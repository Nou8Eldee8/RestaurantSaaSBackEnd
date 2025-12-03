// WhatsApp Webhook Types
// Based on WhatsApp Business API webhook payload structure

export interface WhatsAppWebhookEntry {
    id: string;
    changes: WhatsAppChange[];
}

export interface WhatsAppChange {
    value: WhatsAppValue;
    field: string;
}

export interface WhatsAppValue {
    messaging_product: string;
    metadata: WhatsAppMetadata;
    contacts?: WhatsAppContact[];
    messages?: WhatsAppMessage[];
    statuses?: WhatsAppStatus[];
}

export interface WhatsAppMetadata {
    display_phone_number: string;
    phone_number_id: string;
}

export interface WhatsAppContact {
    profile: {
        name: string;
    };
    wa_id: string;
}

export interface WhatsAppMessage {
    from: string;
    id: string;
    timestamp: string;
    type: 'text' | 'image' | 'video' | 'audio' | 'document' | 'location' | 'contacts';
    text?: {
        body: string;
    };
    image?: WhatsAppMedia;
    video?: WhatsAppMedia;
    audio?: WhatsAppMedia;
    document?: WhatsAppMedia;
    location?: {
        latitude: number;
        longitude: number;
        name?: string;
        address?: string;
    };
    contacts?: any[];
}

export interface WhatsAppMedia {
    id: string;
    mime_type: string;
    sha256: string;
    caption?: string;
}

export interface WhatsAppStatus {
    id: string;
    status: 'sent' | 'delivered' | 'read' | 'failed';
    timestamp: string;
    recipient_id: string;
}

export interface WhatsAppWebhookPayload {
    object: string;
    entry: WhatsAppWebhookEntry[];
}

export interface StoredWhatsAppMessage {
    id?: number;
    organization_id: number;
    client_id: number | null;
    phone_number: string;
    message_content: string;
    message_type: string;
    whatsapp_message_id: string;
    timestamp: string;
    expires_at: string;
    metadata: string | null;
}
