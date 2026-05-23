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
cd /Users/felix/Desktop/开源/BidMind/web-client
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

- 已提供 `vercel.json` 与 `api/[...path].cjs`，`/api/*` 会由 Vercel Function 承接。
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
