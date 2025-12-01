/**
 * Authentication handlers
 * Handles user registration and login
 */

import { Context } from 'hono';
import { hashPassword, verifyPassword, generateToken } from '../lib/auth';

/**
 * Register new organization and admin user
 * POST /api/auth/register
 */
export async function register(c: Context) {
    try {
        const body = await c.req.json();
        console.log('Request body:', body);

        const { organizationName, adminName, email, password, subscriptionTier = 'free' } = body;

        // Validate input
        if (!organizationName || !adminName || !email || !password) {
            console.log('Validation failed: missing fields');
            return c.json({ error: 'Missing required fields' }, 400);
        }

        if (!['free', 'growth', 'enterprise'].includes(subscriptionTier)) {
            console.log('Validation failed: invalid subscriptionTier', subscriptionTier);
            return c.json({ error: 'Invalid subscription tier' }, 400);
        }

        const db = c.env.DB;
        if (!db) {
            console.log('DB binding missing!');
            return c.json({ error: 'DB not configured' }, 500);
        }

        // Check existing user
        let existingUser;
        try {
            existingUser = await db.prepare('SELECT id FROM users WHERE email = ? AND deleted_at IS NULL')
                .bind(email)
                .first();
            console.log('Existing user result:', existingUser);
        } catch (dbErr) {
            console.error('DB error on checking existing user:', dbErr);
            return c.json({ error: 'Database error' }, 500);
        }

        if (existingUser) {
            console.log('Email already registered:', email);
            return c.json({ error: 'Email already registered' }, 409);
        }

        // Hash password
        let passwordHash;
        try {
            console.log('Hashing password...');
            passwordHash = await hashPassword(password);
            console.log('Password hashed');
        } catch (hashErr) {
            console.error('Password hash error:', hashErr);
            return c.json({ error: 'Password hashing failed' }, 500);
        }

        // Create organization
        let orgResult;
        try {
            console.log('Creating organization...');
            orgResult = await db.prepare(
                'INSERT INTO organizations (name, subscription_tier) VALUES (?, ?) RETURNING id'
            ).bind(organizationName, subscriptionTier).first();
            console.log('Organization created:', orgResult);
        } catch (orgErr) {
            console.error('Organization creation error:', orgErr);
            return c.json({ error: 'Organization creation failed' }, 500);
        }

        const organizationId = orgResult.id;

        // Create admin user
        let userResult;
        try {
            console.log('Creating admin user...');
            userResult = await db.prepare(
                'INSERT INTO users (organization_id, email, password_hash, name, role) VALUES (?, ?, ?, ?, ?) RETURNING id, email, name, role'
            ).bind(organizationId, email, passwordHash, adminName, 'admin').first();
            console.log('Admin user created:', userResult);
        } catch (userErr) {
            console.error('Admin user creation error:', userErr);
            return c.json({ error: 'Admin user creation failed' }, 500);
        }

        // Generate JWT token
        let token;
        try {
            console.log('Generating JWT token...');
            token = await generateToken(
                { userId: userResult.id, organizationId, email: userResult.email, role: 'admin' },
                c.env.JWT_SECRET
            );
            console.log('JWT token generated');
        } catch (jwtErr) {
            console.error('JWT generation error:', jwtErr);
            return c.json({ error: 'Token generation failed' }, 500);
        }

        return c.json({
            success: true,
            token,
            user: {
                id: userResult.id,
                name: userResult.name,
                email: userResult.email,
                role: userResult.role,
                organizationId,
                organizationName,
                subscriptionTier,
            },
        }, 201);

    } catch (error) {
        console.error('Registration unexpected error:', error);
        return c.json({ error: 'Registration failed' }, 500);
    }
}

/**
 * Login user
 * POST /api/auth/login
 */
export async function login(c: Context) {
    try {
        const body = await c.req.json();
        const { email, password } = body;

        // Validate input
        if (!email || !password) {
            return c.json({ error: 'Email and password required' }, 400);
        }

        const db = c.env.DB;

        // Get user with organization info
        const user = await db
            .prepare(`
        SELECT 
          u.id, u.email, u.password_hash, u.name, u.role, u.organization_id, u.is_active, u.location_id,
          o.name as organization_name, o.subscription_tier,
          l.name as location_name
        FROM users u
        JOIN organizations o ON u.organization_id = o.id
        LEFT JOIN locations l ON u.location_id = l.id
        WHERE u.email = ? AND u.deleted_at IS NULL AND o.deleted_at IS NULL
      `)
            .bind(email)
            .first();

        if (!user) {
            return c.json({ error: 'Invalid credentials' }, 401);
        }

        if (!user.is_active) {
            return c.json({ error: 'Account is inactive' }, 403);
        }

        // Verify password
        const isValid = await verifyPassword(password, user.password_hash);
        if (!isValid) {
            return c.json({ error: 'Invalid credentials' }, 401);
        }

        // Generate JWT token
        const token = await generateToken(
            {
                userId: user.id,
                organizationId: user.organization_id,
                email: user.email,
                role: user.role,
                locationId: user.location_id,
            },
            c.env.JWT_SECRET
        );

        return c.json({
            success: true,
            token,
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                role: user.role,
                organizationId: user.organization_id,
                organizationName: user.organization_name,
                subscriptionTier: user.subscription_tier,
                locationId: user.location_id,
                locationName: user.location_name,
            },
        });
    } catch (error) {
        console.error('Login error:', error);
        return c.json({ error: 'Login failed' }, 500);
    }
}

/**
 * Get current user info
 * GET /api/auth/me
 */
export async function getCurrentUser(c: Context) {
    try {
        const user = c.get('user');
        const db = c.env.DB;

        const userData = await db
            .prepare(`
        SELECT 
          u.id, u.email, u.name, u.role, u.organization_id, u.location_id,
          o.name as organization_name, o.subscription_tier,
          l.name as location_name
        FROM users u
        JOIN organizations o ON u.organization_id = o.id
        LEFT JOIN locations l ON u.location_id = l.id
        WHERE u.id = ? AND u.deleted_at IS NULL AND o.deleted_at IS NULL
      `)
            .bind(user.userId)
            .first();

        if (!userData) {
            return c.json({ error: 'User not found' }, 404);
        }

        return c.json({
            id: userData.id,
            name: userData.name,
            email: userData.email,
            role: userData.role,
            organizationId: userData.organization_id,
            organizationName: userData.organization_name,
            subscriptionTier: userData.subscription_tier,
            locationId: userData.location_id,
            locationName: userData.location_name,
        });
    } catch (error) {
        console.error('Get current user error:', error);
        return c.json({ error: 'Failed to get user info' }, 500);
    }
}
