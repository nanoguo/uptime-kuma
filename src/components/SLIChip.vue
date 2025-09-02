<template>
    <span v-if="shouldShow" :class="badgeClass">
        {{ display }}
    </span>
</template>

<script>
import deploymentConfig from "../modules/deployment-config.js";

export default {
    name: "SLIChip",
    props: {
        monitorId: { type: Number,
            required: true },
        keySuffix: { type: String,
            default: "24h" },
        pill: { type: Boolean,
            default: false },
        forceShow: { type: Boolean,
            default: false },
    },

    data() {
        return {
            localTimeRange: "24h" // Local reactive state
        };
    },

    computed: {
        shouldShow() {
            if (this.forceShow) {
                // forceShow is true
                return true;
            }

            // Hide SLI in 90-day mode - SLI is for short-term real-time indicators
            const currentDuration = this.currentTimeRange;
            if (currentDuration === "90d") {
                return false;
            }

            // Ensure config is available - fallback to default if not loaded
            if (!deploymentConfig.config) {
                // Config not loaded, using defaults
                // Use default config for initial render
                const defaultConfig = deploymentConfig.getDefaultConfig();
                const featureEnabled = defaultConfig.features.showSLI;
                const timeRangeAvailable = defaultConfig.features.timeRanges.includes(this.keySuffix);

                return featureEnabled && timeRangeAvailable;
            }

            const featureEnabled = deploymentConfig.isFeatureEnabled("showSLI");
            const timeRangeAvailable = deploymentConfig.isTimeRangeAvailable(this.keySuffix);

            return featureEnabled && timeRangeAvailable;
        },

        currentTimeRange() {
            // Use local reactive state that updates from DOM events
            const duration = this.localTimeRange || this.$root.statusDuration || "90m";
            return duration;
        },

        sliData() {
            // SLI (Service Level Indicator) - Fixed 24h data for statistical significance
            // Backend should always provide 24h SLI data regardless of time selector
            const uptimeKey = `${this.monitorId}_24`;
            const uptimeValue = this.$root.uptimeList?.[uptimeKey];

            if (uptimeValue == null) {
                return null;
            }

            return uptimeValue;
        },

        badgeClass() {
            if (!this.pill) {
                return "";
            }

            const base = "badge rounded-pill ";

            if (this.sliData == null) {
                return base + "bg-secondary";
            }

            let color = "bg-secondary";

            // SLI thresholds aligned with heartbeat bar compression logic
            if (this.sliData >= 0.99) {          // ≥99% (≤1% down) → Green
                color = "bg-success";
            } else if (this.sliData >= 0.90) {   // ≥90% (1-10% down) → Yellow
                color = "bg-warning";
            } else {                             // <90% (>10% down) → Red
                color = "bg-danger";
            }

            return base + color;
        },

        display() {
            if (this.sliData == null) {
                return `SLI: ${this.$t("notAvailableShort")}`;
            }

            const pct = Math.round(this.sliData * 10000) / 100;

            // SLI always uses fixed 24h data for statistical significance
            return `SLI: ${pct}% (24 Hours)`;
        }
    },

    async mounted() {
        if (!deploymentConfig.config) {
            await deploymentConfig.initialize();
        }

        // Initialize local time range from current state
        this.localTimeRange = this.$root.statusDuration || "24h";

        this.unsubscribe = deploymentConfig.subscribe(() => {
            this.$forceUpdate();
        });

        // Watch for heartbeat data changes
        this.heartbeatWatcher = this.$watch("$root.heartbeatList", () => {
            this.$forceUpdate();
        }, { deep: true });

        // Watch for page time range changes
        this.statusDurationWatcher = this.$watch("$root.statusDuration", (newVal, oldVal) => {
            // StatusDuration changed
            this.localTimeRange = newVal; // Update local state
            this.$forceUpdate();
        });

        // Also listen to DOM select change as backup
        this.$nextTick(() => {
            const selectElement = document.querySelector(".duration-selector select");
            if (selectElement) {
                // Initialize local state
                this.localTimeRange = selectElement.value || "24h";

                this.domChangeHandler = () => {
                    const newValue = selectElement.value;
                    // DOM select changed
                    this.localTimeRange = newValue; // Update local reactive state
                    this.$forceUpdate();
                };
                selectElement.addEventListener("change", this.domChangeHandler);
            }
        });
    },

    beforeUnmount() {
        if (this.unsubscribe) {
            this.unsubscribe();
        }
        if (this.heartbeatWatcher) {
            this.heartbeatWatcher();
        }
        if (this.statusDurationWatcher) {
            this.statusDurationWatcher();
        }
        // Remove DOM event listener
        if (this.domChangeHandler) {
            const selectElement = document.querySelector(".duration-selector select");
            if (selectElement) {
                selectElement.removeEventListener("change", this.domChangeHandler);
            }
        }
    },

    methods: {
        getTimeRangeLabel() {
            const labels = deploymentConfig.getTimeRangeLabels();
            return labels[this.keySuffix] || this.keySuffix;
        }
    }
};
</script>

<style scoped>
.badge {
    min-width: 62px;
    font-size: 0.85em;
}
</style>
