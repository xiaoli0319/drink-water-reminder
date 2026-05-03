const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain } = require('electron')
const path = require('path')
const fs = require('fs')
const zlib = require('zlib')

// --- 单实例锁 ---
if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0) }

// --- 配置读写 ---
const CFG = path.join(app.getPath('userData'), 'config.json')
let interval = 30
function loadCfg() { try { interval = JSON.parse(fs.readFileSync(CFG, 'utf8')).interval || 30 } catch (_) {} }
function saveCfg() { fs.writeFileSync(CFG, JSON.stringify({ interval })) }

// --- 生成 16x16 蓝色托盘图标 PNG ---
function makeIconPNG([r, g, b]) {
  const W = 16, H = 16
  const raw = Buffer.alloc(H * (1 + W * 4))
  for (let y = 0; y < H; y++) {
    raw[y * 65] = 0
    for (let x = 0; x < W; x++) {
      const o = y * 65 + 1 + x * 4
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = 255
    }
  }
  const idat = zlib.deflateSync(raw)
  const crcT = new Uint32Array(256)
  for (let i = 0; i < 256; i++) { let c = i; for (let j = 0; j < 8; j++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; crcT[i] = c }
  const crc = d => { let c = 0xFFFFFFFF; for (let i = 0; i < d.length; i++) c = crcT[(c ^ d[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0 }
  const chk = (t, d) => {
    const b = Buffer.alloc(12 + d.length)
    b.writeUInt32BE(d.length, 0); b.write(t, 4); d.copy(b, 8)
    b.writeUInt32BE(crc(Buffer.concat([Buffer.from(t), d])), 8 + d.length)
    return b
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 6
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chk('IHDR', ihdr), chk('IDAT', idat), chk('IEND', Buffer.alloc(0))])
}

// --- 全局变量 ---
let tray, cfgWin, remindWin, timer

// --- 弹窗提醒（置顶）---
function showReminder() {
  if (remindWin && !remindWin.isDestroyed()) { remindWin.focus(); return }
  remindWin = new BrowserWindow({
    width: 340, height: 220, useContentSize: true, alwaysOnTop: true, resizable: false,
    minimizable: false, maximizable: false, skipTaskbar: true, title: '喝水提醒',
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  })
  remindWin.setMenu(null)
  remindWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`
    <!DOCTYPE html><meta charset="UTF-8"><style>
      *{margin:0;box-sizing:border-box}body,html{overflow:hidden;height:100%}body{font-family:'Microsoft YaHei',sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;user-select:none;background:#fff}
      .icon{font-size:48px;margin-bottom:10px}.title{font-size:20px;font-weight:bold;color:#333}.tip{font-size:13px;color:#999;margin:8px 0 14px}
      button{padding:8px 36px;font-size:14px;border:none;background:#2196F3;color:#fff;border-radius:6px;cursor:pointer}
    </style>
    <div class="icon">💧</div>
    <div class="title">该喝水啦！</div>
    <div class="tip">每隔 ${interval} 分钟提醒一次 · 保持健康</div>
    <button onclick="require('electron').ipcRenderer.send('close-reminder')">知道了</button>
  `)}`)
  remindWin.on('closed', () => { remindWin = null })
}

// --- 配置面板 ---
function showConfig() {
  if (cfgWin && !cfgWin.isDestroyed()) { cfgWin.focus(); return }
  cfgWin = new BrowserWindow({
    width: 320, height: 260, resizable: false,
    minimizable: false, maximizable: false, title: '设置',
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  })
  cfgWin.setMenu(null)
  cfgWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`
    <!DOCTYPE html><meta charset="UTF-8"><style>
      *{box-sizing:border-box}body{font-family:'Microsoft YaHei',sans-serif;margin:0;background:#f5f5f5;display:flex;flex-direction:column;align-items:center;padding:30px 20px}
      h2{margin:0 0 20px;font-size:18px;color:#333}
      label{font-size:14px;color:#666;display:block;width:100%}
      input{width:100%;padding:8px;margin:6px 0 16px;border:1px solid #ddd;border-radius:4px;font-size:16px}
      .btns{display:flex;gap:10px;width:100%}
      button{flex:1;padding:8px;border:1px solid #ddd;border-radius:4px;font-size:14px;cursor:pointer}
      button.save{background:#2196F3;color:#fff;border:none}
    </style>
    <h2>喝水提醒 · 设置</h2>
    <label>提醒间隔（分钟）</label>
    <input id="iv" type="number" value="${interval}" min="1" max="120">
    <div class="btns">
      <button class="save" onclick="require('electron').ipcRenderer.send('save-config',parseInt(document.getElementById('iv').value)||30)">保存</button>
      <button onclick="window.close()">取消</button>
    </div>
  `)}`)
  cfgWin.on('closed', () => { cfgWin = null })
}

// --- 定时器 ---
function restartTimer() {
  if (timer) clearInterval(timer)
  timer = setInterval(showReminder, interval * 60 * 1000)
}

// --- IPC ---
ipcMain.on('close-reminder', () => remindWin?.close())
ipcMain.on('save-config', (_, v) => {
  interval = Math.max(1, Math.min(120, v))
  saveCfg()
  restartTimer()
  cfgWin?.close()
})

// --- 第二实例时打开设置 ---
app.on('second-instance', () => showConfig())
app.on('window-all-closed', () => {})

// --- 启动 ---
app.whenReady().then(() => {
  loadCfg()

  // 系统托盘
  const icon = nativeImage.createFromBuffer(makeIconPNG([66, 133, 244]))
  tray = new Tray(icon)
  tray.setToolTip('喝水提醒')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '立即提醒', click: showReminder },
    { label: '设置', click: showConfig },
    { type: 'separator' },
    { label: '退出', click: () => { clearInterval(timer); app.exit(0) } }
  ]))
  tray.on('double-click', showConfig)

  restartTimer()
  showReminder()
})

// --- 开机自启 ---
app.setLoginItemSettings({ openAtLogin: true })
