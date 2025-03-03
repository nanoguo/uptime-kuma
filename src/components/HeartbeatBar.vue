<template>
    <div ref="wrap" class="wrap" :style="wrapStyle">
        <div class="hp-bar-big" :style="barStyle">
            <div
                v-for="(beat, index) in shortBeatList"
                :key="index"
                class="beat-hover-area"
                :class="{ 'empty': (beat === 0) }"
                :style="beatHoverAreaStyle"
                @mouseenter="showTooltip(beat, index, $event)"
                @mouseleave="startHideTooltip()"
            >
                <div
                    class="beat"
                    :class="{ 'empty': (beat === 0), 'down': (beat.status === 0), 'pending': (beat.status === 2), 'maintenance': (beat.status === 3) }"
                    :style="beatStyle"
                />
            </div>
        </div>
        <!-- 全局tooltip -->
        <div v-if="activeTooltip" class="global-beat-tooltip" :style="tooltipStyle" v-html="activeTooltip">
        </div>
        <div
            v-if="!$root.isMobile && size !== 'small' && beatList.length > 4 && $root.styleElapsedTime !== 'none'"
            class="d-flex justify-content-between align-items-center word" :style="timeStyle"
        >
            <div>{{ timeSinceFirstBeat }}</div>
            <div v-if="$root.styleElapsedTime === 'with-line'" class="connecting-line"></div>
            <div>{{ timeSinceLastBeat }}</div>
        </div>
    </div>
</template>

<script>
import dayjs from "dayjs";

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
        /** Array of the monitors heartbeats */
        heartbeatList: {
            type: Array,
            default: null,
        }
    },
    data() {
        return {
            beatWidth: 6,
            beatHeight: 34,
            hoverScale: 1.2,
            beatHoverAreaPadding: 2,
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

            let placeholders = [];

            let start = this.beatList.length - this.maxBeat;

            if (this.move) {
                start = start - 1;
            }

            if (start < 0) {
                // Add empty placeholder
                for (let i = start; i < 0; i++) {
                    placeholders.push(0);
                }
                start = 0;
            }

            return placeholders.concat(this.beatList.slice(start));
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
                let width = -(this.beatWidth + this.beatHoverAreaPadding * 2);

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
                padding: this.beatHoverAreaPadding + "px",
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
            return {
                "margin-left": this.numPadding * (this.beatWidth + this.beatHoverAreaPadding * 2) + "px",
            };
        },

        /**
         * Calculates the time elapsed since the first valid beat.
         * @returns {string} The time elapsed in minutes or hours.
         */
        timeSinceFirstBeat() {
            const firstValidBeat = this.shortBeatList.at(this.numPadding);
            const minutes = dayjs().diff(dayjs.utc(firstValidBeat?.time), "minutes");
            if (minutes > 60) {
                return (minutes / 60).toFixed(1) + "h";
            } else {
                return minutes + "m";
            }
        },

        /**
         * Calculates the elapsed time since the last valid beat was registered.
         * @returns {string} The elapsed time in a minutes, hours or "now".
         */
        timeSinceLastBeat() {
            const lastValidBeat = this.shortBeatList.at(-1);
            const seconds = dayjs().diff(dayjs.utc(lastValidBeat?.time), "seconds");

            let tolerance = 60 * 2; // default for when monitorList not available
            if (this.$root.monitorList[this.monitorId] != null) {
                tolerance = this.$root.monitorList[this.monitorId].interval * 2;
            }

            if (seconds < tolerance) {
                return this.$t("now");
            } else if (seconds < 60 * 60) {
                return this.$t("time ago", [ (seconds / 60).toFixed(0) + "m" ]);
            } else {
                return this.$t("time ago", [ (seconds / 60 / 60).toFixed(0) + "h" ]);
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
            this.beatWidth = 5;
            this.beatHeight = 16;
            this.beatHoverAreaPadding = 2;
        }

        // Suddenly, have an idea how to handle it universally.
        // If the pixel * ratio != Integer, then it causes render issue, round it to solve it!!
        const actualWidth = this.beatWidth * window.devicePixelRatio;
        const actualHoverAreaPadding = this.beatHoverAreaPadding * window.devicePixelRatio;

        if (!Number.isInteger(actualWidth)) {
            this.beatWidth = Math.round(actualWidth) / window.devicePixelRatio;
        }

        if (!Number.isInteger(actualHoverAreaPadding)) {
            this.beatHoverAreaPadding = Math.round(actualHoverAreaPadding) / window.devicePixelRatio;
        }

        window.addEventListener("resize", this.resize);
        this.resize();
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
            let title = `<strong>${this.$root.datetime(beat.time)}</strong>`;

            // 添加状态信息
            if (beat.status === 0) {
                title += " - <span class='status-down'>Down</span>";
            } else if (beat.status === 2) {
                title += " - <span class='status-pending'>Pending</span>";
            } else if (beat.status === 3) {
                title += " - <span class='status-maintenance'>Maintenance</span>";
            } else {
                title += " - <span class='status-up'>Up</span>";
            }

            // 添加消息信息（如果有）
            if (beat.msg) {
                // 检查是否有多个事件（通过逗号分隔）
                if (beat.msg.includes(",")) {
                    const events = beat.msg.split(",").map(event => event.trim());
                    title += "<div class='beat-message-container'>";
                    events.forEach(event => {
                        title += `<div class='beat-message-item'>• ${event}</div>`;
                    });
                    title += "</div>";
                } else {
                    title += `<div class='beat-message'>${beat.msg}</div>`;
                }
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
            // 设置2秒后隐藏tooltip
            this.tooltipHideTimer = setTimeout(() => {
                this.activeTooltip = null;
                this.activeBeatIndex = null;
            }, 2000);
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
            background-color: $primary;

            /*
            pointer-events needs to be changed because
            tooltip momentarily disappears when crossing between .beat-hover-area and .beat
            */
            pointer-events: none;

            &.empty {
                background-color: aliceblue;
            }

            &.down {
                background-color: $danger;
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

            &:after {
                content: '';
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

        &:after {
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

    &:after {
        content: '';
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

    :deep(.status-down) {
        color: #ef4444;
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

        &:after {
            border-color: rgba(255, 255, 255, 0.9) transparent transparent transparent !important;
        }

        :deep(.status-up) {
            color: #16a34a;
        }

        :deep(.status-down) {
            color: #dc2626;
        }

        :deep(.status-pending) {
            color: #d97706;
        }

        :deep(.status-maintenance) {
            color: #2563eb;
        }
    }
}
</style>
