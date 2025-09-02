<template>
    <div class="public-status-page">
        <!-- Header Section -->
        <div class="status-header shadow-box mb-4">
            <div class="container-fluid">
                <div class="row align-items-center">
                    <div class="col-md-8">
                        <h1 class="status-title mb-2">{{ statusPage?.title || 'Service Status' }}</h1>
                        <p class="status-description text-muted mb-0">
                            {{ statusPage?.description || 'Real-time status and performance monitoring' }}
                        </p>
                    </div>
                    <div class="col-md-4 text-end">
                        <div class="overall-status">
                            <span class="status-indicator" :class="overallStatusClass">
                                <font-awesome-icon :icon="overallStatusIcon" class="me-2" />
                                {{ overallStatusText }}
                            </span>
                            <div class="last-updated text-muted small mt-1">
                                {{ $t('Last updated') }}: {{ lastUpdated }}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- SLA Summary Cards -->
        <div class="sla-summary-cards mb-4">
            <div class="container-fluid">
                <div class="row">
                    <div v-for="period in slaPeriods" :key="period.key" class="col-md-4 mb-3">
                        <div class="card shadow-box">
                            <div class="card-body text-center">
                                <h5 class="card-title">{{ period.label }}</h5>
                                <div class="sla-metric">
                                    <span class="sla-percentage" :class="getSLAStatusClass(period.achieved, period.target)">
                                        {{ formatPercentage(period.achieved) }}
                                    </span>
                                    <div v-if="period.target" class="sla-target text-muted small">
                                        Target: {{ formatPercentage(period.target) }}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Service Groups -->
        <div class="service-groups">
            <div class="container-fluid">
                <div v-for="group in filteredGroups" :key="group.id" class="service-group mb-4">
                    <h3 class="group-title mb-3">{{ group.name }}</h3>

                    <div class="services-grid">
                        <div
                            v-for="monitor in group.monitorList"
                            :key="monitor.id"
                            class="service-card shadow-box"
                        >
                            <div class="service-header">
                                <div class="service-info">
                                    <h5 class="service-name mb-1">{{ monitor.name }}</h5>
                                    <p v-if="monitor.description" class="service-description text-muted small mb-2">
                                        {{ monitor.description }}
                                    </p>
                                </div>
                                <div class="service-status">
                                    <span
                                        class="status-badge"
                                        :class="getServiceStatusClass(monitor.id)"
                                    >
                                        {{ getServiceStatusText(monitor.id) }}
                                    </span>
                                </div>
                            </div>

                            <!-- Uptime Chart (Mini) -->
                            <div class="service-chart mt-3">
                                <HeartbeatBar
                                    :monitor-id="monitor.id"
                                    :height="40"
                                    :show-tooltip="true"
                                />
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Incidents and Maintenance -->
        <div v-if="hasIncidents || hasMaintenance" class="incidents-section mb-4">
            <div class="container-fluid">
                <div class="row">
                    <!-- Recent Incidents -->
                    <div v-if="hasIncidents" class="col-md-6 mb-4">
                        <div class="shadow-box">
                            <div class="section-header">
                                <h4 class="mb-3">
                                    <font-awesome-icon icon="exclamation-triangle" class="me-2 text-warning" />
                                    {{ $t('Recent Incidents') }}
                                </h4>
                            </div>
                            <div class="incident-list">
                                <div
                                    v-for="incident in recentIncidents"
                                    :key="incident.id"
                                    class="incident-item border-bottom pb-3 mb-3"
                                >
                                    <div class="incident-header d-flex justify-content-between">
                                        <h6 class="incident-title mb-1">{{ incident.title }}</h6>
                                        <span class="incident-date text-muted small">
                                            {{ formatDate(incident.createdDate) }}
                                        </span>
                                    </div>
                                    <p class="incident-description text-muted small mb-2">
                                        {{ incident.content }}
                                    </p>
                                    <span class="incident-status badge" :class="getIncidentStatusClass(incident.style)">
                                        {{ getIncidentStatusText(incident.style) }}
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Scheduled Maintenance -->
                    <div v-if="hasMaintenance" class="col-md-6 mb-4">
                        <div class="shadow-box">
                            <div class="section-header">
                                <h4 class="mb-3">
                                    <font-awesome-icon icon="tools" class="me-2 text-info" />
                                    {{ $t('Scheduled Maintenance') }}
                                </h4>
                            </div>
                            <div class="maintenance-list">
                                <div
                                    v-for="maintenance in scheduledMaintenance"
                                    :key="maintenance.id"
                                    class="maintenance-item border-bottom pb-3 mb-3"
                                >
                                    <div class="maintenance-header d-flex justify-content-between">
                                        <h6 class="maintenance-title mb-1">{{ maintenance.title }}</h6>
                                        <span class="maintenance-date text-muted small">
                                            {{ formatDateRange(maintenance.start_date, maintenance.end_date) }}
                                        </span>
                                    </div>
                                    <p class="maintenance-description text-muted small">
                                        {{ maintenance.description }}
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Footer -->
        <div class="status-footer text-center text-muted py-4">
            <div class="container-fluid">
                <p class="mb-0">
                    {{ $t('Powered by') }} {{ appName }} |
                    <span class="auto-refresh-info">
                        {{ $t('Auto-refresh every') }} {{ refreshInterval }}{{ $t('s') }}
                    </span>
                </p>
            </div>
        </div>
    </div>
</template>

<script>
import HeartbeatBar from "../components/HeartbeatBar.vue";
import deploymentConfig from "../modules/deployment-config.js";
import dayjs from "dayjs";

export default {
    name: "PublicStatusPage",

    components: {
        HeartbeatBar,
    },

    data() {
        return {
            statusPage: null,
            publicGroupList: [],
            incidents: [],
            maintenance: [],
            refreshInterval: 30,
            refreshTimer: null,
            lastUpdated: null,
            appName: "Uptime Kuma",
        };
    },

    computed: {
        slug() {
            return this.$route.params.slug || "default";
        },

        filteredGroups() {
            // Filter groups to only show public monitors
            return this.publicGroupList.filter(group =>
                group.monitorList && group.monitorList.length > 0
            );
        },

        overallStatusClass() {
            const status = this.calculateOverallStatus();
            return {
                "text-success": status === "operational",
                "text-warning": status === "degraded",
                "text-danger": status === "outage",
                "text-secondary": status === "maintenance",
            };
        },

        overallStatusIcon() {
            const status = this.calculateOverallStatus();
            const icons = {
                "operational": "check-circle",
                "degraded": "exclamation-triangle",
                "outage": "times-circle",
                "maintenance": "tools",
            };
            return icons[status] || "question-circle";
        },

        overallStatusText() {
            const status = this.calculateOverallStatus();
            const texts = {
                "operational": this.$t("All Systems Operational") || "All Systems Operational",
                "degraded": this.$t("Degraded Performance") || "Degraded Performance",
                "outage": this.$t("Service Outage") || "Service Outage",
                "maintenance": this.$t("Under Maintenance") || "Under Maintenance",
            };
            return texts[status] || this.$t("Unknown Status") || "Unknown Status";
        },

        slaPeriods() {
            // Calculate overall SLA for different periods
            const periods = [
                { key: "30d",
                    label: "30 Days",
                    achieved: null,
                    target: null },
                { key: "90d",
                    label: "90 Days",
                    achieved: null,
                    target: null },
                { key: "month",
                    label: "This Month",
                    achieved: null,
                    target: null },
            ];

            // Calculate aggregate SLA for each period
            periods.forEach(period => {
                const { achieved, target } = this.calculateAggregateSLA(period.key);
                period.achieved = achieved;
                period.target = target;
            });

            return periods;
        },

        showLongTerm() {
            // Show 90-day metrics in external mode
            return deploymentConfig.isExternalMode();
        },

        hasIncidents() {
            return this.recentIncidents.length > 0;
        },

        hasMaintenance() {
            return this.scheduledMaintenance.length > 0;
        },

        recentIncidents() {
            // Show incidents from last 30 days
            const thirtyDaysAgo = dayjs().subtract(30, "day");
            return this.incidents
                .filter(incident => dayjs(incident.createdDate).isAfter(thirtyDaysAgo))
                .slice(0, 5); // Limit to 5 most recent
        },

        scheduledMaintenance() {
            // Show upcoming and recent maintenance
            const now = dayjs();
            const sevenDaysAgo = now.subtract(7, "day");
            const thirtyDaysAhead = now.add(30, "day");

            return this.maintenance
                .filter(m => {
                    const start = dayjs(m.start_date);
                    const end = dayjs(m.end_date);
                    return (start.isAfter(sevenDaysAgo) && start.isBefore(thirtyDaysAhead)) ||
                           (end.isAfter(sevenDaysAgo) && end.isBefore(thirtyDaysAhead));
                })
                .slice(0, 5);
        }
    },

    async mounted() {
        // Initialize deployment config
        if (!deploymentConfig.config) {
            await deploymentConfig.initialize();
        }

        // Load initial data
        await this.loadStatusPageData();

        // Set up auto-refresh
        this.setupAutoRefresh();

        // Update last updated time
        this.updateLastUpdated();
    },

    beforeUnmount() {
        if (this.refreshTimer) {
            clearInterval(this.refreshTimer);
        }
    },

    methods: {
        async loadStatusPageData() {
            try {
                // Load status page configuration
                const response = await fetch(`/api/status-page/${this.slug}`);
                if (response.ok) {
                    const data = await response.json();
                    this.statusPage = data.config;
                    this.publicGroupList = data.publicGroupList || [];
                    this.incidents = data.incidents || [];
                }

                // Load maintenance data if available
                // This would need to be implemented in the backend
                // const maintenanceResponse = await fetch(`/api/status-page/${this.slug}/maintenance`);
                // if (maintenanceResponse.ok) {
                //     const maintenanceData = await maintenanceResponse.json();
                //     this.maintenance = maintenanceData.maintenance || [];
                // }

            } catch (error) {
                console.error("Error loading status page data:", error);
            }
        },

        setupAutoRefresh() {
            this.refreshTimer = setInterval(() => {
                this.loadStatusPageData();
                this.updateLastUpdated();
            }, this.refreshInterval * 1000);
        },

        updateLastUpdated() {
            this.lastUpdated = dayjs().format("MMM D, YYYY h:mm A");
        },

        calculateOverallStatus() {
            // Calculate overall system status based on individual services
            let hasOutage = false;
            let hasDegraded = false;
            let hasMaintenance = false;

            this.filteredGroups.forEach(group => {
                group.monitorList.forEach(monitor => {
                    const status = this.getServiceStatus(monitor.id);
                    if (status === "down") {
                        hasOutage = true;
                    } else if (status === "pending") {
                        hasDegraded = true;
                    } else if (status === "maintenance") {
                        hasMaintenance = true;
                    }
                });
            });

            if (hasOutage) {
                return "outage";
            }
            if (hasDegraded) {
                return "degraded";
            }
            if (hasMaintenance) {
                return "maintenance";
            }
            return "operational";
        },

        calculateAggregateSLA(period) {
            // Calculate aggregate SLA across all monitors for a given period
            let totalWeight = 0;
            let weightedSum = 0;
            let aggregateTarget = null;

            this.filteredGroups.forEach(group => {
                group.monitorList.forEach(monitor => {
                    const slaData = this.$root.slaList?.[`${monitor.id}_${period}`];
                    if (slaData && typeof slaData.achieved === "number") {
                        totalWeight += 1;
                        weightedSum += slaData.achieved;

                        // Use the highest target as aggregate target
                        if (slaData.target && (!aggregateTarget || slaData.target > aggregateTarget)) {
                            aggregateTarget = slaData.target;
                        }
                    }
                });
            });

            return {
                achieved: totalWeight > 0 ? weightedSum / totalWeight : null,
                target: aggregateTarget
            };
        },

        getServiceStatus(monitorId) {
            // Get current status for a monitor
            const heartbeat = this.$root.lastHeartbeatList?.[monitorId];
            if (!heartbeat) {
                return "unknown";
            }

            return heartbeat.status === 1 ? "up" :
                heartbeat.status === 0 ? "down" :
                    heartbeat.status === 2 ? "pending" :
                        heartbeat.status === 3 ? "maintenance" : "unknown";
        },

        getServiceStatusClass(monitorId) {
            const status = this.getServiceStatus(monitorId);
            return {
                "badge-success": status === "up",
                "badge-danger": status === "down",
                "badge-warning": status === "pending",
                "badge-secondary": status === "maintenance",
                "badge-light": status === "unknown",
            };
        },

        getServiceStatusText(monitorId) {
            const status = this.getServiceStatus(monitorId);
            const texts = {
                "up": this.$t("Operational") || "Operational",
                "down": this.$t("Outage") || "Outage",
                "pending": this.$t("Degraded") || "Degraded",
                "maintenance": this.$t("Maintenance") || "Maintenance",
                "unknown": this.$t("Unknown") || "Unknown",
            };
            return texts[status] || texts["unknown"];
        },

        getSLAStatusClass(achieved, target) {
            if (!achieved) {
                return "text-muted";
            }
            if (!target) {
                return achieved >= 0.999 ? "text-success" :
                    achieved >= 0.99 ? "text-warning" : "text-danger";
            }

            const diff = target - achieved;
            return diff <= 0 ? "text-success" :
                diff <= 0.001 ? "text-warning" : "text-danger";
        },

        formatPercentage(value) {
            if (value == null) {
                return "N/A";
            }
            return (Math.round(value * 10000) / 100).toFixed(2) + "%";
        },

        formatDate(date) {
            return dayjs(date).format("MMM D, YYYY h:mm A");
        },

        formatDateRange(start, end) {
            const startFormatted = dayjs(start).format("MMM D");
            const endFormatted = dayjs(end).format("MMM D, YYYY");
            return `${startFormatted} - ${endFormatted}`;
        },

        getIncidentStatusClass(style) {
            const classes = {
                "info": "bg-info",
                "warning": "bg-warning",
                "danger": "bg-danger",
                "primary": "bg-primary",
                "success": "bg-success",
            };
            return classes[style] || "bg-secondary";
        },

        getIncidentStatusText(style) {
            const texts = {
                "info": "Resolved",
                "warning": "Monitoring",
                "danger": "Investigating",
                "primary": "Identified",
                "success": "Resolved",
            };
            return texts[style] || "Update";
        }
    }
};
</script>

<style lang="scss" scoped>
.public-status-page {
    min-height: 100vh;
    background-color: #f8f9fa;
    padding: 2rem 0;
}

.status-header {
    background: white;
    border-radius: 0.5rem;
    padding: 2rem;

    .status-title {
        color: #2c3e50;
        font-weight: 600;
    }

    .overall-status {
        text-align: right;

        .status-indicator {
            display: inline-flex;
            align-items: center;
            font-size: 1.1rem;
            font-weight: 600;
        }
    }
}

.sla-summary-cards {
    .card {
        border: none;
        background: white;

        .sla-metric {
            .sla-percentage {
                display: block;
                font-size: 2rem;
                font-weight: bold;

                &.text-success { color: #28a745 !important; }
                &.text-warning { color: #ffc107 !important; }
                &.text-danger { color: #dc3545 !important; }
            }
        }
    }
}

.service-groups {
    .group-title {
        color: #495057;
        font-weight: 600;
        margin-bottom: 1.5rem;
    }

    .services-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(400px, 1fr));
        gap: 1.5rem;

        @media (max-width: 768px) {
            grid-template-columns: 1fr;
        }
    }

    .service-card {
        background: white;
        border-radius: 0.5rem;
        padding: 1.5rem;

        .service-header {
            display: flex;
            justify-content: between;
            align-items: flex-start;
            margin-bottom: 1rem;

            .service-info {
                flex: 1;

                .service-name {
                    color: #2c3e50;
                    font-weight: 600;
                    margin-bottom: 0.25rem;
                }
            }

            .service-status {
                .status-badge {
                    padding: 0.375rem 0.75rem;
                    border-radius: 0.25rem;
                    font-size: 0.875rem;
                    font-weight: 500;

                    &.badge-success { background-color: #d4edda; color: #155724; }
                    &.badge-danger { background-color: #f8d7da; color: #721c24; }
                    &.badge-warning { background-color: #fff3cd; color: #856404; }
                    &.badge-secondary { background-color: #e2e3e5; color: #383d41; }
                    &.badge-light { background-color: #f8f9fa; color: #6c757d; }
                }
            }
        }

        .service-metrics {
            margin-bottom: 1rem;

            .metric-row {
                display: flex;
                gap: 1rem;
                flex-wrap: wrap;

                .metric-item {
                    flex: 1;
                    min-width: 150px;
                }
            }
        }

        .service-chart {
            border-top: 1px solid #e9ecef;
            padding-top: 1rem;
        }
    }
}

.incidents-section {
    .section-header {
        border-bottom: 1px solid #e9ecef;
        padding-bottom: 1rem;
        margin-bottom: 1.5rem;

        h4 {
            color: #495057;
            font-weight: 600;
        }
    }

    .incident-item, .maintenance-item {
        .incident-title, .maintenance-title {
            color: #2c3e50;
            font-weight: 600;
        }

        .incident-status {
            font-size: 0.75rem;
            padding: 0.25rem 0.5rem;
        }
    }
}

.status-footer {
    border-top: 1px solid #e9ecef;
    margin-top: 3rem;
}

.shadow-box {
    box-shadow: 0 0.125rem 0.25rem rgba(0, 0, 0, 0.075);
    border: 1px solid rgba(0, 0, 0, 0.125);
}
</style>
