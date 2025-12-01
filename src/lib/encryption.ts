/**
 * Secure Encryption Utilities (AES-256-GCM)
 * Safely encrypts multi-field objects using JSON + one IV per payload.
 */

export interface EncryptedData {
    encrypted: string;
    iv: string;
}

/**
 * Derive an organization-specific AES-256 key
 */
async function deriveOrgKey(masterKey: string, organizationId: number): Promise<CryptoKey> {
    const encoder = new TextEncoder();
    const keyMaterial = encoder.encode(`${masterKey}-org-${organizationId}`);

    const hashBuffer = await crypto.subtle.digest("SHA-256", keyMaterial);

    return crypto.subtle.importKey(
        "raw",
        hashBuffer,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"]
    );
}

/**
 * Base64 helpers
 */
function toBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    const binary = String.fromCharCode(...bytes);
    return btoa(binary);
}

function fromBase64(base64: string): Uint8Array {
    return Uint8Array.from(atob(base64), c => c.charCodeAt(0));
}

/**
 * Encrypt ANY object (strings, numbers, etc)
 */
export async function encryptPayload(
    data: any,
    masterKey: string,
    organizationId: number
): Promise<EncryptedData> {
    const key = await deriveOrgKey(masterKey, organizationId);

    // JSON → UTF-8 bytes
    const encoder = new TextEncoder();
    const json = JSON.stringify(data);
    const dataBuffer = encoder.encode(json);

    // Unique IV per encryption (required for AES-GCM)
    const iv = crypto.getRandomValues(new Uint8Array(12));

    const encryptedBuffer = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        key,
        dataBuffer
    );

    return {
        encrypted: toBase64(encryptedBuffer),
        iv: toBase64(iv.buffer)
    };
}
/**
 * Decrypt ANY object encrypted by encryptPayload()
 */
export async function decryptPayload(
    encrypted: string,
    iv: string,
    masterKey: string,
    organizationId: number
): Promise<any> {
    try {
        const key = await deriveOrgKey(masterKey, organizationId);

        const encryptedBytes = fromBase64(encrypted);
        const ivBytes = fromBase64(iv);

        const decryptedBuffer = await crypto.subtle.decrypt(
            { name: "AES-GCM", iv: ivBytes },
            key,
            encryptedBytes
        );

        const decoder = new TextDecoder();
        const json = decoder.decode(decryptedBuffer);

        return JSON.parse(json);
    } catch (err) {
        throw new Error("Decryption failed: invalid or corrupted payload");
    }
}

/**
 * Encrypt client data (name + phone)
 */
export async function encryptClientData(
    name: string,
    phone: string,
    masterKey: string,
    organizationId: number
): Promise<{ encrypted: string; iv: string }> {
    // Use encryptPayload for combined {name, phone}
    return encryptPayload({ name, phone }, masterKey, organizationId);
}

export async function decryptClientData(
    encrypted: string,
    iv: string,
    masterKey: string,
    organizationId: number
): Promise<{ name: string; phone: string }> {
    return decryptPayload(encrypted, iv, masterKey, organizationId);
}
