import type { AppConfig } from './config.js';

export interface SiteData {
  title: string;
  footerDescription: string;
  logo: string;
  serverName: string;
  serverAddress: string;
  connectUrl: string;
  clientDownload: string;
  mirrorDownload: string;
  translationDownload: string;
  adminName: string;
  adminSteam: string;
  globalServer: string;
}

export interface TutorialSection {
  key: string;
  title: string;
  content: string;
}

export interface TutorialData {
  enabled: boolean;
  title: string;
  sections: TutorialSection[];
  updatedAt: string;
}

export interface DownloadConfig {
  clientDownload?: string;
  mirrorDownload?: string;
  translationDownload?: string;
}

export interface SiteInfoConfig {
  title?: string;
  footerDescription?: string;
  serverName?: string;
  serverAddress?: string;
  adminName?: string;
  adminSteam?: string;
}

export interface TutorialConfig {
  download?: string;
  basic?: string;
  advanced?: string;
}

function safeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export const DOWNLOAD_LINKS = {
  clientDownload: 'https://files.teamspeak-services.com/releases/client/3.6.2/TeamSpeak3-Client-win64-3.6.2.exe',
  mirrorDownload: 'https://cloud.nanodesu.net/d/teamspeak/TeamSpeak3-Client-win64-3.6.2.exe',
  translationDownload:
    'https://cloud.nanodesu.net/d/teamspeak/%E6%B1%89%E5%8C%96%E6%96%87%E4%BB%B6.ts3_translation',
};

export function buildSiteData(config: AppConfig, serverName: string, download?: DownloadConfig, siteInfo?: SiteInfoConfig): SiteData {
  const host = config.publicServer.host;
  const port = config.publicServer.port;
  const defaultAddress = port === 9987 ? host : `${host}:${port}`;
  const address = safeText(siteInfo?.serverAddress) || defaultAddress;
  return {
    title: safeText(siteInfo?.title) || config.site.title,
    footerDescription: safeText(siteInfo?.footerDescription) || 'TeamSpeak3 语音服务器',
    logo: config.site.logo,
    serverName: safeText(siteInfo?.serverName) || config.site.serverName || serverName || 'TS3 语音服务器',
    serverAddress: address,
    connectUrl: `ts3server://${address}`,
    clientDownload: download?.clientDownload || DOWNLOAD_LINKS.clientDownload,
    mirrorDownload: download?.mirrorDownload || DOWNLOAD_LINKS.mirrorDownload,
    translationDownload: download?.translationDownload || DOWNLOAD_LINKS.translationDownload,
    adminName: safeText(siteInfo?.adminName) || config.site.adminName,
    adminSteam: safeText(siteInfo?.adminSteam) || config.site.adminSteam,
    globalServer: config.site.globalServer,
  };
}

const BASIC_TUTORIAL = `### 1. 打开设置
启动 TeamSpeak 3 后，点击顶部菜单栏的 **工具(T)**，在下拉菜单中选择 **设置(O)**（快捷键 \`Alt+P\`）。

![打开设置](/tutorial/basic1.png)

### 2. 配置输出设备
在设置窗口左侧点击 **音频输出**：
* **输出设备** 选择你正在使用的耳机或音箱。
* 点击 **播放测试音(T)** 检查是否有声音。
* 如需调节音量，可拖动 **语音音量调节** 滑块。

![音频输出](/tutorial/basic2.png)

### 3. 配置输入设备
在设置窗口左侧点击 **音频输入**：
* **音频输入设备** 选择你的麦克风。
* 激活方式推荐选择 **语音检测**，并根据环境拖动阈值滑块调节灵敏度。
* 建议勾选 **消除背景噪音** 和 **回声消除**，减少杂音。

![音频输入](/tutorial/basic3.png)

### 4. 保存设置
确认无误后点击 **OK** 保存并关闭设置窗口。`;

const ADVANCED_TUTORIAL = `### 1. 配置多服务器（书签）
1. 点击顶部菜单栏的 **书签(B)**，选择 **书签管理器(M)**（快捷键 \`Ctrl+B\`）。
2. 点击左下角 **新增书签**。
3. 在 **书签名** 填写服务器备注，**昵称** 填写你的名字。
4. 在 **服务器别名或地址** 中填入服务器地址（如 \`996\`）。
5. 点击 **OK** 保存，之后即可在书签列表中快速切换多个服务器。

![书签管理器](https://bee-reg-ab.imagency.cn/p/02271120232b56ceb0f37e75b13d931a.jpg)

### 2. 设置自动连接
1. 在书签管理器中选中要自动连接的服务器。
2. 勾选右侧的 **启动时连接此服务器**。
3. 点击 **OK** 保存，之后每次启动 TeamSpeak 3 都会自动连接该服务器。

![自动连接](https://bee-reg-ab.imagency.cn/p/8307045b654b6c51b6752743028fcdec.jpg)`;

export function buildTutorial(config: AppConfig, tutorialOverride?: TutorialConfig, updatedAtMs?: number, legacyGuide?: string): TutorialData {
  const host = config.publicServer.host;
  const port = config.publicServer.port;
  const address = port === 9987 ? host : `${host}:${port}`;

  const overrideDownload = safeText(tutorialOverride?.download);
  const legacyDownload = safeText(legacyGuide);
  const downloadContent = overrideDownload || legacyDownload
    ? (overrideDownload || legacyDownload)
    : `### 1. 下载安装包
首先下载安装程序：
[点击下载 TeamSpeak3-Client-win64-3.6.2.exe](${DOWNLOAD_LINKS.mirrorDownload})

### 2. 安装步骤
* 运行安装包后，一直点击 **Next** 进行安装。
* **注意：** 在下图所示界面中，请**不要勾选**任何选项，直接点击 **Install** 即可。

![安装注意事项](https://5pw.net/i/2026/03/31/17749517054fd72.png)

### 3. 首次启动
安装完成后打开软件。
* **无需注册：** 出现登录/注册界面时，直接点击右上角的 **“X” (叉叉)** 关闭。

![关闭注册界面](https://5pw.net/i/2026/03/31/17749520466d0f2.jpg)

### 4. 连接服务器
1. 在主界面按下快捷键 \`Ctrl + S\` 弹出连接框。
2. 按照以下信息填写：
   * **Server Address (服务器地址):** \`${address}\`
   * **Nickname (你的名字):** 输入你的昵称
3. 点击 **Connect** 按钮即可连接

![连接设置图](https://5pw.net/i/2026/03/31/17749521062ab4d.png)`;

  return {
    enabled: true,
    title: 'TeamSpeak 使用教程',
    sections: [
      { key: 'download', title: '下载教程', content: downloadContent },
      { key: 'basic', title: '基础教程', content: safeText(tutorialOverride?.basic) || BASIC_TUTORIAL },
      { key: 'advanced', title: '进阶教程', content: safeText(tutorialOverride?.advanced) || ADVANCED_TUTORIAL },
    ],
    updatedAt: formatTimestamp(updatedAtMs ?? Date.now()),
  };
}

function formatTimestamp(ms: number): string {
  const d = new Date(ms);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
