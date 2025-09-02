<template>
    <div ref="wrap" class="wrap" :style="wrapStyle">
        <div class="hp-bar-big" :style="barStyle">
            <div
                v-for="(beat, index) in shortBeatList"
                :key="index"
                class="beat-hover-area"
                :class="{ 'empty': (beat === 0 || beat?.isEmpty || beat?.status === null || beat?.msg === 'No data') }"
                :style="beatHoverAreaStyle"
                @mouseenter="showTooltip(beat, index, $event)"
                @mouseleave="startHideTooltip()"
            >
                <div
                    class="beat"
                    :class="{
                        'empty': (beat === 0 || beat?.isEmpty || beat?.status === null || beat?.msg === 'No data'),
                        'down': (beat?.status === 0 && !beat?.isEmpty && beat?.msg !== 'No data'),
                        'poor': (beat?.status === 6),
                        'partial': (beat?.status === 4),
                        'good-green': (beat?.status === 7),
                        'good': (beat?.status === 5),
                        'pending': (beat?.status === 2),
                        'maintenance': (beat?.status === 3)
                    }"
                    :style="beatStyle"
                />
            </div>
        </div>
        <!-- 全局tooltip -->
        <div v-if="activeTooltip" class="global-beat-tooltip" :style="tooltipStyle" v-html="activeTooltip">
        </div>

        <!-- 90d Mode: Beautiful uptime display (both external and internal) -->
        <div
            v-if="is90d && !$root.isMobile && size !== 'small' && (beatList && beatList.length > 4)"
            class="external-uptime-display" :style="timeStyle"
        >
            <div class="uptime-start">{{ uptimeDisplayStart }}</div>
            <div class="uptime-center">
                <div class="divider-line"></div>
                <span class="uptime-text">{{ uptimeDisplayText }}</span>
                <div class="divider-line"></div>
            </div>
            <div class="uptime-end">{{ uptimeDisplayEnd }}</div>
        </div>

        <!-- Internal Mode: Technical time labels (90m/24h only) -->
        <div
            v-else-if="!$root.isMobile && size !== 'small' && !is90d && (beatList && beatList.length > 4) && $root.styleElapsedTime !== 'none'"
            :class="timeRowClass" :style="timeStyle"
        >
            <div v-if="hasFullWindow">{{ timeSinceFirstBeat }}</div>
            <div v-if="$root.styleElapsedTime === 'with-line'" class="connecting-line"></div>
            <div v-if="!hasFullWindow" class="spacer"></div>
            <div>{{ timeSinceLastBeat }}</div>
        </div>
    </div>
</template>

<script>
import dayjs from "dayjs";
import deploymentConfig from "../modules/deployment-config.js";

export default {
    props: {
        /** Size of the heartbeat bar */
        size: {
            type: String,
            default: "big",
        },
        /** ID of the monitor */
        monitorId: {
            type: Number,
            required: true,
        },
        /** Optional current duration window, e.g. '60m' | '24h' */
        duration: {
            type: String,
            default: null,
        },
        /** Array of the monitors heartbeats */
        heartbeatList: {
            type: Array,
            default: null,
        }
    },
    data() {
        return {
            beatHeight: 34,
            hoverScale: 1.2,
            move: false,
            maxBeat: 60,
            activeBeatIndex: null,
            activeTooltip: null,
            tooltipPosition: { x: 0,
                y: 0 },
            tooltipHideTimer: null,
        };
    },
    computed: {
        /** 统一的窗口来源：优先使用 props.duration，否则用全局 */
        effectiveDuration() {
            return this.duration || this.$root.statusDuration;
        },

        /** Check if in external mode for customer-friendly display */
        isExternalMode() {
            return deploymentConfig.config?.mode === "external";
        },

        /** Dynamic beat width based on number of beats to display */
        beatWidth() {
            // 统一所有模式都使用粗条样式，现在有col-9的充足空间
            return 6;
        },

        /** Dynamic padding based on mode */
        dynamicBeatPadding() {
            // 统一所有模式都使用标准间距
            return 2;
        },

        /** 90d mode: Show "90 days ago" for both internal and external */
        uptimeDisplayStart() {
            if (this.is90d) {
                const days = this.maxBeat - 1;
                return `${days} days ago`;
            }
            return "";
        },

        /** 90d mode: Show "Today" for both internal and external */
        uptimeDisplayEnd() {
            return this.is90d ? "Today" : "";
        },

        /** 90d mode: Calculate and show actual uptime percentage for both modes */
        uptimeDisplayText() {
            if (!this.is90d || !this.beatList) {
                return "N/A uptime";
            }

            // For 90d daily aggregated data, use the SLA data from API response
            const slaData = this.$root.slaList?.[`${this.monitorId}_90d`];
            if (slaData && slaData.achieved !== undefined) {
                const uptimePercent = (slaData.achieved * 100).toFixed(2);
                return `${uptimePercent}% uptime`;
            }

            // Fallback: Calculate from heartbeat data
            const validBeats = this.beatList.filter(beat => beat && beat.status !== undefined);
            if (validBeats.length === 0) {
                return "N/A uptime";
            }

            const upBeats = validBeats.filter(beat => beat.status === 1).length;
            const uptimePercent = ((upBeats / validBeats.length) * 100).toFixed(2);

            return `${uptimePercent}% uptime`;
        },
        is30d() {
            // Legacy support - no longer used as 30d is removed
            return false;
        },

        /** Check if 90d mode for external customer view */
        is90d() {
            return this.effectiveDuration === "90d";
        },
        /** 统一所有模式都使用90个心跳条，但small模式只显示最新的15个 */
        desiredMaxBeat() {
            // 小尺寸模式只显示最新的15个心跳
            if (this.size === "small") {
                return 15;
            }
            return 90;
        },

        /**
         * If heartbeatList is null, get it from $root.heartbeatList
         * @returns {object} Heartbeat list
         */
        beatList() {
            if (this.heartbeatList === null) {
                return this.$root.heartbeatList[this.monitorId];
            } else {
                return this.heartbeatList;
            }
        },

        /**
         * Calculates the amount of beats of padding needed to fill the length of shortBeatList.
         * @returns {number} The amount of beats of padding needed to fill the length of shortBeatList.
         */
        numPadding() {
            if (!this.beatList) {
                return 0;
            }
            let num = this.beatList.length - this.maxBeat;

            if (this.move) {
                num = num - 1;
            }

            if (num > 0) {
                return 0;
            }

            return -1 * num;
        },

        shortBeatList() {
            if (!this.beatList) {
                return [];
            }

            const data = this.beatList;
            const total = data.length;
            const sliceLen = Math.min(this.maxBeat, total);
            // 右对齐：从末尾取 sliceLen 个
            const sliced = data.slice(total - sliceLen);
            // 若不足 maxBeat，在左侧补空白
            const leftPad = this.maxBeat - sliceLen;
            const placeholders = Array.from({ length: Math.max(0, leftPad) }, () => 0);
            return placeholders.concat(sliced);
        },

        /**
         * 是否填满当前窗口（无左侧空白占位）
         * @returns {boolean}
         */
        hasFullWindow() {
            const length = Array.isArray(this.beatList) ? this.beatList.length : 0;
            return length >= this.maxBeat;
        },

        /** 是否有任何有效心跳数据 */
        hasAnyData() {
            return Array.isArray(this.beatList) && this.beatList.length > 0;
        },

        /** 非30天模式下时间行的 class */
        timeRowClass() {
            return "d-flex justify-content-between align-items-center word";
        },

        wrapStyle() {
            let topBottom = (((this.beatHeight * this.hoverScale) - this.beatHeight) / 2);
            let leftRight = (((this.beatWidth * this.hoverScale) - this.beatWidth) / 2);

            return {
                padding: `${topBottom}px ${leftRight}px`,
                width: "100%",
            };
        },

        barStyle() {
            if (this.move && this.shortBeatList.length > this.maxBeat) {
                let width = -(this.beatWidth + this.dynamicBeatPadding * 2);

                return {
                    transition: "all ease-in-out 0.25s",
                    transform: `translateX(${width}px)`,
                };

            }
            return {
                transform: "translateX(0)",
            };

        },

        beatHoverAreaStyle() {
            return {
                padding: this.dynamicBeatPadding + "px",
                "--hover-scale": this.hoverScale,
            };
        },

        beatStyle() {
            return {
                width: this.beatWidth + "px",
                height: this.beatHeight + "px",
            };
        },

        /**
         * Returns the style object for positioning the time element.
         * @returns {object} The style object containing the CSS properties for positioning the time element.
         */
        timeStyle() {
            // 固定宽度：maxBeat 个格子占位，右对齐时无需额外 margin-left
            const cell = (this.beatWidth + this.dynamicBeatPadding * 2);
            let baseWidth = this.maxBeat * cell;

            // For 90d mode, no extra width needed as divider lines are now flex elements
            if (this.is90d) {
                // Minimal extra space for proper text display and padding
                baseWidth += 100;
            }

            return { width: baseWidth + "px" };
        },

        /**
         * Calculates the time elapsed since the first valid beat.
         * @returns {string} The time elapsed in minutes or hours.
         */
        timeSinceFirstBeat() {
            // Check if external mode for customer-friendly display
            const isExternal = deploymentConfig.config?.mode === "external";

            // 90天窗口：显示固定窗口起点，避免数据空洞导致错位
            if (this.is90d) {
                if (isExternal) {
                    // External mode: Show "X days ago" like Cursor status page
                    const days = this.maxBeat - 1;
                    return `${days} days ago`;
                } else {
                    // Internal mode: Show date (though 90d is primarily for external)
                    const start = dayjs().subtract(this.maxBeat - 1, "day");
                    return start.format("MM-DD");
                }
            }
            // 60m/24h：显示距离现在的时长
            const firstValidBeat = this.shortBeatList.find((b) => b && b.time);
            const minutes = dayjs().diff(dayjs.utc(firstValidBeat?.time), "minutes");
            if (isExternal) {
                // External mode: Show customer-friendly format
                if (minutes > 60) {
                    const hours = Math.floor(minutes / 60);
                    return `${hours} hours ago`;
                } else {
                    return `${minutes} minutes ago`;
                }
            } else {
                // Internal mode: Show technical format
                if (minutes > 60) {
                    return (minutes / 60).toFixed(1) + "h";
                } else {
                    return minutes + "m";
                }
            }
        },

        /**
         * Calculates the elapsed time since the last valid beat was registered.
         * @returns {string} The elapsed time in a minutes, hours or "now".
         */
        timeSinceLastBeat() {
            // Check if external mode for customer-friendly display
            const isExternal = deploymentConfig.config?.mode === "external";

            // 90天窗口：固定显示窗口终点（今天）
            if (this.is90d) {
                if (isExternal) {
                    // External mode: Show "Today" like Cursor status page
                    return "Today";
                } else {
                    // Internal mode: Show date (though 90d is primarily for external)
                    return dayjs().format("MM-DD");
                }
            }

            const lastValidBeat = this.shortBeatList.at(-1);
            const seconds = dayjs().diff(dayjs.utc(lastValidBeat?.time), "seconds");

            let tolerance = 60 * 2; // default for when monitorList not available
            if (this.$root.monitorList[this.monitorId] != null) {
                tolerance = this.$root.monitorList[this.monitorId].interval * 2;
            }

            if (isExternal) {
                // External mode: Customer-friendly format
                if (seconds < tolerance) {
                    return "Now";
                } else if (seconds < 60 * 60) {
                    const minutes = Math.floor(seconds / 60);
                    return `${minutes} minutes ago`;
                } else {
                    const hours = Math.floor(seconds / 60 / 60);
                    return `${hours} hours ago`;
                }
            } else {
                // Internal mode: Technical format
                if (seconds < tolerance) {
                    return this.$t("now");
                } else if (seconds < 60 * 60) {
                    return this.$t("time ago", [ (seconds / 60).toFixed(0) + "m" ]);
                } else {
                    return this.$t("time ago", [ (seconds / 60 / 60).toFixed(0) + "h" ]);
                }
            }
        },

        tooltipStyle() {
            return {
                left: `${this.tooltipPosition.x}px`,
                top: `${this.tooltipPosition.y}px`,
            };
        },
    },
    watch: {
        beatList: {
            handler(val, oldVal) {
                this.move = true;

                setTimeout(() => {
                    this.move = false;
                }, 300);
            },
            deep: true,
        },
        "$root.statusDuration"(val) {
            this.maxBeat = this.desiredMaxBeat;
            this.$forceUpdate();
        },

        // 监听duration prop的变化
        duration(newVal, oldVal) {
            this.maxBeat = this.desiredMaxBeat;
            this.$forceUpdate();
        },
    },
    unmounted() {
        window.removeEventListener("resize", this.resize);
    },
    beforeMount() {
        if (this.heartbeatList === null) {
            if (!(this.monitorId in this.$root.heartbeatList)) {
                this.$root.heartbeatList[this.monitorId] = [];
            }
        }
    },

    mounted() {
        if (this.size !== "big") {
            // For small size, reduce height only - width and padding are computed
            this.beatHeight = 16;
        }

        window.addEventListener("resize", this.resize);
        this.resize();
        // 初始化固定柱数（根据窗口）- 统一使用90个心跳条
        this.maxBeat = this.desiredMaxBeat;
    },
    methods: {
        /**
         * Resize the heartbeat bar
         * @returns {void}
         */
        resize() {
            if (this.$refs.wrap) {
                // this.maxBeat = Math.floor(this.$refs.wrap.clientWidth / (this.beatWidth + this.beatHoverAreaPadding * 2)) - 1;
            }
        },

        /**
         * Get the title of the beat.
         * Used as the hover tooltip on the heartbeat bar.
         * @param {object} beat Beat to get title from
         * @returns {string} Beat title
         */
        getBeatTitle(beat) {
            // 90天模式：只显示日期，保持简洁
            // 其他模式：显示完整时间
            const timeFormat = this.is90d
                ? dayjs.utc(beat.time).format("YYYY-MM-DD")
                : this.$root.datetime(beat.time);

            let title = `<strong>${timeFormat}</strong>`;

            // 检查是否是空数据
            if (beat.isEmpty || beat.status === null || beat.msg === "No data") {
                // 没数据时显示"No data exists for this day"
                title += "<br/><span class='status-no-data'>No data exists for this day</span>";
                return title;
            }

            // 颜色已经传达状态，不需要状态形容词

            // Add the detailed message from backend (contains specific down times and durations)
            if (beat.msg && beat.msg !== "Up" && beat.msg !== "Down") {
                title += `<br/><span class='beat-message'>${beat.msg}</span>`;
            }

            return title;
        },

        /**
         * 检查心跳是否为空
         * @param {object|number} beat 心跳数据
         * @returns {boolean} 是否为空
         */
        isEmpty(beat) {
            return beat === 0;
        },

        /**
         * 显示tooltip
         * @param {object} beat 心跳数据
         * @param {number} index 心跳索引
         * @param {Event} event 鼠标事件
         * @returns {void}
         */
        showTooltip(beat, index, event) {
            // 清除之前的隐藏定时器
            if (this.tooltipHideTimer) {
                clearTimeout(this.tooltipHideTimer);
                this.tooltipHideTimer = null;
            }

            if (this.isEmpty(beat)) {
                return;
            }

            // 获取鼠标悬停元素
            const rect = event.currentTarget.getBoundingClientRect();

            this.activeBeatIndex = index;
            this.activeTooltip = this.getBeatTitle(beat);

            // 计算tooltip位置
            this.tooltipPosition = {
                x: rect.left + rect.width / 2,
                y: rect.top - 10,
            };
        },

        /**
         * 开始隐藏tooltip的倒计时
         * @returns {void}
         */
        startHideTooltip() {
            // 设置0.5秒后隐藏tooltip，避免快速移动时堆积
            this.tooltipHideTimer = setTimeout(() => {
                this.activeTooltip = null;
                this.activeBeatIndex = null;
            }, 500);
        },
    },
};
</script>

<style lang="scss" scoped>
@import "../assets/vars.scss";

.wrap {
    overflow: hidden;
    width: 100%;
    white-space: nowrap;
}

.hp-bar-big {
    .beat-hover-area {
        display: inline-block;
        cursor: pointer;
        position: relative;

        &:not(.empty):hover {
            transition: all ease-in-out 0.15s;
            opacity: 0.8;
            transform: scale(var(--hover-scale));
        }

        .beat {
            background-color: #22c55e; // Perfect 100% - 亮绿色

            /*
            pointer-events needs to be changed because
            tooltip momentarily disappears when crossing between .beat-hover-area and .beat
            */
            pointer-events: none;

            &.empty {
                background-color: #e5e7eb; // Gray color for no data
                opacity: 0.6;
            }

            &.down {
                background-color: #ef4444; // Critical <80% - 红色
            }

            &.poor {
                background-color: #f97316; // Poor 80-95% - 橙色
            }

            &.partial {
                background-color: #eab308; // Fair 95-99% - 黄色
            }

            &.good-green {
                background-color: #84cc16; // Good 99-99.9% - 黄绿色
            }

            &.good {
                background-color: #4ade80; // Excellent 99.9-99.99% - 浅绿色
            }

            &.pending {
                background-color: $warning;
            }

            &.maintenance {
                background-color: $maintenance;
            }
        }

        .beat-tooltip {
            position: absolute;
            bottom: 100%;
            left: 50%;
            transform: translateX(-50%);
            background-color: rgba(0, 0, 0, 0.8);
            color: white;
            padding: 5px 10px;
            border-radius: 4px;
            font-size: 12px;
            white-space: nowrap;
            z-index: 9999;
            margin-bottom: 5px;
            pointer-events: none;
            max-width: 300px;
            overflow: hidden;
            text-overflow: ellipsis;

            &::after {
                content: "";
                position: absolute;
                top: 100%;
                left: 50%;
                margin-left: -5px;
                border-width: 5px;
                border-style: solid;
                border-color: rgba(0, 0, 0, 0.8) transparent transparent transparent;
            }
        }
    }
}

.dark {
    .hp-bar-big .beat.empty {
        background-color: #848484;
    }

    .beat-tooltip {
        background-color: rgba(255, 255, 255, 0.9) !important;
        color: #333 !important;

        &::after {
            border-color: rgba(255, 255, 255, 0.9) transparent transparent transparent !important;
        }
    }
}

.word {
    color: $secondary-text;
    font-size: 12px;
}

.connecting-line {
    flex-grow: 1;
    height: 1px;
    background-color: #ededed;
    margin-left: 10px;
    margin-right: 10px;
    margin-top: 2px;

    .dark & {
        background-color: #333;
    }
}

.global-beat-tooltip {
    position: fixed;
    transform: translateX(-50%) translateY(-100%);
    background-color: rgba(0, 0, 0, 0.8);
    color: white;
    padding: 8px 12px;
    border-radius: 4px;
    font-size: 12px;
    z-index: 9999;
    margin-bottom: 5px;
    pointer-events: none;
    max-width: 300px;
    white-space: normal;

    &::after {
        content: "";
        position: absolute;
        top: 100%;
        left: 50%;
        margin-left: -5px;
        border-width: 5px;
        border-style: solid;
        border-color: rgba(0, 0, 0, 0.8) transparent transparent transparent;
    }

    :deep(.status-up) {
        color: #22c55e;
        font-weight: bold;
    }

    :deep(.status-good) {
        color: #eab308;
        font-weight: bold;
    }

    :deep(.status-partial) {
        color: #f97316;
        font-weight: bold;
    }

    :deep(.status-poor) {
        color: #dc2626;
        font-weight: bold;
    }

    :deep(.status-down) {
        color: #991b1b;
        font-weight: bold;
    }

    :deep(.status-pending) {
        color: #f59e0b;
        font-weight: bold;
    }

    :deep(.status-maintenance) {
        color: #3b82f6;
        font-weight: bold;
    }

    :deep(.beat-message) {
        display: block;
        margin-top: 4px;
        font-style: italic;
    }

    :deep(.beat-message-container) {
        display: block;
        margin-top: 4px;
    }

    :deep(.beat-message-item) {
        display: block;
        margin-top: 2px;
        font-style: italic;
        padding-left: 8px;
    }
}

.dark {
    .global-beat-tooltip {
        background-color: rgba(255, 255, 255, 0.9) !important;
        color: #333 !important;

        &::after {
            border-color: rgba(255, 255, 255, 0.9) transparent transparent transparent !important;
        }

        :deep(.status-up) {
            color: #16a34a;
        }

        :deep(.status-good) {
            color: #ca8a04;
        }

        :deep(.status-partial) {
            color: #ea580c;
        }

        :deep(.status-poor) {
            color: #dc2626;
        }

        :deep(.status-down) {
            color: #991b1b;
        }

        :deep(.status-pending) {
            color: #d97706;
        }

        :deep(.status-maintenance) {
            color: #2563eb;
        }
    }
}

/* 90d Mode: Beautiful uptime display (both external and internal) */
.external-uptime-display {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 8px;
    padding: 0 4px;
    font-size: 0.85rem;
    color: #6b7280;

    .dark & {
        color: #9ca3af;
    }

    .spacer {
        flex: 1; // Takes up remaining space to push the last element to the right
    }

    .uptime-start {
        flex: 0 0 150px; // Fixed width to prevent overlap with longer lines
        font-weight: 500;
        color: #6b7280;
        text-align: left;

        .dark & {
            color: #9ca3af;
        }
    }

    .uptime-center {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 20px; // Space between divider line and text

        .uptime-text {
            font-weight: 600;
            font-size: 0.9rem;
            color: #059669;
            white-space: nowrap;

            .dark & {
                color: #10b981;
            }
        }

        .divider-line {
            flex: 1;
            height: 1px;
            background-color: #d1d5db;
            min-width: 60px; // Minimum width for visual balance

            .dark & {
                background-color: #4b5563;
            }
        }
    }

    .uptime-end {
        flex: 0 0 100px; // Fixed width to prevent overlap
        color: #374151;
        font-weight: 600;
        text-align: right;

        .dark & {
            color: #d1d5db;
        }
    }
}
</style>
