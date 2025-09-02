# 本项目使用说明（二次开发版）

本仓库基于 Uptime Kuma 进行二次开发，已不再依赖上游的预构建产物或版本更新流程。本文档仅说明本仓库的启动、构建、账号管理与常见问题处理。原始说明请参考根目录 `README.md`。

## 环境要求

- Node.js: 18 或 >= 20.4.0（推荐 20.4.0+）
- 系统端口：默认监听 `3001`
- 数据目录：默认 `./data/`（可通过环境变量 `DATA_DIR` 覆盖）

## 一分钟上手

1. 安装依赖（仅首次）

```bash
npm install
```

1. 构建前端（仅在生产运行前需要；开发模式可跳过）

```bash
npm run build
```

1. 启动服务（生产模式）

```bash
node server/server.js
```

1. 访问面板

- 浏览器打开 `http://localhost:3001`。
- 首次启动若数据库中没有用户，会显示“初始化管理员账号”的向导页面。

## 别再使用 `npm run setup`

上游的 `npm run setup` 会拉取 GitHub 上的预构建 dist，我们本仓库不再需要该步骤。请用“构建前端 + 启动服务”的方式运行：

```bash
npm run build
node server/server.js
```

开发时可使用并行开发脚本（热更新）：

```bash
npm run dev
# 等价于：一个进程跑后端（3001），一个进程跑前端 Vite（3000）
```

仅启动后端（开发日志更详细）：

```bash
npm run start-server-dev
```

仅启动前端（Vite 开发服务器）：

```bash
npm run start-frontend-dev
```

## 管理员密码（初始化/找回）

本项目没有“默认密码”。若忘记密码或需要为现有数据库重置密码，使用内置 CLI 工具：

- 交互式重置：

```bash
node extra/reset-password.js
```

- 无交互（CI/容器内等场景）：

```bash
node extra/reset-password.js --new-password="你的新密码"
```

执行成功后，使用重置后的密码登录；系统会自动使其他会话失效。

## 数据目录与迁移

- 数据库默认位于 `./data/kuma.db`。通过环境变量可覆盖：

```bash
DATA_DIR=/your/data/dir node server/server.js
```

- 首次运行会自动创建目录与模板数据库，并自动执行 Knex 迁移。

## 关闭上游更新检查（可选）

本仓库不再跟随上游更新。可在“设置 -> 常规”关闭“检查更新”；或保留默认设置，不会影响运行。

## 常见问题

- 我可以直接用 SQLite 文件迁移吗？可以。确保停机后替换 `./data/kuma.db`，首次启动会自动迁移结构。
- 启动后看不到前端页面？请确认已经执行过 `npm run build` 且 `dist/` 存在；生产模式下后端直接服务 `dist/` 静态资源。
- 端口被占用？设置环境变量或修改 `config/` 中默认端口，或用反向代理。

## 约定与差异

- 构建与运行均以本仓库源码为准，不再下载上游构建产物。
- 文档与启动脚本以本文档为主；保留 `README.md` 仅作参考。

## SLO / SLA 窗口口径

- SLO（内部）：默认采用“滚动30天（30d rolling）”作为达成与错误预算的窗口。
- SLA（对外）：默认采用“本月（日历月）”口径，与计费周期对齐。
- 默认时区：Asia/Shanghai（可在监控项中通过 `sla_timezone` 指定，状态页“本月”达成按该时区月初至今计算）。
- 状态页：
  - SLI 徽章：标注为“SLI: 百分比”，默认基于 24h（现有逻辑）。
  - SLA 徽章：默认显示 30天滚动窗口（“达成/目标（30天滚动）”）；后端同时提供 `30d`（rolling-30d）与 `month`（calendar-month），可切换或并列展示。

## 数据库迁移与字段修复

若出现错误 “table monitor has no column named sla_exclude_maintenance”，说明迁移未生效。解决步骤：

1) 重启服务（推荐）

```bash
# 停止现有进程后重新启动，启动时会自动执行迁移
node server/server.js
```

2) 立即手动修复（SQLite 默认）

```bash
# 查看当前表结构
sqlite3 ./data/kuma.db 'PRAGMA table_info(monitor);'

# 若缺少字段，则执行以下 DDL：
sqlite3 ./data/kuma.db "ALTER TABLE monitor ADD COLUMN sla_target REAL;"
sqlite3 ./data/kuma.db "ALTER TABLE monitor ADD COLUMN sla_period TEXT NOT NULL DEFAULT 'calendar-month';"
sqlite3 ./data/kuma.db "ALTER TABLE monitor ADD COLUMN sla_exclude_maintenance INTEGER NOT NULL DEFAULT 1;"
sqlite3 ./data/kuma.db "ALTER TABLE monitor ADD COLUMN sla_timezone TEXT;"
```

3) MariaDB 手动修复（如你使用外部 MariaDB）

```sql
ALTER TABLE monitor ADD COLUMN sla_target DOUBLE NULL;
ALTER TABLE monitor ADD COLUMN sla_period VARCHAR(191) NOT NULL DEFAULT 'calendar-month';
ALTER TABLE monitor ADD COLUMN sla_exclude_maintenance TINYINT(1) NOT NULL DEFAULT 1;
ALTER TABLE monitor ADD COLUMN sla_timezone VARCHAR(191) NULL;
```

4) 可选：直接触发一次迁移（无需重启）

```bash
node -e "(async()=>{const Database=require('./server/database');Database.initDataDir({});await Database.connect(false,true);await Database.patch();await Database.close();console.log('Migration done')})().catch(e=>{console.error(e);process.exit(1)})"
```

完成后再次新建/保存监控即可。
