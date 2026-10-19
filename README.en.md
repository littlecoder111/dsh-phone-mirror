# dsh-phone-mirror

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

[简体中文](README.md) | English

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin that mirrors an Android phone in the right sidebar and lets the agent operate it from a conversation.

The mirror is built on the official [scrcpy](https://github.com/Genymobile/scrcpy) server (bundled, version 4.1) over `adb`; the browser decodes H.264 with jmuxer and MSE.

## Features

- Live screen mirror in a right-sidebar tab; open it from the phone icon at the bottom of the left sidebar.
- Touch and drag on the video for taps and swipes; toolbar keys for back, home, recents, power, wake and volume.
- Text input, including Chinese and other non-ASCII text (via a clipboard paste through scrcpy).
- Agent tools: screenshots, accessibility-tree reading, taps, swipes, keys, text, app/URL launching, and two-way file transfer.
- Three-state permissions per capability (block / ask / allow), with presets and a persisted settings file.
- No build step, no native addons, no cloud service. The browser half is plain JavaScript loaded by the DSH module loader.

## Requirements

- DeepSeek Harness with the Web UI and the `sidebarRightTabs` / `sidebarRight` services (current releases provide both).
- Node.js 20 or newer for the host half.
- Android 7+ with USB debugging enabled and the computer authorized on the phone (`adb devices` shows `device`).
- `adb` from Android platform-tools. The plugin checks `ADB_PATH`, `ADB`, `ANDROID_HOME`, `ANDROID_SDK_ROOT`, the standard SDK locations and `PATH`.

The scrcpy server is bundled under `resources/`; installing scrcpy separately is not required.

## Installation

This repository is a DSH plugin bundle. Clone it, then install the directory through DSH:

1. Open **Plugins** in DSH.
2. Choose the install-from-local-path / install-bundle action.
3. Select the cloned `dsh-phone-mirror` directory.

For profile tooling, the equivalent operation is installing this package directory as a bundle
(package name `dsh-phone-mirror`).

After installation, refresh the Web UI once so the client half loads. The phone icon appears at the
bottom of the left sidebar, next to Settings.

## Usage

1. Connect the phone by USB, enable **Developer options → USB debugging**, and allow the computer.
2. Click the phone icon at the bottom of the left sidebar.
3. The right sidebar opens a **Phone Mirror** tab. The first frame may take a few seconds.
4. Use the panel directly, or ask the agent in chat.

Panel actions (manual, public API):

| Action | How |
|---|---|
| Tap / swipe | Click or drag on the video |
| Back / home / recents / power / wake | Toolbar buttons |
| Volume | Toolbar buttons |
| Text | Type in the input row and press Enter |
| Pause / resume video | Pause button |
| Reconnect / stop | Panel buttons |

### Agent tools

| Tool | Purpose |
|---|---|
| `phone_devices` | List devices, authorization state, mirror state and permission mode |
| `phone_screenshot` | Save a PNG under `<workspace>/phone-files/` and return its path |
| `phone_ui` | Read accessibility nodes with text, bounds, centers and clickable flags |
| `phone_tap` | Tap or long-press by pixel `x`/`y` or normalized `fx`/`fy` |
| `phone_swipe` | Swipe between two points |
| `phone_key` | Press back, home, recents, power, wake, volume or enter |
| `phone_text` | Type into the focused input (non-ASCII uses clipboard paste) |
| `phone_open` | Launch an app package or open a URL |
| `phone_ls` | List a phone directory |
| `phone_pull` | Copy a phone file/directory to the computer |
| `phone_push` | Copy a computer file/directory to the phone |

`phone_pull` defaults to `<workspace>/phone-files/`; `phone_push` defaults to
`/sdcard/Download/`. Transfers are limited to 300 MB per file unless `force: true` is passed.

## Permissions

Open the mirrored panel and click the shield icon at the bottom.

Modes:

- **Full control** — everything runs immediately.
- **Mirror only** — only screen viewing is allowed; control, keys, text and files are blocked.
- **Ask each time** — screen viewing is allowed; the other capabilities ask through the DSH approval flow.
- **Custom** — set each capability independently.

Capabilities: **view screen**, **control**, **keys**, **input**, **files**. Each is one of
**block / ask / allow**.

Permissions apply to agent tools only; manual actions in the panel are not affected. Settings are
stored in `$DSH_HOME/dsh-phone-mirror.json` (or `~/.dsh/dsh-phone-mirror.json`) and survive restarts
and plugin reloads. The default is **ask each time**.

## Configuration

| Environment variable | Default | Purpose |
|---|---|---|
| `ADB_PATH` | auto-detected | adb executable |
| `DSH_PHONE_SERIAL` | first online device | Serial used by tools when `serial` is omitted |
| `PHONE_MIRROR_MAX_SIZE` | `720` | Long-edge pixel cap for the encoded video |
| `PHONE_MIRROR_MAX_FPS` | `30` | Encoder frame-rate cap |
| `PHONE_MIRROR_BIT_RATE` | `4000000` | Encoder bit rate |

If `adb` is not on `PATH`, set `ADB_PATH`, or add an `"adbPath"` field to the
permission config JSON (for example `"adbPath": "/opt/android/platform-tools/adb"`).
The panel settings do not edit that field.

## Architecture

```
index.js        Host half: adb/scrcpy lifecycle, H.264 packet parser,
                local WebSocket server, control messages, tools, permissions
client.js       Browser half: right-sidebar tab, jmuxer/MSE video,
                touch/key/text toolbar, permission settings
resources/      scrcpy-server 4.1 and jmuxer
locale/         plugin metadata and panel strings
```

- Video: scrcpy `tunnel_forward=true`, `max_size`, `max_fps`; the host connects the video and
  control TCP channels through an `adb forward` tunnel.
- The host serves the browser a raw H.264 stream over a loopback WebSocket. Binary messages are
  packets; JSON messages carry size, state and commands.
- The browser decodes with jmuxer/MSE and maps pointer positions onto the encoded frame.
- Input uses the scrcpy control socket. ASCII text uses `INJECT_TEXT`; non-ASCII text uses
  `SET_CLIPBOARD` with paste, which overwrites the phone clipboard.
- File transfer uses `adb push` / `adb pull`.
- The host binds its WebSocket to `127.0.0.1` and validates the browser `Origin`/`Host`.

## Security and privacy

This plugin can control a phone and copy files. It is intentionally local-only:

- No cloud calls, analytics or remote endpoints.
- The mirror socket binds loopback only and rejects non-loopback browser origins.
- The permission settings gate agent tools; use **Mirror only** or **block** when the agent should
  not control the device.
- File paths are resolved against the current session workspace by default. Absolute paths are
  accepted for explicit transfers.
- Non-ASCII text injection writes to the phone clipboard.

Report security issues privately as described in [SECURITY.md](SECURITY.md).

## Development

There is no build step. Edit `index.js` / `client.js` and reinstall or reload the bundle.

```bash
npm run check     # node --check for both halves
```

The client half is a `window.__ModuleLoader__` factory and is served by DSH's client-module route.
The host half is an ESM plugin exporting `inject` and `apply`.

To test against a device:

1. `adb devices` must list an authorized phone.
2. Install the bundle, refresh the UI, open the panel.
3. Call `phone_devices` from the agent, then `phone_screenshot` / `phone_ui`.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the contribution workflow.

## Limitations

- One device at a time per mirror session (choose a serial for multiple devices).
- Video only; no audio, clipboard synchronization or wheel scrolling.
- Text input requires a focused input on the phone.
- Some password/secure fields reject clipboard paste.
- The `ask` mode depends on the DSH approval policy of the current session.
- Not affiliated with DeepSeek or Genymobile/scrcpy.

## License

MIT. See [LICENSE](LICENSE). Bundled third-party components and their licenses are listed in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and [LICENSES/](LICENSES/).
