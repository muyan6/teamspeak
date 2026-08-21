# TS3 Monitor 生产部署指南

本指南将 TS3 Monitor 部署到 Ubuntu 22.04/24.04 服务器，并通过域名以 HTTPS 访问。

部署后的结构如下：

```text
浏览器 -> https://example.com -> Nginx -> Node.js (127.0.0.1:4321)
                                              -> TeamSpeak 3 ServerQuery (TCP 10011)
```

请将文中的 `example.com`、IP 地址、密码和路径替换为实际值。

## 1. 准备条件

- 一台具有公网 IPv4 地址的 Ubuntu 22.04 或 24.04 服务器。
- 一个已购买并能管理 DNS 记录的域名。
- 可 SSH 登录服务器的账户（需要 `sudo` 权限）。
- 可从网站服务器访问的 TS3 ServerQuery 服务；默认端口为 `10011`。

在云服务商安全组和服务器防火墙中开放 TCP `22`、`80`、`443`。不要对公网开放应用的 `4321` 端口。

## 2. 配置域名解析

在域名 DNS 管理面板添加以下记录：

| 类型 | 主机记录 | 记录值 |
| --- | --- | --- |
| A | `@` | 服务器公网 IPv4 地址 |
| A | `www` | 服务器公网 IPv4 地址 |

DNS 生效后，`example.com` 和 `www.example.com` 都应解析到这台服务器。

## 3. 上传项目

推荐使用 Git：

```bash
sudo mkdir -p /opt/ts3-monitor
sudo chown "$USER:$USER" /opt/ts3-monitor
git clone <你的仓库地址> /opt/ts3-monitor
cd /opt/ts3-monitor
```

没有 Git 仓库时，也可以通过 SFTP 将项目源码上传到 `/opt/ts3-monitor`。不要上传 `node_modules`；不要将生产环境的 `.env` 文件提交到仓库。

## 4. 安装系统依赖

项目需要 Node.js `22.5` 或更高版本。以下示例使用 nvm 安装 Node.js 22：

```bash
sudo apt update
sudo apt install -y ca-certificates curl git nginx build-essential

curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
source "$HOME/.nvm/nvm.sh"
nvm install 22
nvm use 22

node --version
npm --version

npm install --global pm2
```

`node --version` 的输出必须不低于 `v22.5.0`。

## 5. 配置环境变量

创建后端环境文件：

```bash
cd /opt/ts3-monitor/backend
nano .env
```

填入至少以下配置：

```env
PORT=4321

# 仅首次启动时用于初始化后台密码
ADMIN_PASSWORD=<高强度后台密码>

# 固定保存；不要在每次重启时更换
JWT_SECRET=<随机长字符串>

# TS3 ServerQuery 连接参数
TS3_HOST=<TS3服务器IP或域名>
TS3_QUERY_PORT=10011
TS3_SERVER_PORT=9987
TS3_QUERY_USERNAME=serveradmin
TS3_QUERY_PASSWORD=<ServerQuery密码>

# 网站展示的 TS3 地址
TS3_PUBLIC_HOST=<TS3玩家连接地址>
TS3_PUBLIC_PORT=9987

# 当前网站域名
SITE_DOMAIN=example.com
```

生成 `JWT_SECRET` 的示例：

```bash
openssl rand -hex 32
```

限制密钥文件权限：

```bash
chmod 600 /opt/ts3-monitor/backend/.env
```

> 后台首次启动后，后台密码和 TS3 连接参数会保存到 SQLite 数据库。数据库默认位置为 `backend/data/ts3monitor.db`，必须定期备份。

## 6. 安装依赖并构建

后端会在生产模式自动托管前端的构建产物：

```bash
cd /opt/ts3-monitor/backend
npm ci
npm run build

cd /opt/ts3-monitor/frontend
npm ci
npm run build
```

## 7. 使用 PM2 常驻运行

```bash
cd /opt/ts3-monitor/backend
pm2 start dist/index.js --name ts3-monitor --time
pm2 save
pm2 startup
```

`pm2 startup` 会输出一条需要以 `sudo` 执行的命令。执行该命令后再运行一次 `pm2 save`，即可使服务在服务器重启后自动恢复。

检查应用是否运行：

```bash
curl http://127.0.0.1:4321/api/health
pm2 status
pm2 logs ts3-monitor
```

## 8. 配置 Nginx 反向代理

创建 Nginx 站点配置：

```bash
sudo nano /etc/nginx/sites-available/ts3-monitor
```

写入以下内容：

```nginx
server {
    listen 80;
    server_name example.com www.example.com;

    location /ws {
        proxy_pass http://127.0.0.1:4321;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 3600s;
    }

    location / {
        proxy_pass http://127.0.0.1:4321;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

启用配置并检查语法：

```bash
sudo ln -s /etc/nginx/sites-available/ts3-monitor /etc/nginx/sites-enabled/ts3-monitor
sudo nginx -t
sudo systemctl reload nginx
```

`/ws` 是实时数据推送端点，必须保留 WebSocket 的 `Upgrade` 和 `Connection` 请求头。

## 9. 申请 HTTPS 证书

确认 DNS 已生效、80 端口已开放后，使用 Certbot 签发证书：

```bash
sudo snap install --classic certbot
sudo ln -s /snap/bin/certbot /usr/local/bin/certbot
sudo certbot --nginx -d example.com -d www.example.com
sudo certbot renew --dry-run
```

完成后访问：

```text
https://example.com
```

## 10. 部署验证清单

按顺序确认：

1. `curl http://127.0.0.1:4321/api/health` 返回 JSON，且 `ok` 为 `true`。
2. 浏览器访问 `http://example.com` 能被 Nginx 正确转发。
3. 浏览器访问 `https://example.com` 显示有效 HTTPS 证书。
4. 网站首页能加载实时数据；浏览器开发者工具中 `/ws` 连接正常。
5. 后台能够连接 TS3 ServerQuery；若失败，检查网站服务器到 TS3 服务器 TCP `10011` 的网络策略和账号密码。

## 11. 后续更新

### 方式一：一键脚本更新（推荐）

在项目根目录下直接运行：

```bash
cd /opt/ts3-monitor
bash update.sh
```

脚本会先检查 Git 工作区是否干净，再拉取快进更新，并按实际变更范围执行必要操作：

| 变更内容 | 脚本操作 |
|----------|----------|
| `backend/src/`、后端 TypeScript 配置 | 构建后端并重启 `ts3-monitor` |
| `frontend/src/`、`public/`、Vite 或前端 TypeScript 配置 | 构建前端，无需重启 PM2 |
| 对应项目的 `package.json` 或 `package-lock.json` | 对应项目运行 `npm ci`，再执行所需构建 |
| 仅 `.md` 文档或 `update.sh` | 不安装依赖、不构建、不重启 |

后端在生产模式直接托管 `frontend/dist`，所以前端构建完成后，下一次网页请求就会使用新文件，不需要重启 Node.js 服务。

需要强制安装两端依赖、构建两端并重启后端时，运行：

```bash
bash update.sh --full
```

`--full` 适合首次在已有代码目录中部署、构建产物丢失或需要排查部署状态时使用。

---

### 方式二：手动按需更新

```bash
cd /opt/ts3-monitor
git pull --ff-only

# 仅后端源码或后端依赖发生变更时执行
cd backend
# package.json 或 package-lock.json 变更时，先运行 npm ci
npm ci
npm run build
pm2 restart ts3-monitor --update-env

# 仅前端源码或前端依赖发生变更时执行
cd ../frontend
# package.json 或 package-lock.json 变更时，先运行 npm ci
npm ci
npm run build
```

只更新文档、部署脚本等不影响运行产物的文件时，拉取代码后无需执行构建或重启命令。

更新后再次检查：

```bash
pm2 logs ts3-monitor --lines 100
curl http://127.0.0.1:4321/api/health
```

## 12. 数据备份

需要备份以下内容：

```text
/opt/ts3-monitor/backend/.env
/opt/ts3-monitor/backend/data/
```

可使用以下命令创建一次备份：

```bash
sudo mkdir -p /var/backups/ts3-monitor
sudo tar -czf "/var/backups/ts3-monitor/ts3-monitor-$(date +%F).tar.gz" \
  /opt/ts3-monitor/backend/.env \
  /opt/ts3-monitor/backend/data
```

## 13. 可选：统一后台分站

若使用统一后台创建 `alpha.example.com` 之类的分站：

1. DNS 额外配置 `*.example.com` 的 A 记录，指向同一台服务器。
2. Nginx 的 `server_name` 需要包含根域名及通配符域名，并继续保留原始 `Host` 请求头。
3. HTTPS 证书需要同时覆盖 `example.com` 和 `*.example.com`；通配符证书通常需要 DNS 验证。
4. 在后台设置 `SITE_BASE_DOMAIN=example.com` 或保存统一分站根域名。

每个分站会拥有独立的 SQLite 数据库、TS3 配置、统计数据和后台密码。
