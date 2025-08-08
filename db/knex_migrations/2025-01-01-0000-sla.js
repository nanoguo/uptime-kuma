exports.up = async function (knex) {
    await knex.schema.alterTable("monitor", function (table) {
        table.float("sla_target").nullable();
        table.string("sla_period").notNullable().defaultTo("calendar-month");
        table.boolean("sla_exclude_maintenance").notNullable().defaultTo(true);
        table.string("sla_timezone").nullable();
    });
};

exports.down = async function (knex) {
    await knex.schema.alterTable("monitor", function (table) {
        table.dropColumn("sla_target");
        table.dropColumn("sla_period");
        table.dropColumn("sla_exclude_maintenance");
        table.dropColumn("sla_timezone");
    });
};

