<template>
    <div class="container mt-3">
        <h1 class="mb-3">报告预览</h1>
        <div class="mb-3">
            <label class="form-label">状态页</label>
            <div class="d-flex gap-2">
                <select v-if="statusPages.length" v-model="slug" class="form-select" style="max-width: 320px;">
                    <option v-for="sp in statusPages" :key="sp.slug" :value="sp.slug">{{ sp.title || sp.slug }}</option>
                </select>
                <input v-else v-model="slug" type="text" class="form-control" placeholder="请输入 slug，如 default" />
            </div>
        </div>
        <div class="mb-3">
            <button class="btn btn-primary" @click="load">生成</button>
            <button class="btn btn-light ms-2" :disabled="!report" @click="exportJSON">导出 JSON</button>
        </div>

        <div v-if="loading">生成中…</div>
        <div v-else-if="error" class="alert alert-danger">{{ error }}</div>

        <div v-if="report" class="shadow-box p-3">
            <h3>总览</h3>
            <div>区间：{{ report.report.window }}（{{ getRangeLabel(report.report.range) }}）</div>
            <div>时区：{{ report.report.timezone }}</div>
            <div>起止：{{ report.report.startedAt }} — {{ report.report.endedAt }}</div>
            <hr />
            <div><strong>监控数：</strong>{{ report.overview.monitors }}</div>
            <div><strong>平均 SLA：</strong>{{ pct(report.overview.slaAverage) }}</div>
            <div><strong>事故总数：</strong>{{ report.overview.incidents.count }}</div>
            <div><strong>总宕机：</strong>{{ seconds(report.overview.incidents.totalDowntimeSeconds) }}</div>
            <div><strong>MTTR：</strong>{{ seconds(report.overview.incidents.mttrSeconds) }}</div>
            <div><strong>维护总时长：</strong>{{ seconds(report.overview.maintenance.totalSeconds) }}</div>
            <div class="mt-2">
                <strong>Top5 宕机：</strong>
                <ul>
                    <li v-for="x in report.overview.incidents.topByDuration" :key="x.monitorID">
                        {{ x.name }} — {{ seconds(x.downtimeSeconds) }}
                    </li>
                </ul>
            </div>

            <div class="mt-4">
                <h3>图表</h3>
                <div class="row g-4">
                    <div class="col-12 col-lg-8">
                        <div class="mb-2 fw-bold">每日宕机/维护（分钟）</div>
                        <div class="chart-scroll">
                            <div :style="chartDailyInnerStyle">
                                <Bar v-if="chartDailyData" :data="chartDailyData" :options="chartDailyOptions" height="220" />
                            </div>
                        </div>
                    </div>
                    <div class="col-12 col-lg-4">
                        <div class="mb-2 fw-bold">Top 宕机监控（分钟）</div>
                        <div class="chart-scroll">
                            <div :style="chartTopInnerStyle">
                                <Bar v-if="chartTopData" :data="chartTopData" :options="chartTopOptions" height="220" />
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            <hr />
            <h3>明细</h3>
            <div v-for="m in report.monitors" :key="m.id" class="mb-4">
                <div class="mb-1"><strong>{{ m.name }}</strong>（ID: {{ m.id }}）</div>
                <div class="mb-1">SLA: {{ pct(m.achieved) }} | SLO: {{ m.target != null ? pct(m.target) : '—' }} | 排除维护: {{ m.excludeMaintenance ? '是' : '否' }}</div>
                <div class="mb-2">
                    Error Budget: 允许 {{ ebAllowedMin(m) }} 分钟，已用 {{ ebConsumedMin(m) }} 分钟，剩余 {{ ebRemainingMin(m) }} 分钟（已用 {{ ebUsedPct(m) }}）
                </div>
                <div class="mb-2">宕机 {{ m.totals.incidents }} 次，合计 {{ seconds(m.totals.downtimeSeconds) }}；维护 {{ seconds(m.totals.maintenanceSeconds) }}</div>

                <div v-if="m.incidents && m.incidents.length" class="mt-2">
                    <div class="fw-bold">事故明细</div>
                    <ul class="mb-2">
                        <li v-for="(i, idx) in m.incidents" :key="idx">
                            {{ fmt(i.start) }} — {{ fmt(i.end) }}（{{ seconds(i.durationSeconds) }}）<span v-if="i.msg">：{{ i.msg }}</span>
                        </li>
                    </ul>
                </div>

                <div v-if="m.maintenance && m.maintenance.length" class="mt-2">
                    <div class="fw-bold">维护明细</div>
                    <ul>
                        <li v-for="(i, idx) in m.maintenance" :key="idx">
                            {{ fmt(i.start) }} — {{ fmt(i.end) }}（{{ seconds(i.durationSeconds) }}）
                        </li>
                    </ul>
                </div>
            </div>
        </div>
    </div>
</template>

<script>
import axios from "axios";
import { Bar } from "vue-chartjs";
import "chart.js/auto";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
dayjs.extend(utc);
export default {
    components: { Bar },
    data() {
        const q = this.$route.query || {};
        return {
            slug: "default",
            query: {
                range: q.range || "weekly",
                window: q.window || "rolling",
                tz: q.tz || "Asia/Shanghai",
                excludeMaintenance: q.excludeMaintenance || "0",
            },
            report: null,
            loading: false,
            error: null,
            chartDailyData: null,
            chartDailyOptions: null,
            chartTopData: null,
            chartTopOptions: null,
            chartDailyInnerStyle: {},
            chartTopInnerStyle: {},
        };
    },
    computed: {
        statusPages() {
            try {
                return Object.values(this.$root.statusPageList || {});
            } catch (_) {
                return [];
            }
        }
    },
    watch: {
        statusPages: {
            immediate: true,
            handler(list) {
                if (list && list.length && (!this.slug || this.slug === "default")) {
                    this.slug = list[0].slug;
                }
            }
        }
    },
    methods: {
        getRangeLabel(range) {
            const labels = {
                monthly: "月报",
                quarterly: "季度报告"
            };
            return labels[range] || range;
        },
        
        async load() {
            try {
                this.loading = true;
                this.error = null;
                const params = new URLSearchParams(this.query).toString();
                const url = `/api/report/status-page/${encodeURIComponent(this.slug)}?${params}`;
                const { data } = await axios.get(url);
                this.report = data;
                this.prepareCharts();
            } catch (e) {
                this.error = e?.message || String(e);
            } finally {
                this.loading = false;
            }
        },
        pct(x) {
            if (x == null) {
                return "—";
            }
            return (Math.round(x * 10000) / 100) + "%";
        },
        seconds(s) {
            if (!s) {
                return "0s";
            }
            const h = Math.floor(s / 3600);
            const m = Math.floor((s % 3600) / 60);
            const sec = s % 60;
            if (h > 0) {
                return `${h}h ${m}m`;
            }
            if (m > 0) {
                return `${m}m ${sec}s`;
            }
            return `${sec}s`;
        },
        fmt(iso) {
            try {
                return new Date(iso).toLocaleString();
            } catch {
                return iso;
            }
        },
        // 直接展示分钟为单
        ebUsedPct(m) {
            const a = m?.errorBudget?.allowed;
            const c = m?.errorBudget?.consumed;
            if (a == null || a === 0 || c == null) {
                return "—";
            }
            return (Math.round((c / a) * 10000) / 100) + "%";
        },
        // 后端已经返回了正确的分钟数，直接显示即可
        ebAllowedMin(m) {
            const v = m?.errorBudget?.allowed;
            if (v == null) {
                return "—";
            }
            return this.oneDecimal(v);
        },
        ebConsumedMin(m) {
            const v = m?.errorBudget?.consumed;
            if (v == null) {
                return "—";
            }
            return this.oneDecimal(v);
        },
        ebRemainingMin(m) {
            const v = m?.errorBudget?.remaining;
            if (v == null) {
                return "—";
            }
            return this.oneDecimal(v);
        },
        oneDecimal(x) {
            if (x == null || isNaN(x)) {
                return "—";
            }
            return (Math.round(x * 10) / 10).toFixed(1);
        },
        exportJSON() {
            const blob = new Blob([ JSON.stringify(this.report, null, 2) ], { type: "application/json" });
            const link = document.createElement("a");
            link.href = URL.createObjectURL(blob);
            link.download = `report-${this.report?.report?.range || "weekly"}.json`;
            link.click();
            URL.revokeObjectURL(link.href);
        },
        // ===== Charts =====
        prepareCharts() {
            if (!this.report) {
                this.chartDailyData = null;
                this.chartTopData = null;
                return;
            }
            this.buildDailyChart();
            this.buildTopChart();
        },
        buildDailyChart() {
            const start = dayjs.utc(this.report.report.startedAt);
            const end = dayjs.utc(this.report.report.endedAt);
            const days = [];
            let cur = start.startOf("day");
            while (cur.isBefore(end)) {
                days.push(cur);
                cur = cur.add(1, "day");
            }
            if (days.length === 0) {
                this.chartDailyData = null;
                return;
            }
            const labels = days.map(d => d.format("MM-DD"));
            const downMins = new Array(days.length).fill(0);
            const maintMins = new Array(days.length).fill(0);

            const addSeg = (arr, seg) => {
                const s = dayjs.utc(seg.start);
                const e = dayjs.utc(seg.end);
                for (let i = 0; i < days.length; i++) {
                    const ds = days[i];
                    const de = (i === days.length - 1) ? end : days[i + 1];
                    const ovStart = s.isAfter(ds) ? s : ds;
                    const ovEnd = e.isBefore(de) ? e : de;
                    const secs = Math.max(0, ovEnd.diff(ovStart, "second"));
                    if (secs > 0) {
                        arr[i] += Math.round(secs / 60);
                    }
                }
            };

            for (const m of this.report.monitors) {
                (m.incidents || []).forEach(seg => addSeg(downMins, seg));
                (m.maintenance || []).forEach(seg => addSeg(maintMins, seg));
            }

            this.chartDailyData = {
                labels,
                datasets: [
                    { label: "宕机",
                        data: downMins,
                        backgroundColor: "#ef4444" },
                    { label: "维护",
                        data: maintMins,
                        backgroundColor: "#3b82f6" },
                ]
            };
            // 预估每天 40px 宽度，超出容器则出现横向滚动
            const pxPerDay = 40;
            this.chartDailyInnerStyle = { width: (labels.length * pxPerDay) + "px",
                minWidth: "600px" };
            this.chartDailyOptions = {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: "index",
                    intersect: false },
                plugins: { legend: { position: "bottom" } },
                scales: { x: { stacked: true },
                    y: { stacked: true,
                        title: { display: true,
                            text: "分钟" } } }
            };
        },
        buildTopChart() {
            const top = (this.report.overview?.incidents?.topByDuration || []).slice(0, 5);
            if (!top.length) {
                this.chartTopData = null;
                return;
            }
            const labels = top.map(x => x.name || x.monitorID);
            const minutes = top.map(x => Math.round((x.downtimeSeconds || 0) / 60));
            this.chartTopData = {
                labels,
                datasets: [{ label: "宕机（分钟）",
                    data: minutes,
                    backgroundColor: "#f59e0b" }]
            };
            const pxPerBar = 48;
            this.chartTopInnerStyle = { width: Math.max(320, labels.length * pxPerBar) + "px" };
            this.chartTopOptions = {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: { y: { title: { display: true,
                    text: "分钟" },
                beginAtZero: true } }
            };
        }
    }
};
</script>

<style scoped>
.chart-scroll {
    overflow-x: auto;
    overflow-y: hidden;
    width: 100%;
}

.chart-scroll > div {
    min-height: 240px;
}
</style>

