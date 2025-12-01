/**
 * User management handlers (Admin only)
 */

import { Context } from 'hono';
import { getUser, getTierLimits } from '../lib/middleware';
import { hashPassword } from '../lib/auth';

/**
 * Get all users in organization
 * GET /api/users
 */
export async function getUsers(c: Context) {
    try {
        const user = getUser(c);
        const db = c.env.DB;

        const users = await db
            .prepare(`
        SELECT u.id, u.email, u.name, u.role, u.is_active, u.created_at, u.location_id, l.name as location_name
        FROM users u
        LEFT JOIN locations l ON u.location_id = l.id
        WHERE u.organization_id = ? AND u.deleted_at IS NULL
        ORDER BY u.created_at ASC
      `)
            .bind(user.organizationId)
            .all();

        return c.json({ users: users.results });
    } catch (error) {
        console.error('Get users error:', error);
        return c.json({ error: 'Failed to retrieve users' }, 500);
    }
}

/**
 * Create new user
 * POST /api/users
 */
export async function createUser(c: Context) {
    try {
        const user = getUser(c);
        const body = await c.req.json();
        const { email, password, name, role = 'cashier', locationId } = body;

        if (!email || !password || !name) {
            return c.json({ error: 'Email, password, and name required' }, 400);
        }

        if (!['admin', 'cashier'].includes(role)) {
            return c.json({ error: 'Invalid role' }, 400);
        }

        const db = c.env.DB;

        // Check if email exists
        const existing = await db
            .prepare('SELECT id FROM users WHERE email = ? AND deleted_at IS NULL')
            .bind(email)
            .first();

        if (existing) {
            return c.json({ error: 'Email already exists' }, 409);
        }

        // Get organization tier
        const org = await db
            .prepare('SELECT subscription_tier FROM organizations WHERE id = ?')
            .bind(user.organizationId)
            .first();

        // Check tier limits
        const limits = getTierLimits(org.subscription_tier);
        const currentCount = await db
            .prepare('SELECT COUNT(*) as count FROM users WHERE organization_id = ? AND deleted_at IS NULL')
            .bind(user.organizationId)
            .first();

        if (currentCount.count >= limits.maxUsers) {
            return c.json({
                error: `User limit reached for ${org.subscription_tier} tier (max: ${limits.maxUsers})`,
            }, 403);
        }

        // Hash password
        const passwordHash = await hashPassword(password);

        // Create user
        // Create user
        const result = await db
            .prepare(`
        INSERT INTO users (organization_id, email, password_hash, name, role, location_id)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
            .bind(user.organizationId, email, passwordHash, name, role, locationId || null)
            .run();

        const newUser = {
            id: result.meta.last_row_id,
            email,
            name,
            role,
            is_active: 1,
            location_id: locationId || null,
            created_at: new Date().toISOString()
        };

        return c.json({ success: true, user: newUser }, 201);
    } catch (error) {
        console.error('Create user error:', error);
        return c.json({ error: 'Failed to create user' }, 500);
    }
}

/**
 * Update user
 * PATCH /api/users/:id
 */
export async function updateUser(c: Context) {
    try {
        const user = getUser(c);
        const userId = c.req.param('id');
        const body = await c.req.json();
        const { name, role, isActive, locationId } = body;

        const db = c.env.DB;

        // Verify ownership
        const targetUser = await db
            .prepare('SELECT id FROM users WHERE id = ? AND organization_id = ? AND deleted_at IS NULL')
            .bind(userId, user.organizationId)
            .first();

        if (!targetUser) {
            return c.json({ error: 'User not found' }, 404);
        }

        // Update
        await db
            .prepare(`
        UPDATE users
        SET name = COALESCE(?, name),
            role = COALESCE(?, role),
            is_active = COALESCE(?, is_active),
            location_id = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `)
            .bind(name, role, isActive, locationId === undefined ? null : locationId, userId)
            .run();

        return c.json({ success: true, message: 'User updated' });
    } catch (error) {
        console.error('Update user error:', error);
        return c.json({ error: 'Failed to update user' }, 500);
    }
}

/**
 * Delete user
 * DELETE /api/users/:id
 */
export async function deleteUser(c: Context) {
    try {
        const user = getUser(c);
        const userId = c.req.param('id');
        const db = c.env.DB;

        // Prevent self-deletion
        if (parseInt(userId) === user.userId) {
            return c.json({ error: 'Cannot delete your own account' }, 400);
        }

        // Verify ownership
        const targetUser = await db
            .prepare('SELECT id FROM users WHERE id = ? AND organization_id = ? AND deleted_at IS NULL')
            .bind(userId, user.organizationId)
            .first();

        if (!targetUser) {
            return c.json({ error: 'User not found' }, 404);
        }

        // Soft delete
        await db
            .prepare('UPDATE users SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?')
            .bind(userId)
            .run();

        return c.json({ success: true, message: 'User deleted' });
    } catch (error) {
        console.error('Delete user error:', error);
        return c.json({ error: 'Failed to delete user' }, 500);
    }
}
