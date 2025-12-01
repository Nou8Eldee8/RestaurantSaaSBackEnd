/**
 * Messaging handler (Twilio SMS/WhatsApp)
 * Placeholder for Twilio integration
 */

import { Context } from 'hono';
import { getUser } from '../lib/middleware';
import { decryptClientData } from '../lib/encryption';

/**
 * Send bulk messages
 * POST /api/messaging/send
 */
export async function sendBulkMessage(c: Context) {
    try {
        const user = getUser(c);
        const body = await c.req.json();
        const { messageType, messageContent, clientIds } = body;

        if (!messageType || !messageContent) {
            return c.json({ error: 'Message type and content required' }, 400);
        }

        if (!['sms', 'whatsapp'].includes(messageType)) {
            return c.json({ error: 'Invalid message type' }, 400);
        }

        const db = c.env.DB;
        const masterKey = c.env.ENCRYPTION_MASTER_KEY;

        // Create campaign record
        const campaign = await db
            .prepare(`
        INSERT INTO messaging_campaigns 
        (organization_id, campaign_name, message_type, message_content, status, created_by_user_id)
        VALUES (?, ?, ?, ?, ?, ?)
        RETURNING id
      `)
            .bind(
                user.organizationId,
                `Campaign ${new Date().toISOString()}`,
                messageType,
                messageContent,
                'draft',
                user.userId
            )
            .first();

        // Get clients to message
        let query = `
      SELECT id, encrypted_phone, encryption_iv
      FROM clients
      WHERE organization_id = ? AND deleted_at IS NULL
    `;
        const params = [user.organizationId];

        if (clientIds && clientIds.length > 0) {
            query += ` AND id IN (${clientIds.map(() => '?').join(',')})`;
            params.push(...clientIds);
        }

        const clients = await db.prepare(query).bind(...params).all();

        // Decrypt phone numbers
        const phoneNumbers = await Promise.all(
            clients.results.map(async (client: any) => {
                const { phone } = await decryptClientData(
                    'temp',
                    client.encrypted_phone,
                    client.encryption_iv,
                    masterKey,
                    user.organizationId
                );
                return phone;
            })
        );

        // Update campaign with recipient count
        await db
            .prepare('UPDATE messaging_campaigns SET recipient_count = ?, status = ? WHERE id = ?')
            .bind(phoneNumbers.length, 'completed', campaign.id)
            .run();

        // TODO: Integrate with Twilio API
        // For now, return success with phone numbers
        return c.json({
            success: true,
            campaignId: campaign.id,
            recipientCount: phoneNumbers.length,
            message: 'Campaign created. Twilio integration pending.',
            // In production, don't return phone numbers
            debug: {
                phoneNumbers: phoneNumbers.slice(0, 5), // Show first 5 for testing
            },
        });
    } catch (error) {
        console.error('Send bulk message error:', error);
        return c.json({ error: 'Failed to send messages' }, 500);
    }
}

/**
 * Get messaging campaigns
 * GET /api/messaging/campaigns
 */
export async function getCampaigns(c: Context) {
    try {
        const user = getUser(c);
        const db = c.env.DB;

        const campaigns = await db
            .prepare(`
        SELECT id, campaign_name, message_type, message_content, 
               recipient_count, sent_count, failed_count, status, created_at, completed_at
        FROM messaging_campaigns
        WHERE organization_id = ?
        ORDER BY created_at DESC
        LIMIT 50
      `)
            .bind(user.organizationId)
            .all();

        return c.json({ campaigns: campaigns.results });
    } catch (error) {
        console.error('Get campaigns error:', error);
        return c.json({ error: 'Failed to retrieve campaigns' }, 500);
    }
}
