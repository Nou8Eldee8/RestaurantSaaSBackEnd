import { Env } from '../index';
import { WhatsAppWebhookPayload, WhatsAppMessage, StoredWhatsAppMessage } from '../types/webhook';
import { decryptPayload } from '../lib/encryption';

/**
 * WhatsApp Webhook Handler
 * Handles webhook verification and incoming messages from WhatsApp Business API
 */

// GET /api/webhooks/whatsapp - Webhook Verification
export async function verifyWhatsAppWebhook(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');

    // Check if verification token matches
    if (mode === 'subscribe' && token === env.WHATSAPP_VERIFY_TOKEN) {
        console.log('Webhook verified successfully');
        return new Response(challenge, { status: 200 });
    }

    console.error('Webhook verification failed');
    return new Response('Forbidden', { status: 403 });
}

// POST /api/webhooks/whatsapp - Receive Messages
export async function handleWhatsAppWebhook(request: Request, env: Env): Promise<Response> {
    try {
        // Verify webhook signature (optional but recommended)
        // const signature = request.headers.get('X-Hub-Signature-256');
        // if (!verifySignature(await request.text(), signature, env.WHATSAPP_WEBHOOK_SECRET)) {
        //   return new Response('Invalid signature', { status: 403 });
        // }

        const payload: WhatsAppWebhookPayload = await request.json();

        // WhatsApp sends 'object' field to identify webhook type
        if (payload.object !== 'whatsapp_business_account') {
            return new Response('Not a WhatsApp webhook', { status: 400 });
        }

        // Process each entry in the webhook
        for (const entry of payload.entry) {
            for (const change of entry.changes) {
                if (change.value.messages) {
                    // Process incoming messages
                    for (const message of change.value.messages) {
                        await processIncomingMessage(message, change.value.metadata.phone_number_id, env);
                    }
                }

                if (change.value.statuses) {
                    // Process message status updates (delivered, read, etc.)
                    // Can be implemented later for tracking message delivery
                    console.log('Status update received:', change.value.statuses);
                }
            }
        }

        // WhatsApp expects a 200 OK response
        return new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });

    } catch (error) {
        console.error('Error processing webhook:', error);
        return new Response(JSON.stringify({ error: 'Internal server error' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

async function processIncomingMessage(
    message: WhatsAppMessage,
    phoneNumberId: string,
    env: Env
): Promise<void> {
    try {
        const senderPhone = message.from;
        const messageId = message.id;
        const timestamp = message.timestamp;

        // Extract message content based on type
        let messageContent = '';
        let messageType = message.type;

        switch (message.type) {
            case 'text':
                messageContent = message.text?.body || '';
                break;
            case 'image':
            case 'video':
            case 'audio':
            case 'document':
                messageContent = message[message.type]?.caption || `[${message.type}]`;
                break;
            case 'location':
                messageContent = `Location: ${message.location?.latitude}, ${message.location?.longitude}`;
                break;
            default:
                messageContent = `[${message.type}]`;
        }

        // Find organization by phone number ID (you'll need to store this mapping)
        // For now, we'll use a placeholder - you should implement proper organization lookup
        const organizationId = await getOrganizationByPhoneNumberId(phoneNumberId, env);

        if (!organizationId) {
            console.error('Organization not found for phone number ID:', phoneNumberId);
            return;
        }

        // Try to find matching client by phone number
        const clientId = await findClientByPhone(senderPhone, organizationId, env);

        // Calculate expiration date (60 days from now)
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 60);

        // Store message in database
        const storedMessage: Omit<StoredWhatsAppMessage, 'id'> = {
            organization_id: organizationId,
            client_id: clientId,
            phone_number: senderPhone,
            message_content: messageContent,
            message_type: messageType,
            whatsapp_message_id: messageId,
            timestamp: new Date(parseInt(timestamp) * 1000).toISOString(),
            expires_at: expiresAt.toISOString(),
            metadata: JSON.stringify(message)
        };

        await env.DB.prepare(
            `INSERT INTO whatsapp_messages 
       (organization_id, client_id, phone_number, message_content, message_type, whatsapp_message_id, timestamp, expires_at, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
            .bind(
                storedMessage.organization_id,
                storedMessage.client_id,
                storedMessage.phone_number,
                storedMessage.message_content,
                storedMessage.message_type,
                storedMessage.whatsapp_message_id,
                storedMessage.timestamp,
                storedMessage.expires_at,
                storedMessage.metadata
            )
            .run();

        console.log('Message stored successfully:', messageId);

    } catch (error) {
        console.error('Error processing message:', error);
        throw error;
    }
}

async function getOrganizationByPhoneNumberId(phoneNumberId: string, env: Env): Promise<number | null> {
    // TODO: Implement proper mapping of WhatsApp phone number IDs to organizations
    // For now, return the first organization (for testing)
    // You should add a table to store this mapping or add a field to organizations table

    const result = await env.DB.prepare(
        'SELECT id FROM organizations WHERE deleted_at IS NULL LIMIT 1'
    ).first<{ id: number }>();

    return result?.id || null;
}

async function findClientByPhone(phone: string, organizationId: number, env: Env): Promise<number | null> {
    try {
        // Get all clients for this organization
        const clients = await env.DB.prepare(
            'SELECT id, encrypted_phone, encryption_iv FROM clients WHERE organization_id = ? AND deleted_at IS NULL'
        ).bind(organizationId).all<{ id: number; encrypted_phone: string; encryption_iv: string }>();

        // Decrypt and compare phone numbers
        for (const client of clients.results) {
            try {
                const decryptedData = await decryptPayload(
                    client.encrypted_phone,
                    client.encryption_iv,
                    env.ENCRYPTION_MASTER_KEY,
                    organizationId
                );

                const decryptedPhone = decryptedData.phone;

                // Normalize phone numbers for comparison (remove +, spaces, etc.)
                const normalizedClientPhone = decryptedPhone.replace(/[\s\-\+\(\)]/g, '');
                const normalizedSenderPhone = phone.replace(/[\s\-\+\(\)]/g, '');

                if (normalizedClientPhone === normalizedSenderPhone ||
                    normalizedClientPhone.endsWith(normalizedSenderPhone) ||
                    normalizedSenderPhone.endsWith(normalizedClientPhone)) {
                    return client.id;
                }
            } catch (decryptError) {
                console.error('Error decrypting phone for client:', client.id, decryptError);
            }
        }

        return null;
    } catch (error) {
        console.error('Error finding client by phone:', error);
        return null;
    }
}
