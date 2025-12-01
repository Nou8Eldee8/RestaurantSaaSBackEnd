/**
 * Location management handlers
 */

import { Context } from 'hono';
import { getUser, getTierLimits } from '../lib/middleware';

/**
 * Get all locations
 * GET /api/locations
 */
export async function getLocations(c: Context) {
    try {
        const user = getUser(c);
        const db = c.env.DB;

        const locations = await db
            .prepare(`
        SELECT id, name, address, phone, region, created_at
        FROM locations
        WHERE organization_id = ? AND deleted_at IS NULL
        ORDER BY created_at ASC
      `)
            .bind(user.organizationId)
            .all();

        return c.json({ locations: locations.results });
    } catch (error) {
        console.error('Get locations error:', error);
        return c.json({ error: 'Failed to retrieve locations' }, 500);
    }
}

/**
 * Create new location
 * POST /api/locations
 */
export async function createLocation(c: Context) {
    try {
        const user = getUser(c);
        const body = await c.req.json();
        const { name, address, phone, region } = body;

        if (!name) {
            return c.json({ error: 'Location name required' }, 400);
        }

        const db = c.env.DB;

        // Get organization tier
        const org = await db
            .prepare('SELECT subscription_tier FROM organizations WHERE id = ?')
            .bind(user.organizationId)
            .first();

        // Check tier limits
        const limits = getTierLimits(org.subscription_tier);
        const currentCount = await db
            .prepare('SELECT COUNT(*) as count FROM locations WHERE organization_id = ? AND deleted_at IS NULL')
            .bind(user.organizationId)
            .first();

        if (currentCount.count >= limits.maxLocations) {
            return c.json({
                error: `Location limit reached for ${org.subscription_tier} tier (max: ${limits.maxLocations})`,
            }, 403);
        }

        // Create location
        const result = await db
            .prepare(`
        INSERT INTO locations (organization_id, name, address, phone, region)
        VALUES (?, ?, ?, ?, ?)
      `)
            .bind(user.organizationId, name, address || null, phone || null, region || null)
            .run();

        const newLocation = {
            id: result.meta.last_row_id,
            name,
            address,
            phone,
            region,
            created_at: new Date().toISOString()
        };

        return c.json({ success: true, location: newLocation }, 201);
    } catch (error) {
        console.error('Create location error:', error);
        return c.json({ error: 'Failed to create location' }, 500);
    }
}

/**
 * Update location
 * PATCH /api/locations/:id
 */
export async function updateLocation(c: Context) {
    try {
        const user = getUser(c);
        const locationId = c.req.param('id');
        const body = await c.req.json();
        const { name, address, phone, region } = body;

        const db = c.env.DB;

        // Verify ownership
        const location = await db
            .prepare('SELECT id FROM locations WHERE id = ? AND organization_id = ? AND deleted_at IS NULL')
            .bind(locationId, user.organizationId)
            .first();

        if (!location) {
            return c.json({ error: 'Location not found' }, 404);
        }

        // Update
        await db
            .prepare(`
        UPDATE locations
        SET name = COALESCE(?, name),
            address = COALESCE(?, address),
            phone = COALESCE(?, phone),
            region = COALESCE(?, region),
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `)
            .bind(name, address, phone, region, locationId)
            .run();

        return c.json({ success: true, message: 'Location updated' });
    } catch (error) {
        console.error('Update location error:', error);
        return c.json({ error: 'Failed to update location' }, 500);
    }
}

/**
 * Delete location
 * DELETE /api/locations/:id
 */
export async function deleteLocation(c: Context) {
    try {
        const user = getUser(c);
        const locationId = c.req.param('id');
        const db = c.env.DB;

        // Verify ownership
        const location = await db
            .prepare('SELECT id FROM locations WHERE id = ? AND organization_id = ? AND deleted_at IS NULL')
            .bind(locationId, user.organizationId)
            .first();

        if (!location) {
            return c.json({ error: 'Location not found' }, 404);
        }

        // Soft delete
        await db
            .prepare('UPDATE locations SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?')
            .bind(locationId)
            .run();

        return c.json({ success: true, message: 'Location deleted' });
    } catch (error) {
        console.error('Delete location error:', error);
        return c.json({ error: 'Failed to delete location' }, 500);
    }
}
