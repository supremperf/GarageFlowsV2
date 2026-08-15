'use client'

import { useEffect, useRef, useState } from 'react'
import { X, KeyRound, CheckCircle, AlertCircle, Loader2, Monitor } from 'lucide-react'
import { GarageFlowIcon } from './GarageFlowLogo'
import { getOrCreateInstallId } from '@/lib/pwa-install-id'

interface Props {
  onClose: () => void
}

interface Poste {
  deviceId: string
  status: string
  name: string | null
  platform: string | null
  lastSeenAt: string | null
}

/**
 * Postes activés sur CETTE licence (GF-DUR-011).
 *
 * `GET /api/license/devices` existait sans qu'aucun écran ne l'appelle :
 * l'exploitant ne pouvait pas savoir combien de sièges il consommait, ni
 * lesquels. Quand l'activation échouait faute de siège, il n'avait aucun moyen
 * de comprendre pourquoi ni quoi faire.
 *
 * La liste est en LECTURE SEULE, et c'est dit. Libérer un poste depuis ici est
 * impossible : `/api/license/deactivate` exige le `deviceToken`, que seul
 * l'appareil concerné détient. Un poste hors service ne peut donc se libérer
 * lui-même — il faut passer par l'éditeur. Proposer un bouton qui ne pourrait
 * pas fonctionner serait pire que de ne rien proposer.
 */
function PostesActives() {
  const [etat, setEtat] = useState<{ seats: number; activeCount: number; devices: Poste[] } | null>(null)

  useEffect(() => {
    let vivant = true
    fetch('/api/license/devices', { cache: 'no-store' })
      .then(async (r) => {
        const d = await r.json().catch(() => null)
        // 401 hors contexte licence, 404 licence inconnue : le bloc disparaît
        // plutôt que d'afficher une erreur qui n'en est pas une.
        if (vivant && r.ok && d?.ok) setEtat({ seats: d.seats, activeCount: d.activeCount, devices: d.devices ?? [] })
      })
      .catch(() => {})
    return () => { vivant = false }
  }, [])

  if (!etat) return null
  const complet = etat.activeCount >= etat.seats

  return (
    <div className="mb-5 rounded-xl border p-3" style={{ borderColor: 'var(--border-color, rgba(255,255,255,0.1))' }}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold" style={{ color: 'var(--text-secondary, #94a3b8)' }}>
          Postes activés
        </p>
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
          complet ? 'text-amber-400 bg-amber-500/15' : 'text-emerald-400 bg-emerald-500/15'
        }`}>
          {etat.activeCount} / {etat.seats} siège{etat.seats > 1 ? 's' : ''}
        </span>
      </div>

      {etat.devices.length === 0 ? (
        <p className="text-[11px] mt-2" style={{ color: 'var(--text-secondary, #94a3b8)' }}>Aucun poste activé.</p>
      ) : (
        <ul className="mt-2 space-y-1">
          {etat.devices.map((p) => (
            <li key={p.deviceId} className="flex items-center gap-2 text-[11px]" style={{ color: 'var(--text-secondary, #94a3b8)' }}>
              <Monitor className="w-3 h-3 shrink-0 opacity-60" />
              <span className="truncate">{p.name ?? 'Poste sans nom'}</span>
              {p.status !== 'active' && <span className="opacity-60">({p.status === 'revoked' ? 'révoqué' : 'libéré'})</span>}
              {p.lastSeenAt && (
                <span className="ml-auto shrink-0 opacity-50">{new Date(p.lastSeenAt).toLocaleDateString('fr-FR')}</span>
              )}
            </li>
          ))}
        </ul>
      )}

      {complet && (
        <p className="text-[10px] text-amber-400/90 mt-2 leading-relaxed">
          Tous vos sièges sont pris. Un poste hors service ne se libère pas depuis ici : il faut le
          faire depuis ce poste s’il fonctionne encore, sinon demandez la libération à votre revendeur.
        </p>
      )}
    </div>
  )
}

export default function LicenseChangeModal({ onClose }: Props) {
  const [token, setToken] = useState('')
  const [loading, setLoading] = useState(false)
  const [shown, setShown] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string; licenseType?: string } | null>(null)

  const dialogRef = useRef<HTMLDivElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)

  const isElectron = typeof window !== 'undefined' && !!(window as unknown as { electronAPI?: unknown }).electronAPI

  // Accessibilité + comportement modale : focus initial, Échap, piège de focus,
  // verrou de défilement, restauration du focus sur le bouton d'origine.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null
    setShown(true)
    // Focus initial dans le champ de licence (après la transition d'entrée).
    const focusTimer = window.setTimeout(() => taRef.current?.focus(), 60)

    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden' // empêche le défilement de l'arrière-plan

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return }
      if (e.key !== 'Tab') return
      // Piège de focus : garder la tabulation dans la modale.
      const root = dialogRef.current
      if (!root) return
      const focusables = root.querySelectorAll<HTMLElement>(
        'button, textarea, input, a[href], [tabindex]:not([tabindex="-1"])',
      )
      const list = Array.from(focusables).filter((el) => !el.hasAttribute('disabled'))
      if (list.length === 0) return
      const first = list[0]
      const last = list[list.length - 1]
      const active = document.activeElement as HTMLElement | null
      if (e.shiftKey && active === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKeyDown)

    return () => {
      window.clearTimeout(focusTimer)
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = prevOverflow
      previouslyFocused?.focus?.() // restaure le focus sur le déclencheur
    }
  }, [onClose])

  async function handleSubmit() {
    const t = token.trim()
    if (!t) return
    setLoading(true)
    setResult(null)

    try {
      if (isElectron) {
        const res = await (window as unknown as { electronAPI: { updateLicense: (t: string) => Promise<{ ok: boolean; licenseType?: string; reason?: string }> } }).electronAPI.updateLicense(t)
        if (res.ok) {
          setResult({ ok: true, message: `Licence activée (${res.licenseType})`, licenseType: res.licenseType })
          setTimeout(() => { onClose(); window.location.reload() }, 1500)
        } else {
          setResult({ ok: false, message: res.reason ?? 'Licence invalide' })
        }
      } else {
        // ── Trois défauts cumulés, corrigés ensemble (GF-008) ─────────────────
        // 1. le corps portait `token`, alors que la route lit `body.license`
        //    (src/app/api/license/activate/route.ts:293) : le serveur recevait
        //    une licence VIDE et refusait TOUTE clé, même parfaitement valide ;
        // 2. aucun `installId` n'était transmis, alors que la route l'exige
        //    hors Electron pour toute licence non-admin — l'appel serait resté
        //    refusé (DEVICE_REQUIRED) même après correction du nom de champ ;
        // 3. le message affiché lisait `data.error`, champ que cette route
        //    n'émet JAMAIS (elle émet `reason`) : le motif réel du refus était
        //    systématiquement remplacé par un « Licence invalide » générique.
        // La branche Electron, elle, fonctionnait — ce qui masquait le défaut
        // en recette sur poste.
        const installId = getOrCreateInstallId()
        const res = await fetch('/api/license/activate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ license: t, ...(installId ? { installId } : {}) }),
        })
        const data = await res.json()
        if (data.ok && data.licenseType) {
          setResult({ ok: true, message: `Licence activée (${data.licenseType})`, licenseType: data.licenseType })
          setTimeout(() => { onClose(); window.location.reload() }, 1500)
        } else {
          setResult({ ok: false, message: data.reason ?? data.error ?? 'Licence invalide' })
        }
      }
    } catch {
      setResult({ ok: false, message: 'Erreur réseau' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className={`fixed inset-0 z-[200] flex items-center justify-center p-4 transition-opacity duration-200 motion-reduce:transition-none ${shown ? 'opacity-100' : 'opacity-0'}`}
      style={{
        paddingTop: 'max(1rem, env(safe-area-inset-top))',
        paddingBottom: 'max(1rem, env(safe-area-inset-bottom))',
      }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      {/* Couche 1 — assombrissement + halo radial bleu pour la profondeur. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        style={{ background: 'radial-gradient(120% 120% at 50% 45%, rgba(37,99,235,0.14), rgba(2,6,23,0.72) 55%, rgba(2,6,23,0.86))' }}
      />
      {/* Couche 2 — GRAND logo GarageFlows officiel : la marque hexagonale au-dessus
          du mot « GARAGEFLOWS » (lockup vertical fidèle au logo fourni), centré et
          faiblement visible. */}
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-[3vmin] opacity-[0.09] blur-[1.5px] transition-transform duration-500 ease-out motion-reduce:transition-none ${shown ? 'scale-100' : 'scale-95'}`}
        style={{ width: 'min(82vw, 70vh)' }}
      >
        <GarageFlowIcon
          size={560}
          className="!w-[min(52vw,46vh)] !h-[min(52vw,46vh)] drop-shadow-[0_0_120px_rgba(37,99,235,0.5)]"
        />
        <div className="font-black tracking-tight leading-none whitespace-nowrap" style={{ fontSize: 'min(11vw, 9.5vh)' }}>
          <span style={{
            background: 'linear-gradient(135deg,#f8fafc,#cbd5e1 45%,#94a3b8)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
          }}>GARAGE</span>
          <span style={{
            background: 'linear-gradient(135deg,#60a5fa,#2563eb)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
          }}>FLOWS</span>
        </div>
      </div>

      {/* Couche 3 — la modale au premier plan. */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="license-modal-title"
        className={`relative z-10 w-full max-w-md rounded-2xl border shadow-2xl p-6 max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain transition-all duration-200 ease-out motion-reduce:transition-none ${shown ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}`}
        style={{
          background: 'var(--card-bg, #1a2235)',
          borderColor: 'var(--border-color, rgba(255,255,255,0.12))',
          boxShadow: '0 24px 70px -20px rgba(2,6,23,0.85), 0 0 0 1px rgba(96,165,250,0.10)',
        }}
      >
        <button
          onClick={onClose}
          aria-label="Fermer"
          className="absolute top-4 right-4 p-1 rounded-md text-slate-500 hover:text-slate-300 hover:bg-white/10 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="flex items-center gap-3 mb-5">
          <div className="w-9 h-9 rounded-xl bg-blue-500/20 flex items-center justify-center">
            <KeyRound className="w-4.5 h-4.5 text-blue-400" />
          </div>
          <div>
            <h2 id="license-modal-title" className="text-base font-bold" style={{ color: 'var(--text-primary, #f1f5f9)' }}>
              Changer de licence
            </h2>
            <p className="text-xs" style={{ color: 'var(--text-secondary, #94a3b8)' }}>
              Entrez votre nouvelle clé pour passer de Trial → Pro → Admin
            </p>
          </div>
        </div>

        <PostesActives />

        <label htmlFor="license-key-input" className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary, #94a3b8)' }}>
          Clé de licence
        </label>
        <textarea
          id="license-key-input"
          ref={taRef}
          value={token}
          onChange={e => setToken(e.target.value)}
          placeholder="GF2.eyJ..."
          rows={4}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          className="w-full rounded-lg border px-3 py-2 text-xs font-mono resize-none outline-none focus:ring-2 focus:ring-blue-500/50 transition-all"
          style={{
            background: 'var(--input-bg, #0d1724)',
            borderColor: 'var(--border-color, rgba(255,255,255,0.1))',
            color: 'var(--text-primary, #f1f5f9)',
          }}
          disabled={loading}
        />

        {result && (
          <div
            role="status"
            className={`mt-3 flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium ${
              result.ok ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'
            }`}
          >
            {result.ok
              ? <CheckCircle className="w-3.5 h-3.5 flex-shrink-0" />
              : <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />}
            {result.message}
          </div>
        )}

        <div className="flex gap-2 mt-4">
          <button
            onClick={onClose}
            className="flex-1 py-2 rounded-lg text-xs font-medium border transition-colors"
            style={{
              borderColor: 'var(--border-color, rgba(255,255,255,0.1))',
              color: 'var(--text-secondary, #94a3b8)',
            }}
          >
            Annuler
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading || !token.trim()}
            className="flex-1 py-2 rounded-lg text-xs font-semibold bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-1.5"
          >
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <KeyRound className="w-3.5 h-3.5" />}
            {loading ? 'Activation...' : 'Activer la licence'}
          </button>
        </div>
      </div>
    </div>
  )
}
