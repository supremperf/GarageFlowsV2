'use client'

import { useState, useEffect, useRef } from 'react'
import { useTranslation } from '@/lib/i18n'
import { RefreshCw, Download, CheckCircle, AlertCircle, Upload, Shield, FileUp, HardDriveDownload } from 'lucide-react'

interface UpdateInfo {
  hasUpdate: boolean
  latestVersion?: string
  releaseUrl?: string
  downloadUrl?: string
  releaseNotes?: string
  fileName?: string
  sha256?: string | null
  size?: number | null
  mandatory?: boolean
}

export function UpdatesTab() {
  const { t } = useTranslation()
  const [currentVersion, setCurrentVersion] = useState('1.0.0')
  const [checking, setChecking] = useState(false)
  const [info, setInfo]         = useState<UpdateInfo | null>(null)
  const [error, setError]       = useState<string | null>(null)

  // Téléchargement / installation (utilisateur)
  const [installing, setInstalling] = useState(false)
  const [progress, setProgress]     = useState<number | null>(null)
  const [closing, setClosing]       = useState(false)

  // Publication (admin)
  const [isAdmin,        setIsAdmin]       = useState(false)
  const [adminVersion,   setAdminVersion]  = useState('')
  const [adminNotes,     setAdminNotes]    = useState('')
  const [file,           setFile]          = useState<File | null>(null)
  const [publishing,     setPublishing]    = useState(false)
  const [uploadPct,      setUploadPct]     = useState<number | null>(null)
  const [publishResult,  setPublishResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const electron = typeof window !== 'undefined' ? (window as any).electronAPI : null

  useEffect(() => {
    fetch('/api/license/type')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.licenseType === 'admin') setIsAdmin(true) })
      .catch(() => {})

    if (electron?.getLicenseInfo) {
      electron.getLicenseInfo().then((i: any) => { if (i?.isAdmin) setIsAdmin(true) }).catch(() => {})
    }
    if (electron?.getVersion) {
      electron.getVersion().then((v: string) => { if (v) setCurrentVersion(v) }).catch(() => {})
    }
    // Progression du téléchargement de l'installeur (émise par le process Electron)
    let off: any
    let offInstalling: any
    if (electron?.onUpdateProgress) {
      off = electron.onUpdateProgress((pct: number) => setProgress(pct))
    }
    // L'app va se fermer pour laisser l'installeur remplacer les fichiers.
    if (electron?.onUpdateInstalling) {
      offInstalling = electron.onUpdateInstalling(() => setClosing(true))
    }
    return () => {
      if (typeof off === 'function') off()
      if (typeof offInstalling === 'function') offInstalling()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function checkForUpdates() {
    setChecking(true); setError(null); setInfo(null)
    try {
      if (electron?.checkUpdates) {
        setInfo(await electron.checkUpdates())
      } else {
        // En dehors d'Electron : lit l'info publiée par l'admin.
        const r = await fetch('/api/admin/updates')
        const d = await r.json().catch(() => ({ hasUpdate: false }))
        setInfo(d?.hasUpdate ? { ...d, hasUpdate: d.latestVersion !== currentVersion } : { hasUpdate: false })
      }
    } catch (err: any) {
      setError(err?.message ?? 'Erreur lors de la vérification')
    } finally {
      setChecking(false)
    }
  }

  async function installUpdate() {
    const url = info?.downloadUrl ?? info?.releaseUrl
    if (!url) return
    if (!electron?.installUpdate) { window.open(url, '_blank'); return }
    setInstalling(true); setProgress(0); setError(null)
    try {
      // Passe l'empreinte SHA-256 → le processus principal vérifie l'intégrité
      // avant d'installer (fichier altéré = installation refusée).
      const res = await electron.installUpdate({
        url,
        sha256: info?.sha256 ?? undefined,
        fileName: info?.fileName ?? undefined,
        version: info?.latestVersion,
      })
      if (res && res.ok === false) throw new Error(res.reason || 'Échec de la mise à jour')
      // Succès : l'installeur est lancé — les données (userData) sont conservées.
    } catch (e: any) {
      setError(e?.message ?? 'Échec du téléchargement de la mise à jour')
    } finally {
      setInstalling(false)
    }
  }

  function publishUpload() {
    if (!adminVersion.trim() || !file) return
    setPublishing(true); setUploadPct(0); setPublishResult(null)

    const fd = new FormData()
    fd.append('version', adminVersion.trim())
    fd.append('releaseNotes', adminNotes.trim())
    fd.append('file', file)

    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/admin/updates')
    xhr.upload.onprogress = e => {
      if (e.lengthComputable) setUploadPct(Math.round((e.loaded / e.total) * 100))
    }
    xhr.onload = () => {
      setPublishing(false)
      let data: any = null
      try { data = JSON.parse(xhr.responseText) } catch { /* ignore */ }
      if (xhr.status >= 200 && xhr.status < 300) {
        setPublishResult({ ok: true, msg: `Mise à jour v${adminVersion} publiée (${(file.size / 1e6).toFixed(1)} Mo). Les utilisateurs pourront l'installer depuis « Vérifier les mises à jour ».` })
        setAdminVersion(''); setAdminNotes(''); setFile(null)
        if (fileInputRef.current) fileInputRef.current.value = ''
      } else {
        setPublishResult({ ok: false, msg: data?.error ?? `Erreur ${xhr.status}` })
      }
    }
    xhr.onerror = () => { setPublishing(false); setPublishResult({ ok: false, msg: 'Erreur réseau lors du téléversement' }) }
    xhr.send(fd)
  }

  return (
    <div className="space-y-6">
      {/* ── Version courante + bouton vérifier ─────────────────────────────── */}
      <div className="flex items-center justify-between p-4 rounded-xl bg-white/[0.03] border border-white/[0.07]">
        <div>
          <p className="text-sm font-medium text-slate-300">{t.currentVersion ?? 'Version actuelle'}</p>
          <p className="text-lg font-bold text-white mt-0.5">v{currentVersion}</p>
        </div>
        <button
          onClick={checkForUpdates}
          disabled={checking || installing}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold disabled:opacity-50 transition-all"
        >
          <RefreshCw className={`w-4 h-4 ${checking ? 'animate-spin' : ''}`} />
          {checking ? (t.loading ?? 'Vérification…') : (t.checkUpdates ?? 'Vérifier les mises à jour')}
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-3 p-4 rounded-xl bg-red-500/10 border border-red-500/20">
          <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
          <p className="text-sm text-red-300">{error}</p>
        </div>
      )}

      {info && !info.hasUpdate && !installing && (
        <div className="flex items-center gap-3 p-4 rounded-xl bg-green-500/10 border border-green-500/20">
          <CheckCircle className="w-5 h-5 text-green-400 flex-shrink-0" />
          <p className="text-sm text-green-300">{t.updateNone ?? 'Vous utilisez la dernière version.'}</p>
        </div>
      )}

      {info?.hasUpdate && (
        <div className="p-4 rounded-xl bg-blue-500/10 border border-blue-500/30 space-y-3">
          <div className="flex items-center gap-2">
            <Download className="w-5 h-5 text-blue-400" />
            <p className="text-sm font-semibold text-blue-300">
              {(t.updateAvailable ?? 'Mise à jour disponible')} — v{info.latestVersion}
            </p>
          </div>
          {info.releaseNotes && (
            <p className="text-xs text-slate-400 whitespace-pre-line">{info.releaseNotes}</p>
          )}

          {installing ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm text-blue-300">
                <HardDriveDownload className="w-4 h-4 animate-pulse" />
                {closing
                  ? 'GarageFlow va se fermer pour installer la mise à jour…'
                  : progress != null && progress < 100
                  ? `Téléchargement… ${progress}%`
                  : 'Préparation de l\'installation…'}
              </div>
              <div className="h-2 rounded-full bg-white/10 overflow-hidden">
                <div
                  className="h-full bg-blue-500 transition-all"
                  style={{ width: `${closing ? 100 : (progress ?? 10)}%` }}
                />
              </div>
              <p className="text-[11px] text-slate-500">
                L&apos;application va se fermer automatiquement, puis l&apos;installeur remplacera
                l&apos;ancienne version. Vos données (clients, interventions, devis, stock…) sont conservées.
              </p>
            </div>
          ) : (
            <button
              onClick={installUpdate}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold transition-all"
            >
              <Download className="w-4 h-4" />
              {t.installUpdate ?? 'Mettre à jour'}
            </button>
          )}
        </div>
      )}

      {/* ── Admin : publier une mise à jour (téléversement du .exe) ─────────── */}
      {isAdmin && (
        <div className="space-y-4 border-t border-white/[0.07] pt-6">
          <div className="flex items-center gap-2 mb-1">
            <Shield className="w-4 h-4 text-amber-400" />
            <p className="text-sm font-bold text-amber-400">Zone Administrateur — Publier une mise à jour</p>
          </div>
          <p className="text-xs text-slate-500 -mt-1">
            Téléversez directement le nouvel installeur <strong>.exe</strong>. Les utilisateurs pourront le
            télécharger et l&apos;installer en un clic, sans perdre leurs données.
          </p>
          <div className="flex items-start gap-2 text-xs text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <span>
              Important : téléversez le fichier <strong>« GarageFlow&nbsp;Setup&nbsp;X.Y.Z.exe »</strong> généré
              par le build (dossier <em>dist</em>), et non l&apos;exécutable de l&apos;application
              (<em>win-unpacked/GarageFlow.exe</em>) qui nécessite ses fichiers annexes et ne peut pas
              s&apos;installer seul.
            </span>
          </div>

          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Numéro de version *</label>
              <input
                value={adminVersion}
                onChange={e => setAdminVersion(e.target.value)}
                placeholder="ex: 1.2.0"
                className="w-full rounded-lg border bg-white/[0.03] border-white/10 px-3 py-2 text-sm text-white placeholder-slate-600 outline-none focus:ring-2 focus:ring-amber-500/40"
              />
            </div>

            {/* Sélecteur de fichier .exe */}
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Fichier installeur (.exe) *</label>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full flex items-center gap-3 rounded-lg border border-dashed border-white/15 bg-white/[0.02] hover:bg-white/[0.05] px-3 py-3 text-left transition-colors"
              >
                <FileUp className="w-5 h-5 text-amber-400 flex-shrink-0" />
                {file ? (
                  <span className="text-sm text-slate-200 truncate">
                    {file.name} <span className="text-slate-500">({(file.size / 1e6).toFixed(1)} Mo)</span>
                  </span>
                ) : (
                  <span className="text-sm text-slate-500">Cliquez pour choisir le fichier GarageFlow-Setup.exe…</span>
                )}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".exe,application/x-msdownload,application/vnd.microsoft.portable-executable"
                className="hidden"
                onChange={e => setFile(e.target.files?.[0] ?? null)}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Notes de version</label>
              <textarea
                value={adminNotes}
                onChange={e => setAdminNotes(e.target.value)}
                placeholder="- Nouvelle fonctionnalité&#10;- Correction de bug"
                rows={4}
                className="w-full rounded-lg border bg-white/[0.03] border-white/10 px-3 py-2 text-sm text-white placeholder-slate-600 outline-none focus:ring-2 focus:ring-amber-500/40 resize-none"
              />
            </div>
          </div>

          {publishing && (
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs text-slate-400">
                <span>Téléversement…</span><span>{uploadPct ?? 0}%</span>
              </div>
              <div className="h-2 rounded-full bg-white/10 overflow-hidden">
                <div className="h-full bg-amber-500 transition-all" style={{ width: `${uploadPct ?? 0}%` }} />
              </div>
            </div>
          )}

          {publishResult && (
            <div className={`flex items-start gap-2 p-3 rounded-lg text-sm ${
              publishResult.ok
                ? 'bg-green-500/10 text-green-300 border border-green-500/20'
                : 'bg-red-500/10 text-red-300 border border-red-500/20'
            }`}>
              {publishResult.ok
                ? <CheckCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                : <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />}
              <span>{publishResult.msg}</span>
            </div>
          )}

          <button
            onClick={publishUpload}
            disabled={publishing || !adminVersion.trim() || !file}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-sm font-semibold disabled:opacity-50 transition-all"
          >
            <Upload className={`w-4 h-4 ${publishing ? 'animate-pulse' : ''}`} />
            {publishing ? 'Publication…' : 'Publier la mise à jour'}
          </button>
        </div>
      )}

      <div className="text-xs text-slate-600 space-y-1">
        <p>Vos données sont stockées séparément de l&apos;application et sont conservées à chaque mise à jour.</p>
        <p>Une sauvegarde automatique est effectuée avant chaque installation.</p>
      </div>
    </div>
  )
}
