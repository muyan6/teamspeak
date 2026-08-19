# 功能任务协作约定

本项目采用按功能纵切的并行协作方式。每个功能任务可同时修改该功能需要的前端、后端与测试，但不得直接修改公共整合文件。

## 工作目录

| 功能 | 分支 | Worktree |
| --- | --- | --- |
| 首页监控与实时数据 | `feature/home-monitor` | `.worktrees/home-monitor` |
| 个人数据查询 | `feature/profile` | `.worktrees/profile` |
| 弹性频道 | `feature/elastic-channels` | `.worktrees/elastic-channels` |
| 周冠军 | `feature/weekly-champion` | `.worktrees/weekly-champion` |
| TS3 后台管理 | `feature/ts3-admin` | `.worktrees/ts3-admin` |
| 站点配置与教程 | `feature/site-config` | `.worktrees/site-config` |
| 整合与发布 | `main` | 项目根目录 |

## 功能范围

### 首页监控与实时数据

- 在线人数、实时名单、榜单、趋势图与 WebSocket 刷新。
- 建议新增：`frontend/src/features/home-monitor/`、`backend/src/features/home-monitor/`。

### 个人数据查询

- 昵称搜索、UID 选择、在线时长、连续在线、常去频道与好友数据。
- 建议新增：`frontend/src/features/profile/`、`backend/src/features/profile/`。

### 弹性频道

- 弹性频道组配置、自动扩容/收缩和频道权限保护。
- 建议新增：`frontend/src/features/elastic-channels/`、`backend/src/features/elastic-channels/`。

### 周冠军

- 奖励服务器组配置、定时检测、冠军切换与历史展示。
- 建议新增：`frontend/src/features/weekly-champion/`、`backend/src/features/weekly-champion/`。

### TS3 后台管理

- 频道、在线用户、封禁、移动用户、服务器组和频道组管理。
- 建议新增：`frontend/src/features/ts3-admin/`、`backend/src/features/ts3-admin/`。

### 站点配置与教程

- 下载链接、教程内容、站点资料和展示配置。
- 建议新增：`frontend/src/features/site-config/`、`backend/src/features/site-config/`。

## 公共文件：仅整合任务修改

- `backend/src/api/router.ts`
- `backend/src/index.ts`
- `frontend/src/App.vue`
- `frontend/src/api.ts`
- `frontend/src/types.ts`
- `frontend/src/components/AdminModal.vue`
- 两端的 `package.json` 与锁文件

功能任务需要接入公共文件时，应在提交说明中给出所需的路由、类型、组件挂载或依赖变更；由 `main` 工作目录统一接入。

## 每个功能任务的完成标准

1. 只在自己的 worktree 中工作。
2. 将新代码放入对应的 `features/<功能名>` 目录，并补充该功能的测试。
3. 不直接编辑公共文件；只记录整合所需的最小变更。
4. 运行相关测试与构建后提交到自己的功能分支。
5. 在提交信息中说明：功能目标、接口契约、测试命令、整合要求。

## 整合顺序

1. 首页监控与实时数据
2. 个人数据查询
3. 弹性频道
4. 周冠军
5. TS3 后台管理
6. 站点配置与教程

每合并一个功能分支，都要运行后端测试、前端构建和浏览器回归；发生冲突时，保持功能分支的业务实现，将公共入口修改收敛在 `main`。
