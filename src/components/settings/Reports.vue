<template>
    <div>
        <div class="mb-3">
            <label class="form-label">默认时区</label>
            <input v-model="form.tz" type="text" class="form-control" placeholder="Asia/Shanghai" />
            <div class="form-text">用于计算自然月/季度；可覆盖默认。</div>
        </div>

        <div class="mb-3">
            <label class="form-label">报告类型</label>
            <select v-model="form.range" class="form-select">
                <option value="monthly">月报</option>
                <option value="quarterly">季度报告</option>
            </select>
            <div class="form-text">
                <strong>月报：</strong>30天滚动窗口，使用月度SLO目标<br>
                <strong>季度报告：</strong>90天滚动窗口，使用季度SLO目标<br>
                <small class="text-info">ℹ️ 自动匹配：系统会根据报告类型选择对应的SLO目标</small>
            </div>
        </div>

        <div class="mb-3">
            <label class="form-label">窗口口径</label>
            <select v-model="form.window" class="form-select">
                <option value="rolling">滚动</option>
                <option value="calendar">自然周期</option>
            </select>
        </div>

        <div class="form-check mb-3">
            <input id="excludeMaintenance" v-model="form.excludeMaintenance" class="form-check-input" type="checkbox" />
            <label class="form-check-label" for="excludeMaintenance">排除维护时间（覆盖各监控设置）</label>
        </div>

        <div class="mb-3">
            <label class="form-label">收件人邮箱（逗号分隔）</label>
            <input v-model="form.recipients" type="text" class="form-control" placeholder="a@example.com,b@example.com" />
        </div>

        <div class="mb-3">
            <label class="form-label">发信邮箱（SMTP From）</label>
            <input v-model="form.smtpFrom" type="text" class="form-control" placeholder="noreply@example.com" />
            <div class="form-text">SMTP 主机等请在“Settings → Notifications → Email (SMTP)”中配置。</div>
        </div>

        <div class="mb-3">
            <label class="form-label">定时任务</label>
            <select v-model="form.schedule" class="form-select">
                <option value="">不启用</option>
                <option value="monthly-1st-9">每月1日 09:00 (月报)</option>
                <option value="quarterly-1st-9">每季度1日 09:00 (季度报告)</option>
            </select>
            <div class="form-text">自动定时生成并发送报告邮件</div>
        </div>

        <div class="d-flex gap-2">
            <button class="btn btn-primary" @click="save">保存</button>
            <button class="btn btn-light" @click="preview">立即生成并预览</button>
        </div>
    </div>
</template>

<script>
export default {
    data() {
        return {
            form: {
                tz: "Asia/Shanghai",
                range: "monthly",
                window: "rolling",
                excludeMaintenance: false,
                recipients: "",
                smtpFrom: "",
                schedule: "",
            },
        };
    },
    mounted() {
        this.load();
    },
    methods: {
        load() {
            this.$root.getSocket().emit("getSettings", (res) => {
                const s = res?.data || {};
                this.form.tz = s.report_tz || this.form.tz;
                this.form.range = s.report_range || this.form.range;
                this.form.window = s.report_window || this.form.window;
                this.form.excludeMaintenance = s.report_excludeMaintenance ?? this.form.excludeMaintenance;
                this.form.recipients = s.report_recipients || this.form.recipients;
                this.form.smtpFrom = s.report_smtpFrom || this.form.smtpFrom;
                this.form.schedule = s.report_schedule || this.form.schedule;
            });
        },
        save() {
            const payload = {
                report_tz: this.form.tz,
                report_range: this.form.range,
                report_window: this.form.window,
                report_excludeMaintenance: this.form.excludeMaintenance,
                report_recipients: this.form.recipients,
                report_smtpFrom: this.form.smtpFrom,
                report_schedule: this.form.schedule,
            };
            this.$root.getSocket().emit("setSettings", { ...payload }, null, () => {
                this.$root.toastSuccess(this.$t("Saved"));
            });
        },
        preview() {
            const q = new URLSearchParams({
                range: this.form.range,
                window: this.form.window,
                tz: this.form.tz,
                excludeMaintenance: this.form.excludeMaintenance ? "1" : "0",
            }).toString();
            this.$router.push(`/reports?${q}`);
        },
    },
};
</script>

