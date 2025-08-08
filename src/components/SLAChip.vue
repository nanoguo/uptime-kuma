<template>
    <span :class="pill ? 'badge bg-secondary' : ''" :title="$t('SLA')">
        {{ display }}
    </span>
    </template>

<script>
export default {
    props: {
        monitorId: { type: Number, required: true },
        keySuffix: { type: String, default: '24' },
        pill: { type: Boolean, default: false },
    },
    computed: {
        record() {
            return this.$root.slaList?.[`${this.monitorId}_${this.keySuffix}`];
        },
        display() {
            if (!this.record) return this.$t('notAvailableShort');
            const pct = Math.round((this.record.achieved ?? 0) * 10000) / 100;
            const tgt = this.record.target != null ? Math.round(this.record.target * 10000) / 100 : null;
            return tgt != null ? `${pct}% / ${tgt}%` : `${pct}%`;
        },
    }
};
 </script>

<style>
.badge { min-width: 62px; }
</style>


