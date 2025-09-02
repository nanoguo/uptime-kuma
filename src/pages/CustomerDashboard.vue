<template>
    <div class="customer-dashboard">
        <!-- Header -->
        <div class="dashboard-header mb-4">
            <div class="row align-items-center">
                <div class="col-md-8">
                    <h2 class="dashboard-title mb-1">Service Dashboard</h2>
                    <p class="dashboard-subtitle text-muted mb-0">
                        Monitor service performance and availability
                    </p>
                </div>
                <div class="col-md-4 text-end">
                    <TimeRangeSelector
                        v-model="selectedTimeRange"
                        :show-label="false"
                        :small="true"
                        @change="onTimeRangeChange"
                    />
                </div>
            </div>
        </div>

        <!-- Summary Metrics -->
        <div class="summary-metrics mb-4">
            <div class="row">
                <div class="col-md-3 col-sm-6 mb-3">
                    <div class="metric-card shadow-box">
                        <div class="metric-header">
                            <h6 class="metric-title">Overall SLA</h6>
                            <font-awesome-icon :icon="overallSlaIcon" :class="overallSlaIconClass" />
                        </div>
                        <div class="metric-value">
                            <span class="metric-number" :class="overallSlaClass">
                                {{ formatPercentage(overallSLA) }}
                            </span>
                            <div v-if="overallSLATarget" class="metric-target text-muted small">
                                Target: {{ formatPercentage(overallSLATarget) }}
                            </div>
                        </div>
                    </div>
                </div>

                <div class="col-md-3 col-sm-6 mb-3">
                    <div class="metric-card shadow-box">
                        <div class="metric-header">
                            <h6 class="metric-title">Active Services</h6>
                            <font-awesome-icon icon="server" class="text-info" />
                        </div>
                        <div class="metric-value">
                            <span class="metric-number text-info">{{ activeServices }}</span>
                            <div class="metric-subtitle text-muted small">
                                of {{ totalServices }} services
                            </div>
                        </div>
                    </div>
                </div>

                <div class="col-md-3 col-sm-6 mb-3">
                    <div class="metric-card shadow-box">
                        <div class="metric-header">
                            <h6 class="metric-title">Service Issues</h6>
                            <font-awesome-icon icon="exclamation-triangle" class="text-warning" />
                        </div>
                        <div class="metric-value">
                            <span class="metric-number" :class="issuesClass">{{ totalIssues }}</span>
                            <div class="metric-subtitle text-muted small">
                                active incidents
                            </div>
                        </div>
                    </div>
                </div>

                <div class="col-md-3 col-sm-6 mb-3">
                    <div class="metric-card shadow-box">
                        <div class="metric-header">
                            <h6 class="metric-title">Avg Response</h6>
                            <font-awesome-icon icon="clock" class="text-secondary" />
                        </div>
                        <div class="metric-value">
                            <span class="metric-number text-secondary">{{ averageResponseTime }}</span>
                            <div class="metric-subtitle text-muted small">
                                milliseconds
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Service Groups -->
        <div class="service-groups">
            <div v-for="group in filteredGroups" :key="group.id" class="service-group shadow-box mb-4">
                <div class="group-header">
                    <div class="row align-items-center">
                        <div class="col-md-8">
                            <h4 class="group-title mb-0">{{ group.name }}</h4>
                        </div>
                        <div class="col-md-4 text-end">
                            <span class="group-status-summary text-muted small">
                                {{ getGroupStatusSummary(group) }}
                            </span>
                        </div>
                    </div>
                </div>

                <div class="services-list">
                    <div
                        v-for="monitor in group.monitorList"
                        :key="monitor.id"
                        class="service-item"
                        @click="showServiceDetails(monitor)"
                    >
                        <div class="service-content">
                            <div class="service-info">
                                <div class="service-basic">
                                    <h5 class="service-name mb-1">{{ monitor.name }}</h5>
                                    <p v-if="monitor.url" class="service-url text-muted small mb-0">
                                        {{ formatUrl(monitor.url) }}
                                    </p>
                                </div>

                                <div class="service-metrics">
                                    <div class="metrics-row">
                                        <!-- Current Status -->
                                        <span
                                            class="status-indicator"
                                            :class="getStatusIndicatorClass(monitor.id)"
                                        >
                                            <font-awesome-icon
                                                :icon="getStatusIcon(monitor.id)"
                                                class="me-1"
                                            />
                                            {{ getStatusText(monitor.id) }}
                                        </span>
                                    </div>
                                </div>
                            </div>

                            <div class="service-chart">
                                <HeartbeatBar
                                    :monitor-id="monitor.id"
                                    :height="50"
                                    :show-tooltip="true"
                                />
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Service Details Modal -->
        <div id="serviceDetailsModal" ref="serviceDetailsModal" class="modal fade" tabindex="-1">
            <div class="modal-dialog modal-lg">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 v-if="selectedService" class="modal-title">
                            {{ selectedService.name }} - Service Details
                        </h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <div v-if="selectedService" class="modal-body">
                        <!-- Service Overview -->
                        <div class="service-overview mb-4">
                            <div class="row">
                                <div class="col-md-4">
                                    <div class="overview-stat">
                                        <h6>Current Status</h6>
                                        <span
                                            class="status-badge large"
                                            :class="getStatusIndicatorClass(selectedService.id)"
                                        >
                                            <font-awesome-icon
                                                :icon="getStatusIcon(selectedService.id)"
                                                class="me-2"
                                            />
                                            {{ getStatusText(selectedService.id) }}
                                        </span>
                                    </div>
                                </div>

                                <div class="col-md-4">
                                    <div class="overview-stat">
                                        <h6>Response Time</h6>
                                        <span class="response-time">
                                            {{ getServiceResponseTime(selectedService.id) }}ms
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <!-- Extended Chart -->
                        <div class="service-detailed-chart mb-4">
                            <h6 class="mb-3">Uptime History ({{ getTimeRangeLabel(selectedTimeRange) }})</h6>
                            <HeartbeatBar
                                :monitor-id="selectedService.id"
                                :height="100"
                                :show-tooltip="true"
                                :show-labels="true"
                            />
                        </div>

                        <!-- Service Information -->
                        <div class="service-information">
                            <h6 class="mb-3">Service Information</h6>
                            <div class="row">
                                <div v-if="selectedService.url" class="col-md-6">
                                    <strong>Endpoint:</strong><br>
                                    <a :href="selectedService.url" target="_blank" rel="noopener">
                                        {{ selectedService.url }}
                                    </a>
                                </div>
                                <div v-if="selectedService.type" class="col-md-6">
                                    <strong>Monitor Type:</strong><br>
                                    {{ formatMonitorType(selectedService.type) }}
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">
                            Close
                        </button>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<script>
import HeartbeatBar from "../components/HeartbeatBar.vue";
import TimeRangeSelector from "../components/TimeRangeSelector.vue";
import deploymentConfig from "../modules/deployment-config.js";
import { Modal } from "bootstrap";

export default {
    name: "CustomerDashboard",

    components: {
        HeartbeatBar,
        TimeRangeSelector,
    },

    data() {
        return {
            selectedTimeRange: "30d",
            selectedService: null,
            modal: null,
        };
    },

    computed: {
        filteredGroups() {
            return this.$root.publicGroupList?.filter(group =>
                group.monitorList && group.monitorList.length > 0
            ) || [];
        },

        totalServices() {
            return this.filteredGroups.reduce((total, group) =>
                total + group.monitorList.length, 0
            );
        },

        activeServices() {
            let active = 0;
            this.filteredGroups.forEach(group => {
                group.monitorList.forEach(monitor => {
                    if (this.getServiceStatus(monitor.id) === "up") {
                        active++;
                    }
                });
            });
            return active;
        },

        totalIssues() {
            let issues = 0;
            this.filteredGroups.forEach(group => {
                group.monitorList.forEach(monitor => {
                    const status = this.getServiceStatus(monitor.id);
                    if (status === "down" || status === "pending") {
                        issues++;
                    }
                });
            });
            return issues;
        },

        issuesClass() {
            return {
                "text-danger": this.totalIssues > 0,
                "text-success": this.totalIssues === 0
            };
        },

        overallSLA() {
            // Calculate overall SLA across all services
            let total = 0;
            let count = 0;

            this.filteredGroups.forEach(group => {
                group.monitorList.forEach(monitor => {
                    const slaData = this.$root.slaList?.[`${monitor.id}_${this.selectedTimeRange}`];
                    if (slaData && typeof slaData.achieved === "number") {
                        total += slaData.achieved;
                        count++;
                    }
                });
            });

            return count > 0 ? total / count : null;
        },

        overallSLATarget() {
            // Get the most common or highest SLA target
            const targets = [];

            this.filteredGroups.forEach(group => {
                group.monitorList.forEach(monitor => {
                    const slaData = this.$root.slaList?.[`${monitor.id}_${this.selectedTimeRange}`];
                    if (slaData && slaData.target) {
                        targets.push(slaData.target);
                    }
                });
            });

            return targets.length > 0 ? Math.max(...targets) : null;
        },

        overallSlaClass() {
            if (!this.overallSLA) {
                return "text-muted";
            }
            if (!this.overallSLATarget) {
                return this.overallSLA >= 0.999 ? "text-success" :
                    this.overallSLA >= 0.99 ? "text-warning" : "text-danger";
            }

            const diff = this.overallSLATarget - this.overallSLA;
            return diff <= 0 ? "text-success" :
                diff <= 0.001 ? "text-warning" : "text-danger";
        },

        overallSlaIcon() {
            if (!this.overallSLA) {
                return "question-circle";
            }

            const isGood = this.overallSLATarget ?
                (this.overallSLA >= this.overallSLATarget) :
                (this.overallSLA >= 0.999);

            return isGood ? "check-circle" : "exclamation-triangle";
        },

        overallSlaIconClass() {
            return this.overallSlaClass;
        },

        averageResponseTime() {
            let total = 0;
            let count = 0;

            this.filteredGroups.forEach(group => {
                group.monitorList.forEach(monitor => {
                    const heartbeat = this.$root.lastHeartbeatList?.[monitor.id];
                    if (heartbeat && heartbeat.ping) {
                        total += heartbeat.ping;
                        count++;
                    }
                });
            });

            return count > 0 ? Math.round(total / count) : "N/A";
        }
    },

    async mounted() {
        // Initialize deployment config
        if (!deploymentConfig.config) {
            await deploymentConfig.initialize();
        }

        // Initialize modal
        this.modal = new Modal(this.$refs.serviceDetailsModal);
    },

    methods: {
        onTimeRangeChange(newRange) {
            this.selectedTimeRange = newRange;
            // Trigger data refresh if needed
        },

        getServiceStatus(monitorId) {
            const heartbeat = this.$root.lastHeartbeatList?.[monitorId];
            if (!heartbeat) {
                return "unknown";
            }

            return heartbeat.status === 1 ? "up" :
                heartbeat.status === 0 ? "down" :
                    heartbeat.status === 2 ? "pending" :
                        heartbeat.status === 3 ? "maintenance" : "unknown";
        },

        getStatusIcon(monitorId) {
            const status = this.getServiceStatus(monitorId);
            const icons = {
                "up": "check-circle",
                "down": "times-circle",
                "pending": "exclamation-triangle",
                "maintenance": "tools",
                "unknown": "question-circle"
            };
            return icons[status];
        },

        getStatusText(monitorId) {
            const status = this.getServiceStatus(monitorId);
            const texts = {
                "up": "Operational",
                "down": "Outage",
                "pending": "Degraded",
                "maintenance": "Maintenance",
                "unknown": "Unknown"
            };
            return texts[status];
        },

        getStatusIndicatorClass(monitorId) {
            const status = this.getServiceStatus(monitorId);
            return {
                "text-success": status === "up",
                "text-danger": status === "down",
                "text-warning": status === "pending",
                "text-secondary": status === "maintenance",
                "text-muted": status === "unknown"
            };
        },

        getGroupStatusSummary(group) {
            const total = group.monitorList.length;
            let operational = 0;

            group.monitorList.forEach(monitor => {
                if (this.getServiceStatus(monitor.id) === "up") {
                    operational++;
                }
            });

            return `${operational}/${total} services operational`;
        },

        showServiceDetails(service) {
            this.selectedService = service;
            this.modal.show();
        },

        getServiceResponseTime(monitorId) {
            const heartbeat = this.$root.lastHeartbeatList?.[monitorId];
            return heartbeat?.ping ? Math.round(heartbeat.ping) : "N/A";
        },

        formatPercentage(value) {
            if (value == null) {
                return "N/A";
            }
            return (Math.round(value * 10000) / 100).toFixed(2) + "%";
        },

        formatUrl(url) {
            try {
                return new URL(url).hostname;
            } catch {
                return url;
            }
        },

        formatMonitorType(type) {
            const types = {
                "http": "HTTP(s)",
                "port": "TCP Port",
                "ping": "Ping",
                "keyword": "HTTP Keyword",
                "dns": "DNS",
                "docker": "Docker Container",
                "push": "Push",
            };
            return types[type] || type;
        },

        getTimeRangeLabel(range) {
            const labels = deploymentConfig.getTimeRangeLabels();
            return labels[range] || range;
        }
    }
};
</script>

<style lang="scss" scoped>
.customer-dashboard {
    padding: 1.5rem;
    background-color: #f8f9fa;
    min-height: 100vh;
}

.dashboard-header {
    .dashboard-title {
        color: #2c3e50;
        font-weight: 600;
        margin-bottom: 0.25rem;
    }
}

.summary-metrics {
    .metric-card {
        background: white;
        border-radius: 0.5rem;
        padding: 1.5rem;
        height: 100%;

        .metric-header {
            display: flex;
            justify-content: between;
            align-items: center;
            margin-bottom: 1rem;

            .metric-title {
                color: #6c757d;
                font-weight: 500;
                margin: 0;
            }
        }

        .metric-value {
            .metric-number {
                display: block;
                font-size: 2rem;
                font-weight: bold;
                line-height: 1;
            }
        }
    }
}

.service-groups {
    .service-group {
        background: white;
        border-radius: 0.5rem;
        padding: 0;
        overflow: hidden;

        .group-header {
            background: #f8f9fa;
            padding: 1.5rem;
            border-bottom: 1px solid #e9ecef;

            .group-title {
                color: #2c3e50;
                font-weight: 600;
                margin: 0;
            }
        }

        .services-list {
            .service-item {
                padding: 1.5rem;
                border-bottom: 1px solid #f1f3f4;
                cursor: pointer;
                transition: background-color 0.2s;

                &:last-child {
                    border-bottom: none;
                }

                &:hover {
                    background-color: #f8f9fa;
                }

                .service-content {
                    display: grid;
                    grid-template-columns: 1fr 200px;
                    gap: 1.5rem;
                    align-items: center;

                    @media (max-width: 768px) {
                        grid-template-columns: 1fr;
                        gap: 1rem;
                    }
                }

                .service-info {
                    .service-name {
                        color: #2c3e50;
                        font-weight: 600;
                        margin-bottom: 0.5rem;
                    }

                    .metrics-row {
                        display: flex;
                        gap: 1rem;
                        align-items: center;
                        flex-wrap: wrap;
                        margin-top: 0.5rem;
                    }

                    .status-indicator {
                        display: inline-flex;
                        align-items: center;
                        font-size: 0.875rem;
                        font-weight: 500;
                    }
                }
            }
        }
    }
}

.modal {
    .service-overview {
        .overview-stat {
            text-align: center;
            padding: 1rem;
            background: #f8f9fa;
            border-radius: 0.25rem;

            h6 {
                color: #6c757d;
                font-size: 0.875rem;
                margin-bottom: 0.75rem;
            }

            .status-badge {
                &.large {
                    padding: 0.5rem 1rem;
                    border-radius: 0.375rem;
                    font-weight: 600;
                }
            }

            .response-time {
                font-size: 1.25rem;
                font-weight: 600;
                color: #6c757d;
            }
        }
    }
}

.shadow-box {
    box-shadow: 0 0.125rem 0.25rem rgba(0, 0, 0, 0.075);
    border: 1px solid rgba(0, 0, 0, 0.125);
}
</style>
