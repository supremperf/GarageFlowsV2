'use client'

/**
 * Fenêtre moderne de mise à jour GarageFlow.
 *
 * S'affiche automatiquement quand le processus Electron détecte une nouvelle
 * version (événement `app:update-available`, émis au démarrage puis toutes les
 * heures). Affiche l'icône GarageFlow, la version actuelle et la nouvelle, les
 * nouveautés (changelog), la taille du téléchargement, la progression en temps
 * réel et les actions « Installer maintenant » / « Plus tard » (cette dernière
 * masquée lorsque la mise à jour est obligatoire).
 *
 * Sécurité : l'installation vérifie l'empreinte SHA-256 avant de lancer
 * l'installateur (géré côté processus principal) — un fichier altéré est refusé.
 */

import { useEffect, useRef, useState } from 'react'
import { Download, Clock, ShieldCheck, AlertTriangle, HardDriveDownload, Sparkles } from 'lucide-react'
import { GarageFlowIcon } from './GarageFlowLogo'

interface UpdateInfo {
  hasUpdate: boolean
  currentVersion?: string
  latestVersion?: string
  title?: string | null
  releaseNotes?: string | null
  downloadUrl?: string | null
  sha256?: string | null
  size?: number | null
  fileName?: string | null
  mandatory?: boolean
  minVersion?: string | null
}

function fmtSize(bytes?: number | null): string | null {
  if (!bytes) return null
  const mb = bytes / 1_000_000
  return mb >= 1 ? `${mb.toFixed(1)} Mo` : `${Math.round(bytes / 1000)} Ko`
}

export default function UpdateModal() {
  const [info, setInfo] = useState<UpdateInfo | null>(null)
  const [installing, setInstalling] = useState(false)
  const [progress, setProgress] = useState<number | null>(null)
  const [closing, setClosing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dismissed = useRef<Set<string>>(new Set())

  const electron = typeof window !== 'undefined' ? (window as any).electronAPI : null

  useEffect(() => {
    if (!electron) return
    const offs: Array<() => void> = []

    if (electron.onUpdateAvailable) {
      offs.push(
        electron.onUpdateAvailable((i: UpdateInfo) => {
          if (!i?.hasUpdate || !i.latestVersion) return
          if (dismissed.current.has(i.latestVersion) && !i.mandatory) return
          setError(null)
          setInfo(i)
        }),
      )
    }
    if (electron.onUpdateProgress) {
      offs.push(electron.onUpdateProgress((pct: number) => setProgress(pct)))
    }
    if (electron.onUpdateInstalling) {
      offs.push(electron.onUpdateInstalling(() => setClosing(true)))
    }
    if (electron.onUpdateError) {
      offs.push(
        electron.onUpdateError((msg: string) => {
          setError(msg || 'Échec de la mise à jour')
          setInstalling(false)
          setProgress(null)
        }),
      )
    }
    return () => offs.forEach((o) => typeof o === 'function' && o())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!info) return null

  const sizeLabel = fmtSize(info.size)

  async function install() {
    if (!electron?.installUpdate || !info?.downloadUrl) {
      if (info?.downloadUrl) window.open(info.downloadUrl, '_blank')
      return
    }
    setInstalling(true)
    setProgress(0)
    setError(null)
    try {
      const res = await electron.installUpdate({
        url: info.downloadUrl,
        sha256: info.sha256 ?? undefined,
        fileName: info.fileName ?? undefined,
        version: info.latestVersion,
      })
      if (res && res.ok === false) throw new Error(res.reason || 'Échec de la mise à jour')
      // Succès : l'installateur est lancé, l'app va se fermer (données conservées).
    } catch (e: any) {
      setError(e?.message ?? 'Échec du téléchargement de la mise à jour')
      setInstalling(false)
      setProgress(null)
    }
  }

  function later() {
    if (info?.mandatory) return
    if (info?.latestVersion) dismissed.current.add(info.latestVersion)
    setInfo(null)
  }

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      style={{ background: 'rgba(3,7,18,0.72)', backdropFilter: 'blur(6px)' }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="gf-update-title"
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-2xl border border-white/10 bg-[#0b1220] shadow-2xl"
        style={{ boxShadow: '0 25px 80px -20px rgba(37,99,235,0.55)' }}
      >
        {/* En-tête aux couleurs GarageFlow */}
        <div
          className="relative flex items-center gap-4 px-6 py-5"
          style={{ background: 'linear-gradient(135deg, rgba(37,99,235,0.22), rgba(14,165,233,0.10))' }}
        >
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/[0.06] ring-1 ring-white/10">
            <GarageFlowIcon size={40} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-blue-300" />
              <p className="text-xs font-semibold uppercase tracking-wide text-blue-300">
                Mise à jour disponible{info.mandatory ? ' — requise' : ''}
              </p>
            </div>
            <h2 id="gf-update-title" className="mt-0.5 truncate text-lg font-bold text-white">
              {info.title || `GarageFlow ${info.latestVersion}`}
            </h2>
          </div>
        </div>

        <div className="space-y-4 px-6 py-5">
          {/* Versions */}
          <div className="flex items-center justify-center gap-3 text-sm">
            <span className="rounded-lg bg-white/[0.04] px-3 py-1.5 text-slate-400">
              Actuelle&nbsp;: <strong className="text-slate-300">v{info.currentVersion ?? '—'}</strong>
            </span>
            <span className="text-slate-500">→</span>
            <span className="rounded-lg bg-blue-500/15 px-3 py-1.5 text-blue-300">
              Nouvelle&nbsp;: <strong>v{info.latestVersion}</strong>
            </span>
          </div>

          {/* Changelog */}
          {info.releaseNotes && (
            <div className="max-h-48 overflow-y-auto rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Nouveautés</p>
              <p className="whitespace-pre-line text-sm leading-relaxed text-slate-300">{info.releaseNotes}</p>
            </div>
          )}

          {/* Taille + intégrité */}
          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
            {sizeLabel && (
              <span className="inline-flex items-center gap-1.5">
                <HardDriveDownload className="h-3.5 w-3.5" /> {sizeLabel}
              </span>
            )}
            {info.sha256 && (
              <span className="inline-flex items-center gap-1.5 text-emerald-400/80">
                <ShieldCheck className="h-3.5 w-3.5" /> Vérifié SHA-256
              </span>
            )}
          </div>

          {/* Erreur */}
          {error && (
            <div className="flex items-start gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2.5 text-sm text-red-300">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Progression */}
          {installing ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm text-blue-300">
                <span className="inline-flex items-center gap-2">
                  <HardDriveDownload className="h-4 w-4 animate-pulse" />
                  {closing
                    ? 'Fermeture pour installer…'
                    : progress != null && progress < 100
                      ? 'Téléchargement…'
                      : 'Préparation…'}
                </span>
                <span>{closing ? 100 : (progress ?? 0)}%</span>
              </div>
              <div className="h-2.5 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${closing ? 100 : (progress ?? 5)}%`,
                    background: 'linear-gradient(90deg,#2563eb,#38bdf8)',
                  }}
                />
              </div>
              <p className="text-[11px] leading-relaxed text-slate-500">
                L&apos;application se fermera automatiquement puis l&apos;installateur remplacera l&apos;ancienne version.
                Vos données (clients, interventions, devis, stock…) sont conservées.
              </p>
            </div>
          ) : (
            <div className="flex items-center justify-end gap-3 pt-1">
              {!info.mandatory && (
                <button
                  onClick={later}
                  className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium text-slate-300 transition hover:bg-white/[0.05]"
                >
                  <Clock className="h-4 w-4" /> Plus tard
                </button>
              )}
              <button
                onClick={install}
                className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-500"
              >
                <Download className="h-4 w-4" /> Installer maintenant
              </button>
            </div>
          )}

          {info.mandatory && !installing && (
            <p className="text-center text-[11px] text-amber-400/80">
              Cette mise à jour est obligatoire pour continuer à utiliser GarageFlow.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
