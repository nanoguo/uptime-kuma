let express = require("express");
const dayjs = require("dayjs");
dayjs.extend(require("dayjs/plugin/utc"));
const apicache = require("../modules/apicache");
const { UptimeKumaServer } = require("../uptime-kuma-server");
const Database = require("../database");
const StatusPage = require("../model/status_page");
const { allowDevAllOrigin, sendHttpError } = require("../util-server");
const { R } = require("redbean-node");
const { badgeConstants } = require("../../src/util");
const { makeBadge } = require("badge-maker");
const { UptimeCalculator } = require("../uptime-calculator");
const { DeploymentMiddleware } = require("../middleware/deployment-middleware");

/**
 * Get daily aggregated heartbeats for long-term views (90d)
 * This avoids fetching massive amounts of minute-level data
 * @param {number} monitorID - Monitor ID
 * @param {number} days - Number of days to aggregate
 * @returns {Promise<Array>} Array of daily aggregated heartbeat objects
 */
async function getDailyAggregatedHeartbeats(monitorID, days) {
    const result = [];

    try {
        let dailyStats;

        if (Database.dbConfig.type === "sqlite") {
            // SQLite: Group by date and calculate daily status
            dailyStats = await R.getAll(`
                SELECT
                    DATE(time) as day,
                    COUNT(*) as total_heartbeats,
                    SUM(CASE WHEN status = 1 THEN 1 ELSE 0 END) as up_count,
                    SUM(CASE WHEN status = 0 THEN 1 ELSE 0 END) as down_count,
                    SUM(CASE WHEN status = 2 THEN 1 ELSE 0 END) as pending_count,
                    SUM(CASE WHEN status = 3 THEN 1 ELSE 0 END) as maintenance_count,
                    MIN(time) as first_time,
                    MAX(time) as last_time
                FROM heartbeat
                WHERE monitor_id = ? AND time >= DATETIME('now', ?)
                GROUP BY DATE(time)
                ORDER BY day DESC
                LIMIT ?
            `, [ monitorID, `-${days} days`, days ]);
        } else {
            // MariaDB/MySQL: Group by date and calculate daily status
            dailyStats = await R.getAll(`
                SELECT
                    DATE(time) as day,
                    COUNT(*) as total_heartbeats,
                    SUM(CASE WHEN status = 1 THEN 1 ELSE 0 END) as up_count,
                    SUM(CASE WHEN status = 0 THEN 1 ELSE 0 END) as down_count,
                    SUM(CASE WHEN status = 2 THEN 1 ELSE 0 END) as pending_count,
                    SUM(CASE WHEN status = 3 THEN 1 ELSE 0 END) as maintenance_count,
                    MIN(time) as first_time,
                    MAX(time) as last_time
                FROM heartbeat
                WHERE monitor_id = ? AND time >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? DAY)
                GROUP BY DATE(time)
                ORDER BY day DESC
                LIMIT ?
            `, [ monitorID, days, days ]);
        }

        // Convert daily stats to heartbeat-like format for frontend compatibility
        for (const stat of dailyStats) {
            // Determine overall status for the day based on uptime percentage
            const uptimePercent = stat.total_heartbeats > 0 ? (stat.up_count / stat.total_heartbeats) : 0;
            let dayStatus = 1; // Default to UP
            let dayMessage = "Up";

            if (stat.maintenance_count > 0 && (stat.maintenance_count / stat.total_heartbeats) > 0.1) {
                // More than 10% maintenance
                dayStatus = 3; // Maintenance
                dayMessage = "Maintenance";
            } else if (stat.pending_count > 0 && (stat.pending_count / stat.total_heartbeats) > 0.05) {
                // More than 5% pending
                dayStatus = 2; // Pending
                dayMessage = "Pending checks";
            } else if (uptimePercent === 1) {
                // 100% uptime - Perfect (亮绿色)
                dayStatus = 1; // Perfect
                dayMessage = "No downtime recorded";
            } else if (uptimePercent >= 0.999) {
                // 99.9-99.99% uptime - Excellent (浅绿色)
                dayStatus = 5; // Excellent
                const downMinutes = stat.down_count;
                const hours = Math.floor(downMinutes / 60);
                const mins = downMinutes % 60;

                if (hours > 0) {
                    dayMessage = `${hours} hrs ${mins} mins downtime`;
                } else if (mins > 0) {
                    dayMessage = `${mins} minutes downtime`;
                } else {
                    dayMessage = "Brief downtime";
                }
            } else if (uptimePercent >= 0.99) {
                // 99.0-99.9% uptime - Good (黄绿色)
                dayStatus = 7; // Good (新状态码)
                const downMinutes = stat.down_count;
                const hours = Math.floor(downMinutes / 60);
                const mins = downMinutes % 60;

                if (hours > 0) {
                    dayMessage = `${hours} hrs ${mins} mins downtime`;
                } else {
                    dayMessage = `${mins} minutes downtime`;
                }
            } else if (uptimePercent >= 0.95) {
                // 95.0-99.0% uptime - Fair (黄色)
                dayStatus = 4; // Fair
                const downMinutes = stat.down_count;
                const hours = Math.floor(downMinutes / 60);
                const mins = downMinutes % 60;

                if (hours > 0) {
                    dayMessage = `${hours} hrs ${mins} mins downtime`;
                } else {
                    dayMessage = `${mins} minutes downtime`;
                }
            } else if (uptimePercent >= 0.80) {
                // 80.0-95.0% uptime - Poor (橙色)
                dayStatus = 6; // Poor
                const downMinutes = stat.down_count;
                const hours = Math.floor(downMinutes / 60);
                const mins = downMinutes % 60;

                if (hours > 0) {
                    dayMessage = `${hours} hrs ${mins} mins downtime`;
                } else {
                    dayMessage = `${mins} minutes downtime`;
                }
            } else {
                // Less than 80% uptime - Critical (红色)
                dayStatus = 0; // Critical
                const downMinutes = stat.down_count;
                const hours = Math.floor(downMinutes / 60);
                const mins = downMinutes % 60;

                if (hours > 0) {
                    dayMessage = `${hours} hrs ${mins} mins downtime`;
                } else {
                    dayMessage = `${mins} minutes downtime`;
                }
            }

            // Create heartbeat-like object for this day
            result.push({
                id: `daily-${stat.day}`,
                monitor_id: monitorID,
                status: dayStatus,
                time: stat.last_time, // Use last time of day as representative time
                msg: dayMessage,
                ping: null,
                duration: null,
                // Additional metadata for debugging
                daily_stats: {
                    total: stat.total_heartbeats,
                    up: stat.up_count,
                    down: stat.down_count,
                    pending: stat.pending_count,
                    maintenance: stat.maintenance_count,
                    uptime_percent: stat.total_heartbeats > 0
                        ? ((stat.up_count / stat.total_heartbeats) * 100).toFixed(2)
                        : 0
                }
            });
        }

        // Fill missing days with empty beats for consistent 90-day display
        while (result.length < days) {
            const daysAgo = result.length;
            const date = dayjs().subtract(daysAgo, "day");

            result.push({
                id: `daily-empty-${daysAgo}`,
                monitor_id: monitorID,
                status: null, // Use null for no data (not 0 which means DOWN)
                time: date.toISOString(),
                msg: "No data",
                ping: null,
                duration: null,
                daily_stats: null,
                isEmpty: true // Mark as empty for frontend logic
            });
        }

        console.log(`getDailyAggregatedHeartbeats: Generated ${result.length} daily heartbeats for monitor ${monitorID}`);
        return result.reverse(); // Return in ascending time order

    } catch (error) {
        console.error(`Error getting daily aggregated heartbeats for monitor ${monitorID}:`, error);
        return [];
    }
}

let router = express.Router();

let cache = apicache.middleware;
const server = UptimeKumaServer.getInstance();

router.get("/status/:slug", cache("5 minutes"), async (request, response) => {
    let slug = request.params.slug;
    slug = slug.toLowerCase();
    await StatusPage.handleStatusPageResponse(response, server.indexHTML, slug);
});

router.get("/status/:slug/rss", cache("5 minutes"), async (request, response) => {
    let slug = request.params.slug;
    slug = slug.toLowerCase();
    await StatusPage.handleStatusPageRSSResponse(response, slug);
});

router.get("/status", cache("5 minutes"), async (request, response) => {
    let slug = "default";
    await StatusPage.handleStatusPageResponse(response, server.indexHTML, slug);
});

router.get("/status-page", cache("5 minutes"), async (request, response) => {
    let slug = "default";
    await StatusPage.handleStatusPageResponse(response, server.indexHTML, slug);
});

// Status page config, incident, monitor list
router.get("/api/status-page/:slug", cache("5 minutes"), async (request, response) => {
    allowDevAllOrigin(response);
    let slug = request.params.slug;
    slug = slug.toLowerCase();

    try {
        // Get Status Page
        let statusPage = await R.findOne("status_page", " slug = ? ", [
            slug
        ]);

        if (!statusPage) {
            sendHttpError(response, "Status Page Not Found");
            return null;
        }

        let statusPageData = await StatusPage.getStatusPageData(statusPage);

        // Response
        response.json(statusPageData);

    } catch (error) {
        sendHttpError(response, error.message);
    }
});

// Status Page Polling Data
// Can fetch only if published
router.get("/api/status-page/heartbeat/:slug/:duration",
    cache("0 seconds"),
    DeploymentMiddleware.injectDeploymentConfig,
    DeploymentMiddleware.validateTimeRange("duration", false), // Non-strict mode for status pages
    async (request, response) => {
        allowDevAllOrigin(response);
        let duration = request.params.duration;

        try {
            let heartbeatList = {};
            let uptimeList = {};
            let slaList = {};

            let slug = request.params.slug;
            slug = slug.toLowerCase();
            let statusPageID = await StatusPage.slugToID(slug);

            let monitorIDList = await R.getCol(`
            SELECT monitor_group.monitor_id FROM monitor_group, \`group\`
            WHERE monitor_group.group_id = \`group\`.id
            AND public = 1
            AND \`group\`.status_page_id = ?
        `, [ statusPageID ]);

            for (let monitorID of monitorIDList) {
                let heartbeats = [];

                // 改为“按时间窗口”查询，避免用点数回溯过久历史
                let thresholdSec = null;
                const now = dayjs.utc();
                if (duration === "90m") {
                    thresholdSec = now.subtract(90, "minute").unix();

                } else if (duration === "24h") {
                    thresholdSec = now.subtract(24, "hour").unix();
                } else if (duration === "90d") {
                    thresholdSec = now.subtract(90, "day").unix();
                } else {
                    console.warn(`⚠️  Unknown duration "${duration}" in timestamp calculation, defaulting to 90m`);
                    thresholdSec = now.subtract(90, "minute").unix();
                }

                let list;
                if (thresholdSec != null) {
                    // Special handling for 90d: use daily aggregation for performance
                    if (duration === "90d") {
                        list = await getDailyAggregatedHeartbeats(monitorID, 90);
                    } else {
                    // 使用数据库原生时间窗口，避免字符串/数值比较导致的越界
                        if (Database.dbConfig.type === "sqlite") {
                            let intervalSQL = "";
                            if (duration === "90m") {
                                intervalSQL = "-90 minutes";

                            } else if (duration === "24h") {
                                intervalSQL = "-24 hours";
                            } else {
                                // 🚨 Unknown duration, default to 90m
                                console.warn(`⚠️  Unknown duration "${duration}", defaulting to 90 minutes`);
                                intervalSQL = "-90 minutes";
                            }

                            console.log(`🔍 SQLite query for monitor ${monitorID}: duration="${duration}" -> intervalSQL="${intervalSQL}"`);
                            list = await R.getAll(`
                                SELECT * FROM heartbeat
                                WHERE monitor_id = ? AND time >= DATETIME('now', ?)
                                ORDER BY time DESC
                            `, [ monitorID, intervalSQL ]);
                        } else {
                        // MariaDB
                            let where = "";
                            if (duration === "90m") {
                                where = "time >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 90 MINUTE)";

                            } else if (duration === "24h") {
                                where = "time >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 24 HOUR)";
                            } else {
                                // 🚨 Unknown duration, default to 90m
                                console.warn(`⚠️  Unknown duration "${duration}", defaulting to 90 minutes`);
                                where = "time >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 90 MINUTE)";
                            }

                            console.log(`🔍 MariaDB query for monitor ${monitorID}: duration="${duration}" -> where="${where}"`);
                            list = await R.getAll(`
                                SELECT * FROM heartbeat
                                WHERE monitor_id = ? AND ${where}
                                ORDER BY time DESC
                            `, [ monitorID ]);
                        }
                    }
                } else {
                // ⚠️  This branch should not be reached anymore since all cases are handled above
                    console.error(`🚨 CRITICAL: thresholdSec is null for duration "${duration}" - this should not happen!`);
                    list = await R.getAll(`
                        SELECT * FROM heartbeat
                        WHERE monitor_id = ?
                        ORDER BY time DESC
                        LIMIT 60
                    `, [ monitorID ]);
                }

                // 90d uses pre-aggregated daily data, skip normal conversion
                if (duration === "90d") {
                    heartbeats = list; // Already processed by getDailyAggregatedHeartbeats
                } else {
                    heartbeats = R.convertToBeans("heartbeat", list)
                        .reverse()
                        .map(row => row.toPublicJSON());

                    if (duration === "24h") {
                    // 压缩成 24 个小时块
                        heartbeats = compressHeartbeats(heartbeats, 24, duration);
                    }
                    // 90d uses daily aggregation, so no compression needed here
                }

                heartbeatList[monitorID] = heartbeats;

                const uptimeCalculator = await UptimeCalculator.getUptimeCalculator(monitorID);

                console.log(`Processing monitor ${monitorID} with duration: ${duration}, heartbeats length: ${heartbeats.length}`);

                if (duration === "90d") {
                    console.log(`90d mode detected for monitor ${monitorID}`);

                    // For 90d, use UptimeCalculator which loads data from stat_daily table
                    // This provides more complete historical data than heartbeat aggregation
                    const breakdown90d = uptimeCalculator.getBreakdown(90, "day");
                    let uptime90d = 0;

                    if (breakdown90d.up + breakdown90d.down > 0) {
                        uptime90d = breakdown90d.up / (breakdown90d.up + breakdown90d.down);
                        console.log(`90d calculation from UptimeCalculator: ${breakdown90d.up}/${breakdown90d.up + breakdown90d.down} = ${uptime90d} for monitor ${monitorID}`);
                    } else {
                        console.log(`90d calculation: No data available in UptimeCalculator for monitor ${monitorID}`);
                    }

                    uptimeList[`${monitorID}_90d`] = uptime90d;

                    // Calculate 90-day SLA
                    const monitorBean = await R.findOne("monitor", " id = ? ", [ monitorID ]);
                    const target = monitorBean?.sla_target ?? null;
                    slaList[`${monitorID}_90d`] = {
                        achieved: uptime90d,
                        target,
                        window: "rolling-90d"
                    };

                    console.log(`90d SLA set for monitor ${monitorID}: ${uptime90d}`);
                } else {
                    console.log(`Standard mode (${duration}) for monitor ${monitorID}`);

                    // Standard uptime calculations - provide accurate data for each time range
                    // Always provide 24h SLI data (fixed time range for statistical significance)
                    const sli24hData = uptimeCalculator.get24Hour().uptime;
                    uptimeList[`${monitorID}_24`] = sli24hData;
                    console.log(`24h SLI data for monitor ${monitorID}: ${sli24hData}`);

                    // Always generate 90-day SLA data for internal mode (for SLA chip consistency)
                    const monitorBean = await R.findOne("monitor", " id = ? ", [ monitorID ]);
                    const excludeMaintenance = monitorBean?.sla_exclude_maintenance === 1 || monitorBean?.sla_exclude_maintenance === true;
                    const target = monitorBean?.sla_target ?? null;

                    // Calculate 90-day SLA using daily aggregation for consistency
                    const dailyBreakdown = uptimeCalculator.getBreakdown(90, "day");
                    const totalDays = dailyBreakdown.up + dailyBreakdown.down + (excludeMaintenance ? 0 : dailyBreakdown.maintenance);
                    const uptime90d = totalDays > 0 ? dailyBreakdown.up / totalDays : 0;

                    slaList[`${monitorID}_90d`] = {
                        achieved: uptime90d,
                        target,
                        window: "rolling-90d"
                    };

                    console.log(`90d SLA for monitor ${monitorID}: ${uptime90d}`);
                }
            }

            // Debug: Log uptimeList structure
            console.log("📊 API Response uptimeList:", {
                duration,
                keys: Object.keys(uptimeList),
                data: uptimeList
            });

            // Filter response based on deployment configuration
            const responseData = {
                heartbeatList,
                uptimeList,
                slaList,
            };

            const filteredResponse = DeploymentMiddleware.filterResponseData(responseData, request.deploymentConfig);

            response.json(filteredResponse);

        } catch (error) {
            sendHttpError(response, error.message);
        }
    });

// Status page's manifest.json
router.get("/api/status-page/:slug/manifest.json", cache("1440 minutes"), async (request, response) => {
    allowDevAllOrigin(response);
    let slug = request.params.slug;
    slug = slug.toLowerCase();

    try {
        // Get Status Page
        let statusPage = await R.findOne("status_page", " slug = ? ", [
            slug
        ]);

        if (!statusPage) {
            sendHttpError(response, "Not Found");
            return;
        }

        // Response
        response.json({
            "name": statusPage.title,
            "start_url": "/status/" + statusPage.slug,
            "display": "standalone",
            "icons": [
                {
                    "src": statusPage.icon,
                    "sizes": "128x128",
                    "type": "image/png"
                }
            ]
        });

    } catch (error) {
        sendHttpError(response, error.message);
    }
});

// overall status-page status badge
router.get("/api/status-page/:slug/badge", cache("5 minutes"), async (request, response) => {
    allowDevAllOrigin(response);
    let slug = request.params.slug;
    slug = slug.toLowerCase();
    const statusPageID = await StatusPage.slugToID(slug);
    const {
        label,
        upColor = badgeConstants.defaultUpColor,
        downColor = badgeConstants.defaultDownColor,
        partialColor = "#F6BE00",
        maintenanceColor = "#808080",
        style = badgeConstants.defaultStyle
    } = request.query;

    try {
        let monitorIDList = await R.getCol(`
            SELECT monitor_group.monitor_id FROM monitor_group, \`group\`
            WHERE monitor_group.group_id = \`group\`.id
            AND public = 1
            AND \`group\`.status_page_id = ?
        `, [
            statusPageID
        ]);

        let hasUp = false;
        let hasDown = false;
        let hasMaintenance = false;

        for (let monitorID of monitorIDList) {
            // retrieve the latest heartbeat
            let beat = await R.getAll(`
                    SELECT * FROM heartbeat
                    WHERE monitor_id = ?
                    ORDER BY time DESC
                    LIMIT 1
            `, [
                monitorID,
            ]);

            // to be sure, when corresponding monitor not found
            if (beat.length === 0) {
                continue;
            }
            // handle status of beat
            if (beat[0].status === 3) {
                hasMaintenance = true;
            } else if (beat[0].status === 2) {
                // ignored
            } else if (beat[0].status === 1) {
                hasUp = true;
            } else {
                hasDown = true;
            }

        }

        const badgeValues = { style };

        if (!hasUp && !hasDown && !hasMaintenance) {
            // return a "N/A" badge in naColor (grey), if monitor is not public / not available / non exsitant

            badgeValues.message = "N/A";
            badgeValues.color = badgeConstants.naColor;

        } else {
            if (hasMaintenance) {
                badgeValues.label = label ? label : "";
                badgeValues.color = maintenanceColor;
                badgeValues.message = "Maintenance";
            } else if (hasUp && !hasDown) {
                badgeValues.label = label ? label : "";
                badgeValues.color = upColor;
                badgeValues.message = "Up";
            } else if (hasUp && hasDown) {
                badgeValues.label = label ? label : "";
                badgeValues.color = partialColor;
                badgeValues.message = "Degraded";
            } else {
                badgeValues.label = label ? label : "";
                badgeValues.color = downColor;
                badgeValues.message = "Down";
            }

        }

        // build the svg based on given values
        const svg = makeBadge(badgeValues);

        response.type("image/svg+xml");
        response.send(svg);

    } catch (error) {
        sendHttpError(response, error.message);
    }
});

/**
 * @param {Array} heartbeats heartbeat list
 * @param {number} chunkSize chunk size
 * @param {string} duration duration
 * @returns {Array} compressed heartbeats
 */
function compressHeartbeats(heartbeats, chunkSize, duration) {
    const compressedHeartbeats = [];

    for (let i = 0; i < heartbeats.length; i += chunkSize) {
        const chunk = heartbeats.slice(i, i + chunkSize);
        if (chunk.length > 0) {
            compressedHeartbeats.push(processChunk(chunk, duration));
        }
    }

    return compressedHeartbeats;
}

/**
 * @param {Array} chunk heartbeat list
 * @param {string} duration duration
 * @returns {object} compressed heartbeat
 */
function processChunk(chunk, duration = null) {
    const mergedBeat = { ...chunk[0] };
    const total = chunk.length;

    const statusCount = new Map();
    // 记录每种状态的心跳及其时间
    const statusBeats = new Map();

    for (const beat of chunk) {
        statusCount.set(beat.status, (statusCount.get(beat.status) || 0) + 1);

        // 记录每种状态的心跳
        if (!statusBeats.has(beat.status)) {
            statusBeats.set(beat.status, []);
        }
        statusBeats.get(beat.status).push(beat);
    }

    const maintenanceCount = statusCount.get(3) || 0;
    const downCount = statusCount.get(0) || 0;

    const maintenanceRatio = maintenanceCount / total;
    const downRatio = downCount / total;
    const pendingExists = statusCount.has(2);

    if (statusCount.get(1) === total) {
        // 100% up
        mergedBeat.status = 1;
        mergedBeat.msg = "Up";
    } else if (pendingExists && maintenanceRatio < 0.01) {
        // 有pending状态且维护很少
        mergedBeat.status = 2;
        mergedBeat.msg = formatStatusMessage(statusCount, statusBeats, chunk, duration);
    } else if (maintenanceRatio >= 0.05) {
        // 维护时间≥5%，显示为维护
        mergedBeat.status = 3;
        mergedBeat.msg = formatStatusMessage(statusCount, statusBeats, chunk, duration);
    } else if (downRatio >= 0.1) {
        // down时间≥10%，显示为严重故障
        mergedBeat.status = 0;
        mergedBeat.msg = formatStatusMessage(statusCount, statusBeats, chunk, duration);
    } else if (downRatio > 0) {
        // 有down但<10%，显示为部分故障
        mergedBeat.status = 4;
        mergedBeat.msg = formatStatusMessage(statusCount, statusBeats, chunk, duration);
    } else {
        // 其他情况默认为up
        mergedBeat.status = 1;
        mergedBeat.msg = formatStatusMessage(statusCount, statusBeats, chunk, duration);
    }

    return mergedBeat;
}

/**
 * 格式化状态消息
 * @param {Map} statusCount 状态计数
 * @param {Map} statusBeats 每种状态的心跳
 * @param {Array} chunk 所有心跳
 * @param {string} duration 持续时间
 * @returns {string} 状态消息
 */
function formatStatusMessage(statusCount, statusBeats, chunk, duration = null) {
    const total = Array.from(statusCount.values()).reduce((sum, count) => sum + count, 0);

    if (!duration || duration === "90m") {
        if (statusCount.get(1) === total) {
            return "Up";
        }
        return "Down";
    }

    // 如果全部正常，直接返回
    if (!statusCount.has(0) && !statusCount.has(2) && !statusCount.has(3)) {
        return "Up";
    }

    // 计算时间段
    const parts = [];

    // 处理宕机状态
    if (statusCount.has(0)) {
        const downBeats = statusBeats.get(0);
        if (downBeats && downBeats.length > 0) {
            // 按时间排序
            downBeats.sort((a, b) => new Date(a.time) - new Date(b.time));

            // 获取第一个和最后一个宕机点的时间
            const firstTime = downBeats[0].time;
            const lastTime = downBeats[downBeats.length - 1].time;

            // 转换为北京时间 (UTC+8)
            const startStr = extractTimeString(firstTime);
            const endStr = extractTimeString(lastTime);

            // 直接使用宕机点的数量作为分钟数
            const durationMinutes = downBeats.length;

            parts.push(`Down: ${startStr}-${endStr} (${durationMinutes}分钟)`);
        }
    }

    // 处理待定状态
    if (statusCount.has(2)) {
        const pendingBeats = statusBeats.get(2);
        if (pendingBeats && pendingBeats.length > 0) {
            // 按时间排序
            pendingBeats.sort((a, b) => new Date(a.time) - new Date(b.time));

            // 获取第一个和最后一个待定点的时间
            const firstTime = pendingBeats[0].time;
            const lastTime = pendingBeats[pendingBeats.length - 1].time;

            // 转换为北京时间 (UTC+8)
            const startStr = extractTimeString(firstTime);
            const endStr = extractTimeString(lastTime);

            // 直接使用待定点的数量作为分钟数
            const durationMinutes = pendingBeats.length;

            parts.push(`Pending: ${startStr}-${endStr} (${durationMinutes}分钟)`);
        }
    }

    // 处理维护状态
    if (statusCount.has(3)) {
        const maintenanceBeats = statusBeats.get(3);
        if (maintenanceBeats && maintenanceBeats.length > 0) {
            // 按时间排序
            maintenanceBeats.sort((a, b) => new Date(a.time) - new Date(b.time));

            // 获取第一个和最后一个维护点的时间
            const firstTime = maintenanceBeats[0].time;
            const lastTime = maintenanceBeats[maintenanceBeats.length - 1].time;

            // 转换为北京时间 (UTC+8)
            const startStr = extractTimeString(firstTime);
            const endStr = extractTimeString(lastTime);

            // 直接使用维护点的数量作为分钟数
            const durationMinutes = maintenanceBeats.length;

            parts.push(`Maintenance: ${startStr}-${endStr} (${durationMinutes}分钟)`);
        }
    }

    return parts.join(", ");
}

/**
 * 从时间字符串中提取时间部分 (HH:MM)，强制转换为北京时间 (UTC+8)
 * @param {string} timeString 时间字符串 (格式如: "2023-05-01T14:30:00.000Z")
 * @returns {string} 格式化的北京时间 (HH:MM)
 */
function extractTimeString(timeString) {
    // 解析ISO时间字符串
    const match = timeString.match(/(\d{2}):(\d{2}):(\d{2})/);
    if (match) {
        // 提取小时和分钟
        let hours = parseInt(match[1], 10);
        const minutes = parseInt(match[2], 10);

        // 强制转换为北京时间 (UTC+8)
        hours = (hours + 8) % 24;

        // 格式化为 HH:MM
        return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`;
    }

    // 如果无法解析，尝试使用Date对象
    try {
        const date = new Date(timeString);
        // 获取UTC时间
        let hours = date.getUTCHours();
        const minutes = date.getUTCMinutes();

        // 转换为北京时间 (UTC+8)
        hours = (hours + 8) % 24;

        // 格式化为 HH:MM
        return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`;
    } catch (e) {
        // 如果出错，返回原始时间字符串
        return timeString;
    }
}

module.exports = router;
