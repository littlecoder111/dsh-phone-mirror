// Host half of the phone-mirror bundle.
//
// Owns the scrcpy bridge for a USB-connected Android phone and exposes:
//   POST /phone-mirror/rpc      start/stop/status + touch/key/text commands
//   GET  /phone-mirror/jmuxer.js  decoder used by the client panel
//   ws://127.0.0.1:<port>/       raw H.264 packets + JSON control messages
//
// The video stream protocol is scrcpy's own: after the 4-byte codec id, every
// packet carries a 12-byte header whose first byte holds the session/config/key
// flags and whose last 4 bytes are the payload size. The payload is Annex-B
// H.264, which the client feeds to jmuxer. Only the subset needed by the panel
// is implemented; the server jar is the official scrcpy 4.1 server.

import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { connect, createServer as createTcpServer } from 'node:net'
import { existsSync, readFileSync, statSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname, basename, isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import os from 'node:os'

const PKG_ROOT = dirname(fileURLToPath(import.meta.url))
const RES = (name) => join(PKG_ROOT, 'resources', name)
const JAR_LOCAL = RES('scrcpy-server-v4.1')
const JAR_REMOTE = '/data/local/tmp/dsh-phone-mirror.jar'
const SERVER_VERSION = '4.1'
const RPC_PATH = '/phone-mirror/rpc'
const JMUXER_PATH = '/phone-mirror/jmuxer.js'
const MAX_GOP_BYTES = 16 * 1024 * 1024

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const log = (...args) => console.log('[phone-mirror]', ...args)
const warn = (...args) => console.warn('[phone-mirror]', ...args)

const CONFIG = {
  maxSize: Number(process.env.PHONE_MIRROR_MAX_SIZE) > 0 ? Number(process.env.PHONE_MIRROR_MAX_SIZE) : 720,
  maxFps: Number(process.env.PHONE_MIRROR_MAX_FPS) > 0 ? Number(process.env.PHONE_MIRROR_MAX_FPS) : 30,
  bitRate: Number(process.env.PHONE_MIRROR_BIT_RATE) > 0 ? Number(process.env.PHONE_MIRROR_BIT_RATE) : 4_000_000,
}

// ---------------------------------------------------------------------------
// persisted permission settings
// ---------------------------------------------------------------------------

const PHONE_CONFIG_DIR = process.env.DSH_HOME || join(os.homedir(), '.dsh')
const PHONE_CONFIG_FILE = join(PHONE_CONFIG_DIR, 'dsh-phone-mirror.json')
const PERMISSION_CATEGORIES = ['view', 'control', 'key', 'input', 'files']
const PERMISSION_LEVELS = ['deny', 'ask', 'allow']
const PERMISSION_PRESETS = {
  full: { view: 'allow', control: 'allow', key: 'allow', input: 'allow', files: 'allow' },
  mirror: { view: 'allow', control: 'deny', key: 'deny', input: 'deny', files: 'deny' },
  confirm: { view: 'allow', control: 'ask', key: 'ask', input: 'ask', files: 'ask' },
}
const DEFAULT_PERMISSION_CONFIG = { mode: 'confirm', permissions: { ...PERMISSION_PRESETS.confirm }, adbPath: '' }

function normalizePermissionConfig(input) {
  const value = input && typeof input === 'object' ? input : {}
  const adbPath = typeof value.adbPath === 'string' ? value.adbPath.trim() : ''
  const mode = value.mode === 'custom' || Object.prototype.hasOwnProperty.call(PERMISSION_PRESETS, value.mode)
    ? value.mode
    : 'confirm'
  if (mode !== 'custom') return { mode, permissions: { ...PERMISSION_PRESETS[mode] }, adbPath }
  const permissions = {}
  for (const category of PERMISSION_CATEGORIES) {
    const level = value.permissions && value.permissions[category]
    permissions[category] = PERMISSION_LEVELS.includes(level) ? level : DEFAULT_PERMISSION_CONFIG.permissions[category]
  }
  return { mode: 'custom', permissions, adbPath }
}

function readPermissionConfig() {
  try {
    return normalizePermissionConfig(JSON.parse(readFileSync(PHONE_CONFIG_FILE, 'utf8')))
  } catch {
    return normalizePermissionConfig(DEFAULT_PERMISSION_CONFIG)
  }
}

function savePermissionConfig(input) {
  const current = readPermissionConfig()
  const request = input && typeof input === 'object' ? input : {}
  const config = normalizePermissionConfig({
    mode: request.mode === undefined ? current.mode : request.mode,
    permissions: request.permissions === undefined ? current.permissions : request.permissions,
    adbPath: typeof request.adbPath === 'string' ? request.adbPath : current.adbPath,
  })
  try {
    mkdirSync(PHONE_CONFIG_DIR, { recursive: true })
    writeFileSync(PHONE_CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8')
    return config
  } catch (error) {
    throw codedError('PERMISSION_SAVE_FAILED', 'could not save permission settings: ' + String((error && error.message) || error))
  }
}

async function requirePhonePermission(ctx, exec, category, action) {
  const config = readPermissionConfig()
  const level = config.permissions[category] || 'ask'
  if (level === 'allow') return
  if (level === 'deny') {
    throw codedError('PHONE_PERMISSION_DENIED', 'Phone Mirror permission "' + category + '" is blocked; change it in the Phone Mirror panel → 权限设置')
  }
  const approval = ctx.get ? ctx.get('approval') : undefined
  if (!approval || typeof approval.request !== 'function') {
    throw codedError('PHONE_APPROVAL_UNAVAILABLE', 'the approval service is unavailable, so this action cannot be confirmed')
  }
  if (!exec || !exec.agent) {
    throw codedError('PHONE_APPROVAL_UNAVAILABLE', 'no agent context is available for this confirmation')
  }
  const outcome = await approval.request({
    agent: exec.agent,
    toolName: exec.name || 'phone',
    callId: exec.callId,
    reason: 'Phone Mirror: ' + action.en,
    displayReason: { en: 'Phone Mirror: ' + action.en, zh: '手机镜像：' + action.zh },
    signal: exec.signal,
  })
  if (outcome !== 'allowed-once') {
    throw codedError('PHONE_PERMISSION_' + String(outcome).toUpperCase(), 'Phone Mirror permission was not granted (' + outcome + ')')
  }
}

// ---------------------------------------------------------------------------
// adb discovery and process helpers
// ---------------------------------------------------------------------------

function adbCandidates() {
  const home = process.env.USERPROFILE || process.env.HOME || ''
  const executable = process.platform === 'win32' ? 'adb.exe' : 'adb'
  const candidates = [process.env.ADB_PATH, process.env.ADB]
  for (const root of [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT]) {
    if (root) candidates.push(join(root, 'platform-tools', executable))
  }
  if (process.env.LOCALAPPDATA) {
    candidates.push(join(process.env.LOCALAPPDATA, 'Android', 'Sdk', 'platform-tools', executable))
  }
  if (home) {
    candidates.push(join(home, 'AppData', 'Local', 'Android', 'Sdk', 'platform-tools', executable))
    candidates.push(join(home, 'Library', 'Android', 'sdk', 'platform-tools', executable))
    candidates.push(join(home, 'Android', 'Sdk', 'platform-tools', executable))
  }
  candidates.push('/usr/local/bin/adb', '/opt/homebrew/bin/adb', '/usr/bin/adb')
  return candidates.filter(Boolean)
}

let cachedAdb
function resolveAdb() {
  if (cachedAdb && (cachedAdb === 'adb' || cachedAdb === 'adb.exe' || existsSync(cachedAdb))) return cachedAdb
  const configured = readPermissionConfig().adbPath
  if (configured && existsSync(configured)) { cachedAdb = configured; return configured }
  for (const candidate of adbCandidates()) {
    if (candidate && existsSync(candidate)) { cachedAdb = candidate; return candidate }
  }
  if (process.platform === 'win32') {
    const probe = spawnSync('adb.exe', ['version'], { stdio: 'ignore', windowsHide: true })
    if (probe.status === 0) { cachedAdb = 'adb.exe'; return cachedAdb }
  }
  const probe = spawnSync('adb', ['version'], { stdio: 'ignore' })
  if (probe.status === 0) { cachedAdb = 'adb'; return cachedAdb }
  return null
}

function runAdb(adbPath, args, options = {}) {
  const { serial, timeout = 20_000, allowFail = false, signal } = options
  const argv = serial ? ['-s', serial, ...args] : args
  return new Promise((resolve, reject) => {
    let child
    try {
      child = spawn(adbPath, argv, { windowsHide: true })
    } catch (error) {
      return reject(error)
    }
    let settled = false
    const out = []
    const err = []
    const finish = (fn) => { if (settled) return; settled = true; clearTimeout(timer); if (signal) signal.removeEventListener('abort', onAbort); fn() }
    const timer = setTimeout(() => {
      try { child.kill() } catch {}
      finish(() => reject(new Error('adb ' + argv.join(' ') + ' timed out')))
    }, timeout)
    const onAbort = () => {
      try { child.kill() } catch {}
      finish(() => reject(new Error('adb ' + argv.join(' ') + ' aborted')))
    }
    if (signal) signal.addEventListener('abort', onAbort, { once: true })
    child.stdout.on('data', (chunk) => out.push(chunk))
    child.stderr.on('data', (chunk) => err.push(chunk))
    child.on('error', (error) => finish(() => reject(error)))
    child.on('close', (code) => {
      const result = {
        code,
        out: Buffer.concat(out),
        err: Buffer.concat(err).toString('utf8'),
      }
      if (code !== 0 && !allowFail) {
        finish(() => reject(new Error('adb ' + argv.join(' ') + ' failed: ' + (result.err || code))))
      } else {
        finish(() => resolve(result))
      }
    })
    if (signal && signal.aborted) onAbort()
  })
}

function parseDevices(text) {
  const devices = []
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('List of devices') || line.startsWith('*')) continue
    const parts = line.split(/\s+/)
    if (parts.length < 2) continue
    const serial = parts[0]
    const state = parts[1]
    const modelMatch = line.match(/\bmodel:([^\s]+)/)
    devices.push({ serial, state, model: modelMatch ? modelMatch[1] : '' })
  }
  return devices
}

async function listDevices(adbPath) {
  const result = await runAdb(adbPath, ['devices', '-l'], { allowFail: true })
  return parseDevices(result.out.toString('utf8'))
}

// ---------------------------------------------------------------------------
// stream session
// ---------------------------------------------------------------------------

let session = null
let starting = null

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createTcpServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port
      server.close(() => resolve(port))
    })
  })
}

function connectSocket(port) {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: '127.0.0.1', port }, () => resolve(socket))
    socket.on('error', reject)
  })
}

async function appProcessPids(adbPath, serial) {
  try {
    const result = await runAdb(adbPath, ['shell', 'pidof app_process'], { serial, allowFail: true })
    return result.out.toString('utf8').trim().split(/\s+/).filter(Boolean)
  } catch {
    return []
  }
}

function newSession(serial, adbPath, model) {
  return {
    serial,
    adb: adbPath,
    model,
    port: 0,
    wsPort: 0,
    ws: null,
    videoSock: null,
    controlSock: null,
    proc: null,
    ownedPids: [],
    ready: false,
    broadcasting: true,
    st: { codec: 0, width: 0, height: 0, buf: Buffer.alloc(0), frames: 0, bytes: 0 },
    gop: { config: null, frames: [], bytes: 0, overflow: false },
  }
}

function publicView(dev) {
  return {
    ok: true,
    port: dev.wsPort,
    serial: dev.serial,
    model: dev.model,
    width: dev.st.width,
    height: dev.st.height,
    fps: CONFIG.maxFps,
    maxSize: CONFIG.maxSize,
  }
}

async function startMirror(options = {}) {
  const requestedSerial = String(options.serial || process.env.DSH_PHONE_SERIAL || '').trim()
  if (session && session.ready) {
    if (!requestedSerial || session.serial === requestedSerial) return publicView(session)
    await stopMirror()
  }
  if (session) await stopMirror()
  if (starting) return starting

  starting = (async () => {
    const adbPath = resolveAdb()
    if (!adbPath) throw codedError('ADB_NOT_FOUND', 'adb not found')
    if (!existsSync(JAR_LOCAL)) throw codedError('JAR_MISSING', 'missing ' + JAR_LOCAL)

    const devices = await listDevices(adbPath)
    const wanted = requestedSerial
    let target = wanted ? devices.find((d) => d.serial === wanted) : null
    if (!target) target = devices.find((d) => d.state === 'device')
    if (!target) {
      const unauthorized = devices.find((d) => d.state === 'unauthorized')
      if (unauthorized) throw codedError('UNAUTHORIZED', authorizedMessage(unauthorized.serial))
      throw codedError('NO_DEVICE', 'no authorized Android device')
    }
    if (target.state !== 'device') {
      throw codedError(target.state === 'unauthorized' ? 'UNAUTHORIZED' : 'DEVICE_OFFLINE', target.state)
    }

    const dev = newSession(target.serial, adbPath, target.model || target.serial)
    session = dev
    try {
      const before = await appProcessPids(adbPath, target.serial)
      await runAdb(adbPath, ['push', JAR_LOCAL, JAR_REMOTE], { serial: target.serial, timeout: 60_000 })
      dev.port = await freePort()
      await runAdb(adbPath, ['forward', '--remove', 'tcp:' + dev.port], { serial: target.serial, allowFail: true })
      await runAdb(adbPath, ['forward', 'tcp:' + dev.port, 'localabstract:scrcpy'], { serial: target.serial })

      const opts = [
        'tunnel_forward=true',
        'audio=false',
        'control=true',
        'cleanup=false',
        'send_device_meta=false',
        'send_dummy_byte=false',
        'max_size=' + CONFIG.maxSize,
        'max_fps=' + CONFIG.maxFps,
        'video_bit_rate=' + CONFIG.bitRate,
      ]
      const cmd = 'CLASSPATH=' + JAR_REMOTE + ' app_process / com.genymobile.scrcpy.Server ' + SERVER_VERSION + ' ' + opts.join(' ')
      dev.proc = spawn(dev.adb, ['-s', target.serial, 'shell', cmd], { windowsHide: true })
      const onOut = (chunk) => {
        for (const line of String(chunk).split(/\r?\n/)) {
          const value = line.trim()
          if (!value) continue
          log(target.serial + ' [server] ' + value)
          for (const client of dev.ws ? dev.ws.clients : []) client.sendText(JSON.stringify({ msg: 'log', data: value }))
        }
      }
      dev.proc.stdout.on('data', onOut)
      dev.proc.stderr.on('data', onOut)
      dev.proc.on('exit', (code) => {
        log(target.serial + ' server exited (' + code + ')')
        dev.proc = null
        dev.ready = false
      })

      await waitForServer(dev, target.serial)
      const after = await appProcessPids(adbPath, target.serial)
      dev.ownedPids = after.filter((pid) => !before.includes(pid))

      dev.ws = createWsServer(dev)
      dev.wsPort = await dev.ws.listen()

      dev.videoSock = await connectSocket(dev.port)
      await sleep(250)
      dev.controlSock = await connectSocket(dev.port)
      dev.videoSock.on('data', (chunk) => onVideoData(dev, chunk))
      dev.videoSock.on('close', () => {
        warn('video socket closed')
        dev.ready = false
      })
      dev.videoSock.on('error', (error) => warn('video socket: ' + String(error && error.message)))
      dev.controlSock.on('error', (error) => warn('control socket: ' + String(error && error.message)))
      dev.controlSock.on('data', (chunk) => {
        const buf = Buffer.from(chunk)
        if (buf.length) log('device message type=' + buf[0])
      })

      await waitForSize(dev, 8_000)
      dev.ready = true
      log('ready serial=' + dev.serial + ' ws=' + dev.wsPort + ' size=' + dev.st.width + 'x' + dev.st.height)
      return publicView(dev)
    } catch (error) {
      await stopMirror()
      if (error && error.code) throw error
      throw codedError('START_FAILED', String((error && error.message) || error))
    } finally {
      starting = null
    }
  })()

  return starting
}

async function waitForServer(dev, serial) {
  const started = Date.now()
  for (;;) {
    if (!dev.proc) throw new Error('scrcpy server exited before it was ready')
    const result = await runAdb(dev.adb, ['shell', 'cat /proc/net/unix'], { serial, allowFail: true })
    if (/@scrcpy/.test(result.out.toString('utf8'))) return
    if (Date.now() - started > 30_000) throw new Error('timed out waiting for scrcpy server')
    await sleep(250)
  }
}

function waitForSize(dev, timeout) {
  if (dev.st.width && dev.st.height) return Promise.resolve()
  return new Promise((resolve) => {
    const started = Date.now()
    const timer = setInterval(() => {
      if ((dev.st.width && dev.st.height) || !dev.proc || Date.now() - started > timeout) {
        clearInterval(timer)
        resolve()
      }
    }, 100)
  })
}

async function stopMirror() {
  const dev = session
  session = null
  if (!dev) return { ok: true }
  try { if (dev.ws) dev.ws.close() } catch {}
  try { if (dev.videoSock) dev.videoSock.destroy() } catch {}
  try { if (dev.controlSock) dev.controlSock.destroy() } catch {}
  try { if (dev.proc) dev.proc.kill() } catch {}
  try {
    if (dev.ownedPids.length) {
      await runAdb(dev.adb, ['shell', 'kill -9 ' + dev.ownedPids.join(' ')], { serial: dev.serial, allowFail: true })
    }
  } catch {}
  try {
    if (dev.port) await runAdb(dev.adb, ['forward', '--remove', 'tcp:' + dev.port], { serial: dev.serial, allowFail: true })
  } catch {}
  log('stopped')
  return { ok: true }
}

// ---------------------------------------------------------------------------
// scrcpy video stream parsing
// ---------------------------------------------------------------------------

const FLAG_CONFIG = 1
const FLAG_KEY = 2

function pushGop(dev, flags, payload) {
  const gop = dev.gop
  if (flags & FLAG_CONFIG) {
    gop.config = Buffer.from(payload)
    gop.frames = []
    gop.bytes = 0
    gop.overflow = false
    return
  }
  if (flags & FLAG_KEY) {
    gop.frames = [Buffer.from(payload)]
    gop.bytes = payload.length
    gop.overflow = false
    return
  }
  if (!gop.config || gop.overflow) return
  gop.frames.push(Buffer.from(payload))
  gop.bytes += payload.length
  if (gop.bytes > MAX_GOP_BYTES) {
    gop.frames = []
    gop.bytes = 0
    gop.overflow = true
  }
}

function replayGop(dev, client) {
  const gop = dev.gop
  let count = 0
  if (gop.config) { client.sendBinary(gop.config); count++ }
  for (const frame of gop.frames) { client.sendBinary(frame); count++ }
  if (count) log('replayed ' + count + ' cached packets')
}

function broadcast(dev, payload) {
  if (!dev.broadcasting || !dev.ws) return
  for (const client of dev.ws.clients) client.sendBinary(payload)
}

function onVideoData(dev, chunk) {
  const st = dev.st
  st.buf = st.buf.length ? Buffer.concat([st.buf, chunk]) : chunk
  for (;;) {
    if (!st.codec) {
      if (st.buf.length < 4) return
      st.codec = st.buf.readUInt32BE(0)
      log('codec id 0x' + st.codec.toString(16) + " = '" + st.buf.subarray(0, 4).toString('latin1') + "'")
      st.buf = st.buf.subarray(4)
      continue
    }
    if (st.buf.length < 12) return
    const first = st.buf[0]
    if (first & 0x80) {
      const width = st.buf.readUInt32BE(4)
      const height = st.buf.readUInt32BE(8)
      const changed = st.width > 0 && (st.width !== width || st.height !== height)
      st.width = width
      st.height = height
      st.buf = st.buf.subarray(12)
      log('frame size ' + width + 'x' + height + (changed ? ' (changed)' : ''))
      if (changed) {
        dev.gop = { config: null, frames: [], bytes: 0, overflow: false }
      }
      if (dev.ws) {
        for (const client of dev.ws.clients) client.sendText(JSON.stringify({ msg: 'size', data: width + 'x' + height }))
      }
      continue
    }
    const size = st.buf.readUInt32BE(8)
    if (st.buf.length < 12 + size) return
    const flags = (first & 0x40 ? FLAG_CONFIG : 0) | (first & 0x20 ? FLAG_KEY : 0)
    const payload = Buffer.from(st.buf.subarray(12, 12 + size))
    st.buf = st.buf.subarray(12 + size)
    st.frames++
    st.bytes += size
    if (st.frames === 1) log('first packet ' + st.width + 'x' + st.height + ' flags=' + flags + ' bytes=' + size)
    pushGop(dev, flags, payload)
    broadcast(dev, payload)
  }
}

// ---------------------------------------------------------------------------
// control messages (scrcpy control protocol, 4.1)
// ---------------------------------------------------------------------------

function injectTouch(dev, action, fx, fy) {
  if (!dev.controlSock) return { ok: false, code: 'NO_CONTROL', error: 'control channel is not connected' }
  const width = dev.st.width
  const height = dev.st.height
  if (!width || !height) return { ok: false, code: 'NO_SIZE', error: 'frame size is not known yet' }
  const x = Math.max(0, Math.min(width - 1, Math.round(clamp01(fx) * (width - 1))))
  const y = Math.max(0, Math.min(height - 1, Math.round(clamp01(fy) * (height - 1))))
  const message = Buffer.alloc(32)
  message[0] = 2
  message[1] = action
  message.writeBigUInt64BE(0xfffffffffffffffen, 2)
  message.writeInt32BE(x, 10)
  message.writeInt32BE(y, 14)
  message.writeUInt16BE(width, 18)
  message.writeUInt16BE(height, 20)
  message.writeUInt16BE(0xffff, 22)
  dev.controlSock.write(message)
  return { ok: true }
}

/**
 * scrcpy 4.1 INJECT_SCROLL_EVENT (21 bytes, big-endian):
 * type(1) + x(i32) + y(i32) + videoWidth(u16) + videoHeight(u16) +
 * hScroll(i16 fixed-point) + vScroll(i16 fixed-point) + buttons(u32).
 * The scroll values are in [-16, 16]; the wire format stores value/16.
 */
function injectScroll(dev, fx, fy, dx, dy) {
  if (!dev.controlSock) return { ok: false, code: 'NO_CONTROL', error: 'control channel is not connected' }
  const width = dev.st.width
  const height = dev.st.height
  if (!width || !height) return { ok: false, code: 'NO_SIZE', error: 'frame size is not known yet' }
  const x = Math.max(0, Math.min(width - 1, Math.round(clamp01(fx) * (width - 1))))
  const y = Math.max(0, Math.min(height - 1, Math.round(clamp01(fy) * (height - 1))))
  const message = Buffer.alloc(21)
  message[0] = 3
  message.writeInt32BE(x, 1)
  message.writeInt32BE(y, 5)
  message.writeUInt16BE(width, 9)
  message.writeUInt16BE(height, 11)
  message.writeInt16BE(encodeScrollFixed(dx), 13)
  message.writeInt16BE(encodeScrollFixed(dy), 15)
  message.writeUInt32BE(0, 17)
  dev.controlSock.write(message)
  return { ok: true }
}

function clampScroll(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return 0
  return number < -16 ? -16 : number > 16 ? 16 : number
}

function encodeScrollFixed(value) {
  const normalized = clampScroll(value) / 16
  let fixed = Math.trunc(normalized * 32768)
  if (fixed >= 0x7fff) fixed = 0x7fff
  if (fixed < -0x8000) fixed = -0x8000
  return fixed
}

function injectText(dev, text) {
  if (!dev.controlSock) return { ok: false, code: 'NO_CONTROL', error: 'control channel is not connected' }
  const body = Buffer.from(String(text), 'utf8')
  const message = Buffer.alloc(5 + body.length)
  message[0] = 1
  message.writeUInt32BE(body.length, 1)
  body.copy(message, 5)
  dev.controlSock.write(message)
  return { ok: true }
}

/**
 * scrcpy's INJECT_TEXT goes through KeyCharacterMap, which cannot produce
 * non-ASCII characters (Chinese, emoji, ...). For those, set the device
 * clipboard and ask the server to paste it into the focused input instead.
 * The SET_CLIPBOARD layout is type(1) + sequence(u64) + paste(1) + len(u32) + UTF-8.
 */
function injectClipboardText(dev, text) {
  if (!dev.controlSock) return { ok: false, code: 'NO_CONTROL', error: 'control channel is not connected' }
  const body = Buffer.from(String(text), 'utf8')
  const message = Buffer.alloc(14 + body.length)
  message[0] = 9
  message.writeBigUInt64BE(0n, 1)
  message[9] = 1
  message.writeUInt32BE(body.length, 10)
  body.copy(message, 14)
  dev.controlSock.write(message)
  return { ok: true }
}

function injectTextSmart(dev, text) {
  const value = String(text)
  if (/^[\x20-\x7e]*$/.test(value)) return { ...injectText(dev, value), via: 'text' }
  return { ...injectClipboardText(dev, value), via: 'clipboard' }
}

const KEYCODES = {
  back: 4,
  home: 3,
  recents: 187,
  power: 26,
  wake: 224,
  volumeUp: 24,
  volumeDown: 25,
  enter: 66,
}

function clamp01(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return 0
  return number < 0 ? 0 : number > 1 ? 1 : number
}

// ---------------------------------------------------------------------------
// minimal WebSocket server (text + binary, no fragmentation)
// ---------------------------------------------------------------------------

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'
const LOOPBACK_ORIGIN_RE = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/
const LOOPBACK_HOST_RE = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/
const DSH_APP_ORIGIN_RE = /^dsh-app:\/\/[A-Za-z0-9._-]+$/i

function wsAccept(key) {
  return createHash('sha1').update(key + WS_GUID).digest('base64')
}

function encodeFrame(opcode, payload) {
  const length = payload.length
  let header
  if (length < 126) {
    header = Buffer.alloc(2)
    header[1] = length
  } else if (length < 65536) {
    header = Buffer.alloc(4)
    header[1] = 126
    header.writeUInt16BE(length, 2)
  } else {
    header = Buffer.alloc(10)
    header[1] = 127
    header.writeBigUInt64BE(BigInt(length), 2)
  }
  header[0] = 0x80 | opcode
  return Buffer.concat([header, payload])
}

function upgradeRejection(req) {
  const origin = req.headers['origin']
  if (origin && !LOOPBACK_ORIGIN_RE.test(String(origin)) && !DSH_APP_ORIGIN_RE.test(String(origin))) {
    return 'origin is not local: ' + origin
  }
  const host = req.headers['host']
  if (host && !LOOPBACK_HOST_RE.test(String(host))) return 'host is not local: ' + host
  return ''
}

function createWsServer(dev) {
  const clients = new Set()
  const server = createServer((req, res) => {
    res.writeHead(426, { 'content-type': 'text/plain' })
    res.end('websocket only')
  })

  server.on('upgrade', (req, socket) => {
    const key = req.headers['sec-websocket-key']
    if (!key) { try { socket.destroy() } catch {} return }
    const rejection = upgradeRejection(req)
    if (rejection) {
      warn('rejected WS client: ' + rejection)
      try {
        socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
        socket.destroy()
      } catch {}
      return
    }
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      'Sec-WebSocket-Accept: ' + wsAccept(key) + '\r\n\r\n',
    )

    const client = {
      socket,
      alive: true,
      sendText(text) {
        if (!this.alive) return
        try { socket.write(encodeFrame(0x1, Buffer.from(String(text), 'utf8'))) } catch {}
      },
      sendBinary(buffer) {
        if (!this.alive) return
        try { socket.write(encodeFrame(0x2, buffer)) } catch {}
      },
      close() {
        this.alive = false
        try { socket.destroy() } catch {}
      },
    }
    clients.add(client)
    try {
      client.sendText(JSON.stringify({ msg: 'hello', serial: dev.serial, model: dev.model }))
      client.sendText(JSON.stringify({ msg: 'size', data: dev.st.width + 'x' + dev.st.height }))
      replayGop(dev, client)
    } catch (error) {
      warn('ws open: ' + String((error && error.message) || error))
    }

    let buffer = Buffer.alloc(0)
    socket.on('data', (chunk) => {
      buffer = buffer.length ? Buffer.concat([buffer, chunk]) : chunk
      for (;;) {
        if (buffer.length < 2) return
        const fin = (buffer[0] & 0x80) !== 0
        const opcode = buffer[0] & 0x0f
        const masked = (buffer[1] & 0x80) !== 0
        let length = buffer[1] & 0x7f
        let offset = 2
        if (length === 126) {
          if (buffer.length < 4) return
          length = buffer.readUInt16BE(2)
          offset = 4
        } else if (length === 127) {
          if (buffer.length < 10) return
          length = Number(buffer.readBigUInt64BE(2))
          offset = 10
        }
        let mask = null
        if (masked) {
          if (buffer.length < offset + 4) return
          mask = buffer.subarray(offset, offset + 4)
          offset += 4
        }
        if (buffer.length < offset + length) return
        const payload = Buffer.from(buffer.subarray(offset, offset + length))
        if (mask) {
          for (let index = 0; index < payload.length; index++) payload[index] ^= mask[index & 3]
        }
        buffer = buffer.subarray(offset + length)
        if (!fin) continue
        if (opcode === 0x1) {
          try { handleWsText(dev, client, payload.toString('utf8')) } catch (error) {
            warn('ws text: ' + String((error && error.message) || error))
          }
        } else if (opcode === 0x8) {
          client.close()
        } else if (opcode === 0x9) {
          try { socket.write(encodeFrame(0xA, payload)) } catch {}
        }
      }
    })
    socket.on('error', () => {})
    socket.on('close', () => {
      client.alive = false
      clients.delete(client)
    })
  })

  return {
    clients,
    listen() {
      return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)))
    },
    close() {
      for (const client of clients) client.close()
      clients.clear()
      try { server.close() } catch {}
    },
  }
}

function handleWsText(dev, client, text) {
  let message
  try { message = JSON.parse(text) } catch { return }
  if (!message || !message.type) return
  if (message.type === 'size') {
    client.sendText(JSON.stringify({ msg: 'size', data: dev.st.width + 'x' + dev.st.height }))
    return
  }
  if (message.type === 'screen') {
    if (String(message.mode) === 'pause') { dev.broadcasting = false; return }
    dev.broadcasting = true
    replayGop(dev, client)
    return
  }
  if (message.type === 'touch') {
    const action = message.event === 'down' ? 0 : message.event === 'up' ? 1 : 2
    injectTouch(dev, action, message.fx, message.fy)
    return
  }
  if (message.type === 'scroll') {
    const result = injectScroll(dev, message.fx, message.fy, message.dx, message.dy)
    if (!result.ok) client.sendText(JSON.stringify({ ok: false, error: result.error }))
    return
  }
  if (message.type === 'key') {
    const code = KEYCODES[String(message.name || '')]
    if (!code) return
    runAdb(dev.adb, ['shell', 'input keyevent ' + code], { serial: dev.serial, allowFail: true }).catch(() => {})
    return
  }
  if (message.type === 'text') {
    const result = injectTextSmart(dev, String(message.text || ''))
    if (!result.ok) client.sendText(JSON.stringify({ ok: false, error: result.error }))
    return
  }
}

// ---------------------------------------------------------------------------
// HTTP RPC
// ---------------------------------------------------------------------------

function codedError(code, detail) {
  const error = new Error(detail || code)
  error.code = code
  return error
}

function authorizedMessage(serial) {
  return 'device ' + serial + ' is unauthorized; allow USB debugging on the phone'
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
      if (body.length > 1024 * 1024) {
        req.destroy()
        reject(new Error('request body too large'))
      }
    })
    req.on('end', () => resolve(body))
    req.on('error', reject)
  })
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(payload))
}

async function handleRpc(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method not allowed' })
  let parsed
  try { parsed = JSON.parse((await readBody(req)) || '{}') } catch {
    return sendJson(res, 400, { ok: false, error: 'invalid json body' })
  }
  const method = String(parsed.method || '')
  try {
    if (method === 'permissions:get') {
      return sendJson(res, 200, { ok: true, result: readPermissionConfig() })
    }
    if (method === 'permissions:set') {
      return sendJson(res, 200, { ok: true, result: savePermissionConfig(parsed.args || {}) })
    }
    if (method === 'status') {
      const adbPath = resolveAdb()
      const devices = adbPath ? await listDevices(adbPath) : []
      return sendJson(res, 200, {
        ok: true,
        result: {
          adb: adbPath,
          devices,
          streaming: !!(session && session.ready),
          serial: session ? session.serial : undefined,
          width: session ? session.st.width : 0,
          height: session ? session.st.height : 0,
        },
      })
    }
    if (method === 'start') {
      return sendJson(res, 200, { ok: true, result: await startMirror() })
    }
    if (method === 'stop') {
      return sendJson(res, 200, { ok: true, result: await stopMirror() })
    }
    if (method === 'touch' || method === 'key' || method === 'text') {
      if (!session || !session.ready) return sendJson(res, 200, { ok: false, code: 'NOT_STREAMING', error: 'mirror is not running' })
      if (method === 'key') {
        const code = KEYCODES[String((parsed.args && parsed.args.name) || '')]
        if (!code) return sendJson(res, 200, { ok: false, code: 'BAD_KEY', error: 'unknown key' })
        await runAdb(session.adb, ['shell', 'input keyevent ' + code], { serial: session.serial, allowFail: true })
        return sendJson(res, 200, { ok: true, result: { ok: true } })
      }
      const result = method === 'touch'
        ? injectTouch(session, parsed.args && parsed.args.event === 'down' ? 0 : parsed.args && parsed.args.event === 'up' ? 1 : 2, parsed.args && parsed.args.fx, parsed.args && parsed.args.fy)
        : injectTextSmart(session, parsed.args && parsed.args.text)
      return sendJson(res, 200, { ok: true, result })
    }
    return sendJson(res, 404, { ok: false, error: 'unknown method: ' + method })
  } catch (error) {
    if (!(error && error.code)) warn(String((error && error.message) || error))
    return sendJson(res, 200, {
      ok: false,
      code: (error && error.code) || 'INTERNAL',
      error: String((error && error.message) || error),
    })
  }
}

// ---------------------------------------------------------------------------
// Agent tools: conversation control + file transfer
// ---------------------------------------------------------------------------

const MAX_TRANSFER_BYTES = 300 * 1024 * 1024
const UI_DUMP_REMOTE = '/data/local/tmp/dsh-phone-ui.xml'
const TOOL_KEYS = ['back', 'home', 'recents', 'power', 'wake', 'volumeUp', 'volumeDown', 'enter']

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

function shQuote(value) {
  return "'" + String(value).replace(/'/g, "'\\''") + "'"
}

function assertRemotePath(value) {
  const path = String(value || '').trim()
  if (!path) throw new Error('remotePath is required')
  if (/[\r\n]/.test(path)) throw new Error('remotePath must not contain line breaks')
  return path
}

async function sessionDirectory(ctx, exec) {
  try {
    const service = ctx.get ? ctx.get('workingDirectory') : undefined
    if (service) {
      if (exec && exec.agent && exec.agent.session && typeof service.get === 'function') {
        try {
          const directory = service.get(exec.agent.session)
          if (directory) return directory
        } catch {}
      }
      if (exec && exec.agent && typeof service.ensure === 'function') {
        try { return await service.ensure(exec.agent, exec.signal) } catch {}
      }
      if (service.defaultDirectory) return service.defaultDirectory
    }
  } catch {}
  return process.cwd()
}

function phoneFilesDir(baseDir) {
  const dir = join(baseDir, 'phone-files')
  mkdirSync(dir, { recursive: true })
  return dir
}

function safeName(value) {
  const name = basename(String(value || '')) || 'phone-file'
  return name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 120)
}

function toolOutput() {
  return {
    schema: { type: 'object' },
    render(_args, value) {
      const text = value && typeof value === 'object' && typeof value.text === 'string'
        ? value.text
        : (typeof value === 'string' ? value : JSON.stringify(value, null, 2))
      return [{ type: 'text', text }]
    },
  }
}

function pngDimensions(buffer) {
  if (buffer.length >= 24 && buffer[0] === 0x89 && buffer[1] === 0x50) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
  }
  return { width: 0, height: 0 }
}

function parseUiXml(xml) {
  const nodes = []
  let maxX = 0
  let maxY = 0
  const nodeRe = /<node\b([^>]*?)\/?>/g
  let nodeMatch
  while ((nodeMatch = nodeRe.exec(String(xml))) !== null) {
    const attrs = {}
    const attrRe = /([\w-]+)="([^"]*)"/g
    let attrMatch
    while ((attrMatch = attrRe.exec(nodeMatch[1])) !== null) attrs[attrMatch[1]] = attrMatch[2]
    const bounds = String(attrs.bounds || '').match(/\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/)
    if (!bounds) continue
    const x1 = Number(bounds[1])
    const y1 = Number(bounds[2])
    const x2 = Number(bounds[3])
    const y2 = Number(bounds[4])
    if (x2 > maxX) maxX = x2
    if (y2 > maxY) maxY = y2
    if (x2 <= x1 || y2 <= y1) continue
    if (attrs.enabled === 'false') continue
    const text = String(attrs.text || '')
    const desc = String(attrs['content-desc'] || '')
    const id = String(attrs['resource-id'] || '')
    const cls = String(attrs.class || '')
    const clickable = attrs.clickable === 'true'
    if (!text && !desc && !clickable && !id) continue
    nodes.push({
      type: (cls.split('.').pop() || cls).slice(0, 40),
      text: text.slice(0, 80),
      desc: desc.slice(0, 80),
      id: id.slice(0, 120),
      clickable,
      x: Math.round((x1 + x2) / 2),
      y: Math.round((y1 + y2) / 2),
      w: x2 - x1,
      h: y2 - y1,
      bounds: x1 + ',' + y1 + ',' + x2 + ',' + y2,
    })
  }
  for (const node of nodes) {
    node.fx = maxX ? clamp01(node.x / maxX) : 0
    node.fy = maxY ? clamp01(node.y / maxY) : 0
  }
  const seen = new Set()
  const unique = []
  for (const node of nodes) {
    const key = node.text + '|' + node.desc + '|' + node.id + '|' + node.type + '|' + node.x + '|' + node.y
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(node)
  }
  unique.sort((a, b) => a.y - b.y || a.x - b.x)
  return { width: maxX, height: maxY, nodes: unique }
}

function ensureAdb() {
  const adbPath = resolveAdb()
  if (!adbPath) throw codedError('ADB_NOT_FOUND', 'adb not found; install Android platform-tools or set ADB_PATH')
  return adbPath
}

async function ensureDevice(serial) {
  const adbPath = ensureAdb()
  const devices = await listDevices(adbPath)
  const wanted = String(serial || (session && session.serial) || process.env.DSH_PHONE_SERIAL || '').trim()
  let target = wanted ? devices.find((device) => device.serial === wanted) : null
  if (!target) target = devices.find((device) => device.state === 'device')
  if (!target) {
    const unauthorized = devices.find((device) => device.state === 'unauthorized')
    if (unauthorized) throw codedError('UNAUTHORIZED', 'device ' + unauthorized.serial + ' is unauthorized; allow USB debugging on the phone')
    throw codedError('NO_DEVICE', 'no authorized Android device connected')
  }
  if (target.state !== 'device') {
    throw codedError(target.state === 'unauthorized' ? 'UNAUTHORIZED' : 'DEVICE_OFFLINE', 'device ' + target.serial + ' is ' + target.state)
  }
  return { adb: adbPath, serial: target.serial, model: target.model }
}

async function screenSize(adbPath, serial, signal) {
  const result = await runAdb(adbPath, ['shell', 'wm size'], { serial, allowFail: true, signal })
  const text = result.out.toString('utf8')
  const match = /Override size:\s*(\d+)x(\d+)/.exec(text) || /Physical size:\s*(\d+)x(\d+)/.exec(text)
  if (!match) throw codedError('NO_SIZE', 'could not read the phone screen size')
  return { w: Number(match[1]), h: Number(match[2]) }
}

async function pixelPoint(adbPath, serial, args, signal) {
  if (Number.isFinite(Number(args.x)) && Number.isFinite(Number(args.y))) {
    return { x: Math.round(Number(args.x)), y: Math.round(Number(args.y)) }
  }
  if (args.fx === undefined || args.fy === undefined) throw new Error('pass x/y pixels or fx/fy ratios (0..1)')
  const size = await screenSize(adbPath, serial, signal)
  return {
    x: Math.round(clamp01(args.fx) * (size.w - 1)),
    y: Math.round(clamp01(args.fy) * (size.h - 1)),
  }
}

async function remoteSize(adbPath, serial, remotePath, signal) {
  const result = await runAdb(adbPath, ['shell', 'stat -c %s ' + shQuote(remotePath)], { serial, allowFail: true, signal })
  const size = Number(result.out.toString('utf8').trim())
  return Number.isFinite(size) && size >= 0 ? size : 0
}

async function remoteIsDir(adbPath, serial, remotePath, signal) {
  const result = await runAdb(adbPath, ['shell', 'test -d ' + shQuote(remotePath) + ' && echo dir || echo file'], { serial, allowFail: true, signal })
  return result.out.toString('utf8').trim() === 'dir'
}

async function copyToPhone(target, localPath, remotePath, force, signal) {
  let stat
  try { stat = statSync(localPath) } catch {
    throw new Error('local path not found: ' + localPath)
  }
  if (!force && stat.isFile() && stat.size > MAX_TRANSFER_BYTES) {
    throw new Error('local file is ' + stat.size + ' bytes, above the ' + MAX_TRANSFER_BYTES + '-byte limit; pass force=true to continue')
  }
  const adbPath = target.adb
  const serial = target.serial
  let remote = assertRemotePath(remotePath)
  if (stat.isDirectory()) {
    if (!remote.endsWith('/')) remote += '/'
    await runAdb(adbPath, ['shell', 'mkdir -p ' + shQuote(remote)], { serial, allowFail: true, signal })
    await runAdb(adbPath, ['push', localPath, remote], { serial, timeout: 600_000, signal })
    return { remotePath: remote, bytes: 0, kind: 'dir' }
  }
  if (remote.endsWith('/') || await remoteIsDir(adbPath, serial, remote, signal)) {
    remote = remote.replace(/\/+$/, '') + '/' + basename(localPath)
  }
  const parent = dirname(remote).replace(/\\/g, '/')
  if (parent && parent !== '.' && parent !== '/') {
    await runAdb(adbPath, ['shell', 'mkdir -p ' + shQuote(parent)], { serial, allowFail: true, signal })
  }
  await runAdb(adbPath, ['push', localPath, remote], { serial, timeout: 600_000, signal })
  return { remotePath: remote, bytes: stat.size, kind: 'file' }
}

async function copyFromPhone(ctx, exec, target, remotePath, localPath, force, signal) {
  const remote = assertRemotePath(remotePath)
  const isDir = await remoteIsDir(target.adb, target.serial, remote, signal)
  if (!isDir) {
    const size = await remoteSize(target.adb, target.serial, remote, signal)
    if (!force && size > MAX_TRANSFER_BYTES) {
      throw new Error('remote file is ' + size + ' bytes, above the ' + MAX_TRANSFER_BYTES + '-byte limit; pass force=true to continue')
    }
  }
  const base = await sessionDirectory(ctx, exec)
  let local = localPath
  if (!local) local = join(phoneFilesDir(base), stamp() + '-' + safeName(remote))
  else if (!isAbsolute(local)) local = resolve(base, local)
  if (existsSync(local) && statSync(local).isDirectory()) local = join(local, safeName(remote))
  mkdirSync(dirname(local), { recursive: true })
  await runAdb(target.adb, ['pull', remote, local], { serial: target.serial, timeout: 600_000, signal })
  const stat = statSync(local)
  return { localPath: local, remotePath: remote, bytes: stat.isFile() ? stat.size : 0, kind: stat.isDirectory() ? 'dir' : 'file' }
}

function phoneToolDefinitions(ctx) {
  return [
    {
      name: 'phone_devices',
      description: 'List USB-connected Android devices, their authorization state, whether the mirror is running, and the current permission mode. Start here before using other phone_* tools.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      output: toolOutput(),
      timeoutMs: 30_000,
      isConcurrencySafe: () => true,
      async execute() {
        const adbPath = resolveAdb()
        if (!adbPath) {
          return { text: 'adb not found. Install Android platform-tools or set ADB_PATH.', adb: null, devices: [] }
        }
        const devices = await listDevices(adbPath)
        const lines = ['adb: ' + adbPath]
        if (devices.length === 0) lines.push('No devices connected. Connect the phone by USB and allow USB debugging.')
        for (const device of devices) {
          lines.push('- ' + device.serial + ' [' + device.state + ']' + (device.model ? ' ' + device.model : ''))
        }
        lines.push(session && session.ready
          ? 'mirror: running ' + session.st.width + 'x' + session.st.height + ' on ' + session.serial
          : 'mirror: stopped')
        const permissions = readPermissionConfig()
        lines.push('permissions: ' + permissions.mode + ' (' + PERMISSION_CATEGORIES.map((category) => category + '=' + permissions.permissions[category]).join(', ') + ')')
        return { text: lines.join('\n'), adb: adbPath, devices, permissions }
      },
    },
    {
      name: 'phone_screenshot',
      description: 'Capture the phone screen to a PNG in the workspace and return its path. Use read_image on that path to inspect the screen.',
      parameters: {
        type: 'object',
        properties: {
          serial: { type: 'string', description: 'Device serial from phone_devices; defaults to the active device.' },
        },
        additionalProperties: false,
      },
      output: toolOutput(),
      timeoutMs: 60_000,
      isConcurrencySafe: () => false,
      async execute(args, exec) {
        await requirePhonePermission(ctx, exec, 'view', { en: 'capture the phone screen', zh: '截取手机屏幕' })
        const target = await ensureDevice(args.serial)
        const result = await runAdb(target.adb, ['exec-out', 'screencap', '-p'], { serial: target.serial, timeout: 30_000, signal: exec.signal })
        if (!result.out.length) throw new Error('screencap returned no data; the phone may be locked')
        const dims = pngDimensions(result.out)
        const base = await sessionDirectory(ctx, exec)
        const file = join(phoneFilesDir(base), 'screenshot-' + stamp() + '.png')
        writeFileSync(file, result.out)
        return {
          text: 'Screenshot saved to ' + file + ' (' + dims.width + 'x' + dims.height + ', ' + result.out.length + ' bytes). Use read_image with this path to view it.',
          path: file,
          width: dims.width,
          height: dims.height,
          bytes: result.out.length,
        }
      },
    },
    {
      name: 'phone_ui',
      description: 'Read the current screen accessibility nodes with text, bounds, normalized centers and clickable flags. Prefer this over guessing tap coordinates.',
      parameters: {
        type: 'object',
        properties: {
          serial: { type: 'string', description: 'Device serial from phone_devices; defaults to the active device.' },
          maxNodes: { type: 'integer', description: 'Maximum nodes to return (default 100, capped at 200).' },
        },
        additionalProperties: false,
      },
      output: toolOutput(),
      timeoutMs: 60_000,
      isConcurrencySafe: () => false,
      async execute(args, exec) {
        await requirePhonePermission(ctx, exec, 'view', { en: 'read the phone screen UI', zh: '读取手机界面控件' })
        const target = await ensureDevice(args.serial)
        await runAdb(target.adb, ['shell', 'uiautomator dump ' + UI_DUMP_REMOTE], { serial: target.serial, allowFail: true, timeout: 30_000, signal: exec.signal })
        const raw = await runAdb(target.adb, ['exec-out', 'cat', UI_DUMP_REMOTE], { serial: target.serial, allowFail: true, timeout: 20_000, signal: exec.signal })
        await runAdb(target.adb, ['shell', 'rm -f ' + UI_DUMP_REMOTE], { serial: target.serial, allowFail: true, signal: exec.signal })
        const xml = raw.out.toString('utf8')
        if (!xml || xml.indexOf('<hierarchy') < 0) {
          throw new Error('uiautomator dump returned no hierarchy; the current screen may be a game/WebView or the phone may be locked')
        }
        const parsed = parseUiXml(xml)
        const limit = Math.max(1, Math.min(200, Number(args.maxNodes) > 0 ? Number(args.maxNodes) : 100))
        const nodes = parsed.nodes.slice(0, limit)
        const lines = ['Screen space ' + parsed.width + 'x' + parsed.height]
        if (nodes.length === 0) lines.push('No accessible nodes on this screen.')
        nodes.forEach((node, index) => {
          lines.push((index + 1) + '. ' + node.type + ' ' + JSON.stringify(node.text || node.desc)
            + ' id=' + (node.id || '-')
            + ' clickable=' + node.clickable
            + ' center=(' + node.x + ',' + node.y + ')'
            + ' fx=' + node.fx.toFixed(3) + ' fy=' + node.fy.toFixed(3))
        })
        return { text: lines.join('\n'), width: parsed.width, height: parsed.height, nodes }
      },
    },
    {
      name: 'phone_tap',
      description: 'Tap the phone screen. Pass pixel x/y (preferred, from phone_ui centers) or fx/fy ratios. A positive durationMs performs a long press.',
      parameters: {
        type: 'object',
        properties: {
          serial: { type: 'string', description: 'Device serial from phone_devices; defaults to the active device.' },
          x: { type: 'integer', description: 'Tap x in current screen pixels.' },
          y: { type: 'integer', description: 'Tap y in current screen pixels.' },
          fx: { type: 'number', description: 'Horizontal ratio 0..1; used when x/y are absent.' },
          fy: { type: 'number', description: 'Vertical ratio 0..1; used when x/y are absent.' },
          durationMs: { type: 'integer', description: 'Long-press duration in ms; 0 or omitted is a normal tap.' },
        },
        additionalProperties: false,
      },
      output: toolOutput(),
      timeoutMs: 30_000,
      isConcurrencySafe: () => false,
      async execute(args, exec) {
        await requirePhonePermission(ctx, exec, 'control', { en: 'tap the phone screen', zh: '点击手机屏幕' })
        const target = await ensureDevice(args.serial)
        const point = await pixelPoint(target.adb, target.serial, args, exec.signal)
        const duration = Math.max(0, Math.min(60_000, Number(args.durationMs) || 0))
        const command = duration > 0
          ? 'input swipe ' + point.x + ' ' + point.y + ' ' + point.x + ' ' + point.y + ' ' + duration
          : 'input tap ' + point.x + ' ' + point.y
        await runAdb(target.adb, ['shell', command], { serial: target.serial, signal: exec.signal })
        return { text: (duration > 0 ? 'Long-pressed' : 'Tapped') + ' (' + point.x + ', ' + point.y + ')', x: point.x, y: point.y }
      },
    },
    {
      name: 'phone_swipe',
      description: 'Swipe between two points on the phone screen. Pass pixel coordinates or fx/fy ratios; durationMs defaults to 300.',
      parameters: {
        type: 'object',
        properties: {
          serial: { type: 'string', description: 'Device serial from phone_devices; defaults to the active device.' },
          x1: { type: 'integer', description: 'Start x in current screen pixels.' },
          y1: { type: 'integer', description: 'Start y in current screen pixels.' },
          x2: { type: 'integer', description: 'End x in current screen pixels.' },
          y2: { type: 'integer', description: 'End y in current screen pixels.' },
          fx1: { type: 'number', description: 'Start horizontal ratio 0..1; used when x1/y1 are absent.' },
          fy1: { type: 'number', description: 'Start vertical ratio 0..1; used when x1/y1 are absent.' },
          fx2: { type: 'number', description: 'End horizontal ratio 0..1; used when x2/y2 are absent.' },
          fy2: { type: 'number', description: 'End vertical ratio 0..1; used when x2/y2 are absent.' },
          durationMs: { type: 'integer', description: 'Swipe duration in ms; default 300.' },
        },
        additionalProperties: false,
      },
      output: toolOutput(),
      timeoutMs: 30_000,
      isConcurrencySafe: () => false,
      async execute(args, exec) {
        await requirePhonePermission(ctx, exec, 'control', { en: 'swipe on the phone screen', zh: '在手机屏幕上滑动' })
        const target = await ensureDevice(args.serial)
        const start = await pixelPoint(target.adb, target.serial, { x: args.x1, y: args.y1, fx: args.fx1, fy: args.fy1 }, exec.signal)
        const end = await pixelPoint(target.adb, target.serial, { x: args.x2, y: args.y2, fx: args.fx2, fy: args.fy2 }, exec.signal)
        const duration = Math.max(1, Math.min(60_000, Number(args.durationMs) || 300))
        await runAdb(target.adb, ['shell', 'input swipe ' + start.x + ' ' + start.y + ' ' + end.x + ' ' + end.y + ' ' + duration], { serial: target.serial, signal: exec.signal })
        return { text: 'Swiped (' + start.x + ', ' + start.y + ') -> (' + end.x + ', ' + end.y + ') in ' + duration + 'ms', from: start, to: end }
      },
    },
    {
      name: 'phone_key',
      description: 'Press a hardware key on the phone: back, home, recents, power, wake, volumeUp, volumeDown or enter.',
      parameters: {
        type: 'object',
        properties: {
          serial: { type: 'string', description: 'Device serial from phone_devices; defaults to the active device.' },
          name: { type: 'string', enum: TOOL_KEYS, description: 'Key to press.' },
        },
        required: ['name'],
        additionalProperties: false,
      },
      output: toolOutput(),
      timeoutMs: 30_000,
      isConcurrencySafe: () => false,
      async execute(args, exec) {
        await requirePhonePermission(ctx, exec, 'key', { en: 'press a phone key', zh: '按手机按键' })
        const target = await ensureDevice(args.serial)
        const code = KEYCODES[String(args.name || '')]
        if (!code) throw new Error('unknown key: ' + String(args.name || ''))
        await runAdb(target.adb, ['shell', 'input keyevent ' + code], { serial: target.serial, signal: exec.signal })
        return { text: 'Pressed ' + args.name, name: args.name }
      },
    },
    {
      name: 'phone_text',
      description: 'Type text into the currently focused input on the phone. ASCII text uses adb input; other text opens a temporary control channel.',
      parameters: {
        type: 'object',
        properties: {
          serial: { type: 'string', description: 'Device serial from phone_devices; defaults to the active device.' },
          text: { type: 'string', description: 'Text to type into the focused input.' },
        },
        required: ['text'],
        additionalProperties: false,
      },
      output: toolOutput(),
      timeoutMs: 90_000,
      isConcurrencySafe: () => false,
      async execute(args, exec) {
        const text = String(args.text === undefined ? '' : args.text)
        if (!text) throw new Error('text is required')
        await requirePhonePermission(ctx, exec, 'input', { en: 'type text into the phone', zh: '向手机输入文字' })
        const target = await ensureDevice(args.serial)
        if (session && session.ready && session.serial === target.serial && session.controlSock) {
          const injected = injectTextSmart(session, text)
          if (!injected.ok) throw new Error(injected.error || 'text injection failed')
          if (injected.via === 'clipboard') await sleep(400)
          return {
            text: 'Typed ' + text.length + ' characters through the active mirror control channel'
              + (injected.via === 'clipboard' ? ' (clipboard paste for non-ASCII text).' : '.'),
            via: injected.via === 'clipboard' ? 'clipboard' : 'control',
          }
        }
        if (/^[\x20-\x7e]*$/.test(text)) {
          const escaped = text.replace(/ /g, '%s')
          const result = await runAdb(target.adb, ['shell', 'input text ' + shQuote(escaped)], { serial: target.serial, allowFail: true, timeout: 20_000, signal: exec.signal })
          if (result.code !== 0) throw new Error('adb input text failed: ' + (result.err || String(result.code)))
          return { text: 'Typed ' + text.length + ' ASCII characters through adb input.', via: 'adb' }
        }
        const hadSession = !!(session && session.ready)
        if (!hadSession) await startMirror({ serial: target.serial })
        try {
          if (!session || !session.controlSock || session.serial !== target.serial) {
            throw new Error('could not open a control channel for text injection')
          }
          const injected = injectTextSmart(session, text)
          if (!injected.ok) throw new Error(injected.error || 'text injection failed')
          if (!hadSession) await sleep(injected.via === 'clipboard' ? 900 : 600)
          return {
            text: 'Typed ' + text.length + ' characters through a temporary control channel'
              + (injected.via === 'clipboard' ? ' (clipboard paste for non-ASCII text).' : '.'),
            via: injected.via === 'clipboard' ? 'clipboard' : (hadSession ? 'control' : 'control-temp'),
          }
        } finally {
          if (!hadSession) await stopMirror()
        }
      },
    },
    {
      name: 'phone_open',
      description: 'Open an app by package name or a URL on the phone.',
      parameters: {
        type: 'object',
        properties: {
          serial: { type: 'string', description: 'Device serial from phone_devices; defaults to the active device.' },
          package: { type: 'string', description: 'Android package name, for example com.android.settings.' },
          url: { type: 'string', description: 'HTTP(S) URL to open instead of a package.' },
        },
        additionalProperties: false,
      },
      output: toolOutput(),
      timeoutMs: 30_000,
      isConcurrencySafe: () => false,
      async execute(args, exec) {
        await requirePhonePermission(ctx, exec, 'control', { en: 'open an app or URL on the phone', zh: '在手机上打开应用或链接' })
        const target = await ensureDevice(args.serial)
        const pkg = String(args.package || '').trim()
        const url = String(args.url || '').trim()
        if (pkg) {
          if (!/^[A-Za-z0-9._]+$/.test(pkg)) throw new Error('package must be a valid Android package name')
          await runAdb(target.adb, ['shell', 'monkey -p ' + pkg + ' -c android.intent.category.LAUNCHER 1'], { serial: target.serial, allowFail: true, signal: exec.signal })
          return { text: 'Launched ' + pkg, package: pkg }
        }
        if (url) {
          if (/[\r\n]/.test(url) || url.length > 2048) throw new Error('invalid url')
          await runAdb(target.adb, ['shell', 'am start -a android.intent.action.VIEW -d ' + shQuote(url)], { serial: target.serial, allowFail: true, signal: exec.signal })
          return { text: 'Opened ' + url, url }
        }
        throw new Error('pass package or url')
      },
    },
    {
      name: 'phone_ls',
      description: 'List a directory on the phone. Defaults to /sdcard. Use phone_pull to copy a file to the computer.',
      parameters: {
        type: 'object',
        properties: {
          serial: { type: 'string', description: 'Device serial from phone_devices; defaults to the active device.' },
          path: { type: 'string', description: 'Remote directory path; default /sdcard.' },
        },
        additionalProperties: false,
      },
      output: toolOutput(),
      timeoutMs: 30_000,
      isConcurrencySafe: () => false,
      async execute(args, exec) {
        await requirePhonePermission(ctx, exec, 'files', { en: 'list phone files', zh: '列出手机文件' })
        const target = await ensureDevice(args.serial)
        const path = assertRemotePath(args.path || '/sdcard')
        const result = await runAdb(target.adb, ['shell', 'ls -la ' + shQuote(path)], { serial: target.serial, allowFail: true, timeout: 20_000, signal: exec.signal })
        if (result.code !== 0) throw new Error('ls failed: ' + (result.err || String(result.code)))
        const lines = result.out.toString('utf8').split(/\r?\n/).filter(Boolean).slice(0, 200)
        return { text: 'Directory ' + path + '\n' + lines.join('\n'), path, entries: lines }
      },
    },
    {
      name: 'phone_pull',
      description: 'Copy a file or directory from the phone to the computer. Default destination is <workspace>/phone-files/.',
      parameters: {
        type: 'object',
        properties: {
          serial: { type: 'string', description: 'Device serial from phone_devices; defaults to the active device.' },
          remotePath: { type: 'string', description: 'Phone path to copy, for example /sdcard/DCIM/Camera/IMG_0001.jpg.' },
          localPath: { type: 'string', description: 'Local destination; relative paths resolve against the workspace. Defaults to phone-files/.' },
          force: { type: 'boolean', description: 'Allow files larger than 300 MB.' },
        },
        required: ['remotePath'],
        additionalProperties: false,
      },
      output: toolOutput(),
      timeoutMs: 600_000,
      isConcurrencySafe: () => false,
      async execute(args, exec) {
        await requirePhonePermission(ctx, exec, 'files', { en: 'copy a file from the phone', zh: '从手机取文件' })
        const target = await ensureDevice(args.serial)
        const result = await copyFromPhone(ctx, exec, target, args.remotePath, args.localPath, args.force === true, exec.signal)
        return {
          text: 'Copied ' + result.remotePath + ' -> ' + result.localPath + ' (' + result.kind + (result.bytes ? ', ' + result.bytes + ' bytes' : '') + ')',
          ...result,
        }
      },
    },
    {
      name: 'phone_push',
      description: 'Copy a file or directory from the computer to the phone. Default remote destination is /sdcard/Download/.',
      parameters: {
        type: 'object',
        properties: {
          serial: { type: 'string', description: 'Device serial from phone_devices; defaults to the active device.' },
          localPath: { type: 'string', description: 'Local file or directory; relative paths resolve against the workspace.' },
          remotePath: { type: 'string', description: 'Phone destination; defaults to /sdcard/Download/<name>.' },
          force: { type: 'boolean', description: 'Allow files larger than 300 MB.' },
        },
        required: ['localPath'],
        additionalProperties: false,
      },
      output: toolOutput(),
      timeoutMs: 600_000,
      isConcurrencySafe: () => false,
      async execute(args, exec) {
        await requirePhonePermission(ctx, exec, 'files', { en: 'copy a file to the phone', zh: '向手机传文件' })
        const target = await ensureDevice(args.serial)
        const rawLocal = String(args.localPath || '').trim()
        if (!rawLocal) throw new Error('localPath is required')
        const base = await sessionDirectory(ctx, exec)
        const local = isAbsolute(rawLocal) ? rawLocal : resolve(base, rawLocal)
        const remote = args.remotePath || ('/sdcard/Download/' + basename(local))
        const result = await copyToPhone(target, local, remote, args.force === true, exec.signal)
        return {
          text: 'Copied ' + local + ' -> ' + result.remotePath + ' (' + result.kind + (result.bytes ? ', ' + result.bytes + ' bytes' : '') + ')',
          localPath: local,
          ...result,
        }
      },
    },
  ]
}

// ---------------------------------------------------------------------------
// plugin entry
// ---------------------------------------------------------------------------

export const inject = ['webServer', 'tools']

export function apply(ctx) {
  let jmuxerSource = null
  ctx.effect(
    () => ctx.webServer.register({
      kind: 'exact',
      path: RPC_PATH,
      handler: (req, res) => handleRpc(req, res),
    }),
    'phone-mirror: rpc route',
  )
  ctx.effect(
    () => ctx.webServer.register({
      kind: 'exact',
      path: JMUXER_PATH,
      handler: (req, res) => {
        try {
          if (!jmuxerSource) jmuxerSource = readFileSync(RES('jmuxer.min.js'))
          res.writeHead(200, {
            'content-type': 'text/javascript; charset=utf-8',
            'cache-control': 'no-cache',
          })
          res.end(jmuxerSource)
        } catch (error) {
          res.writeHead(404, { 'content-type': 'text/plain' })
          res.end('jmuxer not found')
        }
      },
    }),
    'phone-mirror: jmuxer route',
  )
  ctx.effect(
    () => () => { void stopMirror() },
    'phone-mirror: stop stream on unload',
  )
  const definitions = phoneToolDefinitions(ctx)
  for (const definition of definitions) {
    ctx.effect(
      () => ctx.tools.register(definition),
      'phone-mirror: tool ' + definition.name,
    )
  }
  log('host ready (max_size=' + CONFIG.maxSize + ', max_fps=' + CONFIG.maxFps + ', tools=' + definitions.length + ')')
  log('permission config: ' + PHONE_CONFIG_FILE)
}
