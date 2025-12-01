/**
 * Middleware utilities for Cloudflare Workers
 */

import { Context } from 'hono';
import { verifyToken, extractToken, JWTPayload } from './auth';

export interface AuthContext {
    user: JWTPayload;
}

/**
 * Authentication middleware
 * Verifies JWT token and adds user context
 */
export async function authMiddleware(c: Context, next: () => Promise<void>) {
    const token = extractToken(c.req.raw);

    if (!token) {
        return c.json({ error: 'Unauthorized - No token provided' }, 401);
    }

    const jwtSecret = c.env.JWT_SECRET;
    const payload = await verifyToken(token, jwtSecret);

    if (!payload) {
        return c.json({ error: 'Unauthorized - Invalid or expired token' }, 401);
    }

    // Add user to context
    c.set('user', payload);
    await next();
}

/**
 * Admin-only middleware
 * Requires authentication and admin role
 */
export async function adminMiddleware(c: Context, next: () => Promise<void>) {
    const user = c.get('user') as JWTPayload;

    if (!user) {
        return c.json({ error: 'Unauthorized' }, 401);
    }

    if (user.role !== 'admin') {
        return c.json({ error: 'Forbidden - Admin access required' }, 403);
    }

    await next();
}

/**
 * CORS middleware
 */
export function corsMiddleware(c: Context, next: () => Promise<void>) {
    // Handle preflight requests
    if (c.req.method === 'OPTIONS') {
        return new Response(null, {
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization',
                'Access-Control-Max-Age': '86400',
            },
        });
    }

    return next();
}

/**
 * Add CORS headers to response
 */
export function addCorsHeaders(response: Response): Response {
    const headers = new Headers(response.headers);
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
    });
}

/**
 * Get user from context
 */
export function getUser(c: Context): JWTPayload {
    return c.get('user') as JWTPayload;
}

/**
 * Check subscription tier limits
 */
export interface TierLimits {
    maxLocations: number;
    maxUsers: number;
}

export function getTierLimits(tier: string): TierLimits {
    switch (tier) {
        case 'free':
            return { maxLocations: 1, maxUsers: 4 }; // 1 admin + 3 users
        case 'growth':
            return { maxLocations: 3, maxUsers: 11 }; // 1 admin + 10 users
        case 'enterprise':
            return { maxLocations: Infinity, maxUsers: Infinity };
        default:
            return { maxLocations: 1, maxUsers: 4 };
    }
}
