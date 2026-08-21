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
  adminQq: string;
  adminSteam: string;
  globalServer: string;
  musicBotUrl: string;
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
  adminQq?: string;
  adminSteam?: string;
  musicBotUrl?: string;
}

export interface TutorialConfig {
  download?: string;
  basic?: string;
  advanced?: string;
  music?: string;
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

export function buildSiteData(
  config: AppConfig,
  serverName: string,
  download?: DownloadConfig,
  siteInfo?: SiteInfoConfig,
  musicBotUrl?: string
): SiteData {
  const host = config.publicServer.host;
  const port = config.publicServer.port;
  const defaultAddress = port === 9987 ? host : `${host}:${port}`;
  const address = safeText(siteInfo?.serverAddress) || defaultAddress;
  const adminContact = safeText(siteInfo?.adminQq) || safeText(siteInfo?.adminSteam) || config.site.adminQq || config.site.adminSteam;
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
    adminQq: adminContact,
    adminSteam: adminContact,
    globalServer: config.site.globalServer,
    musicBotUrl: safeText(siteInfo?.musicBotUrl) || safeText(musicBotUrl),
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

const MUSIC_TUTORIAL = `### 音乐机器人指令
双击机器人，目前有以下指令（把[xxx]替换成对应信息，不要带上中括号，前面的英文感叹号也要输）

1. **立即播放音乐（默认网易云）**：\`!play [歌名]\`
2. **从网易云音乐搜索并播放**：\`!play -n [歌名]\`
3. **从 QQ 音乐搜索并播放**：\`!play -q [歌名]\`
4. **从酷狗音乐搜索并播放**：\`!play -k [歌名]\`
5. **搜索歌曲列表（挑选同名歌曲，可加 -n/-q/-k 切换音源）**：\`!search [歌名]\`
6. **播放上一次搜索结果中的指定序号歌曲**：\`!play #[序号]\`
7. **按歌曲 id 或链接精确播放**：\`!play id [歌曲id或链接]\`
8. **添加音乐到播放队列**：\`!add [歌名]\`
9. **暂停播放**：\`!pause\`
10. **恢复播放**：\`!resume\`
11. **播放列表中的下一首**：\`!next\`
12. **播放列表中的上一首**：\`!prev\`
13. **停止播放并清空队列**：\`!stop\`
14. **设置音量【0-100】**：\`!vol [音量]\`
15. **查看当前播放队列**：\`!queue\`
16. **从队列中删除指定位置的歌曲（位置从 1 开始）**：\`!remove [位置]\`
17. **播放模式选择【seq=顺序播放 loop=循环播放 random=随机播放 rloop=随机循环】**：\`!mode [模式]\`
18. **播放网易云歌单（支持歌单名或歌单ID）**：\`!playlist [歌单名或ID]\`
19. **从 QQ 音乐搜索并播放歌单**：\`!playlist -q [歌单名]\`
20. **播放专辑（支持专辑名或专辑ID）**：\`!album [专辑名或ID]\`
21. **按歌手循环播放（支持 -n/-q/-k）**：\`!artist [歌手名]\`
22. **网易云私人 FM（自动续播）**：\`!fm\`
23. **QQ 音乐雷达 / 猜你喜欢 FM（自动续播）**：\`!fm -q\`
24. **酷狗私人电台 FM（自动续播）**：\`!fm -k\`
25. **显示当前完整歌词**：\`!lyrics\`
26. **显示当前播放信息**：\`!now\`
27. **投票跳过当前歌曲**：\`!vote\`
28. **移动到指定频道**：\`!move [频道名]\`
29. **保存当前队列为清单**：\`!save [清单名称]\`
30. **加载已保存清单（加 -a 追加到队列末尾）**：\`!load [清单名称]\`
31. **列出所有已保存清单**：\`!queues\`
32. **显示帮助信息**：\`!help\`

### 歌单/歌曲 ID 示例
以下例子加粗的就是音乐或者歌单id：
https://music.163.com/#/my/m/music/playlist?id=**2139305008**`;

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
      { key: 'music', title: '音乐教程', content: safeText(tutorialOverride?.music) || MUSIC_TUTORIAL },
    ],
    updatedAt: formatTimestamp(updatedAtMs ?? Date.now()),
  };
}

function formatTimestamp(ms: number): string {
  const d = new Date(ms);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
