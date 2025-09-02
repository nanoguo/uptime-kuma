let express = require("express");
const {
    setting,
    allowDevAllOrigin,
    allowAllOrigin,
    percentageToColor,
    filterAndJoin,
    sendHttpError,
} = require("../util-server");
const { R } = require("redbean-node");
const apicache = require("../modules/apicache");
const Monitor = require("../model/monitor");
const dayjs = require("dayjs");
// Enable UTC & timezone utilities for report time windows
dayjs.extend(require("dayjs/plugin/utc"));
dayjs.extend(require("../modules/dayjs/plugin/timezone"));
const { UP, MAINTENANCE, DOWN, PENDING, flipStatus, log, badgeConstants } = require("../../src/util");
const StatusPage = require("../model/status_page");
const { UptimeKumaServer } = require("../uptime-kuma-server");
const { makeBadge } = require("badge-maker");
const { Prometheus } = require("../prometheus");
const Database = require("../database");
const { UptimeCalculator } = require("../uptime-calculator");
const { Settings } = require("../settings");
const { DeploymentMiddleware } = require("../middleware/deployment-middleware");
// const Cron = require("croner");
// const nodemailer = require("nodemailer");

let router = express.Router();

let cache = apicache.middleware;
const server = UptimeKumaServer.getInstance();
let io = server.io;

router.get("/api/entry-page", async (request, response) => {
    allowDevAllOrigin(response);

    let result = { };
    let hostname = request.hostname;
    if ((await setting("trustProxy")) && request.headers["x-forwarded-host"]) {
        hostname = request.headers["x-forwarded-host"];
    }

    if (hostname in StatusPage.domainMappingList) {
        result.type = "statusPageMatchedDomain";
        result.statusPageSlug = StatusPage.domainMappingList[hostname];
    } else {
        result.type = "entryPage";
        result.entryPage = server.entryPage;
    }
    response.json(result);
});

// Public deployment configuration endpoint (no auth required)
router.get("/api/config/deployment", cache("1 minutes"), async (request, response) => {
    allowDevAllOrigin(response);
    try {
        const mode = await Settings.get("deploymentMode") || "internal";
        const features = await Settings.get("deploymentFeatures") || {
            showSLI: true,
            showSLO: true,
            showSLA: true,
            timeRanges: [ "90m", "24h", "90d" ], // Internal: 90m/24h for SLI/SLO, 90d for SLA
            defaultView: "dashboard"
        };
        const publicAccess = await Settings.get("deploymentPublicAccess") || {
            enabled: false,
            allowAnonymous: false,
            customDomain: null
        };

        // Only return public-safe configuration data
        response.json({
            mode,
            features: {
                showSLI: features.showSLI,
                showSLO: features.showSLO,
                showSLA: features.showSLA,
                timeRanges: features.timeRanges,
                defaultView: features.defaultView
            },
            publicAccess: {
                enabled: publicAccess.enabled,
                allowAnonymous: publicAccess.allowAnonymous
            }
        });
    } catch (error) {
        log.error("api", "Error getting deployment config:", error);
        // Return safe defaults on error
        response.json({
            mode: "internal",
            features: {
                showSLI: true,
                showSLO: true,
                showSLA: true,
                timeRanges: [ "90m", "24h", "90d" ], // Internal: 90m/24h for SLI/SLO, 90d for SLA
                defaultView: "dashboard"
            },
            publicAccess: {
                enabled: false,
                allowAnonymous: false
            }
        });
    }
});

router.all("/api/push/:pushToken", async (request, response) => {
    try {
        let pushToken = request.params.pushToken;
        let msg = request.query.msg || "OK";
        let ping = parseFloat(request.query.ping) || null;
        let statusString = request.query.status || "up";
        let status = (statusString === "up") ? UP : DOWN;

        let monitor = await R.findOne("monitor", " push_token = ? AND active = 1 ", [
            pushToken
        ]);

        if (! monitor) {
            throw new Error("Monitor not found or not active.");
        }

        const previousHeartbeat = await Monitor.getPreviousHeartbeat(monitor.id);

        let isFirstBeat = true;

        let bean = R.dispense("heartbeat");
        bean.time = R.isoDateTimeMillis(dayjs.utc());
        bean.monitor_id = monitor.id;
        bean.ping = ping;
        bean.msg = msg;
        bean.downCount = previousHeartbeat?.downCount || 0;

        if (previousHeartbeat) {
            isFirstBeat = false;
            bean.duration = dayjs(bean.time).diff(dayjs(previousHeartbeat.time), "second");
        }

        if (await Monitor.isUnderMaintenance(monitor.id)) {
            msg = "Monitor under maintenance";
            bean.status = MAINTENANCE;
        } else {
            determineStatus(status, previousHeartbeat, monitor.maxretries, monitor.isUpsideDown(), bean);
        }

        // Calculate uptime
        let uptimeCalculator = await UptimeCalculator.getUptimeCalculator(monitor.id);
        let endTimeDayjs = await uptimeCalculator.update(bean.status, parseFloat(bean.ping));
        bean.end_time = R.isoDateTimeMillis(endTimeDayjs);

        log.debug("router", `/api/push/ called at ${dayjs().format("YYYY-MM-DD HH:mm:ss.SSS")}`);
        log.debug("router", "PreviousStatus: " + previousHeartbeat?.status);
        log.debug("router", "Current Status: " + bean.status);

        bean.important = Monitor.isImportantBeat(isFirstBeat, previousHeartbeat?.status, status);

        if (Monitor.isImportantForNotification(isFirstBeat, previousHeartbeat?.status, status)) {
            // Reset down count
            bean.downCount = 0;

            log.debug("monitor", `[${this.name}] sendNotification`);
            await Monitor.sendNotification(isFirstBeat, monitor, bean);
        } else {
            if (bean.status === DOWN && this.resendInterval > 0) {
                ++bean.downCount;
                if (bean.downCount >= this.resendInterval) {
                    // Send notification again, because we are still DOWN
                    log.debug("monitor", `[${this.name}] sendNotification again: Down Count: ${bean.downCount} | Resend Interval: ${this.resendInterval}`);
                    await Monitor.sendNotification(isFirstBeat, this, bean);

                    // Reset down count
                    bean.downCount = 0;
                }
            }
        }

        await R.store(bean);

        io.to(monitor.user_id).emit("heartbeat", bean.toJSON());

        Monitor.sendStats(io, monitor.id, monitor.user_id);
        new Prometheus(monitor).update(bean, undefined);

        response.json({
            ok: true,
        });
    } catch (e) {
        response.status(404).json({
            ok: false,
            msg: e.message
        });
    }
});

router.get("/api/badge/:id/status", cache("5 minutes"), async (request, response) => {
    allowAllOrigin(response);

    const {
        label,
        upLabel = "Up",
        downLabel = "Down",
        pendingLabel = "Pending",
        maintenanceLabel = "Maintenance",
        upColor = badgeConstants.defaultUpColor,
        downColor = badgeConstants.defaultDownColor,
        pendingColor = badgeConstants.defaultPendingColor,
        maintenanceColor = badgeConstants.defaultMaintenanceColor,
        style = badgeConstants.defaultStyle,
        value, // for demo purpose only
    } = request.query;

    try {
        const requestedMonitorId = parseInt(request.params.id, 10);
        const overrideValue = value !== undefined ? parseInt(value) : undefined;

        let publicMonitor = await R.getRow(`
                SELECT monitor_group.monitor_id FROM monitor_group, \`group\`
                WHERE monitor_group.group_id = \`group\`.id
                AND monitor_group.monitor_id = ?
                AND public = 1
            `,
        [ requestedMonitorId ]
        );

        const badgeValues = { style };

        if (!publicMonitor) {
            // return a "N/A" badge in naColor (grey), if monitor is not public / not available / non exsitant

            badgeValues.message = "N/A";
            badgeValues.color = badgeConstants.naColor;
        } else {
            const heartbeat = await Monitor.getPreviousHeartbeat(requestedMonitorId);
            const state = overrideValue !== undefined ? overrideValue : heartbeat.status;

            if (label === undefined) {
                badgeValues.label = "Status";
            } else {
                badgeValues.label = label;
            }
            switch (state) {
                case DOWN:
                    badgeValues.color = downColor;
                    badgeValues.message = downLabel;
                    break;
                case UP:
                    badgeValues.color = upColor;
                    badgeValues.message = upLabel;
                    break;
                case PENDING:
                    badgeValues.color = pendingColor;
                    badgeValues.message = pendingLabel;
                    break;
                case MAINTENANCE:
                    badgeValues.color = maintenanceColor;
                    badgeValues.message = maintenanceLabel;
                    break;
                default:
                    badgeValues.color = badgeConstants.naColor;
                    badgeValues.message = "N/A";
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

router.get("/api/badge/:id/uptime/:duration?", cache("5 minutes"), async (request, response) => {
    allowAllOrigin(response);

    const {
        label,
        labelPrefix,
        labelSuffix = badgeConstants.defaultUptimeLabelSuffix,
        prefix,
        suffix = badgeConstants.defaultUptimeValueSuffix,
        color,
        labelColor,
        style = badgeConstants.defaultStyle,
        value, // for demo purpose only
    } = request.query;

    try {
        const requestedMonitorId = parseInt(request.params.id, 10);
        // if no duration is given, set value to 24 (h)
        let requestedDuration = request.params.duration !== undefined ? request.params.duration : "24h";
        const overrideValue = value && parseFloat(value);

        if (/^[0-9]+$/.test(requestedDuration)) {
            requestedDuration = `${requestedDuration}h`;
        }

        let publicMonitor = await R.getRow(`
                SELECT monitor_group.monitor_id FROM monitor_group, \`group\`
                WHERE monitor_group.group_id = \`group\`.id
                AND monitor_group.monitor_id = ?
                AND public = 1
            `,
        [ requestedMonitorId ]
        );

        const badgeValues = { style };

        if (!publicMonitor) {
            // return a "N/A" badge in naColor (grey), if monitor is not public / not available / non existent
            badgeValues.message = "N/A";
            badgeValues.color = badgeConstants.naColor;
        } else {
            const uptimeCalculator = await UptimeCalculator.getUptimeCalculator(requestedMonitorId);
            const uptime = overrideValue ?? uptimeCalculator.getDataByDuration(requestedDuration).uptime;

            // limit the displayed uptime percentage to four (two, when displayed as percent) decimal digits
            const cleanUptime = (uptime * 100).toPrecision(4);

            // use a given, custom color or calculate one based on the uptime value
            badgeValues.color = color ?? percentageToColor(uptime);
            // use a given, custom labelColor or use the default badge label color (defined by badge-maker)
            badgeValues.labelColor = labelColor ?? "";
            // build a label string. If a custom label is given, override the default one (requestedDuration)
            badgeValues.label = filterAndJoin([
                labelPrefix,
                label ?? `Uptime (${requestedDuration.slice(0, -1)}${labelSuffix})`,
            ]);
            badgeValues.message = filterAndJoin([ prefix, cleanUptime, suffix ]);
        }

        // build the SVG based on given values
        const svg = makeBadge(badgeValues);

        response.type("image/svg+xml");
        response.send(svg);
    } catch (error) {
        sendHttpError(response, error.message);
    }
});

router.get("/api/badge/:id/ping/:duration?", cache("5 minutes"), async (request, response) => {
    allowAllOrigin(response);

    const {
        label,
        labelPrefix,
        labelSuffix = badgeConstants.defaultPingLabelSuffix,
        prefix,
        suffix = badgeConstants.defaultPingValueSuffix,
        color = badgeConstants.defaultPingColor,
        labelColor,
        style = badgeConstants.defaultStyle,
        value, // for demo purpose only
    } = request.query;

    try {
        const requestedMonitorId = parseInt(request.params.id, 10);

        // Default duration is 24 (h) if not defined in queryParam, limited to 720h (30d)
        let requestedDuration = request.params.duration !== undefined ? request.params.duration : "24h";
        const overrideValue = value && parseFloat(value);

        if (/^[0-9]+$/.test(requestedDuration)) {
            requestedDuration = `${requestedDuration}h`;
        }

        // Check if monitor is public

        const uptimeCalculator = await UptimeCalculator.getUptimeCalculator(requestedMonitorId);
        const publicAvgPing = uptimeCalculator.getDataByDuration(requestedDuration).avgPing;

        const badgeValues = { style };

        if (!publicAvgPing) {
            // return a "N/A" badge in naColor (grey), if monitor is not public / not available / non exsitant

            badgeValues.message = "N/A";
            badgeValues.color = badgeConstants.naColor;
        } else {
            const avgPing = parseInt(overrideValue ?? publicAvgPing);

            badgeValues.color = color;
            // use a given, custom labelColor or use the default badge label color (defined by badge-maker)
            badgeValues.labelColor = labelColor ?? "";
            // build a lable string. If a custom label is given, override the default one (requestedDuration)
            badgeValues.label = filterAndJoin([ labelPrefix, label ?? `Avg. Ping (${requestedDuration.slice(0, -1)}${labelSuffix})` ]);
            badgeValues.message = filterAndJoin([ prefix, avgPing, suffix ]);
        }

        // build the SVG based on given values
        const svg = makeBadge(badgeValues);

        response.type("image/svg+xml");
        response.send(svg);
    } catch (error) {
        sendHttpError(response, error.message);
    }
});

router.get("/api/badge/:id/avg-response/:duration?", cache("5 minutes"), async (request, response) => {
    allowAllOrigin(response);

    const {
        label,
        labelPrefix,
        labelSuffix,
        prefix,
        suffix = badgeConstants.defaultPingValueSuffix,
        color = badgeConstants.defaultPingColor,
        labelColor,
        style = badgeConstants.defaultStyle,
        value, // for demo purpose only
    } = request.query;

    try {
        const requestedMonitorId = parseInt(request.params.id, 10);

        // Default duration is 24 (h) if not defined in queryParam, limited to 720h (30d)
        const requestedDuration = Math.min(
            request.params.duration
                ? parseInt(request.params.duration, 10)
                : 24,
            720
        );
        const overrideValue = value && parseFloat(value);

        const sqlHourOffset = Database.sqlHourOffset();

        const publicAvgPing = parseInt(await R.getCell(`
            SELECT AVG(ping) FROM monitor_group, \`group\`, heartbeat
            WHERE monitor_group.group_id = \`group\`.id
            AND heartbeat.time > ${sqlHourOffset}
            AND heartbeat.ping IS NOT NULL
            AND public = 1
            AND heartbeat.monitor_id = ?
            `,
        [ -requestedDuration, requestedMonitorId ]
        ));

        const badgeValues = { style };

        if (!publicAvgPing) {
            // return a "N/A" badge in naColor (grey), if monitor is not public / not available / non existent

            badgeValues.message = "N/A";
            badgeValues.color = badgeConstants.naColor;
        } else {
            const avgPing = parseInt(overrideValue ?? publicAvgPing);

            badgeValues.color = color;
            // use a given, custom labelColor or use the default badge label color (defined by badge-maker)
            badgeValues.labelColor = labelColor ?? "";
            // build a label string. If a custom label is given, override the default one (requestedDuration)
            badgeValues.label = filterAndJoin([
                labelPrefix,
                label ?? `Avg. Response (${requestedDuration}h)`,
                labelSuffix,
            ]);
            badgeValues.message = filterAndJoin([ prefix, avgPing, suffix ]);
        }

        // build the SVG based on given values
        const svg = makeBadge(badgeValues);

        response.type("image/svg+xml");
        response.send(svg);
    } catch (error) {
        sendHttpError(response, error.message);
    }
});

router.get("/api/badge/:id/cert-exp", cache("5 minutes"), async (request, response) => {
    allowAllOrigin(response);

    const date = request.query.date;

    const {
        label,
        labelPrefix,
        labelSuffix,
        prefix,
        suffix = date ? "" : badgeConstants.defaultCertExpValueSuffix,
        upColor = badgeConstants.defaultUpColor,
        warnColor = badgeConstants.defaultWarnColor,
        downColor = badgeConstants.defaultDownColor,
        warnDays = badgeConstants.defaultCertExpireWarnDays,
        downDays = badgeConstants.defaultCertExpireDownDays,
        labelColor,
        style = badgeConstants.defaultStyle,
        value, // for demo purpose only
    } = request.query;

    try {
        const requestedMonitorId = parseInt(request.params.id, 10);

        const overrideValue = value && parseFloat(value);

        let publicMonitor = await R.getRow(`
            SELECT monitor_group.monitor_id FROM monitor_group, \`group\`
            WHERE monitor_group.group_id = \`group\`.id
            AND monitor_group.monitor_id = ?
            AND public = 1
            `,
        [ requestedMonitorId ]
        );

        const badgeValues = { style };

        if (!publicMonitor) {
            // return a "N/A" badge in naColor (grey), if monitor is not public / not available / non existent

            badgeValues.message = "N/A";
            badgeValues.color = badgeConstants.naColor;
        } else {
            const tlsInfoBean = await R.findOne("monitor_tls_info", "monitor_id = ?", [
                requestedMonitorId,
            ]);

            if (!tlsInfoBean) {
                // return a "No/Bad Cert" badge in naColor (grey), if no cert saved (does not save bad certs?)
                badgeValues.message = "No/Bad Cert";
                badgeValues.color = badgeConstants.naColor;
            } else {
                const tlsInfo = JSON.parse(tlsInfoBean.info_json);

                if (!tlsInfo.valid) {
                    // return a "Bad Cert" badge in naColor (grey), when cert is not valid
                    badgeValues.message = "Bad Cert";
                    badgeValues.color = downColor;
                } else {
                    const daysRemaining = parseInt(overrideValue ?? tlsInfo.certInfo.daysRemaining);

                    if (daysRemaining > warnDays) {
                        badgeValues.color = upColor;
                    } else if (daysRemaining > downDays) {
                        badgeValues.color = warnColor;
                    } else {
                        badgeValues.color = downColor;
                    }
                    // use a given, custom labelColor or use the default badge label color (defined by badge-maker)
                    badgeValues.labelColor = labelColor ?? "";
                    // build a label string. If a custom label is given, override the default one
                    badgeValues.label = filterAndJoin([
                        labelPrefix,
                        label ?? "Cert Exp.",
                        labelSuffix,
                    ]);
                    badgeValues.message = filterAndJoin([ prefix, date ? tlsInfo.certInfo.validTo : daysRemaining, suffix ]);
                }
            }
        }

        // build the SVG based on given values
        const svg = makeBadge(badgeValues);

        response.type("image/svg+xml");
        response.send(svg);
    } catch (error) {
        sendHttpError(response, error.message);
    }
});

router.get("/api/badge/:id/response", cache("5 minutes"), async (request, response) => {
    allowAllOrigin(response);

    const {
        label,
        labelPrefix,
        labelSuffix,
        prefix,
        suffix = badgeConstants.defaultPingValueSuffix,
        color = badgeConstants.defaultPingColor,
        labelColor,
        style = badgeConstants.defaultStyle,
        value, // for demo purpose only
    } = request.query;

    try {
        const requestedMonitorId = parseInt(request.params.id, 10);

        const overrideValue = value && parseFloat(value);

        let publicMonitor = await R.getRow(`
            SELECT monitor_group.monitor_id FROM monitor_group, \`group\`
            WHERE monitor_group.group_id = \`group\`.id
            AND monitor_group.monitor_id = ?
            AND public = 1
            `,
        [ requestedMonitorId ]
        );

        const badgeValues = { style };

        if (!publicMonitor) {
            // return a "N/A" badge in naColor (grey), if monitor is not public / not available / non existent

            badgeValues.message = "N/A";
            badgeValues.color = badgeConstants.naColor;
        } else {
            const heartbeat = await Monitor.getPreviousHeartbeat(
                requestedMonitorId
            );

            if (!heartbeat.ping) {
                // return a "N/A" badge in naColor (grey), if previous heartbeat has no ping

                badgeValues.message = "N/A";
                badgeValues.color = badgeConstants.naColor;
            } else {
                const ping = parseInt(overrideValue ?? heartbeat.ping);

                badgeValues.color = color;
                // use a given, custom labelColor or use the default badge label color (defined by badge-maker)
                badgeValues.labelColor = labelColor ?? "";
                // build a label string. If a custom label is given, override the default one
                badgeValues.label = filterAndJoin([
                    labelPrefix,
                    label ?? "Response",
                    labelSuffix,
                ]);
                badgeValues.message = filterAndJoin([ prefix, ping, suffix ]);
            }
        }

        // build the SVG based on given values
        const svg = makeBadge(badgeValues);

        response.type("image/svg+xml");
        response.send(svg);
    } catch (error) {
        sendHttpError(response, error.message);
    }
});

// SLA details for a monitor
router.get("/api/monitor/:id/sla/:duration",
    cache("1 minutes"),
    DeploymentMiddleware.injectDeploymentConfig,
    DeploymentMiddleware.checkFeatureEnabled("showSLA"),
    DeploymentMiddleware.validateTimeRange("duration"),
    async (request, response) => {
        allowDevAllOrigin(response);
        try {
            const id = parseInt(request.params.id, 10);
            const duration = request.params.duration; // e.g. 24h/30d
            const monitor = await R.findOne("monitor", " id = ? ", [ id ]);
            if (!monitor) {
                sendHttpError(response, "Monitor not found");
                return;
            }
            const uptimeCalculator = await UptimeCalculator.getUptimeCalculator(id);
            const excludeMaintenance = Boolean(monitor.sla_exclude_maintenance);
            const { ratio, breakdown } = uptimeCalculator.getSLAByDuration(duration, { excludeMaintenance });

            const target = monitor.sla_target ?? null;
            const period = monitor.sla_period ?? "calendar-month";
            const totalUnits = breakdown.up + breakdown.down + (excludeMaintenance ? 0 : breakdown.maintenance);
            const allowedError = (target != null) ? Math.max(0, (1 - target) * totalUnits) : null;
            const consumedError = breakdown.down;
            const remainingError = (allowedError != null) ? Math.max(0, allowedError - consumedError) : null;

            response.json({
                monitorID: id,
                period,
                target,
                achieved: ratio,
                breakdown,
                errorBudget: {
                    allowed: allowedError,
                    consumed: consumedError,
                    remaining: remainingError,
                },
            });
        } catch (error) {
            sendHttpError(response, error.message);
        }
    });

/**
 * Determines the status of the next beat in the push route handling.
 * @param {string} status - The reported new status.
 * @param {object} previousHeartbeat - The previous heartbeat object.
 * @param {number} maxretries - The maximum number of retries allowed.
 * @param {boolean} isUpsideDown - Indicates if the monitor is upside down.
 * @param {object} bean - The new heartbeat object.
 * @returns {void}
 */
function determineStatus(status, previousHeartbeat, maxretries, isUpsideDown, bean) {
    if (isUpsideDown) {
        status = flipStatus(status);
    }

    if (previousHeartbeat) {
        if (previousHeartbeat.status === UP && status === DOWN) {
            // Going Down
            if ((maxretries > 0) && (previousHeartbeat.retries < maxretries)) {
                // Retries available
                bean.retries = previousHeartbeat.retries + 1;
                bean.status = PENDING;
            } else {
                // No more retries
                bean.retries = 0;
                bean.status = DOWN;
            }
        } else if (previousHeartbeat.status === PENDING && status === DOWN && previousHeartbeat.retries < maxretries) {
            // Retries available
            bean.retries = previousHeartbeat.retries + 1;
            bean.status = PENDING;
        } else {
            // No more retries or not pending
            if (status === DOWN) {
                bean.retries = previousHeartbeat.retries + 1;
                bean.status = status;
            } else {
                bean.retries = 0;
                bean.status = status;
            }
        }
    } else {
        // First beat?
        if (status === DOWN && maxretries > 0) {
            // Retries available
            bean.retries = 1;
            bean.status = PENDING;
        } else {
            // Retires not enabled
            bean.retries = 0;
            bean.status = status;
        }
    }
}

module.exports = router;

/**
 * Report endpoints: weekly/monthly for a status page (slug)
 * Example:
 * GET /api/report/status-page/:slug?range=weekly&window=rolling&tz=Asia/Shanghai
 *   - range: weekly | monthly (default: weekly)
 *   - window:
 *       weekly: rolling | calendar (calendar = 本周一 00:00:00 至今，按 tz)
 *       monthly: rolling | calendar (calendar = 本月 00:00:00 至今，按 tz)
 *   - tz: IANA timezone id, default UTC
 *   - excludeMaintenance: 0|1 覆盖每个监控的设置（默认 undefined=按监控设置）
 */
// Preflight CORS for report API
router.options("/api/report/status-page/:slug", (request, response) => {
    const origin = request.headers.origin || "*";
    log.info("report", `OPTIONS /api/report/status-page/${request.params.slug || "(no-slug)"} from ${origin}`);
    response.header("Access-Control-Allow-Origin", origin);
    response.header("Vary", "Origin");
    response.header("Access-Control-Allow-Credentials", "true");
    response.header("Access-Control-Allow-Methods", "GET, OPTIONS");
    response.header("Access-Control-Allow-Headers", request.headers["access-control-request-headers"] || "Origin, X-Requested-With, Content-Type, Accept, Authorization");
    response.header("Access-Control-Max-Age", "600");
    response.sendStatus(204);
});

router.get("/api/report/status-page/:slug", cache("30 seconds"), async (request, response) => {
    const origin = request.headers.origin || "*";
    response.header("Access-Control-Allow-Origin", origin);
    response.header("Vary", "Origin");
    response.header("Access-Control-Allow-Credentials", "true");
    try {
        const slugParam = String(request.params.slug || "").toLowerCase();
        log.info("report", `GET /api/report/status-page/${slugParam} range=${request.query.range} window=${request.query.window} tz=${request.query.tz} excludeMaintenance=${request.query.excludeMaintenance}`);
        const range = request.query.range === "quarterly" ? "quarterly" :
            request.query.range === "monthly" ? "monthly" : "monthly"; // 默认月报
        const windowType = (request.query.window === "calendar") ? "calendar" : "rolling";
        const tz = request.query.tz || "Asia/Shanghai";
        const overrideExcludeMaintenance = request.query.excludeMaintenance;

        // Validate status page
        const statusPageID = await StatusPage.slugToID(slugParam);
        if (!statusPageID) {
            sendHttpError(response, "Status Page Not Found");
            return;
        }

        // Get public monitors under this status page
        const monitorIDList = await R.getCol(`
            SELECT monitor_group.monitor_id FROM monitor_group, \`group\`
            WHERE monitor_group.group_id = \`group\`.id
            AND public = 1
            AND \`group\`.status_page_id = ?
        `, [ statusPageID ]);

        // Resolve time window
        const nowUtc = dayjs.utc();
        const nowTz = nowUtc.tz(tz);
        let startUtc = nowUtc.subtract(30, "day"); // 默认月报
        let endUtc = nowUtc;
        let windowLabel = "rolling-30d";

        if (range === "monthly") {
            // 月报 - 30天窗口
            if (windowType === "calendar") {
                const startTz = nowTz.startOf("month");
                startUtc = startTz.utc();
                endUtc = nowTz.utc();
                windowLabel = "calendar-month";
            } else {
                startUtc = nowUtc.subtract(30, "day");
                endUtc = nowUtc;
                windowLabel = "rolling-30d";
            }
        } else if (range === "quarterly") {
            // 季度报告 - 90天窗口
            if (windowType === "calendar") {
                const startTz = nowTz.startOf("quarter");
                startUtc = startTz.utc();
                endUtc = nowTz.utc();
                windowLabel = "calendar-quarter";
            } else {
                startUtc = nowUtc.subtract(90, "day");
                endUtc = nowUtc;
                windowLabel = "rolling-90d";
            }
        }

        // Helpers
        const computeSLAForMonitor = async (monitorID, monitorBean) => {
            const uptimeCalculator = await UptimeCalculator.getUptimeCalculator(monitorID);
            const useExcludeMaintenance = (overrideExcludeMaintenance === undefined || overrideExcludeMaintenance === null)
                ? Boolean(monitorBean?.sla_exclude_maintenance)
                : (String(overrideExcludeMaintenance) === "1" || String(overrideExcludeMaintenance) === "true");

            // 所有监控项都包含在报告中，自动使用对应的SLO目标

            let achieved = 0;
            let breakdown = { up: 0,
                down: 0,
                maintenance: 0,
                avgPing: null };
            if (range === "monthly" && windowType === "calendar") {
                const res = uptimeCalculator.getSLAByCalendarMonth({ excludeMaintenance: useExcludeMaintenance,
                    timezone: monitorBean?.sla_timezone || tz });
                achieved = res.ratio;
                breakdown = res.breakdown;
                // 日历月：使用当前月的实际天数
                const currentMonth = nowTz.daysInMonth();
                breakdown.theoreticalTotal = currentMonth * 24 * 60;
            } else if (range === "quarterly" && windowType === "calendar") {
                // 季度报告 - 自然季度计算
                const res = uptimeCalculator.getSLAByCalendarQuarter({ excludeMaintenance: useExcludeMaintenance,
                    timezone: monitorBean?.sla_timezone || tz });
                achieved = res.ratio;
                breakdown = res.breakdown;
                // 日历季度：使用90天作为理论值（近似）
                breakdown.theoreticalTotal = 90 * 24 * 60;
            } else {
                // compute days count for rolling windows
                let numDays;
                if (range === "monthly") {
                    if (windowType === "calendar") {
                        numDays = nowUtc.startOf("day").diff(startUtc.startOf("day"), "day") + 1;
                    } else {
                        numDays = 30; // 月报：30天滚动窗口
                    }
                } else if (range === "quarterly") {
                    if (windowType === "calendar") {
                        numDays = nowUtc.startOf("day").diff(startUtc.startOf("day"), "day") + 1;
                    } else {
                        numDays = 90; // 季度报告：90天滚动窗口
                    }
                }
                const br = uptimeCalculator.getBreakdown(numDays, "day");
                breakdown = br;
                const denominator = br.up + br.down + (useExcludeMaintenance ? 0 : br.maintenance);
                achieved = denominator === 0 ? 0 : (br.up / denominator);

                // 对于Error Budget计算，使用完整的理论时间窗口，而不是实际监控时间
                // 这样确保Error Budget基于完整的SLO周期计算
                const theoreticalTotalMinutes = numDays * 24 * 60; // 理论总分钟数
                breakdown.theoreticalTotal = theoreticalTotalMinutes;
            }

            // Error budget - 根据报告类型选择对应的SLO目标
            let target = null;
            if (range === "monthly") {
                // 月报：优先使用monthly_slo_target，否则回退到sla_target
                target = monitorBean?.monthly_slo_target ?? monitorBean?.sla_target ?? null;
            } else if (range === "quarterly") {
                // 季度报告：优先使用quarterly_slo_target，否则回退到sla_target
                target = monitorBean?.quarterly_slo_target ?? monitorBean?.sla_target ?? null;
            } else {
                // 其他情况使用通用目标
                target = monitorBean?.sla_target ?? null;
            }
            // 使用理论总时间计算Error Budget，确保基于完整SLO周期
            const denominatorForBudget = breakdown.theoreticalTotal || (breakdown.up + breakdown.down + ( ( (overrideExcludeMaintenance === undefined || overrideExcludeMaintenance === null) ? !monitorBean?.sla_exclude_maintenance : !(String(overrideExcludeMaintenance) === "1" || String(overrideExcludeMaintenance) === "true") ) ? breakdown.maintenance : 0 ));
            const allowedError = (target != null) ? Math.max(0, (1 - target) * denominatorForBudget) : null;
            const consumedError = breakdown.down;
            const remainingError = (allowedError != null) ? Math.max(0, allowedError - consumedError) : null;

            return { achieved,
                breakdown,
                target,
                errorBudget: { allowed: allowedError,
                    consumed: consumedError,
                    remaining: remainingError },
                excludeMaintenance: useExcludeMaintenance };
        };

        const fetchHeartbeats = async (monitorID, startISO, endISO) => {
            const rows = await R.getAll(`
                SELECT time, status, msg FROM heartbeat
                WHERE monitor_id = ? AND time >= ? AND time <= ?
                ORDER BY time ASC
            `, [ monitorID, startISO, endISO ]);
            const prev = await R.getRow(`
                SELECT time, status FROM heartbeat
                WHERE monitor_id = ? AND time < ?
                ORDER BY time DESC LIMIT 1
            `, [ monitorID, startISO ]);
            return { rows,
                prev };
        };

        const computeSegments = (rows, prev, startISO, endISO) => {
            const start = dayjs.utc(startISO);
            const end = dayjs.utc(endISO);
            const segments = { incidents: [],
                maintenance: [] };
            const Bad = new Set([ DOWN, PENDING ]);
            let curState = prev ? prev.status : null;
            let curStart = null;
            const pushSeg = (type, segStart, segEnd, firstMsg) => {
                if (!segStart || !segEnd || segEnd.isBefore(segStart)) {
                    return;
                }
                segments[type].push({
                    start: segStart.toISOString(),
                    end: segEnd.toISOString(),
                    durationSeconds: segEnd.diff(segStart, "second"),
                    msg: firstMsg || null,
                });
            };
            let firstMsg = null;
            // Seed from start boundary
            if (curState === MAINTENANCE) {
                curStart = start;
                firstMsg = null;
            } else if (Bad.has(curState)) {
                curStart = start;
                firstMsg = null;
            }
            for (const row of rows) {
                const t = dayjs.utc(row.time);
                if (curState === MAINTENANCE) {
                    if (row.status !== MAINTENANCE) {
                        pushSeg("maintenance", curStart, t, firstMsg);
                        curStart = null;
                        firstMsg = null;
                    }
                } else if (Bad.has(curState)) {
                    if (!Bad.has(row.status)) {
                        pushSeg("incidents", curStart, t, firstMsg);
                        curStart = null;
                        firstMsg = null;
                    }
                }

                // Transition into segment
                if (curState !== MAINTENANCE && row.status === MAINTENANCE) {
                    curStart = t;
                    firstMsg = row.msg || null;
                } else if (!Bad.has(curState) && Bad.has(row.status)) {
                    curStart = t;
                    firstMsg = row.msg || null;
                }
                curState = row.status;
            }
            // Close open at end
            if (curStart) {
                if (curState === MAINTENANCE) {
                    pushSeg("maintenance", curStart, end, firstMsg);
                } else if (Bad.has(curState)) {
                    pushSeg("incidents", curStart, end, firstMsg);
                }
            }
            return segments;
        };

        const startISO = startUtc.toISOString();
        const endISO = endUtc.toISOString();

        // Per-monitor data
        const monitors = [];
        for (const monitorID of monitorIDList) {
            const monitorBean = await R.findOne("monitor", " id = ? ", [ monitorID ]);
            const sla = await computeSLAForMonitor(monitorID, monitorBean);

            // 跳过不匹配报告周期的监控项
            if (!sla) {
                continue;
            }

            const { rows, prev } = await fetchHeartbeats(monitorID, startISO, endISO);
            const segs = computeSegments(rows, prev, startISO, endISO);
            const downtimeSeconds = segs.incidents.reduce((s, x) => s + x.durationSeconds, 0);
            const mttrSeconds = segs.incidents.length > 0 ? Math.round(downtimeSeconds / segs.incidents.length) : 0;
            const maintenanceSeconds = segs.maintenance.reduce((s, x) => s + x.durationSeconds, 0);

            monitors.push({
                id: monitorID,
                name: monitorBean?.name || String(monitorID),
                target: sla.target,
                achieved: sla.achieved,
                breakdown: sla.breakdown,
                errorBudget: sla.errorBudget,
                excludeMaintenance: sla.excludeMaintenance,
                incidents: segs.incidents,
                maintenance: segs.maintenance,
                totals: {
                    incidents: segs.incidents.length,
                    downtimeSeconds,
                    mttrSeconds,
                    maintenanceSeconds,
                }
            });
        }

        // Overview aggregation
        const count = monitors.length;
        const avg = (arr) => arr.length ? (arr.reduce((s, x) => s + x, 0) / arr.length) : 0;
        const overview = {
            monitors: count,
            slaAverage: avg(monitors.map(m => m.achieved)),
            incidents: {
                count: monitors.reduce((s, m) => s + m.totals.incidents, 0),
                totalDowntimeSeconds: monitors.reduce((s, m) => s + m.totals.downtimeSeconds, 0),
                mttrSeconds: (() => {
                    const allSegs = monitors.flatMap(m => m.incidents);
                    if (!allSegs.length) {
                        return 0;
                    }
                    const total = allSegs.reduce((s, x) => s + x.durationSeconds, 0);
                    return Math.round(total / allSegs.length);
                })(),
                topByDuration: monitors
                    .map(m => ({ monitorID: m.id,
                        name: m.name,
                        downtimeSeconds: m.totals.downtimeSeconds }))
                    .sort((a, b) => b.downtimeSeconds - a.downtimeSeconds)
                    .slice(0, 5),
            },
            maintenance: {
                totalSeconds: monitors.reduce((s, m) => s + m.totals.maintenanceSeconds, 0),
            }
        };

        response.json({
            report: {
                slug: slugParam,
                range,
                window: windowLabel,
                timezone: tz,
                generatedAt: nowUtc.toISOString(),
                startedAt: startISO,
                endedAt: endISO,
            },
            overview,
            monitors,
        });
    } catch (error) {
        sendHttpError(response, error.message);
    }
});
