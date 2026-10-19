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
    const handler = (_e, msg) => cb(msg)
    ipcRenderer.on('license-error', handler)
    return () => ipcRenderer.removeListener('license-error', handler)
  },

  // ── Window controls ───────────────────────────────────────────────────────
  windowAPI: {
    minimize:         () => ipcRenderer.invoke('win:minimize'),
    maximizeToggle:   () => ipcRenderer.invoke('win:maximize-toggle'),
    close:            () => ipcRenderer.invoke('win:close'),
    fullscreenToggle: () => ipcRenderer.invoke('win:fullscreen-toggle'),
    isMaximized:      () => ipcRenderer.invoke('win:is-maximized'),
    onMaximizedChange: (cb) => {
      const handler = (_, v) => cb(v)
      ipcRenderer.on('win:maximized-change', handler)
      return () => ipcRenderer.removeListener('win:maximized-change', handler)
    },
    onFullscreenChange: (cb) => {
      const handler = (_, v) => cb(v)
      ipcRenderer.on('win:fullscreen-change', handler)
      return () => ipcRenderer.removeListener('win:fullscreen-change', handler)
    },
  },

  // ── Desktop export ────────────────────────────────────────────────────────
  exportToDesktop:    () => ipcRenderer.invoke('app:desktop-export-now'),
  openDesktopExports: () => ipcRenderer.invoke('app:open-desktop-export'),

  /**
   * Ouvre un lien EXTERNE dans le navigateur du système (GF-025).
   *
   * Sans ce pont, un `<a target="_blank">` vers un site hors de la liste blanche
   * ne faisait RIEN dans l'application packagée : le gestionnaire d'ouverture
   * refuse tout le reste. Les 135 liens « Site de la plateforme » du catalogue
   * de facturation électronique — dont aucun hôte n'est dans la liste — étaient
   * donc tous morts, sans le moindre message.
   *
   * Le processus principal reste seul juge : il n'ouvre qu'en HTTPS et rend un
   * motif de refus. Ce pont n'élargit pas la liste blanche.
   */
  openExternal: (url) => ipcRenderer.invoke('app:open-external', url),
  onDesktopExportDone:(cb) => {
    const handler = (_e, info) => cb(info)
    ipcRenderer.on('app:desktop-export-done', handler)
    return () => ipcRenderer.removeListener('app:desktop-export-done', handler)
  },

  // ── License update & revocation ───────────────────────────────────────────
  updateLicense:    (token) => ipcRenderer.invoke('app:update-license', token),
  getLocalIP:       ()      => ipcRenderer.invoke('app:local-ip'),
  onLicenseRevoked: (cb)    => {
    const handler = (_e, info) => cb(info)
    ipcRenderer.on('license:revoked', handler)
    return () => ipcRenderer.removeListener('license:revoked', handler)
  },
  onLicenseReactivated: (cb) => {
    const handler = (_e, info) => cb(info)
    ipcRenderer.on('license:reactivated', handler)
    return () => ipcRenderer.removeListener('license:reactivated', handler)
  },

  // ── Updates ───────────────────────────────────────────────────────────────
  checkUpdates:   () => ipcRenderer.invoke('app:check-updates'),
  // arg: string (URL) OU { url, sha256, size } — l'empreinte est vérifiée avant exécution
  installUpdate:  (arg) => ipcRenderer.invoke('app:install-update', arg),
  downloadUpdate: (arg) => ipcRenderer.invoke('app:install-update', arg),
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
  // Notification automatique (démarrage + toutes les heures) : une mise à jour existe.
  onUpdateAvailable: (cb) => {
    const handler = (_e, info) => cb(info)
    ipcRenderer.on('app:update-available', handler)
    return () => ipcRenderer.removeListener('app:update-available', handler)
  },
  // Erreur pendant le téléchargement/l'installation (ex. empreinte SHA-256 invalide).
  onUpdateError: (cb) => {
    const handler = (_e, msg) => cb(msg)
    ipcRenderer.on('app:update-error', handler)
    return () => ipcRenderer.removeListener('app:update-error', handler)
  },

  // ── Online status ─────────────────────────────────────────────────────────
  getOnlineStatus: () => ipcRenderer.invoke('app:online-status'),
  onOnlineStatus:  (cb) => {
    const handler = (_e, info) => cb(info)
    ipcRenderer.on('app:online-status', handler)
    return () => ipcRenderer.removeListener('app:online-status', handler)
  },

  // ── Modules / droits (entitlements) ─────────────────────────────────────────
  getEntitlements: () => ipcRenderer.invoke('app:entitlements'),
  onEntitlements:  (cb) => {
    const handler = (_e, info) => cb(info)
    ipcRenderer.on('entitlements:update', handler)
    return () => ipcRenderer.removeListener('entitlements:update', handler)
  },

  // ── Centre de notifications ─────────────────────────────────────────────────
  getNotifications: () => ipcRenderer.invoke('app:notifications'),
  onNotifications:  (cb) => {
    const handler = (_e, info) => cb(info)
    ipcRenderer.on('notifications:update', handler)
    return () => ipcRenderer.removeListener('notifications:update', handler)
  },
  ackNotification: (id) => ipcRenderer.invoke('app:ack-notification', id),

  // ── Crash reporting (avec consentement) ─────────────────────────────────────
  getCrashConsent: ()      => ipcRenderer.invoke('app:crash-consent'),
  setCrashConsent: (value) => ipcRenderer.invoke('app:set-crash-consent', value),
  reportCrash:     (info)  => ipcRenderer.invoke('app:report-crash', info),
  addBreadcrumb:   (action) => ipcRenderer.send('app:breadcrumb', action),

  // ── Démarrage automatique de Windows ───────────────────────────────────────
  // Lecture seule de l'état RÉEL (registre) et bascule ON/OFF. Aucun accès au
  // registre n'est exposé au-delà de ce réglage précis.
  getAutostart: () => ipcRenderer.invoke('app:autostart-get'),
  setAutostart: (actif) => ipcRenderer.invoke('app:autostart-set', actif === true),

  // ── Utility ───────────────────────────────────────────────────────────────
  isElectron: true,
})
