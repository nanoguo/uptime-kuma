<template>
    <span v-if="shouldShow" :class="className" :title="title">SLI: {{ uptime }} <span class="sli-window">({{ windowLabel }})</span></span>
</template>

<script>
import { DOWN, MAINTENANCE, PENDING, UP } from "../util.ts";
import deploymentConfig from "../modules/deployment-config.js";

export default {
    props: {
        /** Monitor this represents */
        monitor: {
            type: Object,
            default: null,
        },
        /** Type of monitor */
        type: {
            type: String,
            default: null,
        },
        /** Is this a pill? */
        pill: {
            type: Boolean,
            default: false,
        },
        /** Force show, ignoring deployment configuration */
        forceShow: {
            type: Boolean,
            default: false,
        },
    },

    computed: {
        shouldShow() {
            if (this.forceShow) {
                return true;
            }

            return deploymentConfig.isFeatureEnabled("showSLI") &&
                   deploymentConfig.isTimeRangeAvailable(this.type);
        },
        uptime() {
            if (this.type === "maintenance") {
                return this.$t("statusMaintenance");
            }

            let key = this.monitor.id + "_" + this.type;

            if (this.$root.uptimeList[key] !== undefined) {
                let result = Math.round(this.$root.uptimeList[key] * 10000) / 100;
                // Only perform sanity check on status page. See louislam/uptime-kuma#2628
                if (this.$route.path.startsWith("/status") && result > 100) {
                    return "100%";
                } else {
                    return result + "%";
                }
            }

            return this.$t("notAvailableShort");
        },
        windowLabel() {
            // 显式标注窗口，避免与顶部的时间范围混淆
            if (this.type === "24") {
                return "24h";
            }
            if (this.type === "720") {
                return "30d";
            }
            if (this.type === "1y") {
                return "1y";
            }
            // 兜底：若传入已是标准时长（如 60m/24h/30d），直接显示
            return String(this.type || "");
        },

        color() {
            if (this.lastHeartBeat.status === MAINTENANCE) {
                return "maintenance";
            }

            if (this.lastHeartBeat.status === DOWN) {
                return "danger";
            }

            if (this.lastHeartBeat.status === UP) {
                return "primary";
            }

            if (this.lastHeartBeat.status === PENDING) {
                return "warning";
            }

            return "secondary";
        },

        lastHeartBeat() {
            if (this.monitor.id in this.$root.lastHeartbeatList && this.$root.lastHeartbeatList[this.monitor.id]) {
                return this.$root.lastHeartbeatList[this.monitor.id];
            }

            return {
                status: -1,
            };
        },

        className() {
            if (this.pill) {
                return `badge rounded-pill bg-${this.color}`;
            }

            return "";
        },

        title() {
            if (this.type === "1y") {
                return `1${this.$t("-year")}`;
            }
            if (this.type === "720") {
                return `30${this.$t("-day")}`;
            }
            return `24${this.$t("-hour")}`;
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
    },
};
</script>

<style>
.badge {
    min-width: 62px;
}
.sli-window { opacity: 0.65; margin-left: 6px; }
</style>
