exports.up = async function (knex) {
    // 检查setting表是否存在，如果不存在则创建
    const hasSettingTable = await knex.schema.hasTable("setting");
    if (!hasSettingTable) {
        await knex.schema.createTable("setting", function (table) {
            table.increments("id").primary();
            table.string("key").notNullable().unique();
            table.text("value");
            table.string("type").nullable();
            table.timestamps(true, true);
        });
    }

    // 添加默认的部署配置设置
    const defaultDeploymentConfig = {
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
    };

    // 插入默认配置（如果不存在）
    const existingConfig = await knex("setting")
        .where("key", "deploymentMode")
        .first();

    if (!existingConfig) {
        await knex("setting").insert([
            {
                key: "deploymentMode",
                value: JSON.stringify(defaultDeploymentConfig.mode),
                type: "deployment"
            },
            {
                key: "deploymentFeatures",
                value: JSON.stringify(defaultDeploymentConfig.features),
                type: "deployment"
            },
            {
                key: "deploymentPublicAccess",
                value: JSON.stringify(defaultDeploymentConfig.publicAccess),
                type: "deployment"
            },
            {
                key: "deploymentModules",
                value: JSON.stringify(defaultDeploymentConfig.modules),
                type: "deployment"
            }
        ]);
    }
};

exports.down = async function (knex) {
    // 删除部署配置相关设置
    await knex("setting")
        .whereIn("key", [
            "deploymentMode",
            "deploymentFeatures",
            "deploymentPublicAccess",
            "deploymentModules"
        ])
        .del();
};
