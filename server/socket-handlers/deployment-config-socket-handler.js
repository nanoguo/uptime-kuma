const { checkLogin } = require("../util-server");
const { log } = require("../../src/util");
const { Settings } = require("../settings");

/**
 * Socket handlers for deployment configuration management
 * @param {Socket} socket Socket.io instance
 * @returns {void}
 */
module.exports.deploymentConfigSocketHandler = (socket) => {

    /**
     * Get current deployment configuration
     */
    socket.on("getDeploymentConfig", async (callback) => {
        try {
            checkLogin(socket);

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

            log.debug("deployment-config", "Retrieved deployment configuration", config);

            callback({
                ok: true,
                config: config
            });

        } catch (error) {
            log.error("deployment-config", "Error getting deployment config:", error);
            callback({
                ok: false,
                msg: error.message
            });
        }
    });

    /**
     * Update deployment configuration
     */
    socket.on("setDeploymentConfig", async (newConfig, callback) => {
        try {
            checkLogin(socket);

            // Validate the config structure
            if (!newConfig.mode || ![ "internal", "external" ].includes(newConfig.mode)) {
                throw new Error("Invalid deployment mode. Must be 'internal' or 'external'");
            }

            // Update each configuration section
            if (newConfig.mode !== undefined) {
                await Settings.set("deploymentMode", newConfig.mode, "deployment");
            }

            if (newConfig.features) {
                // Validate features based on mode
                if (newConfig.mode === "external") {
                    // For external mode, enforce constraints
                    newConfig.features.showSLI = false;
                    newConfig.features.showSLO = false;
                    newConfig.features.showSLA = false;  // SLA shown in heartbeat bar instead
                    newConfig.features.timeRanges = [ "90d" ];  // Only 90 days for external
                    newConfig.features.defaultView = "public-status";
                }
                await Settings.set("deploymentFeatures", newConfig.features, "deployment");
            }

            if (newConfig.publicAccess) {
                await Settings.set("deploymentPublicAccess", newConfig.publicAccess, "deployment");
            }

            if (newConfig.modules) {
                // For external mode, disable certain modules
                if (newConfig.mode === "external") {
                    newConfig.modules.configuration = false;
                    newConfig.modules.alerting = false;
                    newConfig.modules.monitoring = false;
                }
                await Settings.set("deploymentModules", newConfig.modules, "deployment");
            }

            log.info("deployment-config", "Updated deployment configuration:", newConfig);

            callback({
                ok: true,
                msg: "Deployment configuration updated successfully",
                config: newConfig
            });

        } catch (error) {
            log.error("deployment-config", "Error setting deployment config:", error);
            callback({
                ok: false,
                msg: error.message
            });
        }
    });

    /**
     * Reset deployment configuration to defaults
     */
    socket.on("resetDeploymentConfig", async (callback) => {
        try {
            checkLogin(socket);

            const defaultConfig = {
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

            // Reset all deployment settings
            await Settings.set("deploymentMode", defaultConfig.mode, "deployment");
            await Settings.set("deploymentFeatures", defaultConfig.features, "deployment");
            await Settings.set("deploymentPublicAccess", defaultConfig.publicAccess, "deployment");
            await Settings.set("deploymentModules", defaultConfig.modules, "deployment");

            log.info("deployment-config", "Reset deployment configuration to defaults");

            callback({
                ok: true,
                msg: "Deployment configuration reset to defaults",
                config: defaultConfig
            });

        } catch (error) {
            log.error("deployment-config", "Error resetting deployment config:", error);
            callback({
                ok: false,
                msg: error.message
            });
        }
    });

    /**
     * Get deployment mode quick access (for middleware/routing decisions)
     */
    socket.on("getDeploymentMode", async (callback) => {
        try {
            const mode = await Settings.get("deploymentMode") || "internal";
            callback({
                ok: true,
                mode: mode
            });
        } catch (error) {
            log.error("deployment-config", "Error getting deployment mode:", error);
            callback({
                ok: false,
                msg: error.message,
                mode: "internal" // fallback
            });
        }
    });
};
