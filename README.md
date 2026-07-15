# BidMind（Web 全功能版）

> 该目录为 Web 客户端的网页化改造版本：
> - **界面保持与桌面端一致**（沿用原 Renderer 代码）
> - **功能链路保持一致**（将 Main 侧能力迁移为 Web API 服务）

## 目录说明

- `src/`：原客户端 Renderer（React + Vite）
- `server/`：网页端 API 服务（Node）
- `backend-core/services/`：复用桌面端 Main 服务逻辑（任务、知识库、查重、导出等）

## 本地开发

```bash
cd /Users/felix/Desktop/BidMind
npm install
npm run dev
```

- 前端：`http://127.0.0.1:5173`
- API：`http://127.0.0.1:8788`

## 生产部署建议

网页端是 **前后端一体**：

1. `npm run build` 生成前端静态文件（`dist/`）
2. `npm run start:server` 启动 API 服务
3. 用 Nginx / 网关将 `/api` 反向代理到 API 服务
4. 将 `dist/` 部署为静态站点

### Vercel 部署说明

- 已提供 `vercel.json` 与 `api/index.cjs`，`/api/*` 会由 Vercel Function 承接。
- 若在 Vercel 运行，服务端数据目录默认会落到 `/tmp/bidmind-web-data`（临时目录）。
- `/tmp` 数据 **不保证持久化**，正式多用户环境建议把用户、会话、项目数据迁移到数据库/对象存储。

## 关键改造点

- 新增 `src/platform/webBridge.ts`：在网页端注入 `window.bidmind`，与桌面端 API 结构保持一致。
- 新增 `server/index.cjs`：承接配置、文件解析、后台任务、知识库、查重、Word 导出、事件推送等能力。
- `MarkdownRenderer` 增加 `bidmind-asset://` 到 `/api/assets` 的映射，确保正文/知识库图片可展示。

## 多用户与数据隔离（互联网部署）

- 除 `注册/登录/版本号/头像` 外，`/api/*` 现在默认要求登录态（`Authorization: Bearer <token>`）。
- 每个账号使用独立的数据根目录，互不共享配置、项目、知识库、任务事件与导出文件。

## 数据存储

服务端数据保存在：

- `/Users/felix/Desktop/BidMind/.web-data/`

其中包含：
- `users.json`（账号与会话）
- `users/<userId>/user_config.json`
- `users/<userId>/workspace/`（技术方案/查重缓存、知识库、图片资产）
- `users/<userId>/exports/`（Word 导出）
- `uploads/<userId>/`（上传临时文件）
- `blob-store/`（当 `BIDMIND_BLOB_DRIVER=local` 时的对象文件）

## 集中配置（默认本地，可切换 MySQL / MinIO / Redis）

后端配置统一在：

- `server/infrastructure/runtimeConfig.cjs`

默认全部走本地（零配置可运行）。需要切换时只改环境变量即可：

### 驱动开关（全部默认 `local`）

- `BIDMIND_AUTH_DRIVER=local|mysql`（账号与会话）
- `BIDMIND_STATE_DRIVER=local|mysql`（配置与工作区状态，会先落本地再镜像到 MySQL）
- `BIDMIND_BLOB_DRIVER=local|minio`（头像、导出、查重上传文件镜像）
- `BIDMIND_EVENT_DRIVER=local|redis`（事件轮询）

### MySQL

- `BIDMIND_MYSQL_ENABLED=true`
- `BIDMIND_MYSQL_HOST=127.0.0.1`
- `BIDMIND_MYSQL_PORT=3306`
- `BIDMIND_MYSQL_USER=...`
- `BIDMIND_MYSQL_PASSWORD=...`
- `BIDMIND_MYSQL_DATABASE=bidmind`
- `BIDMIND_MYSQL_POOL_SIZE=10`

### MinIO

- `BIDMIND_MINIO_ENABLED=true`
- `BIDMIND_MINIO_ENDPOINT=127.0.0.1`
- `BIDMIND_MINIO_PORT=9000`
- `BIDMIND_MINIO_USE_SSL=false`
- `BIDMIND_MINIO_ACCESS_KEY=...`
- `BIDMIND_MINIO_SECRET_KEY=...`
- `BIDMIND_MINIO_BUCKET=bidmind`
- `BIDMIND_MINIO_PREFIX=app`

### Redis

- `BIDMIND_REDIS_ENABLED=true`
- `BIDMIND_REDIS_URL=redis://...`
- `BIDMIND_REDIS_PREFIX=bidmind:`

### 一键切换到 MySQL + MinIO + Redis

```bash
BIDMIND_AUTH_DRIVER=mysql
BIDMIND_STATE_DRIVER=mysql
BIDMIND_BLOB_DRIVER=minio
BIDMIND_EVENT_DRIVER=redis

BIDMIND_MYSQL_ENABLED=true
BIDMIND_MINIO_ENABLED=true
BIDMIND_REDIS_ENABLED=true
```

建议先复制 `.env.example` 为 `.env` 后按需填写。
