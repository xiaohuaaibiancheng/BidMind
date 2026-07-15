# BidMind Web 版 — 安装与启动指南

本文档详细介绍如何在本地安装依赖、启动前后端，以及生产环境的部署方式。

---

## 目录

1. [环境要求](#1-环境要求)
2. [项目架构概览](#2-项目架构概览)
3. [安装依赖](#3-安装依赖)
4. [本地开发启动](#4-本地开发启动)
5. [单独启动前端 / 后端](#5-单独启动前端--后端)
6. [构建生产版本](#6-构建生产版本)
7. [生产部署](#7-生产部署)
8. [Vercel 一键部署](#8-vercel-一键部署)
9. [环境变量配置](#9-环境变量配置)
10. [数据存储说明](#10-数据存储说明)
11. [常见问题排查](#11-常见问题排查)

---

## 1. 环境要求

| 依赖 | 版本要求 | 说明 |
|------|---------|------|
| **Node.js** | **20.x** | `package.json` 中 `engines.node` 指定为 `20.x`，请确保版本匹配 |
| **pnpm** | 最新稳定版 | 项目使用 pnpm 作为包管理器（有 `pnpm-lock.yaml` 和 `pnpm-workspace.yaml`） |
| **操作系统** | macOS / Linux / Windows | 均可运行 |

### 安装 Node.js 20.x

推荐使用 [nvm](https://github.com/nvm-sh/nvm) 或 [fnm](https://github.com/Schniz/fnm) 管理 Node 版本：

```bash
# 使用 nvm
nvm install 20
nvm use 20

# 使用 fnm
fnm install 20
fnm use 20

# 验证版本
node -v   # 应输出 v20.x.x
npm -v    # 确认 npm 可用
```

### 安装 pnpm

```bash
npm install -g pnpm

# 验证
pnpm -v
```

---

## 2. 项目架构概览

```
BidMind/
├── src/                        # 前端源码（React + TypeScript + Vite）
│   ├── main.tsx                # 前端入口
│   ├── App.tsx                 # 应用根组件
│   ├── platform/webBridge.ts   # 网页端 window.bidmind 桥接层
│   └── features/               # 业务功能模块
│       ├── technical-plan/     # 技术方案
│       ├── knowledge-base/     # 知识库
│       ├── duplicate-check/    # 标书查重
│       ├── rejection-check/    # 废标项检查
│       └── settings/          # 设置页
├── server/                     # 后端 API 服务（Express）
│   ├── index.cjs               # 服务入口，监听 8788 端口
│   └── infrastructure/         # 基础设施（认证、状态存储、事件、对象存储）
│       ├── runtimeConfig.cjs   # 运行时配置（驱动选择、MySQL/MinIO/Redis）
│       ├── authStore.cjs       # 认证存储
│       ├── stateStore.cjs      # 状态持久化
│       ├── eventStore.cjs      # 事件轮询
│       ├── blobStore.cjs       # 对象存储
│       └── clients.cjs         # 外部服务客户端
├── backend-core/               # 复用桌面端 Main 侧服务逻辑
│   ├── services/               # 核心业务服务（AI、文件解析、任务、导出等）
│   ├── ipc/                    # IPC 通道注册
│   ├── utils/                  # 工具函数
│   ├── main.cjs                # 桌面端 Main 入口
│   └── preload.cjs             # 桌面端预加载脚本
├── api/                        # Vercel Serverless Function 入口
│   └── index.cjs
├── assets/                     # 静态资源（图标等）
├── public/                     # Vite 公共资源
├── index.html                  # 前端 HTML 入口
├── vite.config.ts              # Vite 配置（含 API 代理）
├── tsconfig.json               # TypeScript 配置
├── vercel.json                 # Vercel 部署配置
├── package.json                # 项目依赖与脚本
├── pnpm-lock.yaml              # pnpm 锁文件
└── pnpm-workspace.yaml         # pnpm 工作区配置
```

### 前后端关系

| 部分 | 技术栈 | 开发地址 | 说明 |
|------|-------|---------|------|
| **前端** | React 19 + Vite 7 + TypeScript 5 | `http://127.0.0.1:5173` | Vite 开发服务器，自动代理 `/api` 到后端 |
| **后端** | Express + Node.js (CommonJS) | `http://127.0.0.1:8788` | REST API 服务，提供所有业务能力 |

> 开发时前端通过 Vite 的 `proxy` 配置将 `/api` 请求自动转发到后端 `http://127.0.0.1:8788`，无需跨域配置。

---

## 3. 安装依赖

### 3.1 克隆项目（如已有项目可跳过）

```bash
cd /Users/felix/Desktop
# 如果是从 Git 仓库克隆：
git clone <仓库地址> BidMind
cd BidMind
```

### 3.2 安装依赖

```bash
cd /Users/felix/Desktop/BidMind
pnpm install
```

> **注意**：
> - 项目包含原生模块 `@napi-rs/canvas`，macOS 可能需要 Xcode Command Line Tools（`xcode-select --install`）。
> - 如果安装失败，请检查 Node.js 版本是否为 20.x。
> - 请**不要**使用 `npm install`，项目使用 pnpm 管理依赖，混用可能导致锁文件冲突。

### 3.3 验证安装

```bash
# 确认依赖安装成功
pnpm ls --depth 0
```

---

## 4. 本地开发启动

### 一键启动（推荐）

```bash
cd /Users/felix/Desktop/BidMind
pnpm dev
```

该命令会通过 `concurrently` 同时启动前端和后端：

| 进程 | 命令 | 日志前缀 | 地址 |
|------|------|---------|------|
| 后端 API | `node server/index.cjs` | `[api]`（紫色） | `http://127.0.0.1:8788` |
| 前端 Vite | `vite --host 127.0.0.1 --port 5173 --strictPort` | `[vite]`（蓝色） | `http://127.0.0.1:5173` |

启动成功后，在浏览器访问 **http://127.0.0.1:5173** 即可使用。

> `concurrently -k` 参数表示任一进程退出时自动终止另一个，`Ctrl+C` 即可同时关闭前后端。

---

## 5. 单独启动前端 / 后端

某些场景下需要单独启动，比如只调试前端 UI 或只调试后端 API。

### 5.1 仅启动后端 API

```bash
cd /Users/felix/Desktop/BidMind
pnpm run dev:server
```

后端将在 `http://127.0.0.1:8788` 启动，可直接用 curl 或 Postman 测试 API。

### 5.2 仅启动前端

```bash
cd /Users/felix/Desktop/BidMind
pnpm run dev:web
```

> 前端依赖后端 API，单独启动前端时需要确保后端已经在 `http://127.0.0.1:8788` 运行，否则 `/api` 请求会失败。

### 5.3 自定义后端端口

后端默认监听 `8788` 端口，可通过环境变量修改：

```bash
BIDMIND_WEB_API_PORT=9000 pnpm run dev:server
```

> 如果修改了后端端口，需要同步修改 `vite.config.ts` 中的 `proxy` 目标地址。

---

## 6. 构建生产版本

### 6.1 前端构建

```bash
cd /Users/felix/Desktop/BidMind
pnpm build
```

该命令会先执行 `tsc --noEmit` 进行类型检查，然后执行 `vite build`，产物输出到 `dist/` 目录。

### 6.2 预览构建结果

```bash
pnpm preview
```

在 `http://127.0.0.1:4173` 预览生产构建的静态文件。

### 6.3 仅启动后端（生产模式）

```bash
pnpm start:server
```

后端 API 服务在 `http://127.0.0.1:8788` 启动。

---

## 7. 生产部署

生产环境是**前后端一体**架构，推荐按以下步骤部署：

### 7.1 构建前端静态文件

```bash
pnpm build
# 产物在 dist/ 目录
```

### 7.2 启动后端 API 服务

```bash
pnpm start:server
# API 服务运行在 http://127.0.0.1:8788
```

### 7.3 Nginx 反向代理配置示例

```nginx
server {
    listen 80;
    server_name your-domain.com;

    # 前端静态文件
    root /path/to/BidMind/dist;
    index index.html;

    # API 反向代理
    location /api/ {
        proxy_pass http://127.0.0.1:8788;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # SPA 路由回退
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

### 7.4 使用 PM2 守护后端进程

```bash
npm install -g pm2

# 启动后端
pm2 start server/index.cjs --name bidmind-api

# 设置开机自启
pm2 save
pm2 startup
```

---

## 8. Vercel 一键部署

项目已内置 Vercel 部署配置（`vercel.json` + `api/index.cjs`）：

1. 将代码推送到 GitHub 仓库
2. 在 [Vercel](https://vercel.com) 导入该仓库
3. Vercel 会自动识别配置并部署

> **注意**：Vercel 环境的数据目录默认在 `/tmp/bidmind-web-data`，这是临时目录，**不保证数据持久化**。正式使用建议切换到 MySQL + MinIO + Redis（见环境变量配置）。

---

## 9. 环境变量配置

后端所有配置通过环境变量控制，默认全部走本地文件存储，**零配置即可运行**。

### 9.1 基础配置

| 环境变量 | 默认值 | 说明 |
|---------|--------|------|
| `BIDMIND_DATA_ROOT` | `.web-data/`（项目根目录下） | 数据存储根目录 |
| `BIDMIND_WEB_API_PORT` | `8788` | 后端 API 服务端口 |

### 9.2 驱动切换

| 环境变量 | 可选值 | 默认值 | 说明 |
|---------|--------|--------|------|
| `BIDMIND_AUTH_DRIVER` | `local` / `mysql` | `local` | 账号与会话存储 |
| `BIDMIND_STATE_DRIVER` | `local` / `mysql` | `local` | 配置与工作区状态存储 |
| `BIDMIND_BLOB_DRIVER` | `local` / `minio` | `local` | 文件对象存储 |
| `BIDMIND_EVENT_DRIVER` | `local` / `redis` | `local` | 事件轮询存储 |

### 9.3 MySQL 配置

| 环境变量 | 默认值 | 说明 |
|---------|--------|------|
| `BIDMIND_MYSQL_ENABLED` | `false` | 是否启用 MySQL |
| `BIDMIND_MYSQL_HOST` | `127.0.0.1` | MySQL 主机 |
| `BIDMIND_MYSQL_PORT` | `3306` | MySQL 端口 |
| `BIDMIND_MYSQL_USER` | - | MySQL 用户名 |
| `BIDMIND_MYSQL_PASSWORD` | - | MySQL 密码 |
| `BIDMIND_MYSQL_DATABASE` | `bidmind` | MySQL 数据库名 |
| `BIDMIND_MYSQL_POOL_SIZE` | `10` | 连接池大小 |

### 9.4 MinIO 配置

| 环境变量 | 默认值 | 说明 |
|---------|--------|------|
| `BIDMIND_MINIO_ENABLED` | `false` | 是否启用 MinIO |
| `BIDMIND_MINIO_ENDPOINT` | `127.0.0.1` | MinIO 端点 |
| `BIDMIND_MINIO_PORT` | `9000` | MinIO 端口 |
| `BIDMIND_MINIO_USE_SSL` | `false` | 是否使用 SSL |
| `BIDMIND_MINIO_ACCESS_KEY` | - | MinIO Access Key |
| `BIDMIND_MINIO_SECRET_KEY` | - | MinIO Secret Key |
| `BIDMIND_MINIO_BUCKET` | `bidmind` | MinIO Bucket 名 |
| `BIDMIND_MINIO_PREFIX` | `app` | MinIO Key 前缀 |

### 9.5 Redis 配置

| 环境变量 | 默认值 | 说明 |
|---------|--------|------|
| `BIDMIND_REDIS_ENABLED` | `false` | 是否启用 Redis |
| `BIDMIND_REDIS_URL` | - | Redis 连接 URL，如 `redis://127.0.0.1:6379` |
| `BIDMIND_REDIS_PREFIX` | `bidmind:` | Redis Key 前缀 |

### 9.6 一键切换到 MySQL + MinIO + Redis

创建 `.env` 文件（从 `.env.example` 复制，如有的话）：

```bash
BIDMIND_AUTH_DRIVER=mysql
BIDMIND_STATE_DRIVER=mysql
BIDMIND_BLOB_DRIVER=minio
BIDMIND_EVENT_DRIVER=redis

BIDMIND_MYSQL_ENABLED=true
BIDMIND_MYSQL_HOST=127.0.0.1
BIDMIND_MYSQL_PORT=3306
BIDMIND_MYSQL_USER=root
BIDMIND_MYSQL_PASSWORD=your_password
BIDMIND_MYSQL_DATABASE=bidmind

BIDMIND_MINIO_ENABLED=true
BIDMIND_MINIO_ENDPOINT=127.0.0.1
BIDMIND_MINIO_PORT=9000
BIDMIND_MINIO_ACCESS_KEY=your_access_key
BIDMIND_MINIO_SECRET_KEY=your_secret_key
BIDMIND_MINIO_BUCKET=bidmind

BIDMIND_REDIS_ENABLED=true
BIDMIND_REDIS_URL=redis://127.0.0.1:6379
```

---

## 10. 数据存储说明

### 10.1 本地开发数据目录

默认数据存储在项目根目录下的 `.web-data/`：

```
.web-data/
├── users.json                       # 账号与会话
├── users/<userId>/
│   ├── user_config.json             # 用户配置（模型、文件解析等）
│   ├── workspace/                   # 工作区（技术方案、查重缓存、知识库）
│   └── exports/                     # Word 导出文件
├── uploads/<userId>/                # 上传的临时文件
├── avatars/                         # 用户头像
└── blob-store/                      # 本地对象存储（BIDMIND_BLOB_DRIVER=local 时）
```

> `.web-data/` 已在 `.gitignore` 中，不会提交到 Git。

### 10.2 多用户数据隔离

- 除注册/登录/版本号/头像外，所有 `/api/*` 接口默认要求登录态（`Authorization: Bearer <token>`）。
- 每个账号使用独立的数据目录，配置、项目、知识库、任务事件与导出文件互不共享。

---

## 11. 常见问题排查

### Q1: `pnpm install` 失败，提示 `@napi-rs/canvas` 编译错误

**原因**：`@napi-rs/canvas` 是原生模块，需要编译工具链。

**解决**：
```bash
# macOS：安装 Xcode Command Line Tools
xcode-select --install

# 安装后重试
pnpm install
```

### Q2: 启动前端后页面空白，控制台报 `/api` 请求失败

**原因**：后端 API 服务未启动。

**解决**：确保后端已在 `http://127.0.0.1:8788` 运行。可使用 `pnpm dev` 同时启动前后端。

### Q3: 端口 `5173` 或 `8788` 被占用

**解决**：
```bash
# 查找占用端口的进程
lsof -i :5173
lsof -i :8788

# 终止占用进程
kill -9 <PID>

# 或者修改后端端口
BIDMIND_WEB_API_PORT=9000 pnpm run dev:server
```

> 前端端口 `5173` 使用了 `--strictPort`，被占用时 Vite 会直接报错而不会自动换端口。如需修改前端端口，需编辑 `package.json` 中的 `dev:web` 脚本。

### Q4: Node.js 版本不对

**解决**：
```bash
# 检查当前版本
node -v

# 切换到 Node.js 20.x
nvm use 20   # 或 fnm use 20

# 重新安装依赖
rm -rf node_modules
pnpm install
```

### Q5: `pnpm: command not found`

**解决**：
```bash
npm install -g pnpm
```

### Q6: TypeScript 类型检查报错

**解决**：
```bash
# 单独运行类型检查
npx tsc --noEmit

# 查看具体报错信息，按需修复
```

### Q7: macOS 上安装依赖时提示权限问题

**解决**：
```bash
# 确保对项目目录有读写权限
sudo chown -R $(whoami) /Users/felix/Desktop/BidMind
pnpm install
```

---

## 快速启动命令总结

```bash
# 1. 进入项目目录
cd /Users/felix/Desktop/BidMind

# 2. 确保 Node.js 版本为 20.x
node -v

# 3. 安装依赖
pnpm install

# 4. 一键启动前后端
pnpm dev

# 5. 浏览器访问
# http://127.0.0.1:5173
```

---

> 如有其他问题，请参考项目根目录下的 `README.md` 和 `开发说明.md`。
