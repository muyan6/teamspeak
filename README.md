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
- **站点配置**：下载链接、汉化包链接、使用教程内容。

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

## 子域名分站部署

当不同 TeamSpeak 服务器不属于同一个管理员时，推荐为每个服务器运行一个独立实例，而不是在一个后台集中展示所有服务器。每个实例使用独立的 `.env`、SQLite 数据库和管理员密码，再通过不同子域名对外提供服务：

```text
a.example.com -> 服务器 A
b.example.com -> 服务器 B
```

每个实例配置不同的 `DB_PATH`、`TS3_HOST`、`ADMIN_PASSWORD`、`SITE_SLUG` 和 `SITE_DOMAIN`。设置 `SITE_DOMAIN` 后，实例会拒绝未绑定域名的访问请求；本地开发时仍允许 `localhost` 和 `127.0.0.1`。

这种部署方式可以保证服务器管理员只看到自己的实时数据、统计数据、站点配置和管理入口。DNS 侧需要将各子域名解析到同一台应用服务器，再由反向代理按子域名转发到对应端口。

## 测试

```bash
cd backend
npm test
```

## 常见问题

- **启动后日志提示「未配置 TS3 服务器」**：`.env` 中未填写 `TS3_HOST`，或下载包缺少 `.env`。打开网页后台「服务器配置」填写即可。
- **`node:sqlite` 报错**：Node 版本低于 22.5，请升级。
- **数据库历史数据丢失**：`data/ts3monitor.db` 不随 git 提交。如需迁移历史数据，请连同该文件一起拷贝。
