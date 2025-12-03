/**
 * Messaging handler (WhatsApp Business API)
 * Sends messages using Meta's WhatsApp Business API
 */

import { Context } from 'hono';
import { getUser } from '../lib/middleware';
import { decryptPayload } from '../lib/encryption';
import { sendBulkWhatsAppMessages } from '../lib/whatsapp';

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

        // Only WhatsApp is supported for now
        if (messageType !== 'whatsapp') {
            return c.json({ error: 'Only WhatsApp messaging is currently supported' }, 400);
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
                'sending',
                user.userId
            )
            .first() as { id: number } | null;

        if (!campaign) {
            return c.json({ error: 'Failed to create campaign' }, 500);
        }

        // Get clients to message - USE encrypted_name NOT encrypted_phone
        let query = `
      SELECT id, encrypted_name, encryption_iv
      FROM clients
      WHERE organization_id = ? AND deleted_at IS NULL
    `;
        const params = [user.organizationId];

        if (clientIds && clientIds.length > 0) {
            query += ` AND id IN (${clientIds.map(() => '?').join(',')})`;
            params.push(...clientIds);
        }

        const clients = (await db.prepare(query).bind(...params).all()) as {
            results: {
                id: number;
                encrypted_name: string;
                encryption_iv: string;
            }[];
        };

        // Decrypt phone numbers and prepare recipients
        const recipients = await Promise.all(
            clients.results.map(async (client) => {
                const decryptedData = await decryptPayload(
                    client.encrypted_name,
                    client.encryption_iv,
                    masterKey,
                    user.organizationId
                );

                // Log decrypted data for debugging
                console.log('Decrypted client data:', {
                    id: client.id,
                    phone: decryptedData.phone,
                    name: decryptedData.name
                });

                return {
                    phone: decryptedData.phone,
                    name: decryptedData.name || 'Customer'
                };
            })
        );

        // Update campaign with recipient count
        await db
            .prepare('UPDATE messaging_campaigns SET recipient_count = ? WHERE id = ?')
            .bind(recipients.length, campaign.id)
            .run();

        // Send WhatsApp messages
        const result = await sendBulkWhatsAppMessages(
            recipients,
            messageContent,
            user.organizationId,
            c.env
        );

        // Update campaign with results
        await db
            .prepare(`
        UPDATE messaging_campaigns 
        SET sent_count = ?, failed_count = ?, status = ?, completed_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `)
            .bind(
                result.totalSent,
                result.totalFailed,
                result.totalFailed === 0 ? 'completed' : 'failed',
                campaign.id
            )
            .run();

        return c.json({
            success: true,
            campaignId: campaign.id,
            recipientCount: recipients.length,
            sentCount: result.totalSent,
            failedCount: result.totalFailed,
            message: `Successfully sent ${result.totalSent} messages, ${result.totalFailed} failed`,
            results: result.results
        });

    } catch (error) {
        console.error('Send bulk message error:', error);
        return c.json({
            error: 'Failed to send messages',
            details: error instanceof Error ? error.message : 'Unknown error'
        }, 500);
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
