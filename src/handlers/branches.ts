/**
 * Branch Analytics Handlers
 * Provides performance metrics and analytics for restaurant locations/branches
 */

import { Context } from 'hono';
import { getUser } from '../lib/middleware';

/**
 * Get comprehensive branch analytics
 * GET /api/branches/analytics?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
 */
export async function getBranchAnalytics(c: Context) {
    try {
        const user = getUser(c);
        const db = c.env.DB;

        // Get date range from query params, default to last 30 days
        const startDate = c.req.query('startDate') || null;
        const endDate = c.req.query('endDate') || null;

        // Build date filter for queries
        const dateFilter = startDate && endDate
            ? `AND created_at >= '${startDate}' AND created_at <= '${endDate}'`
            : `AND created_at >= datetime('now', '-30 days')`;

        // Get all locations for the organization
        const locationsResult = await db
            .prepare(`
                SELECT id, name, address, phone, region
                FROM locations
                WHERE organization_id = ? AND deleted_at IS NULL
                ORDER BY name ASC
            `)
            .bind(user.organizationId)
            .all();

        const locations = locationsResult.results || [];

        // Get analytics for each branch
        const branchAnalytics = await Promise.all(
            locations.map(async (location: any) => {
                // Get visit stats
                const visitStats: any = await db
                    .prepare(`
                        SELECT 
                            COUNT(*) as total_visits,
                            COUNT(DISTINCT client_id) as unique_clients,
                            COALESCE(SUM(ticket_amount), 0) as total_revenue,
                            COALESCE(AVG(ticket_amount), 0) as avg_ticket
                        FROM visits
                        WHERE organization_id = ? 
                        AND location_id = ?
                        ${dateFilter}
                    `)
                    .bind(user.organizationId, location.id)
                    .first();

                // Get returning vs new clients
                const clientMetrics: any = await db
                    .prepare(`
                        SELECT 
                            SUM(CASE WHEN visit_count >= 2 THEN 1 ELSE 0 END) as returning_clients,
                            SUM(CASE WHEN visit_count = 1 THEN 1 ELSE 0 END) as new_clients
                        FROM (
                            SELECT client_id, COUNT(*) as visit_count
                            FROM visits
                            WHERE organization_id = ? 
                            AND location_id = ?
                            ${dateFilter}
                            GROUP BY client_id
                        )
                    `)
                    .bind(user.organizationId, location.id)
                    .first();

                return {
                    locationId: location.id,
                    locationName: location.name,
                    address: location.address,
                    region: location.region,
                    totalVisits: visitStats?.total_visits || 0,
                    uniqueClients: visitStats?.unique_clients || 0,
                    totalRevenue: visitStats?.total_revenue || 0,
                    avgTicket: visitStats?.avg_ticket || 0,
                    returningClients: clientMetrics?.returning_clients || 0,
                    newClients: clientMetrics?.new_clients || 0,
                    retentionRate: visitStats?.unique_clients > 0
                        ? ((clientMetrics?.returning_clients || 0) / visitStats.unique_clients * 100).toFixed(2)
                        : 0
                };
            })
        );

        // Calculate totals
        const totals = branchAnalytics.reduce((acc, branch) => ({
            totalRevenue: acc.totalRevenue + branch.totalRevenue,
            totalVisits: acc.totalVisits + branch.totalVisits,
            totalUniqueClients: acc.totalUniqueClients + branch.uniqueClients,
            totalReturningClients: acc.totalReturningClients + branch.returningClients,
            totalNewClients: acc.totalNewClients + branch.newClients
        }), {
            totalRevenue: 0,
            totalVisits: 0,
            totalUniqueClients: 0,
            totalReturningClients: 0,
            totalNewClients: 0
        });

        return c.json({
            branches: branchAnalytics,
            totals,
            period: {
                startDate: startDate || 'Last 30 days',
                endDate: endDate || 'Today'
            }
        });
    } catch (error) {
        console.error('Get branch analytics error:', error);
        return c.json({
            error: 'Failed to retrieve branch analytics',
            details: error instanceof Error ? error.message : 'Unknown error'
        }, 500);
    }
}

/**
 * Get revenue comparison across branches
 * GET /api/branches/revenue-comparison?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
 */
export async function getBranchRevenueComparison(c: Context) {
    try {
        const user = getUser(c);
        const db = c.env.DB;

        const startDate = c.req.query('startDate') || null;
        const endDate = c.req.query('endDate') || null;

        const dateFilter = startDate && endDate
            ? `AND v.created_at >= '${startDate}' AND v.created_at <= '${endDate}'`
            : `AND v.created_at >= datetime('now', '-30 days')`;

        const revenueData = await db
            .prepare(`
                SELECT 
                    l.id,
                    l.name,
                    l.region,
                    COALESCE(SUM(v.ticket_amount), 0) as revenue,
                    COUNT(v.id) as visit_count
                FROM locations l
                LEFT JOIN visits v ON l.id = v.location_id 
                    AND v.organization_id = ?
                    ${dateFilter}
                WHERE l.organization_id = ? AND l.deleted_at IS NULL
                GROUP BY l.id, l.name, l.region
                ORDER BY revenue DESC
            `)
            .bind(user.organizationId, user.organizationId)
            .all();

        const branches = revenueData.results || [];
        const totalRevenue = branches.reduce((sum: number, b: any) => sum + (b.revenue || 0), 0);

        const comparison = branches.map((branch: any) => ({
            locationId: branch.id,
            locationName: branch.name,
            region: branch.region,
            revenue: branch.revenue,
            visitCount: branch.visit_count,
            percentage: totalRevenue > 0 ? ((branch.revenue / totalRevenue) * 100).toFixed(2) : 0
        }));

        return c.json({
            comparison,
            totalRevenue,
            period: {
                startDate: startDate || 'Last 30 days',
                endDate: endDate || 'Today'
            }
        });
    } catch (error) {
        console.error('Get revenue comparison error:', error);
        return c.json({
            error: 'Failed to retrieve revenue comparison',
            details: error instanceof Error ? error.message : 'Unknown error'
        }, 500);
    }
}

/**
 * Get client engagement metrics by branch
 * GET /api/branches/client-metrics?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
 */
export async function getBranchClientMetrics(c: Context) {
    try {
        const user = getUser(c);
        const db = c.env.DB;

        const startDate = c.req.query('startDate') || null;
        const endDate = c.req.query('endDate') || null;

        const dateFilter = startDate && endDate
            ? `AND created_at >= '${startDate}' AND created_at <= '${endDate}'`
            : `AND created_at >= datetime('now', '-30 days')`;

        const locations = await db
            .prepare(`
                SELECT id, name, region
                FROM locations
                WHERE organization_id = ? AND deleted_at IS NULL
            `)
            .bind(user.organizationId)
            .all();

        const metrics = await Promise.all(
            (locations.results || []).map(async (location: any) => {
                const clientData: any = await db
                    .prepare(`
                        SELECT 
                            COUNT(DISTINCT client_id) as total_clients,
                            SUM(CASE WHEN visit_count >= 2 THEN 1 ELSE 0 END) as returning,
                            SUM(CASE WHEN visit_count = 1 THEN 1 ELSE 0 END) as new_clients,
                            AVG(visit_count) as avg_visits_per_client
                        FROM (
                            SELECT client_id, COUNT(*) as visit_count
                            FROM visits
                            WHERE organization_id = ? 
                            AND location_id = ?
                            ${dateFilter}
                            GROUP BY client_id
                        )
                    `)
                    .bind(user.organizationId, location.id)
                    .first();

                const totalClients = clientData?.total_clients || 0;
                const returning = clientData?.returning || 0;
                const newClients = clientData?.new_clients || 0;

                return {
                    locationId: location.id,
                    locationName: location.name,
                    region: location.region,
                    totalClients,
                    returningClients: returning,
                    newClients,
                    returningPercentage: totalClients > 0 ? ((returning / totalClients) * 100).toFixed(2) : 0,
                    avgVisitsPerClient: clientData?.avg_visits_per_client || 0
                };
            })
        );

        // Find top performers
        const topReturning = metrics.reduce((max, branch) =>
            branch.returningClients > max.returningClients ? branch : max
            , metrics[0] || { returningClients: 0 });

        const topNew = metrics.reduce((max, branch) =>
            branch.newClients > max.newClients ? branch : max
            , metrics[0] || { newClients: 0 });

        return c.json({
            metrics,
            topPerformers: {
                mostReturningClients: topReturning,
                mostNewVisitors: topNew
            },
            period: {
                startDate: startDate || 'Last 30 days',
                endDate: endDate || 'Today'
            }
        });
    } catch (error) {
        console.error('Get client metrics error:', error);
        return c.json({
            error: 'Failed to retrieve client metrics',
            details: error instanceof Error ? error.message : 'Unknown error'
        }, 500);
    }
}

/**
 * Get visit trends over time by branch
 * GET /api/branches/visit-trends?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&groupBy=day|week|month
 */
export async function getBranchVisitTrends(c: Context) {
    try {
        const user = getUser(c);
        const db = c.env.DB;

        const startDate = c.req.query('startDate') || null;
        const endDate = c.req.query('endDate') || null;
        const groupBy = c.req.query('groupBy') || 'day';

        const dateFilter = startDate && endDate
            ? `AND v.created_at >= '${startDate}' AND v.created_at <= '${endDate}'`
            : `AND v.created_at >= datetime('now', '-30 days')`;

        // Determine date grouping format
        let dateFormat = '%Y-%m-%d'; // day
        if (groupBy === 'week') {
            dateFormat = '%Y-W%W';
        } else if (groupBy === 'month') {
            dateFormat = '%Y-%m';
        }

        const trendsData = await db
            .prepare(`
                SELECT 
                    l.id as location_id,
                    l.name as location_name,
                    strftime('${dateFormat}', v.created_at) as period,
                    COUNT(v.id) as visit_count,
                    COALESCE(SUM(v.ticket_amount), 0) as revenue
                FROM locations l
                LEFT JOIN visits v ON l.id = v.location_id 
                    AND v.organization_id = ?
                    ${dateFilter}
                WHERE l.organization_id = ? AND l.deleted_at IS NULL
                GROUP BY l.id, l.name, period
                ORDER BY period ASC, l.name ASC
            `)
            .bind(user.organizationId, user.organizationId)
            .all();

        // Group by location
        const trendsByLocation: any = {};
        (trendsData.results || []).forEach((row: any) => {
            if (!trendsByLocation[row.location_id]) {
                trendsByLocation[row.location_id] = {
                    locationId: row.location_id,
                    locationName: row.location_name,
                    trends: []
                };
            }
            if (row.period) { // Only add if there's actual data
                trendsByLocation[row.location_id].trends.push({
                    period: row.period,
                    visitCount: row.visit_count,
                    revenue: row.revenue
                });
            }
        });

        return c.json({
            trends: Object.values(trendsByLocation),
            groupBy,
            period: {
                startDate: startDate || 'Last 30 days',
                endDate: endDate || 'Today'
            }
        });
    } catch (error) {
        console.error('Get visit trends error:', error);
        return c.json({
            error: 'Failed to retrieve visit trends',
            details: error instanceof Error ? error.message : 'Unknown error'
        }, 500);
    }
}
