/**
 * Statistics handlers
 * Provides dashboard statistics and analytics
 */

import { Context } from 'hono';
import { getUser } from '../lib/middleware';

/**
 * Get dashboard statistics
 * GET /api/stats?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
 */
export async function getStats(c: Context) {
    try {
        const user = getUser(c);
        const db = c.env.DB;

        // Get date range from query params, default to last 30 days
        const startDate = c.req.query('startDate') || null;
        const endDate = c.req.query('endDate') || null;

        // Calculate days difference for the period
        let daysAgo = 30;
        if (startDate && endDate) {
            const start = new Date(startDate);
            const end = new Date(endDate);
            daysAgo = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
        }

        // Build date filter for queries
        const dateFilter = startDate && endDate
            ? `AND created_at >= '${startDate}' AND created_at <= '${endDate}'`
            : `AND created_at >= datetime('now', '-${daysAgo} days')`;

        const visitDateFilter = startDate && endDate
            ? `AND visit_date >= '${startDate}' AND visit_date <= '${endDate}'`
            : `AND visit_date >= datetime('now', '-${daysAgo} days')`;

        // Get total clients count
        const totalClientsResult = await db
            .prepare('SELECT COUNT(*) as count FROM clients WHERE organization_id = ? AND deleted_at IS NULL')
            .bind(user.organizationId)
            .first();

        const totalClients = totalClientsResult?.count || 0;

        // Get new clients in the selected period
        const newClientsResult = await db
            .prepare(`
                SELECT COUNT(*) as count 
                FROM clients 
                WHERE organization_id = ? 
                ${dateFilter}
                AND deleted_at IS NULL
            `)
            .bind(user.organizationId)
            .first();

        const newClients = newClientsResult?.count || 0;

        // Get returning clients (2+ visits in selected period)
        const returningClientsResult = await db
            .prepare(`
                SELECT COUNT(DISTINCT client_id) as count
                FROM (
                    SELECT client_id, COUNT(*) as visit_count
                    FROM visits
                    WHERE organization_id = ?
                    ${visitDateFilter}
                    GROUP BY client_id
                    HAVING visit_count >= 2
                )
            `)
            .bind(user.organizationId)
            .first();

        const returningClients = returningClientsResult?.count || 0;

        // Get reactivated clients
        // These are clients who:
        // 1. Have a visit in the selected period
        // 2. Their previous visit before that was more than the period length ago
        const reactivationThreshold = startDate && endDate
            ? `'${startDate}'`
            : `datetime('now', '-${daysAgo} days')`;

        const reactivatedClientsResult = await db
            .prepare(`
                SELECT COUNT(DISTINCT v1.client_id) as count
                FROM visits v1
                WHERE v1.organization_id = ?
                ${visitDateFilter}
                AND EXISTS (
                    SELECT 1 FROM visits v2
                    WHERE v2.client_id = v1.client_id
                    AND v2.organization_id = v1.organization_id
                    AND v2.visit_date < ${reactivationThreshold}
                    AND v2.visit_date < v1.visit_date
                )
                AND NOT EXISTS (
                    SELECT 1 FROM visits v3
                    WHERE v3.client_id = v1.client_id
                    AND v3.organization_id = v1.organization_id
                    AND v3.visit_date >= datetime(${reactivationThreshold}, '-${daysAgo} days')
                    AND v3.visit_date < ${reactivationThreshold}
                )
            `)
            .bind(user.organizationId)
            .first();

        const reactivatedClients = reactivatedClientsResult?.count || 0;

        // Get total revenue from all clients
        const revenueResult = await db
            .prepare(`
                SELECT COALESCE(SUM(total_spent), 0) as total
                FROM clients
                WHERE organization_id = ?
                AND deleted_at IS NULL
            `)
            .bind(user.organizationId)
            .first();

        const totalRevenue = revenueResult?.total || 0;

        return c.json({
            totalClients,
            newClients,
            returningClients,
            reactivatedClients,
            totalRevenue,
        });
    } catch (error) {
        console.error('Get stats error:', error);
        return c.json({ error: 'Failed to retrieve statistics' }, 500);
    }
}
