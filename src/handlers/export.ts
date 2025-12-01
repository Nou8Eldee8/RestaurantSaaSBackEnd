/**
 * Data export handler
 * Exports client data as CSV or XLSX
 */

import { Context } from 'hono';
import { getUser } from '../lib/middleware';
import { decryptClientData } from '../lib/encryption';

/**
 * Export clients as CSV or XLSX
 * GET /api/clients/export?format=csv|xlsx
 */
export async function exportClients(c: Context) {
    try {
        const user = getUser(c);
        const format = c.req.query('format') || 'csv';

        if (!['csv', 'xlsx'].includes(format)) {
            return c.json({ error: 'Invalid format. Use csv or xlsx' }, 400);
        }

        const db = c.env.DB;
        const masterKey = c.env.ENCRYPTION_MASTER_KEY;

        // Get all clients
        const clients = await db
            .prepare(`
        SELECT encrypted_name, encrypted_phone, encryption_iv, 
               total_orders, total_spent, last_order_date, created_at
        FROM clients
        WHERE organization_id = ? AND deleted_at IS NULL
        ORDER BY created_at DESC
      `)
            .bind(user.organizationId)
            .all();

        // Decrypt client data
        const decryptedClients = await Promise.all(
            clients.results.map(async (client: any) => {
                const { name, phone } = await decryptClientData(
                    client.encrypted_name,
                    client.encrypted_phone,
                    client.encryption_iv,
                    masterKey,
                    user.organizationId
                );

                return {
                    Name: name,
                    Phone: phone,
                    'Total Orders': client.total_orders,
                    'Total Spent': client.total_spent?.toFixed(2) || '0.00',
                    'Last Order Date': client.last_order_date || 'N/A',
                    'Customer Since': client.created_at,
                };
            })
        );

        if (format === 'csv') {
            // Generate CSV
            const headers = ['Name', 'Phone', 'Total Orders', 'Total Spent', 'Last Order Date', 'Customer Since'];
            const csvRows = [headers.join(',')];

            for (const client of decryptedClients) {
                const row = headers.map(header => {
                    const value = client[header] || '';
                    // Escape commas and quotes
                    return `"${String(value).replace(/"/g, '""')}"`;
                });
                csvRows.push(row.join(','));
            }

            const csvContent = csvRows.join('\n');

            return new Response(csvContent, {
                headers: {
                    'Content-Type': 'text/csv',
                    'Content-Disposition': `attachment; filename="clients-export-${Date.now()}.csv"`,
                },
            });
        } else {
            // For XLSX, we'll use a simple approach
            // In production, you'd use the xlsx library
            return c.json({
                message: 'XLSX export not yet implemented. Please use CSV format.',
                data: decryptedClients,
            });
        }
    } catch (error) {
        console.error('Export error:', error);
        return c.json({ error: 'Failed to export clients' }, 500);
    }
}
