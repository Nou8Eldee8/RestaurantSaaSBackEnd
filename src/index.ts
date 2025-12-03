/**
 * Cloudflare Workers Entry Point
 * Restaurant Marketing SaaS API
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';

// Handlers
import { register, login, getCurrentUser } from './handlers/auth';
import { getClients, addClient, deleteClient } from './handlers/clients';
import { getLocations, createLocation, updateLocation, deleteLocation } from './handlers/locations';
import { getUsers, createUser, updateUser, deleteUser } from './handlers/users';
import { exportClients } from './handlers/export';
import { sendBulkMessage, getCampaigns } from './handlers/messaging';
import { getStats } from './handlers/stats';
import { getBranchAnalytics, getBranchRevenueComparison, getBranchClientMetrics, getBranchVisitTrends } from './handlers/branches';
import { verifyWhatsAppWebhook, handleWhatsAppWebhook } from './handlers/webhooks';
import { testWhatsAppMessage } from './handlers/test';

// Middleware
import { authMiddleware, adminMiddleware } from './lib/middleware';

// Types
export interface Env {
    DB: D1Database;
    JWT_SECRET: string;
    ENCRYPTION_MASTER_KEY: string;
    TWILIO_ACCOUNT_SID?: string;
    TWILIO_AUTH_TOKEN?: string;
    TWILIO_PHONE_NUMBER?: string;
    TWILIO_WHATSAPP_NUMBER?: string;
    WHATSAPP_VERIFY_TOKEN: string;
    WHATSAPP_WEBHOOK_SECRET?: string;
    ENCRYPTION_KEY: string;
}

const app = new Hono<{ Bindings: Env }>();

// CORS middleware
app.use('/*', cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
}));

// Health check
app.get('/', (c) => {
    return c.json({
        service: 'Restaurant Marketing API',
        version: '1.0.0',
        status: 'healthy',
    });
});

// ============================================
// Public Routes (No Authentication Required)
// ============================================

// Authentication
app.post('/api/auth/register', register);
app.post('/api/auth/login', login);

// WhatsApp Webhooks (Public - No Auth)
app.get('/api/webhooks/whatsapp', (c) => verifyWhatsAppWebhook(c.req.raw, c.env));
app.post('/api/webhooks/whatsapp', (c) => handleWhatsAppWebhook(c.req.raw, c.env));

// Test endpoint for WhatsApp (Public - for testing only, remove in production)
app.post('/api/test/whatsapp', testWhatsAppMessage);

// ============================================
// Protected Routes (Authentication Required)
// ============================================

// Current user
app.get('/api/auth/me', authMiddleware, getCurrentUser);

// Stats
app.get('/api/stats', authMiddleware, getStats);

// Clients
app.get('/api/clients', authMiddleware, getClients);
app.post('/api/clients', authMiddleware, addClient);
app.delete('/api/clients/:id', authMiddleware, deleteClient);
app.get('/api/clients/export', authMiddleware, exportClients);

// Locations
app.get('/api/locations', authMiddleware, getLocations);
app.post('/api/locations', authMiddleware, createLocation);
app.patch('/api/locations/:id', authMiddleware, updateLocation);
app.delete('/api/locations/:id', authMiddleware, deleteLocation);

// Messaging
app.post('/api/messaging/send', authMiddleware, sendBulkMessage);
app.get('/api/messaging/campaigns', authMiddleware, getCampaigns);

// Branch Analytics
app.get('/api/branches/analytics', authMiddleware, getBranchAnalytics);
app.get('/api/branches/revenue-comparison', authMiddleware, getBranchRevenueComparison);
app.get('/api/branches/client-metrics', authMiddleware, getBranchClientMetrics);
app.get('/api/branches/visit-trends', authMiddleware, getBranchVisitTrends);

// ============================================
// Admin-Only Routes
// ============================================

// User management
app.get('/api/users', authMiddleware, adminMiddleware, getUsers);
app.post('/api/users', authMiddleware, adminMiddleware, createUser);
app.patch('/api/users/:id', authMiddleware, adminMiddleware, updateUser);
app.delete('/api/users/:id', authMiddleware, adminMiddleware, deleteUser);

// 404 handler
app.notFound((c) => {
    return c.json({ error: 'Not found' }, 404);
});

// Error handler
app.onError((err, c) => {
    console.error('Unhandled error:', err);
    return c.json({ error: 'Internal server error' }, 500);
});

export default app;
