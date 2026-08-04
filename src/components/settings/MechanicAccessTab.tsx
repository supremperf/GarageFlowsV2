'use client'

/**
 * Onglet « Accès mécaniciens » (propriétaire / responsable).
 *
 * Permet d'enregistrer une clé mécanicien (générée par le Keygen), de l'associer
 * à un mécanicien, de la suspendre / réactiver / révoquer individuellement, de
 * déconnecter ses appareils et de copier la clé quand c'est nécessaire. Aucune
 * génération cryptographique ici (réservée au Keygen). Toutes les actions sont
 * appliquées ET vérifiées côté serveur.
 */

import { useEffect, useState, useCallback } from 'react'
import { Loader2, KeyRound, Plus, UserCheck, Ban, PauseCircle, PlayCircle, LogOut, Copy, ShieldAlert } from 'lucide-react'
import toast from 'react-hot-toast'

interface MechLicense {
  licenseId: string
  status: string
  expiryAt: string
  mechanicId: string | null
  mechanicName: string | null
  mechanicHint: string | null
  assigned: boolean
  assignedAt: string | null
  lastSeenAt: string | null
  suspendedAt: string | null
  createdAt: string
  activeDevices: number
}
interface Mechanic { id: string; name: string }

const STATUS_STYLE: Record<string, string> = {
  active: 'bg-emerald-500/15 text-emerald-300',
  suspended: 'bg-amber-500/15 text-amber-300',
  revoked: 'bg-red-500/15 text-red-300',
}
const STATUS_LABEL: Record<string, string> = { active: 'Active', suspended: 'Suspendue', revoked: 'Révoquée' }

export function MechanicAccessTab() {
  const [licenses, setLicenses] = useState<MechLicense[]>([])
  const [mechanics, setMechanics] = useState<Mechanic[]>([])
  const [loading, setLoading] = useState(true)
  const [max, setMax] = useState(20)
  const [busy, setBusy] = useState<string | null>(null)
  const [token, setToken] = useState('')
  const [showAdd, setShowAdd] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [lic, mech] = await Promise.all([
        fetch('/api/mechanic-licenses', { cache: 'no-store' }).then((r) => r.json()),
        fetch('/api/mechanics', { cache: 'no-store' }).then((r) => r.json()),
      ])
      setLicenses(Array.isArray(lic.data) ? lic.data : [])
      setMax(lic.max ?? 20)
      setMechanics(Array.isArray(mech) ? mech : (mech.data ?? []))
    } catch {
      toast.error('Chargement impossible')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function register() {
    if (!token.trim() || busy) return
    setBusy('register')
    try {
      const res = await fetch('/api/mechanic-licenses', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token.trim() }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error ?? 'Enregistrement refusé'); return }
      toast.success('Clé mécanicien enregistrée')
      setToken(''); setShowAdd(false); load()
    } catch { toast.error('Erreur réseau') } finally { setBusy(null) }
  }

  async function assign(licenseId: string, mechanicId: string) {
    if (!mechanicId) return
    setBusy(licenseId)
    try {
      const res = await fetch(`/api/mechanic-licenses/${licenseId}/assign`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mechanicId }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error ?? 'Attribution refusée'); return }
      toast.success(data.reassignment ? 'Clé réattribuée (anciennes sessions fermées)' : 'Clé attribuée')
      load()
    } catch { toast.error('Erreur réseau') } finally { setBusy(null) }
  }

  async function setStatus(licenseId: string, status: string, confirmMsg?: string) {
    if (confirmMsg && !window.confirm(confirmMsg)) return
    setBusy(licenseId)
    try {
      const res = await fetch(`/api/mechanic-licenses/${licenseId}/status`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error ?? 'Action refusée'); return }
      toast.success('Statut mis à jour'); load()
    } catch { toast.error('Erreur réseau') } finally { setBusy(null) }
  }

  async function disconnect(licenseId: string) {
    setBusy(licenseId)
    try {
      const res = await fetch(`/api/mechanic-licenses/${licenseId}/disconnect`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error ?? 'Action refusée'); return }
      toast.success(`${data.disconnected} appareil(s) déconnecté(s)`); load()
    } catch { toast.error('Erreur réseau') } finally { setBusy(null) }
  }

  async function copyToken(licenseId: string) {
    // §9 — récupération protégée : POST (token jamais dans l'URL) + réauthentification.
    const password = window.prompt('Confirmez votre mot de passe pour copier la clé mécanicien :')
    if (password === null) return // annulé
    try {
      const res = await fetch(`/api/mechanic-licenses/${licenseId}/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ password }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error ?? 'Copie refusée'); return }
      await navigator.clipboard.writeText(data.token)
      toast.success('Clé copiée')
    } catch { toast.error('Copie impossible') }
  }

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-slate-500" /></div>

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold text-white flex items-center gap-2"><KeyRound className="w-4 h-4 text-blue-400" />Accès mécaniciens</h3>
          <p className="text-xs text-slate-500 mt-0.5">{licenses.length} / {max} clé(s) · générées par le Keygen, associées ici.</p>
        </div>
        <button onClick={() => setShowAdd((v) => !v)} className="inline-flex items-center gap-1.5 text-xs bg-blue-600 hover:bg-blue-500 text-white px-3 py-2 rounded-lg font-medium">
          <Plus className="w-4 h-4" /> Enregistrer une clé
        </button>
      </div>

      {showAdd && (
        <div className="bg-white/[0.03] border border-white/[0.08] rounded-xl p-3">
          <label className="block text-xs text-slate-400 mb-1.5">Collez la clé mécanicien (GF2.…) générée par le Keygen</label>
          <textarea value={token} onChange={(e) => setToken(e.target.value)} rows={2}
            spellCheck={false} placeholder="GF2.…"
            className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-xs font-mono text-slate-200 placeholder-slate-600 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500/40" />
          <div className="flex justify-end gap-2 mt-2">
            <button onClick={() => { setShowAdd(false); setToken('') }} className="text-xs text-slate-400 px-3 py-1.5">Annuler</button>
            <button disabled={busy === 'register' || !token.trim()} onClick={register} className="text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white px-3 py-1.5 rounded-lg font-medium">
              {busy === 'register' ? 'Enregistrement…' : 'Enregistrer'}
            </button>
          </div>
        </div>
      )}

      {licenses.length === 0 ? (
        <div className="text-center py-10 text-slate-500 text-sm">
          <KeyRound className="w-8 h-8 mx-auto mb-3 opacity-40" />
          Aucune clé mécanicien. La création de clés reste facultative.
        </div>
      ) : (
        <ul className="space-y-2.5">
          {licenses.map((l) => (
            <li key={l.licenseId} className="bg-[#0d1424] border border-white/[0.06] rounded-xl p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${STATUS_STYLE[l.status] ?? ''}`}>{STATUS_LABEL[l.status] ?? l.status}</span>
                    {l.activeDevices > 0 && <span className="text-[10px] text-emerald-400">● {l.activeDevices} connecté(s)</span>}
                  </div>
                  <p className="text-sm text-white font-medium mt-1 truncate">
                    {l.assigned ? (l.mechanicName ?? 'Mécanicien') : <span className="text-amber-400 inline-flex items-center gap-1"><ShieldAlert className="w-3.5 h-3.5" />Non attribuée</span>}
                  </p>
                  <p className="text-[11px] text-slate-500 font-mono">…{l.licenseId.slice(-8)} · exp {new Date(l.expiryAt).toLocaleDateString('fr-FR')}{l.mechanicHint && !l.assigned ? ` · indice: ${l.mechanicHint}` : ''}</p>
                </div>
              </div>

              {/* Attribution */}
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <select
                  defaultValue={l.mechanicId ?? ''} disabled={busy === l.licenseId || l.status === 'revoked'}
                  onChange={(e) => assign(l.licenseId, e.target.value)}
                  className="text-xs bg-white/[0.05] border border-white/[0.08] rounded-lg px-2 py-1.5 text-slate-200 focus:outline-none disabled:opacity-50"
                >
                  <option value="" disabled>{l.assigned ? 'Réattribuer à…' : 'Associer à un mécanicien…'}</option>
                  {mechanics.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
                {l.assigned && <UserCheck className="w-4 h-4 text-emerald-400" />}
              </div>

              {/* Actions */}
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {l.status === 'active' && (
                  <button disabled={busy === l.licenseId} onClick={() => setStatus(l.licenseId, 'suspended')} className="text-[11px] inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-amber-500/10 text-amber-300 hover:bg-amber-500/20"><PauseCircle className="w-3.5 h-3.5" />Suspendre</button>
                )}
                {l.status === 'suspended' && (
                  <button disabled={busy === l.licenseId} onClick={() => setStatus(l.licenseId, 'active')} className="text-[11px] inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20"><PlayCircle className="w-3.5 h-3.5" />Réactiver</button>
                )}
                {l.status !== 'revoked' && (
                  <button disabled={busy === l.licenseId} onClick={() => setStatus(l.licenseId, 'revoked', 'Révoquer définitivement cette clé mécanicien ? Le mécanicien perdra l\'accès immédiatement.')} className="text-[11px] inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-red-500/10 text-red-300 hover:bg-red-500/20"><Ban className="w-3.5 h-3.5" />Révoquer</button>
                )}
                {l.activeDevices > 0 && (
                  <button disabled={busy === l.licenseId} onClick={() => disconnect(l.licenseId)} className="text-[11px] inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-white/[0.04] text-slate-300 hover:bg-white/[0.08]"><LogOut className="w-3.5 h-3.5" />Déconnecter</button>
                )}
                <button disabled={busy === l.licenseId} onClick={() => copyToken(l.licenseId)} className="text-[11px] inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-white/[0.04] text-slate-300 hover:bg-white/[0.08]"><Copy className="w-3.5 h-3.5" />Copier la clé</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
