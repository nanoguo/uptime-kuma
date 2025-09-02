<template>
    <div>
        <h4 class="mb-3">{{ $t("Deployment Configuration") }}</h4>

        <p class="form-text mb-3">
            {{ $t("Configure how this instance should be deployed and what features should be available to different user types.") }}
        </p>

        <div class="mb-4">
            <label for="deployment-mode" class="form-label">{{ $t("Deployment Mode") }}</label>
            <select id="deployment-mode" v-model="config.mode" class="form-select" @change="onModeChange">
                <option value="internal">{{ $t("Internal Operations") }}</option>
                <option value="external">{{ $t("External Customer") }}</option>
            </select>
            <div class="form-text">
                <template v-if="config.mode === 'internal'">
                    {{ $t("Internal mode: Full monitoring capabilities for operations teams") }}
                </template>
                <template v-else>
                    {{ $t("External mode: Simplified public status page for customers") }}
                </template>
            </div>
        </div>

        <!-- Features Configuration -->
        <div class="mb-4">
            <h5>{{ $t("Displayed Metrics") }}</h5>

            <div class="form-check form-switch mb-2">
                <input id="show-sli" v-model="config.features.showSLI" class="form-check-input" type="checkbox" :disabled="config.mode === 'external'">
                <label class="form-check-label" for="show-sli">
                    {{ $t("Show SLI (Service Level Indicator)") }}
                </label>
                <div class="form-text small">
                    {{ $t("Real-time service availability metrics (up/up+down)") }}
                </div>
            </div>

            <div class="form-check form-switch mb-2">
                <input id="show-slo" v-model="config.features.showSLO" class="form-check-input" type="checkbox" :disabled="config.mode === 'external'">
                <label class="form-check-label" for="show-slo">
                    {{ $t("Show SLO (Service Level Objective)") }}
                </label>
                <div class="form-text small">
                    {{ $t("Internal operational targets and error budgets") }}
                </div>
            </div>

            <!-- SLA配置已移除：90天的uptime展示本身就是SLA体现 -->
        </div>

        <!-- Time Ranges Configuration -->
        <div class="mb-4">
            <h5>{{ $t("Time Ranges") }}</h5>
            <div class="form-text mb-2">
                {{ $t("Select which time ranges should be available for monitoring data") }}
            </div>

            <div class="row">
                <div v-for="range in availableTimeRanges" :key="range.value" class="col-6 col-md-3">
                    <div class="form-check">
                        <input
                            :id="'time-range-' + range.value"
                            v-model="config.features.timeRanges"
                            :value="range.value"
                            class="form-check-input"
                            type="checkbox"
                            :disabled="range.disabled"
                        >
                        <label class="form-check-label" :for="'time-range-' + range.value">
                            {{ range.label }}
                        </label>
                    </div>
                </div>
            </div>
        </div>

        <!-- Public Access Configuration -->
        <div v-if="config.mode === 'external'" class="mb-4">
            <h5>{{ $t("Public Access") }}</h5>

            <div class="form-check form-switch mb-2">
                <input id="allow-anonymous" v-model="config.publicAccess.allowAnonymous" class="form-check-input" type="checkbox">
                <label class="form-check-label" for="allow-anonymous">
                    {{ $t("Allow Anonymous Access") }}
                </label>
                <div class="form-text small">
                    {{ $t("Allow visitors to view status page without logging in") }}
                </div>
            </div>

            <div class="mb-3">
                <label for="custom-domain" class="form-label">{{ $t("Custom Domain") }} <span class="text-muted">({{ $t("Optional") }})</span></label>
                <input
                    id="custom-domain"
                    v-model="config.publicAccess.customDomain"
                    type="text"
                    class="form-control"
                    :placeholder="$t('status.example.com')"
                >
                <div class="form-text">
                    {{ $t("Custom domain for public status page") }}
                </div>
            </div>
        </div>

        <!-- Default View Configuration -->
        <div class="mb-4">
            <label for="default-view" class="form-label">{{ $t("Default Landing Page") }}</label>
            <select id="default-view" v-model="config.features.defaultView" class="form-select">
                <option v-if="config.mode === 'internal'" value="dashboard">{{ $t("Operations Dashboard") }}</option>
                <option v-if="config.mode === 'external'" value="public-status">{{ $t("Public Status Page") }}</option>
                <option value="reports">{{ $t("Reports") }}</option>
            </select>
        </div>

        <!-- Module Configuration -->
        <div class="mb-4">
            <h5>{{ $t("Available Modules") }}</h5>
            <div class="form-text mb-2">
                {{ $t("Control which system modules are available") }}
            </div>

            <div class="row">
                <div v-for="module in availableModules" :key="module.key" class="col-6 col-md-3">
                    <div class="form-check">
                        <input
                            :id="'module-' + module.key"
                            v-model="config.modules[module.key]"
                            class="form-check-input"
                            type="checkbox"
                            :disabled="module.disabled"
                        >
                        <label class="form-check-label" :for="'module-' + module.key">
                            {{ module.label }}
                        </label>
                    </div>
                </div>
            </div>
        </div>

        <!-- Action Buttons -->
        <div class="d-flex gap-2">
            <button type="button" class="btn btn-primary" :disabled="processing" @click="save">
                <div v-if="processing" class="spinner-border spinner-border-sm me-2" role="status"></div>
                {{ $t("Save") }}
            </button>

            <button type="button" class="btn btn-outline-secondary" :disabled="processing" @click="reset">
                {{ $t("Reset to Defaults") }}
            </button>
        </div>
    </div>
</template>

<script>
export default {
    data() {
        return {
            processing: false,
            config: {
                mode: "internal",
                features: {
                    showSLI: true,
                    showSLO: true,
                    showSLA: true,
                    timeRanges: [ "90m", "24h", "90d" ],
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
            }
        };
    },

    computed: {
        availableTimeRanges() {
            const allRanges = [
                { value: "90m",
                    label: this.$t("90 Minutes"),
                    disabled: false },
                { value: "24h",
                    label: this.$t("24 Hours"),
                    disabled: false },
                { value: "90d",
                    label: this.$t("90 Days"),
                    disabled: false }
            ];

            // In external mode, restrict available ranges
            if (this.config.mode === "external") {
                return allRanges.map(range => ({
                    ...range,
                    disabled: ![ "90d" ].includes(range.value)
                }));
            }

            return allRanges;
        },

        availableModules() {
            const allModules = [
                { key: "monitoring",
                    label: this.$t("Real-time Monitoring"),
                    disabled: false },
                { key: "configuration",
                    label: this.$t("System Configuration"),
                    disabled: false },
                { key: "alerting",
                    label: this.$t("Alert Management"),
                    disabled: false },
                { key: "reporting",
                    label: this.$t("Reporting"),
                    disabled: false }
            ];

            // In external mode, disable certain modules
            if (this.config.mode === "external") {
                return allModules.map(module => ({
                    ...module,
                    disabled: [ "monitoring", "configuration", "alerting" ].includes(module.key)
                }));
            }

            return allModules;
        }
    },

    mounted() {
        this.loadConfig();
    },

    methods: {
        loadConfig() {
            this.$root.getSocket().emit("getDeploymentConfig", (res) => {
                if (res.ok) {
                    this.config = res.config;
                } else {
                    this.$root.toastError(res.msg);
                }
            });
        },

        save() {
            this.processing = true;

            this.$root.getSocket().emit("setDeploymentConfig", this.config, (res) => {
                this.processing = false;
                this.$root.toastRes(res);

                if (res.ok) {
                    // Refresh the page or update global config
                    this.$root.toastSuccess("Configuration updated. Please refresh the page to see changes.");
                }
            });
        },

        reset() {
            if (confirm(this.$t("Are you sure you want to reset deployment configuration to defaults?"))) {
                this.processing = true;

                this.$root.getSocket().emit("resetDeploymentConfig", (res) => {
                    this.processing = false;
                    this.$root.toastRes(res);

                    if (res.ok) {
                        this.config = res.config;
                    }
                });
            }
        },

        onModeChange() {
            // Auto-adjust settings based on selected mode
            if (this.config.mode === "external") {
                // External mode constraints
                this.config.features.showSLI = false;
                this.config.features.showSLO = false;
                this.config.features.showSLA = true;
                this.config.features.timeRanges = [ "30d", "90d" ];
                this.config.features.defaultView = "public-status";

                // Disable certain modules
                this.config.modules.monitoring = false;
                this.config.modules.configuration = false;
                this.config.modules.alerting = false;
                this.config.modules.reporting = true;

                // Enable public access by default
                this.config.publicAccess.enabled = true;
                this.config.publicAccess.allowAnonymous = true;

            } else {
                // Internal mode - enable all features
                this.config.features.showSLI = true;
                this.config.features.showSLO = true;
                this.config.features.showSLA = true;
                this.config.features.timeRanges = [ "90m", "24h", "90d" ];
                this.config.features.defaultView = "dashboard";

                // Enable all modules
                this.config.modules.monitoring = true;
                this.config.modules.configuration = true;
                this.config.modules.alerting = true;
                this.config.modules.reporting = true;

                // Disable public access
                this.config.publicAccess.enabled = false;
                this.config.publicAccess.allowAnonymous = false;
            }
        }
    }
};
</script>

<style scoped>
.form-text.small {
    font-size: 0.85em;
    color: var(--bs-secondary);
}

.form-check .form-check-label {
    font-weight: 500;
}

.spinner-border-sm {
    width: 1rem;
    height: 1rem;
}
</style>
