/**
 * Client management handlers
 * Compatible with lib/encryption.ts (encryptPayload / decryptPayload)
 *
 * Assumptions:
 * - New rows store the whole {name, phone} JSON ciphertext in `encrypted_name`
 *   and the base64 IV in `encryption_iv`.
 * - `encrypted_phone` column is left present for backwards compatibility but is
 *   not used for the new format.
 */

import { Context } from 'hono';
import { getUser } from '../lib/middleware';
import { encryptClientData, decryptClientData } from '../lib/encryption';

type DBClientRow = {
    id: number;
    encrypted_name: string | null;
    encrypted_phone: string | null;
    encryption_iv: string | null;
    total_orders: number | null;
    total_spent: number | null;
    last_order_date: string | null;
    last_visit: string | null;
    created_at: string | null;
};

export async function getClients(c: Context) {
    try {
        const user = getUser(c);
        const db = c.env.DB;
        const masterKey = c.env.ENCRYPTION_MASTER_KEY as string | undefined;

        if (!masterKey) return c.json({ error: 'Missing encryption key' }, 500);
        if (!db) return c.json({ error: 'Missing database binding' }, 500);

        const page = Number.parseInt(c.req.query('page') || '1', 10);
        const limit = Number.parseInt(c.req.query('limit') || '50', 10);
        const offset = (page - 1) * limit;

        const countResult: any = await db
            .prepare('SELECT COUNT(*) as count FROM clients WHERE organization_id = ? AND deleted_at IS NULL')
            .bind(user.organizationId)
            .first();

        const totalCount = countResult?.count ?? 0;

        if (totalCount === 0) {
            return c.json({
                clients: [],
                pagination: { page, limit, total: 0, totalPages: 0 },
            });
        }

        const clientsResult: any = await db
            .prepare(`
        SELECT id, encrypted_name, encrypted_phone, encryption_iv,
               total_orders, total_spent, last_order_date, last_visit, created_at
        FROM clients
        WHERE organization_id = ? AND deleted_at IS NULL
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?
      `)
            .bind(user.organizationId, limit, offset)
            .all();

        const rows: DBClientRow[] = clientsResult.results ?? [];

        const decryptedClients = await Promise.all(
            rows.map(async (row) => {
                try {
                    if (!row.encrypted_name || !row.encryption_iv) throw new Error('Missing ciphertext or IV');
                    const decrypted = await decryptClientData(row.encrypted_name, row.encryption_iv, masterKey, user.organizationId);
                    return {
                        id: row.id,
                        name: decrypted.name,
                        phone: decrypted.phone,
                        totalOrders: row.total_orders ?? 0,
                        totalSpent: row.total_spent ?? 0,
                        lastOrderDate: row.last_order_date,
                        lastVisit: row.last_visit,
                        createdAt: row.created_at,
                    };
                } catch (err) {
                    console.warn('Decryption fallback triggered for client id', row.id, (err as Error).message);
                    return {
                        id: row.id,
                        name: null,
                        phone: null,
                        totalOrders: row.total_orders ?? 0,
                        totalSpent: row.total_spent ?? 0,
                        lastOrderDate: row.last_order_date,
                        lastVisit: row.last_visit,
                        createdAt: row.created_at,
                    };
                }
            })
        );

        return c.json({
            clients: decryptedClients,
            pagination: {
                page,
                limit,
                total: totalCount,
                totalPages: Math.ceil(totalCount / limit),
            },
        });
    } catch (err: any) {
        console.error('Get clients error:', err);
        return c.json({ error: 'Failed to retrieve clients', details: err?.message ?? 'Unknown' }, 500);
    }
}
export async function addClient(c: Context) {
    try {
        const user = getUser(c);
        const body = await c.req.json();
        const name = body?.name as string | undefined;
        const phone = body?.phone as string | undefined;
        const ticketAmount = body?.ticketAmount as number | undefined;
        const locationId = body?.locationId as number | null | undefined;

        if (!name || !phone || !ticketAmount) {
            return c.json({ error: 'Name, phone, and ticketAmount are required' }, 400);
        }
        if (ticketAmount <= 0) {
            return c.json({ error: 'Ticket amount must be positive' }, 400);
        }

        const db = c.env.DB;
        const masterKey = c.env.ENCRYPTION_MASTER_KEY as string | undefined;
        if (!db || !masterKey) {
            return c.json({ error: 'Server misconfiguration' }, 500);
        }

        // Decrypt existing clients to check for duplicates
        const existingResult: any = await db
            .prepare(`SELECT id, encrypted_name, encryption_iv FROM clients
                      WHERE organization_id = ? AND deleted_at IS NULL`)
            .bind(user.organizationId)
            .all();

        const rows: Array<{ id: number; encrypted_name: string | null; encryption_iv: string | null }> =
            existingResult.results ?? [];

        let clientId: number | null = null;

        for (const r of rows) {
            if (!r.encrypted_name || !r.encryption_iv) continue;
            try {
                const decrypted = await decryptClientData(r.encrypted_name, r.encryption_iv, masterKey, user.organizationId);
                if (decrypted?.phone === phone) {
                    clientId = r.id;
                    break;
                }
            } catch {
                continue; // skip legacy/corrupt rows
            }
        }

        // Create new client if not found
        if (!clientId) {
            const encrypted = await encryptClientData(name, phone, masterKey, user.organizationId);

            const insertResult: any = await db
                .prepare(`
                  INSERT INTO clients (
                      organization_id, encrypted_name, encrypted_phone, encryption_iv,
                      total_orders, total_spent, last_visit
                  ) VALUES (?, ?, ?, ?, 1, ?, CURRENT_TIMESTAMP)
                `)
                .bind(
                    user.organizationId,
                    encrypted.encrypted, // combined ciphertext
                    '',                 // empty string for legacy column (NOT NULL constraint)
                    encrypted.iv,
                    ticketAmount
                )
                .run();

            clientId = insertResult.meta?.last_row_id ?? null;
        } else {
            // Update existing client totals
            await db
                .prepare(`
                  UPDATE clients
                  SET total_orders = total_orders + 1,
                      total_spent = total_spent + ?,
                      last_order_date = CURRENT_TIMESTAMP,
                      last_visit = CURRENT_TIMESTAMP,
                      updated_at = CURRENT_TIMESTAMP
                  WHERE id = ?
                `)
                .bind(ticketAmount, clientId)
                .run();
        }

        // Use provided locationId, or user's location, or NULL for admins
        const finalLocationId = locationId ?? user.locationId ?? null;

        // Insert visit (location_id nullable for admins)
        await db
            .prepare(`
                INSERT INTO visits (organization_id, client_id, location_id, ticket_amount)
                VALUES (?, ?, ?, ?)
            `)
            .bind(user.organizationId, clientId, finalLocationId, ticketAmount)
            .run();

        // Insert order (location_id nullable for admins)
        await db
            .prepare(`
                INSERT INTO orders (organization_id, client_id, location_id, ticket_amount, created_by_user_id)
                VALUES (?, ?, ?, ?, ?)
            `)
            .bind(user.organizationId, clientId, finalLocationId, ticketAmount, user.userId)
            .run();

        return c.json({ success: true, clientId, message: 'Client and order added successfully' }, 201);
    } catch (err) {
        console.error('Add client error:', err);
        return c.json({ error: 'Failed to add client', details: (err as Error).message }, 500);
    }
}

export async function deleteClient(c: Context) {
    try {
        const user = getUser(c);
        const clientId = c.req.param('id');
        const db = c.env.DB;

        const client = await db
            .prepare('SELECT id FROM clients WHERE id = ? AND organization_id = ? AND deleted_at IS NULL')
            .bind(clientId, user.organizationId)
            .first();

        if (!client) return c.json({ error: 'Client not found' }, 404);

        await db.prepare('UPDATE clients SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?').bind(clientId).run();

        return c.json({ success: true, message: 'Client deleted successfully' });
    } catch (err) {
        console.error('Delete client error:', err);
        return c.json({ error: 'Failed to delete client' }, 500);
    }
}
