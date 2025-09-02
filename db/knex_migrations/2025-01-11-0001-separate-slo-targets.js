exports.up = function (knex) {
    return knex.schema.alterTable("monitor", function (table) {
        table.decimal("monthly_slo_target", 8, 7).nullable().comment("Monthly SLO target (0-1), used for monthly reports");
        table.decimal("quarterly_slo_target", 8, 7).nullable().comment("Quarterly SLO target (0-1), used for quarterly reports");
    });
    // 不设置任何默认值，让前端逻辑处理新监控项的默认值
};

exports.down = function (knex) {
    return knex.schema.alterTable("monitor", function (table) {
        table.dropColumn("monthly_slo_target");
        table.dropColumn("quarterly_slo_target");
    });
};
