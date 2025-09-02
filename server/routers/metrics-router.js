let express = require("express");
const { allowDevAllOrigin, sendHttpError } = require("../util-server");
const { R } = require("redbean-node");
const apicache = require("../modules/apicache");
const { UptimeCalculator } = require("../uptime-calculator");
const { DeploymentMiddleware } = require("../middleware/deployment-middleware");
const { log } = require("../../src/util");

let router = express.Router();
let cache = apicache.middleware;

// Apply deployment config injection middleware to all routes
router.use(DeploymentMiddleware.injectDeploymentConfig);

/**
 * Unified metrics endpoint for a monitor
 * Returns SLI, SLO, SLA data based on deployment configuration and user permissions
 * GET /api/metrics/monitor/:id/:duration
 */
router.get("/api/metrics/monitor/:id/:duration",
    cache("30 seconds"),
    DeploymentMiddleware.validateTimeRange("duration"),
    async (request, response) => {
        allowDevAllOrigin(response);

        try {
            const monitorID = parseInt(request.params.id, 10);
            const duration = request.params.duration;
            const config = request.deploymentConfig;

            // Get monitor details
            const monitor = await R.findOne("monitor", " id = ? ", [ monitorID ]);
            if (!monitor) {
                return sendHttpError(response, "Monitor not found");
            }

            const uptimeCalculator = await UptimeCalculator.getUptimeCalculator(monitorID);
            const excludeMaintenance = Boolean(monitor.sla_exclude_maintenance);

            let result = {
                monitorID,
                duration,
                timestamp: new Date().toISOString()
            };

            // SLA data (always included)
            if (config.features.showSLA) {
                try {
                    const slaData = uptimeCalculator.getSLAByDuration(duration, { excludeMaintenance });
                    const target = monitor.sla_target ?? null;
                    const totalUnits = slaData.breakdown.up + slaData.breakdown.down + (excludeMaintenance ? 0 : slaData.breakdown.maintenance);
                    const allowedError = (target != null) ? Math.max(0, (1 - target) * totalUnits) : null;
                    const consumedError = slaData.breakdown.down;
                    const remainingError = (allowedError != null) ? Math.max(0, allowedError - consumedError) : null;

                    result.sla = {
                        achieved: slaData.ratio,
                        target: target,
                        period: monitor.sla_period || "calendar-month",
                        breakdown: slaData.breakdown,
                        errorBudget: {
                            allowed: allowedError,
                            consumed: consumedError,
                            remaining: remainingError
                        }
                    };
                } catch (error) {
                    log.warn("metrics-router", `Failed to get SLA data for monitor ${monitorID}, duration ${duration}:`, error.message);
                    result.sla = null;
                }
            }

            // SLI data (Service Level Indicator - raw availability)
            if (config.features.showSLI) {
                try {
                    const slaData = uptimeCalculator.getSLAByDuration(duration, { excludeMaintenance: true });
                    result.sli = {
                        availability: slaData.ratio,
                        breakdown: slaData.breakdown
                    };
                } catch (error) {
                    log.warn("metrics-router", `Failed to get SLI data for monitor ${monitorID}:`, error.message);
                    result.sli = null;
                }
            }

            // SLO data (Service Level Objective - internal operational targets)
            if (config.features.showSLO) {
                try {
                    // SLO uses same calculation as SLA but may have different targets/interpretation
                    const sloData = uptimeCalculator.getSLAByDuration(duration, { excludeMaintenance });
                    const sloTarget = monitor.slo_target || monitor.sla_target; // Fall back to SLA target if no specific SLO target

                    result.slo = {
                        achieved: sloData.ratio,
                        target: sloTarget,
                        breakdown: sloData.breakdown,
                        type: "operational" // Distinguish from customer-facing SLA
                    };
                } catch (error) {
                    log.warn("metrics-router", `Failed to get SLO data for monitor ${monitorID}:`, error.message);
                    result.slo = null;
                }
            }

            // Additional performance metrics for internal mode
            if (config.mode === "internal") {
                try {
                    const uptimeData = uptimeCalculator.getDataByDuration(duration);
                    result.performance = {
                        uptime: uptimeData.uptime,
                        avgPing: uptimeData.avgPing,
                        minPing: uptimeData.minPing,
                        maxPing: uptimeData.maxPing
                    };
                } catch (error) {
                    log.warn("metrics-router", `Failed to get performance data for monitor ${monitorID}:`, error.message);
                    result.performance = null;
                }
            }

            // Filter response based on deployment configuration
            const filteredResult = DeploymentMiddleware.filterResponseData(result, config);

            response.json(filteredResult);

        } catch (error) {
            log.error("metrics-router", "Error in unified metrics endpoint:", error);
            sendHttpError(response, error.message);
        }
    }
);

/**
 * Batch metrics endpoint for multiple monitors
 * GET /api/metrics/monitors/:duration?ids=1,2,3&types=sla,sli
 */
router.get("/api/metrics/monitors/:duration",
    cache("30 seconds"),
    DeploymentMiddleware.validateTimeRange("duration"),
    async (request, response) => {
        allowDevAllOrigin(response);

        try {
            const duration = request.params.duration;
            const config = request.deploymentConfig;

            // Parse monitor IDs from query parameter
            const idsParam = request.query.ids || "";
            const monitorIds = idsParam.split(",")
                .filter(id => id.trim())
                .map(id => parseInt(id.trim(), 10))
                .filter(id => !isNaN(id));

            if (monitorIds.length === 0) {
                return sendHttpError(response, "No valid monitor IDs provided");
            }

            // Parse requested metric types
            const typesParam = request.query.types || "sla";
            const requestedTypes = typesParam.split(",")
                .map(type => type.trim().toLowerCase())
                .filter(type => [ "sla", "sli", "slo" ].includes(type));

            const results = {
                duration,
                timestamp: new Date().toISOString(),
                monitors: {}
            };

            // Process each monitor
            for (const monitorId of monitorIds) {
                try {
                    const monitor = await R.findOne("monitor", " id = ? ", [ monitorId ]);
                    if (!monitor) {
                        results.monitors[monitorId] = { error: "Monitor not found" };
                        continue;
                    }

                    const uptimeCalculator = await UptimeCalculator.getUptimeCalculator(monitorId);
                    const excludeMaintenance = Boolean(monitor.sla_exclude_maintenance);

                    let monitorResult = {
                        id: monitorId,
                        name: monitor.name
                    };

                    // Add requested metrics based on deployment config and user request
                    if (requestedTypes.includes("sla") && config.features.showSLA) {
                        try {
                            const slaData = uptimeCalculator.getSLAByDuration(duration, { excludeMaintenance });
                            monitorResult.sla = {
                                achieved: slaData.ratio,
                                target: monitor.sla_target,
                                breakdown: slaData.breakdown
                            };
                        } catch (error) {
                            monitorResult.sla = { error: error.message };
                        }
                    }

                    if (requestedTypes.includes("sli") && config.features.showSLI) {
                        try {
                            const sliData = uptimeCalculator.getSLAByDuration(duration, { excludeMaintenance: true });
                            monitorResult.sli = {
                                availability: sliData.ratio,
                                breakdown: sliData.breakdown
                            };
                        } catch (error) {
                            monitorResult.sli = { error: error.message };
                        }
                    }

                    if (requestedTypes.includes("slo") && config.features.showSLO) {
                        try {
                            const sloData = uptimeCalculator.getSLAByDuration(duration, { excludeMaintenance });
                            monitorResult.slo = {
                                achieved: sloData.ratio,
                                target: monitor.slo_target || monitor.sla_target,
                                breakdown: sloData.breakdown
                            };
                        } catch (error) {
                            monitorResult.slo = { error: error.message };
                        }
                    }

                    results.monitors[monitorId] = monitorResult;

                } catch (error) {
                    results.monitors[monitorId] = { error: error.message };
                }
            }

            // Filter response based on deployment configuration
            const filteredResults = DeploymentMiddleware.filterResponseData(results, config);

            response.json(filteredResults);

        } catch (error) {
            log.error("metrics-router", "Error in batch metrics endpoint:", error);
            sendHttpError(response, error.message);
        }
    }
);

/**
 * Available metrics endpoint - returns what metrics are available in current deployment mode
 * GET /api/metrics/available
 */
router.get("/api/metrics/available", cache("5 minutes"), async (request, response) => {
    allowDevAllOrigin(response);

    try {
        const config = request.deploymentConfig;

        response.json({
            deploymentMode: config.mode,
            availableMetrics: {
                sli: config.features.showSLI,
                slo: config.features.showSLO,
                sla: config.features.showSLA
            },
            availableTimeRanges: config.features.timeRanges,
            modules: config.modules,
            publicAccess: {
                enabled: config.publicAccess.enabled,
                allowAnonymous: config.publicAccess.allowAnonymous
            }
        });

    } catch (error) {
        log.error("metrics-router", "Error getting available metrics:", error);
        sendHttpError(response, error.message);
    }
});

/**
 * Health check for metrics API
 * GET /api/metrics/health
 */
router.get("/api/metrics/health", async (request, response) => {
    allowDevAllOrigin(response);

    try {
        const config = request.deploymentConfig;

        response.json({
            status: "healthy",
            timestamp: new Date().toISOString(),
            deploymentMode: config.mode,
            version: "2.0.0"
        });

    } catch (error) {
        log.error("metrics-router", "Error in health check:", error);
        response.status(503).json({
            status: "unhealthy",
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

module.exports = router;
