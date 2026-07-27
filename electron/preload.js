'use strict'

// ─────────────────────────────────────────────────────────────────────────────
//  GarageFlow Preload — Secure IPC bridge between Electron and the web app
//  Exposes only the specific functions the app needs, no raw Node.js access.
// ─────────────────────────────────────────────────────────────────────────────

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  // ── App info ──────────────────────────────────────────────────────────────
  getVersion:    () => ipcRenderer.invoke('app:version'),
  getLicenseInfo: () => ipcRenderer.invoke('app:license-info'),
  getDBPath:     () => ipcRenderer.invoke('app:db-path'),

  // ── Backup ────────────────────────────────────────────────────────────────
  backupDB:      () => ipcRenderer.invoke('app:backup'),
  openBackups:   () => ipcRenderer.invoke('app:open-backups'),
  openLogs:      () => ipcRenderer.invoke('app:open-logs'),

  // ── License window IPC ────────────────────────────────────────────────────
  submitLicenseToken: (token) => ipcRenderer.send('license-submit', token),
  quitApp:            ()      => ipcRenderer.send('license-quit'),
  onLicenseError:(cb)     => {
    ipcRenderer.on('license-error', (_e, msg) => cb(msg))
    return () => ipcRenderer.removeAllListeners('license-error')
  },

  // ── Window controls ───────────────────────────────────────────────────────
  windowAPI: {
    minimize:         () => ipcRenderer.invoke('win:minimize'),
    maximizeToggle:   () => ipcRenderer.invoke('win:maximize-toggle'),
    close:            () => ipcRenderer.invoke('win:close'),
    fullscreenToggle: () => ipcRenderer.invoke('win:fullscreen-toggle'),
    isMaximized:      () => ipcRenderer.invoke('win:is-maximized'),
    onMaximizedChange:   (cb) => { ipcRenderer.on('win:maximized-change',  (_, v) => cb(v)); return () => ipcRenderer.removeAllListeners('win:maximized-change') },
    onFullscreenChange:  (cb) => { ipcRenderer.on('win:fullscreen-change', (_, v) => cb(v)); return () => ipcRenderer.removeAllListeners('win:fullscreen-change') },
  },

  // ── Desktop export ────────────────────────────────────────────────────────
  exportToDesktop:    () => ipcRenderer.invoke('app:desktop-export-now'),
  openDesktopExports: () => ipcRenderer.invoke('app:open-desktop-export'),
  onDesktopExportDone:(cb) => {
    ipcRenderer.on('app:desktop-export-done', (_e, info) => cb(info))
    return () => ipcRenderer.removeAllListeners('app:desktop-export-done')
  },

  // ── License update & revocation ───────────────────────────────────────────
  updateLicense:    (token) => ipcRenderer.invoke('app:update-license', token),
  getLocalIP:       ()      => ipcRenderer.invoke('app:local-ip'),
  onLicenseRevoked: (cb)    => {
    ipcRenderer.on('license:revoked', (_e, info) => cb(info))
    return () => ipcRenderer.removeAllListeners('license:revoked')
  },
  onLicenseReactivated: (cb) => {
    ipcRenderer.on('license:reactivated', (_e, info) => cb(info))
    return () => ipcRenderer.removeAllListeners('license:reactivated')
  },

  // ── Updates ───────────────────────────────────────────────────────────────
  checkUpdates:   () => ipcRenderer.invoke('app:check-updates'),
  installUpdate:  (url) => ipcRenderer.invoke('app:install-update', url),
  downloadUpdate: (url) => ipcRenderer.invoke('app:install-update', url),
  onUpdateProgress: (cb) => {
    const handler = (_e, pct) => cb(pct)
    ipcRenderer.on('app:update-progress', handler)
    return () => ipcRenderer.removeListener('app:update-progress', handler)
  },
  onUpdateInstalling: (cb) => {
    const handler = () => cb()
    ipcRenderer.on('app:update-installing', handler)
    return () => ipcRenderer.removeListener('app:update-installing', handler)
  },

  // ── Online status ─────────────────────────────────────────────────────────
  getOnlineStatus: () => ipcRenderer.invoke('app:online-status'),
  onOnlineStatus:  (cb) => {
    ipcRenderer.on('app:online-status', (_e, info) => cb(info))
    return () => ipcRenderer.removeAllListeners('app:online-status')
  },

  // ── Modules / droits (entitlements) ─────────────────────────────────────────
  getEntitlements: () => ipcRenderer.invoke('app:entitlements'),
  onEntitlements:  (cb) => {
    ipcRenderer.on('entitlements:update', (_e, info) => cb(info))
    return () => ipcRenderer.removeAllListeners('entitlements:update')
  },

  // ── Centre de notifications ─────────────────────────────────────────────────
  getNotifications: () => ipcRenderer.invoke('app:notifications'),
  onNotifications:  (cb) => {
    ipcRenderer.on('notifications:update', (_e, info) => cb(info))
    return () => ipcRenderer.removeAllListeners('notifications:update')
  },
  ackNotification: (id) => ipcRenderer.invoke('app:ack-notification', id),

  // ── Crash reporting (avec consentement) ─────────────────────────────────────
  getCrashConsent: ()      => ipcRenderer.invoke('app:crash-consent'),
  setCrashConsent: (value) => ipcRenderer.invoke('app:set-crash-consent', value),
  reportCrash:     (info)  => ipcRenderer.invoke('app:report-crash', info),
  addBreadcrumb:   (action) => ipcRenderer.send('app:breadcrumb', action),

  // ── Utility ───────────────────────────────────────────────────────────────
  isElectron: true,
})
