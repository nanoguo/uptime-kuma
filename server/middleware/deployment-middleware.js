const { Settings } = require("../settings");
const { log } = require("../../src/util");

/**
 * Middleware to check deployment mode and apply access restrictions
 */
class DeploymentMiddleware {

    /**
     * Get current deployment configuration
     * @returns {Promise<object>} deployment configuration
     */
    static async getDeploymentConfig() {
        try {
            const config = {
                mode: await Settings.get("deploymentMode") || "internal",
                features: await Settings.get("deploymentFeatures") || {
                    showSLI: true,
                    showSLO: true,
                    showSLA: true,
                    timeRanges: [ "90m", "24h", "90d" ], // Internal: 90m/24h for SLI/SLO, 90d for SLA
                    defaultView: "dashboard"
                },
                publicAccess: await Settings.get("deploymentPublicAccess") || {
                    enabled: false,
                    allowAnonymous: false,
                    customDomain: null
                },
                modules: await Settings.get("deploymentModules") || {
                    monitoring: true,
                    configuration: true,
                    alerting: true,
                    reporting: true
                }
            };

            return config;
        } catch (error) {
            log.error("deployment-middleware", "Error getting deployment config:", error);
            // Return safe defaults
            return {
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
                    allowAnonymous: false,
                    customDomain: null
                },
                modules: {
                    monitoring: true,
                    configuration: true,
                    alerting: true,
                    reporting: true
                }
            };
        }
    }

    /**
     * Middleware to inject deployment config into request
     * @param {object} req - Express request object
     * @param {object} res - Express response object
     * @param {Function} next - Express next middleware function
     * @returns {void}
     */
    static async injectDeploymentConfig(req, res, next) {
        try {
            req.deploymentConfig = await DeploymentMiddleware.getDeploymentConfig();
            next();
        } catch (error) {
            log.error("deployment-middleware", "Error injecting deployment config:", error);
            next();
        }
    }

    /**
     * Middleware to check if the requested feature is enabled in current deployment mode
     * @param {string} feature - Feature name (e.g., 'showSLI', 'showSLO', 'monitoring')
     * @returns {Function} Express middleware function
     */
    static checkFeatureEnabled(feature) {
        return async (req, res, next) => {
            try {
                const config = req.deploymentConfig || await DeploymentMiddleware.getDeploymentConfig();

                // Check feature in features object first
                if (config.features && config.features[feature] !== undefined) {
                    if (!config.features[feature]) {
                        return res.status(403).json({
                            error: "Feature not available in current deployment mode",
                            feature: feature,
                            deploymentMode: config.mode
                        });
                    }
                }

                // Check feature in modules object
                if (config.modules && config.modules[feature] !== undefined) {
                    if (!config.modules[feature]) {
                        return res.status(403).json({
                            error: "Module not available in current deployment mode",
                            module: feature,
                            deploymentMode: config.mode
                        });
                    }
                }

                next();
            } catch (error) {
                log.error("deployment-middleware", "Error checking feature:", error);
                // Allow access on error to prevent breaking existing functionality
                next();
            }
        };
    }

    /**
     * Middleware to validate time range is allowed in current deployment mode
     * @param {string} timeRangeParam - Request parameter name containing time range
     * @param {boolean} strict - Whether to enforce strict validation
     * @returns {Function} Express middleware function
     */
    /**
     * Normalize time range format (e.g., "60m" -> "1h", "1440m" -> "24h")
     * @param {string} timeRange - Input time range string
     * @returns {string} Normalized time range string
     */
    static normalizeTimeRange(timeRange) {
        if (!timeRange) {
            return timeRange;
        }

        const timeRangeMap = {
            // Legacy formats (normalize to standard)
            "60m": "1h",
            "1440m": "24h",
            "1d": "24h",
            "90days": "90d",

            // Standard formats (keep as-is)
            "1h": "1h",
            "24h": "24h",
            "90d": "90d"
            // Note: 30d, 7d, and other ranges removed per user request
        };

        return timeRangeMap[timeRange] || timeRange;
    }

    /**
     * Validate time range middleware
     * @param {string} timeRangeParam - Request parameter name containing time range
     * @param {boolean} strict - Whether to enforce strict validation
     * @returns {Function} Express middleware function
     */
    static validateTimeRange(timeRangeParam = "duration", strict = true) {
        return async (req, res, next) => {
            try {
                const config = req.deploymentConfig || await DeploymentMiddleware.getDeploymentConfig();
                const requestedRange = req.params[timeRangeParam] || req.query[timeRangeParam];

                if (!requestedRange) {
                    return next();
                }

                const normalizedRequested = DeploymentMiddleware.normalizeTimeRange(requestedRange);
                const allowedRanges = config.features?.timeRanges || [ "90m", "24h", "90d" ]; // Default: 90m/24h for SLI/SLO, 90d for SLA

                if (!allowedRanges.includes(normalizedRequested)) {
                    if (strict) {
                        return res.status(403).json({
                            error: "Time range not available in current deployment mode",
                            requestedRange: requestedRange,
                            normalizedRange: normalizedRequested,
                            allowedRanges: allowedRanges,
                            deploymentMode: config.mode
                        });
                    } else {
                        // For non-strict mode (like status pages), just continue
                        log.debug("deployment-middleware", `Time range ${requestedRange} (normalized: ${normalizedRequested}) not in allowed list, but continuing in non-strict mode`);
                        return next();
                    }
                }

                next();
            } catch (error) {
                log.error("deployment-middleware", "Error validating time range:", error);
                // Allow access on error
                next();
            }
        };
    }

    /**
     * Middleware for external mode restrictions
     * Only allows access if public access is enabled or user is authenticated
     * @returns {Function} Express middleware function
     */
    static checkPublicAccess() {
        return async (req, res, next) => {
            try {
                const config = req.deploymentConfig || await DeploymentMiddleware.getDeploymentConfig();

                // Internal mode: proceed normally (existing auth handles this)
                if (config.mode === "internal") {
                    return next();
                }

                // External mode: check public access settings
                if (config.mode === "external") {
                    // If public access is enabled and anonymous access allowed, allow
                    if (config.publicAccess?.enabled && config.publicAccess?.allowAnonymous) {
                        return next();
                    }

                    // If not anonymous, check if user is authenticated
                    // This is a simplified check - in reality you'd check actual auth status
                    const authHeader = req.headers.authorization;
                    if (authHeader || req.headers.cookie) {
                        return next();
                    }

                    return res.status(401).json({
                        error: "Authentication required",
                        deploymentMode: config.mode,
                        publicAccess: config.publicAccess?.enabled || false
                    });
                }

                next();
            } catch (error) {
                log.error("deployment-middleware", "Error checking public access:", error);
                next();
            }
        };
    }

    /**
     * Filter response data based on deployment configuration
     * @param {object} data - Response data to filter
     * @param {object} config - Deployment configuration
     * @returns {object} Filtered data
     */
    static filterResponseData(data, config) {
        if (!config || config.mode === "internal") {
            return data; // Return all data for internal mode
        }

        if (config.mode === "external") {
            // For external mode, filter out SLI/SLO data
            const filtered = { ...data };

            // Remove SLI/SLO specific fields
            if (filtered.sli !== undefined) {
                delete filtered.sli;
            }
            if (filtered.slo !== undefined) {
                delete filtered.slo;
            }
            if (filtered.errorBudget !== undefined) {
                delete filtered.errorBudget;
            }

            // Filter time ranges in nested objects
            if (filtered.uptimeList) {
                const allowedRanges = config.features?.timeRanges || [ "90m", "24h", "90d" ];
                const filteredUptimeList = {};

                Object.keys(filtered.uptimeList).forEach(key => {
                    const range = key.split("_").pop();
                    if (allowedRanges.includes(range + "d") || allowedRanges.includes(range)) {
                        filteredUptimeList[key] = filtered.uptimeList[key];
                    }
                });

                filtered.uptimeList = filteredUptimeList;
            }

            return filtered;
        }

        return data;
    }
}

module.exports = { DeploymentMiddleware };
