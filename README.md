# TS3 Monitor — TeamSpeak3 语音服务器监控管理站

一个参照 `teamspeak.nanodesu.net` 实现的功能完整的 TeamSpeak3 监控站。后端通过 ServerQuery 协议（TCP 10011）连接真实 TS3 服务器，周期采集数据写入 SQLite，经 REST 向前端提供数据。

功能包括：实时在线、在线时长统计、活跃榜、热门频道、周冠军、弹性频道自动扩容、下载链接、汉化包、使用教程、个人数据查询与管理后台。

## 环境要求

- Node.js 22.5 或更高版本（本项目使用 Node 内置的 `node:sqlite`，22.5 以下无法运行）
- npm

## 目录结构

```
backend/   后端服务（Express + SQLite + ts3-nodejs-library）
frontend/  前端（Vue 3 + Vite）
```

## 快速开始

### 方式一：整包下载（含 `.env` 配置与历史数据）

如果下载的压缩包里包含 `backend/.env`（隐藏文件）和 `backend/data/ts3monitor.db`，则开箱即用，只需启动后端：

```bash
# 启动后端
cd backend
npm install
npm run dev
```

前端构建产物已包含在 `frontend/dist` 中，后端会自动托管。启动后浏览器打开：

```
http://localhost:3001
```

### 方式二：仅代码（git 下载，无 `.env` 无历史数据）

```bash
# 1. 准备后端配置
cd backend
cp .env.example .env
# 编辑 .env，填写 TS3_HOST、TS3_QUERY_PASSWORD、ADMIN_PASSWORD 等真实值
npm install

# 2. 构建前端（后端会托管构建产物）
cd ../frontend
npm install
npm run build

# 3. 启动后端
cd ../backend
npm run dev
```

> 如果 `.env` 里没有配置 TS3 连接信息，后端不会连接任何服务器，也不会生成任何假数据。打开网页会提示「尚未连接 TS3 服务器」，点击「前往后台配置」填写服务器地址、端口、账号、密码即可自动连接。

## 配置说明（`.env`）

| 变量 | 说明 | 必填 |
|------|------|------|
| `PORT` | 后端监听端口，默认 `3001` | 否 |
| `TS3_HOST` | 被监控 TS3 服务器地址 | 是 |
| `TS3_QUERY_PORT` | ServerQuery 端口，默认 `10011` | 否 |
| `TS3_SERVER_PORT` | 语音端口，默认 `9987` | 否 |
| `TS3_SERVER_ID` | 虚拟服务器 ID，默认 `1` | 否 |
| `TS3_QUERY_USERNAME` | ServerQuery 账号，默认 `serveradmin` | 否 |
| `TS3_QUERY_PASSWORD` | ServerQuery 密码 | 是 |
| `TS3_PUBLIC_HOST` | 站点对外展示的地址（留空则显示 `TS3_HOST`） | 否 |
| `TS3_PUBLIC_PORT` | 站点对外展示的端口，默认 `9987` | 否 |
| `SITE_TITLE` | 站点标题 | 否 |
| `SITE_SERVER_NAME` | 站点展示的服务器名（留空则读取真实服务器名） | 否 |
| `SITE_SLUG` | 当前分站唯一标识，例如 `server-a` | 否 |
| `SITE_DOMAIN` | 当前分站允许访问的域名，可用逗号分隔多个域名 | 否 |
| `SITE_BASE_DOMAIN` | 统一分站的默认根域名；也可在总站后台「统一分站」中保存 | 否 |
| `ADMIN_PASSWORD` | 后台管理密码 | 是 |
| `JWT_SECRET` | JWT 签名密钥，生产环境请改成随机串 | 否 |
| `DB_PATH` | SQLite 数据库路径，默认 `data/ts3monitor.db` | 否 |
| `COLLECT_INTERVAL_MS` | 数据采集间隔（毫秒），默认 `30000` | 否 |
| `SAMPLE_INTERVAL_MS` | 在线人数采样间隔（毫秒），默认 `300000` | 否 |

## 后台管理

访问首页右上角「后台」按钮，输入 `ADMIN_PASSWORD` 配置的密码登录。

后台提供以下功能：

- **服务器配置**：修改被监控 TS3 服务器的连接参数，保存后立即重新连接，并同步写回 `.env` 文件，无需手动改本地文件。
- **弹性频道**：配置频道组的前缀、满员阈值、空置阈值，自动扩容/收缩频道。
- **周冠军**：配置奖励服务器组与检测间隔。
- **TS3 管理**：在线用户列表、频道管理、踢人/移动/封禁、服务器组与频道组分配。
- **站点配置**：维护站点名称、页脚描述、欢迎语服务器名称、对外服务器地址与管理员联系方式。
- **教程配置**：分别维护下载、基础、进阶三段使用教程，以及官方下载、备用下载和汉化包链接。

## 开发模式（前后端分离）

开发时前后端分别启动，前端通过 Vite 代理转发 API：

```bash
# 终端 1：后端
cd backend
npm run dev

# 终端 2：前端
cd frontend
npm run dev
```

前端开发服务器运行在 `http://localhost:5173`，已配置 `/api` 与 `/ws` 代理到后端 `3001` 端口。

## 生产部署

```bash
# 构建后端
cd backend
npm run build

# 构建前端
cd ../frontend
npm run build

# 启动后端（托管前端构建产物）
cd ../backend
npm start
```

## 统一后台分站

总站后台的「统一分站」可集中创建和启停多个分站。先保存分站根域名，例如 `example.com`，再填写分站昵称、子域名 `alpha`、TS3 ServerQuery 参数和该分站自己的后台密码，系统会立即创建：

```text
alpha.example.com -> Alpha 语音分站
```

每个分站都有独立的 SQLite 数据库（`backend/data/subsites/<slug>.db`）、TS3 连接参数、统计数据、后台密码、配置和自动化任务。分站的 API、WebSocket 推送和后台令牌均按 Host 隔离；停用后访问该分站域名会返回 404，但历史数据库会保留。

应用可以立即创建分站记录和 Host 路由，但无法在没有 DNS 服务商权限时自行创建公网 DNS 记录或签发 HTTPS 证书。生产环境还需要：

1. 在 DNS 服务商配置 `*.example.com` 泛解析到运行本服务的服务器。
2. 让反向代理将所有子域名转发到 `127.0.0.1:3001`，并保留原始 `Host` 请求头。
3. 为根域名与通配符子域名配置 HTTPS 证书，例如 `example.com` 和 `*.example.com`。

本地验证时可以通过请求的 `Host` 头模拟子域名；仅访问 `127.0.0.1:3001` 不会自动获得真实公网域名解析。

## 测试

```bash
cd backend
npm test
```

## 常见问题

- **启动后日志提示「未配置 TS3 服务器」**：`.env` 中未填写 `TS3_HOST`，或下载包缺少 `.env`。打开网页后台「服务器配置」填写即可。
- **`node:sqlite` 报错**：Node 版本低于 22.5，请升级。
- **数据库历史数据丢失**：`data/ts3monitor.db` 不随 git 提交。如需迁移历史数据，请连同该文件一起拷贝。
