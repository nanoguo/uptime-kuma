/**
 * Deployment Configuration Management Service
 * Handles fetching, caching, and reactive updates of deployment configuration
 */

class DeploymentConfigService {
    /**
     *
     */
    constructor() {
        this.config = null;
        this.isLoading = false;
        this.lastFetch = null;
        this.cacheTimeout = 5 * 60 * 1000; // 5 minutes
        this.listeners = [];
    }

    /**
     * Get current deployment configuration
     * @param {boolean} forceRefresh - Force refresh from server
     * @returns {Promise<object>} Deployment configuration
     */
    async getConfig(forceRefresh = false) {
        const now = Date.now();
        const cacheExpired = !this.lastFetch || (now - this.lastFetch) > this.cacheTimeout;

        if (forceRefresh || !this.config || cacheExpired) {
            await this.fetchConfig();
        }

        return this.config;
    }

    /**
     * Fetch configuration from server
     * @returns {Promise<void>}
     */
    async fetchConfig() {
        if (this.isLoading) {
            return;
        }

        this.isLoading = true;

        try {
            const response = await fetch("/api/config/deployment");
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const newConfig = await response.json();

            // Check if config has changed
            const configChanged = JSON.stringify(this.config) !== JSON.stringify(newConfig);

            this.config = newConfig;
            this.lastFetch = Date.now();

            // Notify listeners if config changed
            if (configChanged) {
                this.notifyListeners(newConfig);
            }

        } catch (error) {
            console.error("Failed to fetch deployment config:", error);

            // Use safe defaults on error
            if (!this.config) {
                this.config = this.getDefaultConfig();
            }
        } finally {
            this.isLoading = false;
        }
    }

    /**
     * Check if a feature is enabled
     * @param {string} feature - Feature name
     * @returns {boolean}
     */
    isFeatureEnabled(feature) {
        if (!this.config || !this.config.features) {
            return this.getDefaultConfig().features[feature] || false;
        }
        return this.config.features[feature] || false;
    }

    /**
     * Check if a time range is available
     * @param {string} timeRange - Time range (e.g., '1h', '24h')
     * @returns {boolean}
     */
    isTimeRangeAvailable(timeRange) {
        if (!this.config || !this.config.features || !this.config.features.timeRanges) {
            return this.getDefaultConfig().features.timeRanges.includes(timeRange);
        }
        return this.config.features.timeRanges.includes(timeRange);
    }

    /**
     * Get default deployment configuration
     * @returns {object} Default configuration
     */
    getDefaultConfig() {
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

    /**
     * Get available time ranges
     * @returns {string[]} Available time ranges
     */
    getAvailableTimeRanges() {
        if (!this.config || !this.config.features || !this.config.features.timeRanges) {
            return this.getDefaultConfig().features.timeRanges;
        }
        return this.config.features.timeRanges;
    }

    /**
     * Get deployment mode
     * @returns {string} Deployment mode ('internal' or 'external')
     */
    getMode() {
        if (!this.config) {
            return "internal";
        }
        return this.config.mode || "internal";
    }

    /**
     * Check if current mode is external
     * @returns {boolean}
     */
    isExternalMode() {
        return this.getMode() === "external";
    }

    /**
     * Check if current mode is internal
     * @returns {boolean}
     */
    isInternalMode() {
        return this.getMode() === "internal";
    }

    /**
     * Subscribe to configuration changes
     * @param {Function} callback - Callback function to call when config changes
     * @returns {Function} Unsubscribe function
     */
    subscribe(callback) {
        this.listeners.push(callback);

        // Return unsubscribe function
        return () => {
            const index = this.listeners.indexOf(callback);
            if (index > -1) {
                this.listeners.splice(index, 1);
            }
        };
    }

    /**
     * @param newConfig - New configuration
     */
    notifyListeners(newConfig) {
        this.listeners.forEach(callback => {
            try {
                callback(newConfig);
            } catch (error) {
                console.error("Error in config change listener:", error);
            }
        });
    }

    /**
     * Initialize the service - fetch initial config
     * @returns {Promise<void>}
     */
    async initialize() {
        await this.fetchConfig();
    }

    /**
     * Refresh configuration from server
     * @returns {Promise<void>}
     */
    async refresh() {
        await this.fetchConfig();
    }

    /**
     * Get human-readable labels for time ranges
     * @returns {object} Time range labels
     */
    getTimeRangeLabels() {
        return {
            "1h": "1 Hour",
            "24h": "24 Hours",
            "7d": "7 Days",
            "30d": "30 Days",
            "90d": "90 Days"
        };
    }

    /**
     * Get filtered metrics data based on current config
     * @param {object} data - Raw metrics data
     * @returns {object} Filtered data
     */
    filterMetricsData(data) {
        if (!this.config || this.isInternalMode()) {
            return data;
        }

        // For external mode, filter out SLI/SLO data
        const filtered = { ...data };

        // Remove SLI/SLO specific fields
        if (!this.isFeatureEnabled("showSLI") && filtered.sli !== undefined) {
            delete filtered.sli;
        }
        if (!this.isFeatureEnabled("showSLO") && filtered.slo !== undefined) {
            delete filtered.slo;
        }
        if (!this.isFeatureEnabled("showSLA") && filtered.sla !== undefined) {
            delete filtered.sla;
        }

        return filtered;
    }
}

// Create singleton instance
const deploymentConfig = new DeploymentConfigService();

// Vue plugin
const DeploymentConfigPlugin = {
    install(app) {
        // Make the service available globally in Vue components
        app.config.globalProperties.$deploymentConfig = deploymentConfig;

        // Provide reactive properties
        app.provide("deploymentConfig", deploymentConfig);
    }
};

export default deploymentConfig;
export { DeploymentConfigService, DeploymentConfigPlugin };
