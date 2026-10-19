# dsh-phone-mirror

简体中文 | [English](README.en.md)

一个 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 插件：在右侧边栏镜像一台 Android 手机，并允许 AI 在对话里操作手机。

镜像基于官方 [scrcpy](https://github.com/Genymobile/scrcpy) server（仓库内自带 4.1），通过 `adb` 连接，浏览器端用 jmuxer + MSE 解码 H.264。

## 功能

- 右侧边栏实时投屏；入口在左侧边栏底部（设置按钮旁）的手机图标。
- 点击/拖动画面 = 触摸/滑动；工具栏提供返回、主页、最近任务、电源、唤醒、音量键。
- 文字输入，支持中文等非 ASCII 文本（通过 scrcpy 剪贴板粘贴）。
- 对话工具：截图、控件树、点击、滑动、按键、输入、打开应用/URL，以及双向文件传输。
- 每类能力三态权限（禁止 / 需确认 / 直接），带预设模式，配置持久化。
- 无构建步骤、无原生依赖、无云服务。

## 环境要求

- 带 Web UI 的 DeepSeek Harness（当前版本提供 `sidebarRightTabs` / `sidebarRight` 服务）。
- Node.js 20+（宿主半区）。
- Android 7+，开启「开发者选项 → USB 调试」，并在手机上允许这台电脑（`adb devices` 显示 `device`）。
- Android platform-tools 里的 `adb`。插件会检查 `ADB_PATH`、`ADB`、`ANDROID_HOME`、`ANDROID_SDK_ROOT`、常见 SDK 路径和 `PATH`。

scrcpy server 已包含在 `resources/` 中，不需要另外安装 scrcpy。

## 安装

本仓库是一个 DSH 插件 bundle。克隆后，在 DSH 的插件面板里选择「从本地路径安装 bundle」，选中 `dsh-phone-mirror` 目录即可。

安装后刷新一次 Web UI，让浏览器半区加载。手机图标会出现在左侧边栏底部、设置按钮旁边。

## 使用

1. 用数据线连接手机，开启 USB 调试，并在手机上允许这台电脑。
2. 点左侧边栏底部的手机图标。
3. 右侧打开「手机镜像」标签页，首帧可能需要几秒。
4. 可以直接在面板里操作，也可以在对话里让 AI 操作。

| 面板操作 | 方式 |
|---|---|
| 点击 / 滑动 | 在画面上点击或拖动 |
| 返回 / 主页 / 最近任务 / 电源 / 唤醒 | 工具栏按钮 |
| 音量 | 工具栏按钮 |
| 文字 | 在输入框输入后按 Enter |
| 暂停 / 继续 | 暂停按钮 |
| 重连 / 停止 | 面板按钮 |

### 对话工具

| 工具 | 作用 |
|---|---|
| `phone_devices` | 列出设备、授权状态、投屏状态和当前权限 |
| `phone_screenshot` | 截图保存到 `<workspace>/phone-files/`，返回路径 |
| `phone_ui` | 读取控件树（文字、bounds、中心点、可点击） |
| `phone_tap` | 按像素 `x`/`y` 或比例 `fx`/`fy` 点击/长按 |
| `phone_swipe` | 两点之间滑动 |
| `phone_key` | 返回、主页、最近任务、电源、唤醒、音量、回车 |
| `phone_text` | 向已聚焦输入框输入文字（非 ASCII 走剪贴板） |
| `phone_open` | 打开应用包名或 URL |
| `phone_ls` | 列手机目录 |
| `phone_pull` | 手机 → 电脑 |
| `phone_push` | 电脑 → 手机 |

`phone_pull` 默认保存到 `<workspace>/phone-files/`，`phone_push` 默认传到 `/sdcard/Download/`。单文件默认上限 300 MB，可用 `force: true` 放开。

## 权限

打开镜像面板，点底栏的盾牌图标。

模式：

- **完全控制**：全部直接执行。
- **仅投屏**：只允许查看屏幕，控制、按键、输入、文件全部禁止。
- **需确认**：查看允许，其余每次走 DSH 审批弹窗。
- **自定义**：逐项设置。

五类能力：**查看屏幕 / 控制 / 按键 / 输入 / 文件**，每类三态：**禁止 / 需确认 / 直接**。

权限只约束对话里的 AI 工具；面板里手动点击、按键、输入不受影响。配置保存在 `$DSH_HOME/dsh-phone-mirror.json`（或 `~/.dsh/dsh-phone-mirror.json`），重启和插件重载后继续生效。默认是「需确认」。

## 配置

| 环境变量 | 默认 | 说明 |
|---|---|---|
| `ADB_PATH` | 自动查找 | adb 可执行文件 |
| `DSH_PHONE_SERIAL` | 第一台在线设备 | 工具未传 `serial` 时使用 |
| `PHONE_MIRROR_MAX_SIZE` | `720` | 编码画面长边像素上限 |
| `PHONE_MIRROR_MAX_FPS` | `30` | 最高帧率 |
| `PHONE_MIRROR_BIT_RATE` | `4000000` | 视频码率 |

如果 `adb` 不在 `PATH`，可以设置 `ADB_PATH`，或在权限配置 JSON 里加
`"adbPath": "/path/to/adb"`（例如 `"adbPath": "/opt/android/platform-tools/adb"`）。
面板设置不编辑这个字段。

## 实现

```
index.js        宿主：adb/scrcpy 生命周期、H.264 解析、本机 WebSocket、
                控制消息、工具、权限
client.js       浏览器：右侧标签页、jmuxer/MSE 画面、触摸/按键/文字工具栏、权限设置
resources/      scrcpy-server 4.1 与 jmuxer
locale/         插件元数据与面板文案
```

- 视频：scrcpy `tunnel_forward=true`、`max_size`、`max_fps`，通过 `adb forward` 隧道连接 video/control 两路 TCP。
- 宿主通过本机 WebSocket 向浏览器发送裸 H.264 包；文本消息传尺寸、状态和命令。
- 浏览器用 jmuxer/MSE 解码，并把指针位置映射到编码帧坐标。
- 输入走 scrcpy control socket；ASCII 用 `INJECT_TEXT`，非 ASCII 用 `SET_CLIPBOARD` 加粘贴（会覆盖手机剪贴板）。
- 文件传输走 `adb push` / `adb pull`。
- 宿主 WebSocket 只绑定 `127.0.0.1`，并校验浏览器的 `Origin`/`Host`。

## 安全与隐私

插件可以控制手机、复制文件，因此默认只在本机工作：

- 没有云调用、统计或远程端点。
- 投屏 socket 只绑定回环地址，拒绝非回环来源。
- 权限设置只约束 AI 工具；不想让 AI 操作时选「仅投屏」或「禁止」。
- 文件路径默认相对当前会话工作区；显式传输可使用绝对路径。
- 非 ASCII 文本注入会写入手机剪贴板。

安全问题请按 [SECURITY.md](SECURITY.md) 私下报告。

## 开发

没有构建步骤，直接改 `index.js` / `client.js`，然后重载 bundle。

```bash
npm run check
```

浏览器半区是 `window.__ModuleLoader__` 工厂；宿主半区是导出 `inject` 和 `apply` 的 ESM 插件。

## 已知限制

- 一次只镜像一台设备（多设备可用 `serial`）。
- 只有画面；没有声音、双向剪贴板同步和滚轮滚动。
- 文字输入要求手机上已有输入框聚焦。
- 密码框/安全输入框可能禁止剪贴板粘贴。
- 「需确认」依赖当前 DSH 会话的审批策略。
- 与 DeepSeek、Genymobile/scrcpy 无隶属关系。

## 许可证

MIT，见 [LICENSE](LICENSE)。随包分发的第三方组件与许可证见
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 和 [LICENSES/](LICENSES/)。
