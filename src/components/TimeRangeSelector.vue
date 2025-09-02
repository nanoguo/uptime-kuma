<template>
    <div class="time-range-selector">
        <label v-if="showLabel" :for="selectId" class="form-label">{{ label }}</label>
        <select
            :id="selectId"
            v-model="selectedRange"
            class="form-select"
            :class="{ 'form-select-sm': small }"
            @change="onRangeChange"
        >
            <option
                v-for="range in availableRanges"
                :key="range.value"
                :value="range.value"
                :disabled="range.disabled"
            >
                {{ range.label }}
                <span v-if="range.restricted" class="text-muted">({{ restrictedText }})</span>
            </option>
        </select>
        <div v-if="showDescription && description" class="form-text">
            {{ description }}
        </div>
    </div>
</template>

<script>
import deploymentConfig from "../modules/deployment-config.js";

export default {
    name: "TimeRangeSelector",
    props: {
        modelValue: {
            type: String,
            default: "24h"
        },
        // Available ranges - if not provided, uses deployment config
        ranges: {
            type: Array,
            default: null
        },
        // Show label
        showLabel: {
            type: Boolean,
            default: true
        },
        // Label text
        label: {
            type: String,
            default: "Time Range"
        },
        // Show description
        showDescription: {
            type: Boolean,
            default: false
        },
        // Description text
        description: {
            type: String,
            default: ""
        },
        // Small size
        small: {
            type: Boolean,
            default: false
        },
        // Include restricted ranges (show but disable them)
        includeRestricted: {
            type: Boolean,
            default: true
        },
        // Custom ID for the select element
        selectId: {
            type: String,
            default: () => "time-range-" + Math.random().toString(36).substr(2, 9)
        }
    },

    emits: [ "update:modelValue", "change" ],

    data() {
        return {
            selectedRange: this.modelValue
        };
    },

    computed: {
        availableRanges() {
            // Use provided ranges or get from deployment config
            const configRanges = this.ranges || deploymentConfig.getAvailableTimeRanges();
            const allRanges = this.getAllTimeRanges();

            return allRanges.map(range => {
                const isAllowed = configRanges.includes(range.value);
                const isRestricted = !isAllowed && this.includeRestricted;

                return {
                    ...range,
                    disabled: !isAllowed,
                    restricted: isRestricted
                };
            }).filter(range => range.disabled ? this.includeRestricted : true);
        },

        deploymentMode() {
            return deploymentConfig.getMode();
        },

        restrictedText() {
            return this.$t("Not available in current mode") || "Not available";
        }
    },

    watch: {
        modelValue(newValue) {
            this.selectedRange = newValue;
            this.validateCurrentSelection();
        }
    },

    async mounted() {
        if (!deploymentConfig.config) {
            await deploymentConfig.initialize();
        }

        this.unsubscribe = deploymentConfig.subscribe(() => {
            this.validateCurrentSelection();
            this.$forceUpdate();
        });

        // Validate initial selection
        this.validateCurrentSelection();
    },

    beforeUnmount() {
        if (this.unsubscribe) {
            this.unsubscribe();
        }
    },

    methods: {
        getAllTimeRanges() {
            // All possible time ranges with labels
            return [
                { value: "1h",
                    label: this.$t("1 Hour") || "1 Hour" },
                { value: "6h",
                    label: this.$t("6 Hours") || "6 Hours" },
                { value: "24h",
                    label: this.$t("24 Hours") || "24 Hours" },
                { value: "7d",
                    label: this.$t("7 Days") || "7 Days" },
                { value: "30d",
                    label: this.$t("30 Days") || "30 Days" },
                { value: "90d",
                    label: this.$t("90 Days") || "90 Days" },
                { value: "1y",
                    label: this.$t("1 Year") || "1 Year" }
            ];
        },

        onRangeChange() {
            this.$emit("update:modelValue", this.selectedRange);
            this.$emit("change", this.selectedRange);
        },

        validateCurrentSelection() {
            // Check if current selection is still valid
            const allowedRanges = deploymentConfig.getAvailableTimeRanges();

            if (!allowedRanges.includes(this.selectedRange)) {
                // Current selection is not allowed, switch to first available
                if (allowedRanges.length > 0) {
                    this.selectedRange = allowedRanges[0];
                    this.onRangeChange();
                }
            }
        },

        // Public method to get current deployment restrictions
        getRestrictionInfo() {
            return {
                mode: this.deploymentMode,
                allowedRanges: deploymentConfig.getAvailableTimeRanges(),
                isRestricted: this.deploymentMode === "external"
            };
        }
    }
};
</script>

<style scoped>
.time-range-selector {
    display: flex;
    flex-direction: column;
}

.form-select option:disabled {
    color: #6c757d;
    background-color: #f8f9fa;
}

.text-muted {
    font-size: 0.9em;
}

@media (max-width: 768px) {
    .time-range-selector {
        margin-bottom: 1rem;
    }
}
</style>
