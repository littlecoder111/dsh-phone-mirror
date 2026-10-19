// Browser half of the phone-mirror bundle.
//
// Registers a right-sidebar tab (and a header button that opens it), then
// renders the scrcpy H.264 stream with jmuxer and sends touch/key/text
// commands back over the host's local WebSocket.

window.__ModuleLoader__.load({
  id: 'dsh-phone-mirror',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const RPC_PATH = '/phone-mirror/rpc'
    const JMUXER_PATH = '/phone-mirror/jmuxer.js'
    const TAB_KIND = 'phone-mirror'
    const PREFIX = 'pm'
    const PERMISSION_CATEGORIES = [
      { key: 'view', label: 'permView', desc: 'permViewDesc' },
      { key: 'control', label: 'permControl', desc: 'permControlDesc' },
      { key: 'key', label: 'permKey', desc: 'permKeyDesc' },
      { key: 'input', label: 'permInput', desc: 'permInputDesc' },
      { key: 'files', label: 'permFiles', desc: 'permFilesDesc' },
    ]
    const PERMISSION_MODES = [
      { key: 'full', label: 'modeFull' },
      { key: 'mirror', label: 'modeMirror' },
      { key: 'confirm', label: 'modeConfirm' },
      { key: 'custom', label: 'modeCustom' },
    ]
    const PERMISSION_PRESETS = {
      full: { view: 'allow', control: 'allow', key: 'allow', input: 'allow', files: 'allow' },
      mirror: { view: 'allow', control: 'deny', key: 'deny', input: 'deny', files: 'deny' },
      confirm: { view: 'allow', control: 'ask', key: 'ask', input: 'ask', files: 'ask' },
    }
    const DEFAULT_PERMISSIONS = { ...PERMISSION_PRESETS.confirm }
    const PERMISSION_LEVELS = [
      { key: 'deny', label: 'levelDeny' },
      { key: 'ask', label: 'levelAsk' },
      { key: 'allow', label: 'levelAllow' },
    ]

    const ZH = {
      title: '手机镜像',
      open: '打开手机镜像',
      starting: '正在启动投屏…',
      connecting: '正在连接手机…',
      ready: '已连接',
      stopped: '投屏已停止',
      disconnected: '连接已断开',
      reconnect: '重新连接',
      stop: '停止投屏',
      back: '返回',
      home: '主页',
      recents: '最近任务',
      power: '电源键',
      wake: '唤醒屏幕',
      volumeUp: '音量 +',
      volumeDown: '音量 -',
      textPlaceholder: '输入要发送到手机的文字',
      send: '发送',
      loading: '正在加载解码器…',
      hint: '点击画面 = 触摸，拖动 = 滑动',
      noDevice: '没有找到已授权的 Android 设备。请用数据线连接手机，打开「开发者选项 → USB 调试」，并在手机上允许这台电脑。',
      unauthorized: '手机还没有授权这台电脑。请在手机弹窗里点「允许」，或重新插拔数据线。',
      adbMissing: '没有找到 adb。请安装 Android 平台工具，或设置 ADB_PATH 环境变量。',
      startFailed: '启动投屏失败',
      error: '出错了',
      retry: '重试',
      pause: '暂停画面',
      resume: '继续画面',
      paused: '已暂停',
      fps: 'fps',
      frame: '画面',
      device: '设备',
      permissions: '权限设置',
      modeLabel: '控制模式',
      modeFull: '完全控制',
      modeMirror: '仅投屏',
      modeConfirm: '需确认',
      modeCustom: '自定义',
      permView: '查看屏幕',
      permViewDesc: '截图、读取控件树',
      permControl: '控制',
      permControlDesc: '点击、滑动、打开应用',
      permKey: '按键',
      permKeyDesc: '返回、主页、音量、电源',
      permInput: '输入',
      permInputDesc: '文字输入（中文走剪贴板）',
      permFiles: '文件',
      permFilesDesc: '列目录、收发文件',
      levelDeny: '禁止',
      levelAsk: '需确认',
      levelAllow: '直接',
      saving: '保存中…',
      saved: '已保存',
      saveFailed: '保存失败',
      loadingSettings: '正在读取设置…',
      permNote: '只约束对话里的 AI 工具；你在面板里手动点击、按键、输入不受影响。配置会保存到磁盘，下次打开继续生效。',
    }
    const EN = {
      title: 'Phone Mirror',
      open: 'Open phone mirror',
      starting: 'Starting mirror…',
      connecting: 'Connecting to phone…',
      ready: 'Connected',
      stopped: 'Mirror stopped',
      disconnected: 'Disconnected',
      reconnect: 'Reconnect',
      stop: 'Stop mirror',
      back: 'Back',
      home: 'Home',
      recents: 'Recents',
      power: 'Power',
      wake: 'Wake screen',
      volumeUp: 'Volume +',
      volumeDown: 'Volume -',
      textPlaceholder: 'Text to send to the phone',
      send: 'Send',
      loading: 'Loading decoder…',
      hint: 'Click to tap, drag to swipe',
      noDevice: 'No authorized Android device found. Connect it by USB, enable Developer options → USB debugging, and allow this computer on the phone.',
      unauthorized: 'The phone has not authorized this computer yet. Tap Allow on the phone, or reconnect the cable.',
      adbMissing: 'adb was not found. Install Android platform-tools or set the ADB_PATH environment variable.',
      startFailed: 'Could not start the mirror',
      error: 'Something went wrong',
      retry: 'Retry',
      pause: 'Pause video',
      resume: 'Resume video',
      paused: 'Paused',
      fps: 'fps',
      frame: 'Frame',
      device: 'Device',
      permissions: 'Permissions',
      modeLabel: 'Control mode',
      modeFull: 'Full control',
      modeMirror: 'Mirror only',
      modeConfirm: 'Ask each time',
      modeCustom: 'Custom',
      permView: 'View screen',
      permViewDesc: 'Screenshots and UI tree',
      permControl: 'Control',
      permControlDesc: 'Taps, swipes, launching apps',
      permKey: 'Keys',
      permKeyDesc: 'Back, home, volume, power',
      permInput: 'Input',
      permInputDesc: 'Text input (non-ASCII uses clipboard)',
      permFiles: 'Files',
      permFilesDesc: 'List, push, pull files',
      levelDeny: 'Block',
      levelAsk: 'Ask',
      levelAllow: 'Allow',
      saving: 'Saving…',
      saved: 'Saved',
      saveFailed: 'Save failed',
      loadingSettings: 'Loading settings…',
      permNote: 'These permissions gate the AI tools only; manual taps, keys and input in this panel are not affected. Settings are saved to disk and reused next time.',
    }

    function detectLanguage() {
      try {
        const locale = navigator.language || ''
        if (String(locale).toLowerCase().startsWith('zh')) return 'zh'
      } catch {}
      return 'en'
    }
    let language = detectLanguage()
    function T(key) {
      const dict = language === 'zh' ? ZH : EN
      return Object.prototype.hasOwnProperty.call(dict, key) ? dict[key] : key
    }

    const CSS = `
.${PREFIX}-root{display:flex;flex-direction:column;height:100%;min-height:380px;min-width:0;position:relative;color:var(--dsw-alias-label-primary,inherit);font-size:13px;line-height:1.45}
.${PREFIX}-status{display:flex;align-items:center;gap:8px;padding:10px 12px 8px;border-bottom:.5px solid var(--dsw-alias-border-l1,rgba(128,128,128,.18));flex:none}
.${PREFIX}-dot{width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-state-idle-primary,#999);flex:none}
.${PREFIX}-dot[data-live="true"]{background:var(--dsw-alias-state-success-primary,#2e9e5b)}
.${PREFIX}-dot[data-error="true"]{background:var(--dsw-alias-state-error-primary,#d33)}
.${PREFIX}-name{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.${PREFIX}-meta{margin-left:auto;color:var(--dsw-alias-label-secondary,inherit);white-space:nowrap;font-size:12px;flex:none}
.${PREFIX}-videoWrap{position:relative;flex:1;min-height:240px;background:#05070a;display:flex;align-items:center;justify-content:center;overflow:hidden}
.${PREFIX}-video{display:block;width:100%;height:100%;object-fit:contain;touch-action:none;-webkit-user-select:none;user-select:none;background:#05070a}
.${PREFIX}-overlay{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:18px;text-align:center;color:#d8e4f0;background:rgba(5,7,10,.72)}
.${PREFIX}-overlayText{max-width:280px;font-size:12.5px;line-height:1.6;color:#c9d8e8}
.${PREFIX}-overlayTitle{font-weight:600;font-size:14px;color:#fff}
.${PREFIX}-spinner{width:18px;height:18px;border-radius:50%;border:2px solid rgba(255,255,255,.25);border-top-color:#7cb8ef;animation:${PREFIX}-spin .8s linear infinite}
@keyframes ${PREFIX}-spin{to{transform:rotate(360deg)}}
.${PREFIX}-toolbar{flex:none;display:flex;flex-direction:column;gap:6px;padding:8px 10px 10px;border-top:.5px solid var(--dsw-alias-border-l1,rgba(128,128,128,.18))}
.${PREFIX}-row{display:flex;align-items:center;gap:6px}
.${PREFIX}-btn{display:inline-flex;align-items:center;justify-content:center;gap:5px;min-width:30px;height:30px;padding:0 8px;border-radius:8px;border:.5px solid var(--dsw-alias-border-l1,rgba(128,128,128,.22));background:transparent;color:var(--dsw-alias-label-primary,inherit);cursor:pointer;font:inherit;font-size:12px;flex:none}
.${PREFIX}-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.12))}
.${PREFIX}-btn:disabled{opacity:.45;cursor:default}
.${PREFIX}-btn[data-danger="true"]{color:var(--dsw-alias-state-error-primary,#d33)}
.${PREFIX}-btn[data-active="true"]{background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.14));border-color:var(--dsw-alias-border-l2,rgba(128,128,128,.4))}
.${PREFIX}-input{flex:1;height:30px;min-width:0;border-radius:8px;border:.5px solid var(--dsw-alias-border-l1,rgba(128,128,128,.28));background:var(--dsw-alias-bg-layer-1,transparent);color:var(--dsw-alias-label-primary,inherit);padding:0 9px;font:inherit;font-size:12.5px;outline:none}
.${PREFIX}-input:focus{border-color:var(--dsw-alias-brand-primary,#247bbf)}
.${PREFIX}-hint{color:var(--dsw-alias-label-secondary,inherit);font-size:11.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.${PREFIX}-footWrap{width:100%}
.${PREFIX}-footWrap.rail{display:flex;justify-content:center}
.${PREFIX}-footBtn{box-sizing:border-box;display:flex;align-items:center;gap:8px;width:calc(100% + 4px);height:42px;margin:4px -2px;padding:0 10px 0 8px;border:0;border-radius:12px;background:transparent;color:var(--dsw-alias-label-primary,inherit);font:inherit;font-size:14px;line-height:22px;cursor:pointer;overflow:hidden}
.${PREFIX}-footWrap.rail .${PREFIX}-footBtn{width:36px;height:36px;margin:8px 0 10px;padding:0;justify-content:center;border-radius:50%;gap:0}
.${PREFIX}-footBtn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.12))}
.${PREFIX}-footBtn svg{flex:none;width:16px;height:16px}
.${PREFIX}-footWrap.rail .${PREFIX}-footBtn svg{width:18px;height:18px}
.${PREFIX}-footLabel{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.${PREFIX}-title{display:inline-flex;align-items:center;gap:6px;min-width:0}
.${PREFIX}-titleText{font-size:12px;white-space:nowrap}
.${PREFIX}-settings{position:absolute;inset:0;z-index:10;background:var(--dsw-alias-bg-base,#fff);display:flex;flex-direction:column;gap:10px;padding:12px;overflow:auto}
.${PREFIX}-settingsHead{display:flex;align-items:center;gap:8px;flex:none}
.${PREFIX}-settingsTitle{flex:1;font-weight:600;font-size:13px}
.${PREFIX}-settingsStatus{font-size:11px;color:var(--dsw-alias-label-secondary,inherit);white-space:nowrap}
.${PREFIX}-settingsStatus[data-error="true"]{color:var(--dsw-alias-state-error-primary,#d33)}
.${PREFIX}-section{display:flex;flex-direction:column;gap:6px;flex:none}
.${PREFIX}-sectionLabel{font-size:11px;color:var(--dsw-alias-label-secondary,inherit);letter-spacing:.04em}
.${PREFIX}-seg{display:flex;flex-wrap:wrap;gap:4px}
.${PREFIX}-segBtn{flex:1 1 0;min-width:62px;height:30px;padding:0 8px;border-radius:8px;border:.5px solid var(--dsw-alias-border-l1,rgba(128,128,128,.28));background:transparent;color:inherit;font:inherit;font-size:12px;cursor:pointer}
.${PREFIX}-segBtn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.12))}
.${PREFIX}-segBtn[data-active="true"]{background:var(--dsw-alias-brand-primary,#247bbf);border-color:transparent;color:#fff}
.${PREFIX}-perm{padding:8px 0;border-bottom:.5px solid var(--dsw-alias-border-l1,rgba(128,128,128,.18));display:flex;flex-direction:column;gap:6px}
.${PREFIX}-perm:last-of-type{border-bottom:0}
.${PREFIX}-permHead{display:flex;align-items:baseline;gap:6px;flex-wrap:wrap}
.${PREFIX}-permLabel{font-weight:600;font-size:12.5px}
.${PREFIX}-permDesc{font-size:11px;color:var(--dsw-alias-label-secondary,inherit)}
.${PREFIX}-permLevels{display:flex;gap:4px}
.${PREFIX}-permBtn{flex:1 1 0;height:28px;border-radius:7px;border:.5px solid var(--dsw-alias-border-l1,rgba(128,128,128,.28));background:transparent;color:inherit;font:inherit;font-size:11.5px;cursor:pointer}
.${PREFIX}-permBtn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.12))}
.${PREFIX}-permBtn[data-active="true"]{background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.16));border-color:var(--dsw-alias-border-l2,rgba(128,128,128,.45));font-weight:600}
.${PREFIX}-permBtn[data-level="deny"][data-active="true"]{color:var(--dsw-alias-state-error-primary,#d33)}
.${PREFIX}-note{font-size:11px;line-height:1.55;color:var(--dsw-alias-label-secondary,inherit);flex:none}
`

    function own(ctx, register, label) {
      try {
        if (typeof ctx.effect === 'function') return ctx.effect(register, label)
        return register()
      } catch (error) {
        console.error('[phone-mirror]', label || 'registration failed', error)
        return undefined
      }
    }

    async function rpc(method, args) {
      let response
      try {
        response = await fetch(RPC_PATH, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ method, args: args || {} }),
        })
      } catch (error) {
        const failure = new Error('network error')
        failure.code = 'NETWORK'
        throw failure
      }
      if (response.status === 401) {
        const failure = new Error('authentication required')
        failure.code = 'AUTH'
        throw failure
      }
      const payload = await response.json().catch(() => ({}))
      if (!payload || payload.ok !== true) {
        const failure = new Error(payload.error || 'RPC ' + method + ' failed')
        failure.code = payload.code || 'RPC'
        throw failure
      }
      return payload.result
    }

    let jmuxerPromise = null
    function loadJmuxer() {
      if (typeof window !== 'undefined' && window.JMuxer) return Promise.resolve(window.JMuxer)
      if (jmuxerPromise) return jmuxerPromise
      jmuxerPromise = fetch(JMUXER_PATH, { credentials: 'same-origin' })
        .then((response) => {
          if (!response.ok) throw new Error('jmuxer HTTP ' + response.status)
          return response.text()
        })
        .then(async (source) => {
          // The shipped jmuxer is a UMD bundle; evaluating it installs window.JMuxer.
          try { (0, eval)(source) } catch (error) { console.warn('[phone-mirror] jmuxer eval failed', error) }
          if (!window.JMuxer) {
            // A strict CSP can reject eval but still allow a same-origin script.
            await new Promise((resolve, reject) => {
              const script = document.createElement('script')
              script.src = JMUXER_PATH
              script.onload = resolve
              script.onerror = () => reject(new Error('jmuxer script failed'))
              document.head.appendChild(script)
            })
          }
          if (!window.JMuxer) throw new Error('JMuxer global missing')
          return window.JMuxer
        })
        .catch((error) => {
          jmuxerPromise = null
          throw error
        })
      return jmuxerPromise
    }

    function PhoneIcon(props) {
      const size = (props && props.size) || 16
      return h('svg', { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
        h('rect', { x: 3.2, y: 1.4, width: 6.6, height: 13.2, rx: 1.7, stroke: 'currentColor', strokeWidth: 1.2 }),
        h('path', { d: 'M4.6 3.1h3.8', stroke: 'currentColor', strokeWidth: 1, strokeLinecap: 'round' }),
        h('rect', { x: 8.1, y: 6.1, width: 5.7, height: 7.2, rx: 1, stroke: 'currentColor', strokeWidth: 1.1 }),
        h('path', { d: 'M7.4 9.7h2.1M9 8.2l1.5 1.5L9 11.2', stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round', strokeLinejoin: 'round' }))
    }

    function Glyph(props) {
      const name = props.name
      const common = { width: 15, height: 15, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' }
      if (name === 'back') return h('svg', common, h('path', { d: 'M10.2 3.4 5.6 8l4.6 4.6', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' }))
      if (name === 'home') return h('svg', common, h('path', { d: 'M2.8 7.4 8 3l5.2 4.4V13a.8.8 0 0 1-.8.8H9.6V9.9H6.4v3.9H3.6a.8.8 0 0 1-.8-.8Z', stroke: 'currentColor', strokeWidth: 1.3, strokeLinejoin: 'round' }))
      if (name === 'recents') return h('svg', common, h('rect', { x: 5.4, y: 2.6, width: 8, height: 10.8, rx: 1.4, stroke: 'currentColor', strokeWidth: 1.2 }), h('path', { d: 'M2.6 5.1v8.3h6.2', stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round', strokeLinejoin: 'round' }))
      if (name === 'power') return h('svg', common, h('path', { d: 'M8 2.2v5.1', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' }), h('path', { d: 'M5 4.1a4.6 4.6 0 1 0 6 0', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round' }))
      if (name === 'volumeUp') return h('svg', common, h('path', { d: 'M2.8 6.1h2.1L7.6 3.8v8.4L4.9 9.9H2.8Z', stroke: 'currentColor', strokeWidth: 1.2, strokeLinejoin: 'round' }), h('path', { d: 'M10.2 6.2v3.6M8.4 8h3.6', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round' }))
      if (name === 'volumeDown') return h('svg', common, h('path', { d: 'M2.8 6.1h2.1L7.6 3.8v8.4L4.9 9.9H2.8Z', stroke: 'currentColor', strokeWidth: 1.2, strokeLinejoin: 'round' }), h('path', { d: 'M8.4 8h3.6', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round' }))
      if (name === 'wake') return h('svg', common, h('circle', { cx: 8, cy: 8, r: 3.1, stroke: 'currentColor', strokeWidth: 1.3 }), h('path', { d: 'M8 1.4v1.6M8 13v1.6M1.4 8h1.6M13 8h1.6M3.3 3.3l1.1 1.1M11.6 11.6l1.1 1.1M12.7 3.3l-1.1 1.1M4.4 11.6l-1.1 1.1', stroke: 'currentColor', strokeWidth: 1.1, strokeLinecap: 'round' }))
      if (name === 'shield') return h('svg', common,
        h('path', { d: 'M8 2.1 12.6 4v3.7c0 2.7-2 4.8-4.6 5.7-2.6-.9-4.6-3-4.6-5.7V4Z', stroke: 'currentColor', strokeWidth: 1.25, strokeLinejoin: 'round' }),
        h('path', { d: 'M6.1 8.1 7.4 9.4 10 6.7', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round' }))
      return h('svg', common)
    }

    function IconButton(props) {
      return h('button', {
        type: 'button',
        className: PREFIX + '-btn',
        title: props.label,
        'aria-label': props.label,
        disabled: !!props.disabled,
        'data-active': props.active ? 'true' : undefined,
        'data-danger': props.danger ? 'true' : undefined,
        onClick: props.onClick,
      }, props.children || h(Glyph, { name: props.glyph }))
    }

    function describeError(error) {
      const code = error && error.code
      if (code === 'ADB_NOT_FOUND') return T('adbMissing')
      if (code === 'NO_DEVICE') return T('noDevice')
      if (code === 'UNAUTHORIZED') return T('unauthorized')
      if (code === 'NETWORK' || code === 'AUTH') return T('disconnected')
      return (error && error.message) || T('startFailed')
    }

    function apply(ctx) {
      const slots = ctx.slots
      const tabs = ctx.get ? ctx.get('sidebarRightTabs') : undefined
      const sidebarRight = ctx.get ? ctx.get('sidebarRight') : undefined

      own(ctx, () => {
        const style = document.createElement('style')
        style.setAttribute('data-plugin', 'dsh-phone-mirror')
        style.textContent = CSS
        document.head.appendChild(style)
        return () => {
          try { style.remove() } catch {}
        }
      }, 'phone-mirror: styles')

      function openPanel() {
        try {
          if (!sidebarRight || typeof sidebarRight.openTab !== 'function') {
            console.warn('[phone-mirror] right sidebar service is unavailable')
            return
          }
          sidebarRight.openTab(TAB_KIND)
          if (typeof sidebarRight.isExpanded === 'function' && !sidebarRight.isExpanded()
            && typeof sidebarRight.toggleExpanded === 'function') {
            sidebarRight.toggleExpanded()
          }
        } catch (error) {
          console.warn('[phone-mirror] open tab failed', error)
        }
      }

      function SidebarFooterAction(props) {
        const wide = !!(props && props.wide)
        return h('div', { className: PREFIX + '-footWrap' + (wide ? '' : ' rail') },
          h('button', {
            type: 'button',
            className: PREFIX + '-footBtn',
            title: T('open'),
            'aria-label': T('open'),
            onClick: openPanel,
          },
            h(PhoneIcon, { size: 16 }),
            wide ? h('span', { className: PREFIX + '-footLabel' }, T('title')) : null))
      }

      function PanelTitle() {
        return h('span', { className: PREFIX + '-title' },
          h(PhoneIcon, { size: 14 }),
          h('span', { className: PREFIX + '-titleText' }, T('title')))
      }

      function Panel() {
        const videoRef = React.useRef(null)
        const wsRef = React.useRef(null)
        const muxerRef = React.useRef(null)
        const ctorRef = React.useRef(null)
        const frameRef = React.useRef({ w: 0, h: 0 })
        const draggingRef = React.useRef(false)
        const lastMoveRef = React.useRef(0)
        const framesRef = React.useRef(0)
        const saveSeqRef = React.useRef(0)
        const saveQueueRef = React.useRef(Promise.resolve())

        const [phase, setPhase] = React.useState('starting')
        const [errorText, setErrorText] = React.useState('')
        const [info, setInfo] = React.useState(null)
        const [size, setSize] = React.useState({ w: 0, h: 0 })
        const [fps, setFps] = React.useState(0)
        const [paused, setPaused] = React.useState(false)
        const [text, setText] = React.useState('')
        const [model, setModel] = React.useState('')
        const [settingsOpen, setSettingsOpen] = React.useState(false)
        const [permissionConfig, setPermissionConfig] = React.useState(null)
        const [permissionStatus, setPermissionStatus] = React.useState('')
        const [permissionError, setPermissionError] = React.useState('')

        React.useEffect(() => {
          let disposed = false
          let socket = null
          let muxer = null
          let fpsTimer = null

          function makeMuxer(fpsValue) {
            if (!ctorRef.current || !videoRef.current) return
            try { if (muxerRef.current) muxerRef.current.destroy() } catch {}
            try {
              muxer = new ctorRef.current({
                node: videoRef.current,
                mode: 'video',
                flushingTime: 0,
                fps: fpsValue > 0 ? fpsValue : 30,
                onError() {
                  try { if (muxerRef.current) muxerRef.current.reset() } catch {}
                },
              })
              muxerRef.current = muxer
              const video = videoRef.current
              if (video) {
                video.muted = true
                const attempt = video.play()
                if (attempt && typeof attempt.catch === 'function') attempt.catch(() => {})
              }
            } catch (error) {
              muxerRef.current = null
              setErrorText(String((error && error.message) || error))
              setPhase('error')
            }
          }

          function onSize(data) {
            const parts = String(data || '').split('x')
            if (parts.length !== 2) return
            const width = parseInt(parts[0], 10)
            const height = parseInt(parts[1], 10)
            if (!width || !height) return
            if (frameRef.current.w === width && frameRef.current.h === height) return
            frameRef.current = { w: width, h: height }
            setSize({ w: width, h: height })
            makeMuxer(30)
          }

          function send(message) {
            const active = wsRef.current
            if (!active || active.readyState !== 1) return false
            try { active.send(JSON.stringify(message)); return true } catch { return false }
          }

          function connectSocket(port) {
            const active = new WebSocket('ws://127.0.0.1:' + port + '/')
            active.binaryType = 'arraybuffer'
            wsRef.current = active
            const openTimer = window.setTimeout(() => {
              if (disposed || active.readyState === 1) return
              setErrorText(T('disconnected'))
              setPhase('disconnected')
              try { active.close() } catch {}
            }, 8000)
            active.onopen = () => {
              window.clearTimeout(openTimer)
              if (disposed) return
              setPhase('ready')
              setErrorText('')
              active.send(JSON.stringify({ type: 'size' }))
              active.send(JSON.stringify({ type: 'screen', mode: 'video' }))
            }
            active.onmessage = (event) => {
              if (disposed) return
              if (typeof event.data === 'string') {
                let message = null
                try { message = JSON.parse(event.data) } catch {}
                if (!message) return
                if (message.msg === 'size') onSize(message.data)
                else if (message.msg === 'hello' && message.model) setModel(String(message.model))
                else if (message.msg === 'log') {
                  if (String(message.data).toLowerCase().includes('error')) console.warn('[phone-mirror]', message.data)
                } else if (message.ok === false && message.error) {
                  setErrorText(String(message.error))
                }
                return
              }
              framesRef.current += 1
              const current = muxerRef.current
              if (!current) return
              try { current.feed({ video: new Uint8Array(event.data) }) } catch (error) {
                console.warn('[phone-mirror] feed failed', error)
              }
            }
            active.onclose = () => {
              if (disposed || wsRef.current !== active) return
              setPhase((current) => current === 'stopped' ? current : 'disconnected')
            }
            active.onerror = () => {
              if (!disposed) setPhase('disconnected')
            }
            socket = active
          }

          async function boot() {
            try {
              setPhase('starting')
              setErrorText('')
              const view = await rpc('start')
              if (disposed) return
              setInfo(view)
              setModel(view.model || view.serial || '')
              if (view.width && view.height) {
                frameRef.current = { w: view.width, h: view.height }
                setSize({ w: view.width, h: view.height })
              }
              const Ctor = await loadJmuxer()
              if (disposed) return
              ctorRef.current = Ctor
              makeMuxer(view.fps || 30)
              connectSocket(view.port)
            } catch (error) {
              if (disposed) return
              console.warn('[phone-mirror] start failed', error)
              setErrorText(describeError(error))
              setPhase('error')
            }
          }

          fpsTimer = window.setInterval(() => {
            setFps(framesRef.current)
            framesRef.current = 0
          }, 1000)

          boot()

          return () => {
            disposed = true
            if (fpsTimer) window.clearInterval(fpsTimer)
            try { if (socket) socket.close() } catch {}
            try { if (muxerRef.current) muxerRef.current.destroy() } catch {}
            muxerRef.current = null
            wsRef.current = null
          }
        }, [])

        const connected = phase === 'ready'
        const canControl = connected && !paused

        function sendCommand(message) {
          const socket = wsRef.current
          if (socket && socket.readyState === 1) {
            try { socket.send(JSON.stringify(message)); return true } catch {}
          }
          return false
        }

        function pressKey(name) {
          if (!sendCommand({ type: 'key', name })) {
            rpc('key', { name }).catch((error) => setErrorText(describeError(error)))
          }
        }

        function submitText() {
          const value = text.trim()
          if (!value) return
          if (!sendCommand({ type: 'text', text: value })) {
            rpc('text', { text: value }).catch((error) => setErrorText(describeError(error)))
          }
          setText('')
        }

        function togglePause() {
          const next = !paused
          sendCommand({ type: 'screen', mode: next ? 'pause' : 'resume' })
          setPaused(next)
        }

        function stopMirror() {
          setPhase('stopped')
          setPaused(false)
          const socket = wsRef.current
          wsRef.current = null
          try { if (socket) socket.close() } catch {}
          rpc('stop').catch(() => {})
        }

        async function openSettings() {
          setSettingsOpen(true)
          setPermissionError('')
          setPermissionStatus('')
          try {
            const config = await rpc('permissions:get')
            setPermissionConfig(config)
          } catch (error) {
            setPermissionError(String((error && error.message) || error))
          }
        }

        function closeSettings() {
          setSettingsOpen(false)
          setPermissionStatus('')
          setPermissionError('')
        }

        function persistPermissions(next) {
          const sequence = ++saveSeqRef.current
          setPermissionStatus('saving')
          setPermissionError('')
          saveQueueRef.current = saveQueueRef.current
            .catch(() => {})
            .then(() => rpc('permissions:set', next))
            .then((saved) => {
              if (sequence !== saveSeqRef.current) return
              setPermissionConfig(saved)
              setPermissionStatus('saved')
            })
            .catch((error) => {
              if (sequence !== saveSeqRef.current) return
              setPermissionStatus('error')
              setPermissionError(String((error && error.message) || error))
            })
        }

        function applyPermissionMode(mode) {
          const current = permissionConfig || { mode: 'confirm', permissions: DEFAULT_PERMISSIONS }
          const next = mode === 'custom'
            ? { mode: 'custom', permissions: { ...(current.permissions || DEFAULT_PERMISSIONS) } }
            : { mode, permissions: { ...PERMISSION_PRESETS[mode] } }
          setPermissionConfig(next)
          persistPermissions(next)
        }

        function setPermissionLevel(category, level) {
          const current = permissionConfig || { mode: 'custom', permissions: DEFAULT_PERMISSIONS }
          const next = {
            mode: 'custom',
            permissions: { ...(current.permissions || DEFAULT_PERMISSIONS), [category]: level },
          }
          setPermissionConfig(next)
          persistPermissions(next)
        }

        function retry() {
          setPhase('starting')
          setErrorText('')
          setPaused(false)
          const socket = wsRef.current
          wsRef.current = null
          if (socket) { try { socket.close() } catch {} }
          rpc('start').then((view) => {
            setInfo(view)
            setModel(view.model || view.serial || '')
            if (view.width && view.height) {
              frameRef.current = { w: view.width, h: view.height }
              setSize({ w: view.width, h: view.height })
            }
            connectAgain(view)
          }).catch((error) => {
            setErrorText(describeError(error))
            setPhase('error')
          })
        }

        function connectAgain(view) {
          loadJmuxer().then((Ctor) => {
            ctorRef.current = Ctor
            try { if (muxerRef.current) muxerRef.current.destroy() } catch {}
            muxerRef.current = null
            if (videoRef.current) {
              try {
                muxerRef.current = new Ctor({ node: videoRef.current, mode: 'video', flushingTime: 0, fps: view.fps || 30 })
                const video = videoRef.current
                video.muted = true
                const attempt = video.play()
                if (attempt && typeof attempt.catch === 'function') attempt.catch(() => {})
              } catch (error) {
                setErrorText(String((error && error.message) || error))
                setPhase('error')
                return
              }
            }
            const socket = new WebSocket('ws://127.0.0.1:' + view.port + '/')
            socket.binaryType = 'arraybuffer'
            wsRef.current = socket
            const openTimer = window.setTimeout(() => {
              if (wsRef.current !== socket || socket.readyState === 1) return
              setErrorText(T('disconnected'))
              setPhase('disconnected')
              try { socket.close() } catch {}
            }, 8000)
            socket.onopen = () => {
              window.clearTimeout(openTimer)
              setPhase('ready')
              setErrorText('')
              socket.send(JSON.stringify({ type: 'size' }))
              socket.send(JSON.stringify({ type: 'screen', mode: 'video' }))
            }
            socket.onmessage = (event) => {
              if (typeof event.data === 'string') {
                let message = null
                try { message = JSON.parse(event.data) } catch {}
                if (!message) return
                if (message.msg === 'size') {
                  const parts = String(message.data || '').split('x')
                  if (parts.length === 2) {
                    const w = parseInt(parts[0], 10)
                    const hh = parseInt(parts[1], 10)
                    if (w && hh) {
                      const changed = frameRef.current.w !== w || frameRef.current.h !== hh
                      frameRef.current = { w, h: hh }
                      setSize({ w, h: hh })
                      if (changed && videoRef.current) {
                        try { if (muxerRef.current) muxerRef.current.destroy() } catch {}
                        try {
                          muxerRef.current = new Ctor({ node: videoRef.current, mode: 'video', flushingTime: 0, fps: view.fps || 30 })
                        } catch {}
                      }
                    }
                  }
                }
                return
              }
              framesRef.current += 1
              const current = muxerRef.current
              if (current) { try { current.feed({ video: new Uint8Array(event.data) }) } catch {} }
            }
            socket.onclose = () => {
              if (wsRef.current !== socket) return
              setPhase((current) => current === 'stopped' ? current : 'disconnected')
            }
            socket.onerror = () => {
              if (wsRef.current === socket) setPhase('disconnected')
            }
          }).catch((error) => {
            setErrorText(String((error && error.message) || error))
            setPhase('error')
          })
        }

        function onPointerDown(event) {
          if (!canControl) return
          event.preventDefault()
          draggingRef.current = true
          try { event.currentTarget.setPointerCapture(event.pointerId) } catch {}
          mapTouch('down', event.clientX, event.clientY)
        }
        function onPointerMove(event) {
          if (!draggingRef.current || !canControl) return
          const now = Date.now()
          if (now - lastMoveRef.current < 16) return
          lastMoveRef.current = now
          mapTouch('move', event.clientX, event.clientY)
        }
        function onPointerUp(event) {
          if (!draggingRef.current) return
          draggingRef.current = false
          mapTouch('up', event.clientX, event.clientY)
        }
        function mapTouch(kind, clientX, clientY) {
          const { w, h } = frameRef.current
          const video = videoRef.current
          if (!w || !h || !video) return
          const rect = video.getBoundingClientRect()
          const scale = Math.min(rect.width / w, rect.height / h)
          const contentWidth = w * scale
          const contentHeight = h * scale
          const left = rect.left + (rect.width - contentWidth) / 2
          const top = rect.top + (rect.height - contentHeight) / 2
          const fx = (clientX - left) / contentWidth
          const fy = (clientY - top) / contentHeight
          if (fx < 0 || fx > 1 || fy < 0 || fy > 1) return
          sendCommand({ type: 'touch', event: kind, fx, fy })
        }

        const statusLabel = phase === 'ready' ? T('ready')
          : phase === 'error' ? T('error')
            : phase === 'disconnected' ? T('disconnected')
              : phase === 'stopped' ? T('stopped')
                : T('starting')

        const meta = []
        if (size.w && size.h) meta.push(size.w + '×' + size.h)
        if (connected) meta.push(fps + ' ' + T('fps'))

        function renderSettings() {
          const config = permissionConfig
          const statusText = permissionStatus === 'saving' ? T('saving')
            : permissionStatus === 'saved' ? T('saved')
              : permissionStatus === 'error' ? T('saveFailed')
                : ''
          return h('div', { className: PREFIX + '-settings' },
            h('div', { className: PREFIX + '-settingsHead' },
              h(IconButton, { glyph: 'back', label: T('back'), onClick: closeSettings }),
              h('span', { className: PREFIX + '-settingsTitle' }, T('permissions')),
              h('span', {
                className: PREFIX + '-settingsStatus',
                'data-error': permissionStatus === 'error' ? 'true' : undefined,
              }, statusText)),
            permissionError ? h('div', { className: PREFIX + '-note' }, permissionError) : null,
            !config
              ? h('div', { className: PREFIX + '-note' }, T('loadingSettings'))
              : h(React.Fragment, null,
                h('div', { className: PREFIX + '-section' },
                  h('span', { className: PREFIX + '-sectionLabel' }, T('modeLabel')),
                  h('div', { className: PREFIX + '-seg' },
                    PERMISSION_MODES.map((mode) => h('button', {
                      key: mode.key,
                      type: 'button',
                      className: PREFIX + '-segBtn',
                      'data-active': config.mode === mode.key ? 'true' : undefined,
                      onClick: () => applyPermissionMode(mode.key),
                    }, T(mode.label))))),
                PERMISSION_CATEGORIES.map((category) => h('div', {
                  key: category.key,
                  className: PREFIX + '-perm',
                },
                  h('div', { className: PREFIX + '-permHead' },
                    h('span', { className: PREFIX + '-permLabel' }, T(category.label)),
                    h('span', { className: PREFIX + '-permDesc' }, T(category.desc))),
                  h('div', { className: PREFIX + '-permLevels' },
                    PERMISSION_LEVELS.map((level) => h('button', {
                      key: level.key,
                      type: 'button',
                      className: PREFIX + '-permBtn',
                      'data-level': level.key,
                      'data-active': config.permissions && config.permissions[category.key] === level.key ? 'true' : undefined,
                      onClick: () => setPermissionLevel(category.key, level.key),
                    }, T(level.label)))))),
                h('div', { className: PREFIX + '-note' }, T('permNote'))))
        }

        return h('div', { className: PREFIX + '-root' },
          h('div', { className: PREFIX + '-status' },
            h('span', { className: PREFIX + '-dot', 'data-live': connected ? 'true' : undefined, 'data-error': phase === 'error' ? 'true' : undefined }),
            h('span', { className: PREFIX + '-name', title: model }, model || T('device')),
            h('span', { className: PREFIX + '-meta' }, meta.join(' · ') || statusLabel)),
          h('div', { className: PREFIX + '-videoWrap' },
            h('video', {
              ref: videoRef,
              className: PREFIX + '-video',
              muted: true,
              autoPlay: true,
              playsInline: true,
              onPointerDown,
              onPointerMove,
              onPointerUp,
              onPointerCancel: onPointerUp,
              onContextMenu: (event) => event.preventDefault(),
            }),
            phase === 'starting' || phase === 'connecting'
              ? h('div', { className: PREFIX + '-overlay' },
                h('div', { className: PREFIX + '-spinner' }),
                h('div', { className: PREFIX + '-overlayText' }, T('starting')))
              : null,
            phase === 'error'
              ? h('div', { className: PREFIX + '-overlay' },
                h('div', { className: PREFIX + '-overlayTitle' }, T('error')),
                h('div', { className: PREFIX + '-overlayText' }, errorText || T('startFailed')),
                h('button', { type: 'button', className: PREFIX + '-btn', onClick: retry }, T('retry')))
              : null,
            phase === 'disconnected'
              ? h('div', { className: PREFIX + '-overlay' },
                h('div', { className: PREFIX + '-overlayTitle' }, T('disconnected')),
                h('div', { className: PREFIX + '-overlayText' }, errorText || T('disconnected')),
                h('button', { type: 'button', className: PREFIX + '-btn', onClick: retry }, T('reconnect')))
              : null,
            phase === 'stopped'
              ? h('div', { className: PREFIX + '-overlay' },
                h('div', { className: PREFIX + '-overlayText' }, T('stopped')),
                h('button', { type: 'button', className: PREFIX + '-btn', onClick: retry }, T('reconnect')))
              : null,
            paused
              ? h('div', { className: PREFIX + '-overlay' },
                h('div', { className: PREFIX + '-overlayText' }, T('paused')),
                h('button', { type: 'button', className: PREFIX + '-btn', onClick: togglePause }, T('resume')))
              : null),
          h('div', { className: PREFIX + '-toolbar' },
            h('div', { className: PREFIX + '-row' },
              h(IconButton, { glyph: 'back', label: T('back'), disabled: !connected, onClick: () => pressKey('back') }),
              h(IconButton, { glyph: 'home', label: T('home'), disabled: !connected, onClick: () => pressKey('home') }),
              h(IconButton, { glyph: 'recents', label: T('recents'), disabled: !connected, onClick: () => pressKey('recents') }),
              h(IconButton, { glyph: 'wake', label: T('wake'), disabled: !connected, onClick: () => pressKey('wake') }),
              h(IconButton, { glyph: 'volumeDown', label: T('volumeDown'), disabled: !connected, onClick: () => pressKey('volumeDown') }),
              h(IconButton, { glyph: 'volumeUp', label: T('volumeUp'), disabled: !connected, onClick: () => pressKey('volumeUp') }),
              h(IconButton, { glyph: 'power', label: T('power'), danger: true, disabled: !connected, onClick: () => pressKey('power') })),
            h('div', { className: PREFIX + '-row' },
              h('input', {
                className: PREFIX + '-input',
                value: text,
                placeholder: T('textPlaceholder'),
                disabled: !connected,
                onChange: (event) => setText(event.target.value),
                onKeyDown: (event) => {
                  if (event.key === 'Enter') { event.preventDefault(); submitText() }
                },
              }),
              h('button', { type: 'button', className: PREFIX + '-btn', disabled: !connected || !text.trim(), onClick: submitText }, T('send'))),
            h('div', { className: PREFIX + '-row' },
              h(IconButton, { glyph: 'wake', label: paused ? T('resume') : T('pause'), disabled: !connected, active: paused, onClick: togglePause }),
              h('span', { className: PREFIX + '-hint' }, connected ? T('hint') : statusLabel),
              h('span', { style: { flex: 1 } }),
              h(IconButton, { glyph: 'shield', label: T('permissions'), onClick: openSettings }),
              h('button', { type: 'button', className: PREFIX + '-btn', disabled: phase === 'stopped', onClick: stopMirror }, T('stop')))),
          settingsOpen ? renderSettings() : null)
      }

      if (tabs) {
        own(ctx, () => tabs.register({
          id: TAB_KIND,
          kind: TAB_KIND,
          priority: 'extension',
          title: () => T('title'),
        }), 'phone-mirror: tab type')
      } else {
        console.warn('[phone-mirror] sidebarRightTabs service is unavailable')
      }

      own(ctx, () => slots.inject('sidebar.right.pane.tab', () => slots.register({
        name: 'sidebar.right.pane.tab',
        key: TAB_KIND,
      }, Panel)), 'phone-mirror: tab body')

      own(ctx, () => slots.inject('sidebar.right.pane.tab.title', () => slots.register({
        name: 'sidebar.right.pane.tab.title',
        key: TAB_KIND,
      }, PanelTitle)), 'phone-mirror: tab title')

      own(ctx, () => slots.inject('sidebar.footer.action', () => slots.register({
        name: 'sidebar.footer.action',
        id: 'phone-mirror',
        order: 9,
        label: () => T('title'),
      }, SidebarFooterAction)), 'phone-mirror: sidebar footer action')
    }

    return {
      inject: ['slots', 'sidebarRightTabs', 'sidebarRight'],
      apply,
    }
  },
})
