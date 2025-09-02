<template>
    <span v-if="shouldShow" :class="badgeClass">
        {{ display }}
    </span>
</template>

<script>
import deploymentConfig from "../modules/deployment-config.js";

export default {
    name: "SLOChip",
    props: {
        monitorId: { type: Number,
            required: true },
        keySuffix: { type: String,
            default: "7d" },
        pill: { type: Boolean,
            default: false },
        forceShow: { type: Boolean,
            default: false },
    },

    computed: {
        shouldShow() {
            if (this.forceShow) {
                return true;
            }

            const featureEnabled = deploymentConfig.isFeatureEnabled("showSLO");

            return featureEnabled;
        },

        sloTarget() {
            // Get SLO target from monitor configuration
            let monitor = this.$root.monitorList?.[this.monitorId];

            // If monitorList is not available (public status page), try to get from publicGroupList
            if (!monitor) {
                for (const group of this.$root.publicGroupList || []) {
                    const foundMonitor = group.monitorList?.find(m => m.id === this.monitorId);
                    if (foundMonitor) {
                        monitor = foundMonitor;
                        break;
                    }
                }
            }

            // Debug target acquisition
            if (!monitor?.sla_target) {
                // No target found
            }

            if (monitor) {
                // SLA_target from edit page is actually our SLO target
                return monitor.sla_target;
            }
            return null;
        },

        badgeClass() {
            if (!this.pill) {
                return "";
            }

            const base = "badge rounded-pill ";

            return base + "bg-primary";
        },

        display() {
            if (!this.sloTarget) {
                // No target configured
                return `SLO: ${this.$t("notAvailableShort")}`;
            }

            const targetPct = Math.round(this.sloTarget * 10000) / 100;
            return `SLO: ${targetPct}%`;
        }
    },

    async mounted() {
        if (!deploymentConfig.config) {
            await deploymentConfig.initialize();
        }

        this.unsubscribe = deploymentConfig.subscribe(() => {
            this.$forceUpdate();
        });
    },

    beforeUnmount() {
        if (this.unsubscribe) {
            this.unsubscribe();
        }
    }
};
</script>

<style scoped>
.badge {
    min-width: 85px;
    font-size: 0.8em;
}
</style>
