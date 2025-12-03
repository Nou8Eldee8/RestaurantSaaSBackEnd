import { Env } from '../index';

/**
 * WhatsApp Business API Integration
 * Sends messages using Meta's WhatsApp Business API
 */

interface WhatsAppTextMessage {
    messaging_product: 'whatsapp';
    recipient_type: 'individual';
    to: string;
    type: 'text';
    text: {
        preview_url: boolean;
        body: string;
    };
}

interface WhatsAppResponse {
    messaging_product: string;
    contacts: Array<{
        input: string;
        wa_id: string;
    }>;
    messages: Array<{
        id: string;
    }>;
}

interface WhatsAppError {
    error: {
        message: string;
        type: string;
        code: number;
        error_subcode?: number;
        fbtrace_id: string;
    };
}

/**
 * Send a WhatsApp message to a single recipient
 */
export async function sendWhatsAppMessage(
    phoneNumber: string,
    messageBody: string,
    organizationId: number,
    env: Env
): Promise<{ success: boolean; messageId?: string; error?: string }> {
    try {
        // Get organization's WhatsApp credentials from database
        const org = await env.DB.prepare(
            'SELECT whatsapp_access_token, whatsapp_phone_number_id FROM organizations WHERE id = ? AND deleted_at IS NULL'
        ).bind(organizationId).first<{
            whatsapp_access_token: string | null;
            whatsapp_phone_number_id: string | null;
        }>();

        if (!org || !org.whatsapp_access_token || !org.whatsapp_phone_number_id) {
            return {
                success: false,
                error: 'WhatsApp credentials not configured for this organization'
            };
        }

        // Normalize phone number (remove any non-digit characters except +)
        const normalizedPhone = phoneNumber.replace(/[^\d+]/g, '');

        // Remove + if present
        let cleanPhone = normalizedPhone.replace('+', '');

        // Add Egyptian country code (20) if number starts with 0
        // Egyptian numbers: 01220386963 → 201220386963
        if (cleanPhone.startsWith('0')) {
            cleanPhone = '20' + cleanPhone.substring(1);
        }

        // Prepare WhatsApp message payload
        const payload: WhatsAppTextMessage = {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: cleanPhone,
            type: 'text',
            text: {
                preview_url: true,
                body: messageBody
            }
        };

        // Send message via WhatsApp Business API
        const response = await fetch(
            `https://graph.facebook.com/v22.0/${org.whatsapp_phone_number_id}/messages`,
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${org.whatsapp_access_token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            }
        );

        const responseData = await response.json();

        if (!response.ok) {
            const errorData = responseData as WhatsAppError;
            console.error('WhatsApp API Error:', errorData);
            return {
                success: false,
                error: errorData.error?.message || 'Failed to send WhatsApp message'
            };
        }

        const successData = responseData as WhatsAppResponse;
        const messageId = successData.messages?.[0]?.id;

        console.log('WhatsApp message sent successfully:', {
            messageId,
            to: cleanPhone,
            organizationId
        });

        return {
            success: true,
            messageId
        };

    } catch (error) {
        console.error('Error sending WhatsApp message:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error occurred'
        };
    }
}

/**
 * Send WhatsApp messages to multiple recipients
 */
export async function sendBulkWhatsAppMessages(
    recipients: Array<{ phone: string; name: string }>,
    messageBody: string,
    organizationId: number,
    env: Env
): Promise<{
    totalSent: number;
    totalFailed: number;
    results: Array<{ phone: string; success: boolean; messageId?: string; error?: string }>;
}> {
    const results = [];
    let totalSent = 0;
    let totalFailed = 0;

    for (const recipient of recipients) {
        const result = await sendWhatsAppMessage(
            recipient.phone,
            messageBody,
            organizationId,
            env
        );

        results.push({
            phone: recipient.phone,
            ...result
        });

        if (result.success) {
            totalSent++;
        } else {
            totalFailed++;
        }

        // Add a small delay between messages to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));
    }

    return {
        totalSent,
        totalFailed,
        results
    };
}
