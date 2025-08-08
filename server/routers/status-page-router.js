let express = require("express");
const apicache = require("../modules/apicache");
const { UptimeKumaServer } = require("../uptime-kuma-server");
const StatusPage = require("../model/status_page");
const { allowDevAllOrigin, sendHttpError } = require("../util-server");
const { R } = require("redbean-node");
const { badgeConstants } = require("../../src/util");
const { makeBadge } = require("badge-maker");
const { UptimeCalculator } = require("../uptime-calculator");

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
router.get("/api/status-page/heartbeat/:slug/:duration", cache("1 minutes"), async (request, response) => {
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

            // 24h 和 1h 的查询保持不变
            let limit = duration === "24h" ? 60 * 24 : 60;

            let list = await R.getAll(`
                    SELECT * FROM heartbeat
                    WHERE monitor_id = ?
                    ORDER BY time DESC
                    LIMIT ?
                `, [ monitorID, limit ]);

            heartbeats = R.convertToBeans("heartbeat", list)
                .reverse()
                .map(row => row.toPublicJSON());

            if (duration === "24h") {
                heartbeats = compressHeartbeats(heartbeats, 24, duration);
            }

            heartbeatList[monitorID] = heartbeats;

            const uptimeCalculator = await UptimeCalculator.getUptimeCalculator(monitorID);
            uptimeList[`${monitorID}_24`] = uptimeCalculator.get24Hour().uptime;

            // SLA for the same 24h window on status page
            const monitorBean = await R.findOne("monitor", " id = ? ", [ monitorID ]);
            const excludeMaintenance = monitorBean?.sla_exclude_maintenance === 1 || monitorBean?.sla_exclude_maintenance === true;
            const target = monitorBean?.sla_target ?? null;
            const sla = uptimeCalculator.getSLAByDuration("24h", { excludeMaintenance });
            slaList[`${monitorID}_24`] = { achieved: sla.ratio,
                target };
        }

        response.json({
            heartbeatList,
            uptimeList,
            slaList,
        });

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
    const maintenanceRatio = maintenanceCount / total;
    const pendingExists = statusCount.has(2);

    if (statusCount.get(1) === total) {
        mergedBeat.status = 1;
        mergedBeat.msg = "Up";
    } else {
        if (pendingExists && maintenanceRatio < 0.01) {
            mergedBeat.status = 2;
        } else if (maintenanceRatio >= 0.01) {
            mergedBeat.status = 0;
        } else {
            mergedBeat.status = 0;
        }

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

    // 60分钟的情况，保持原有的简单消息
    if (!duration || duration === "60m") {
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
