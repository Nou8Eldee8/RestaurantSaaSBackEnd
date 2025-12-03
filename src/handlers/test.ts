import { Env } from '../index';
import { sendWhatsAppMessage } from '../lib/whatsapp';

/**
 * Test WhatsApp Message Sending
 * POST /api/test/whatsapp
 * 
 * This is a test endpoint to quickly verify WhatsApp integration
 */
export async function testWhatsAppMessage(c: any) {
    try {
        const body = await c.req.json();
        const { phoneNumber, message, organizationId } = body;

        if (!phoneNumber || !message) {
            return c.json({
                error: 'Phone number and message are required',
                example: {
                    phoneNumber: '201220386963',
                    message: 'Hello from Loyal Base!',
                    organizationId: 1
                }
            }, 400);
        }

        const orgId = organizationId || 1; // Default to org 1 for testing

        const result = await sendWhatsAppMessage(
            phoneNumber,
            message,
            orgId,
            c.env as Env
        );

        if (result.success) {
            return c.json({
                success: true,
                message: 'WhatsApp message sent successfully!',
                messageId: result.messageId,
                sentTo: phoneNumber
            });
        } else {
            return c.json({
                success: false,
                error: result.error
            }, 400);
        }

    } catch (error) {
        console.error('Test WhatsApp error:', error);
        return c.json({
            error: 'Failed to send test message',
            details: error instanceof Error ? error.message : 'Unknown error'
        }, 500);
    }
}
