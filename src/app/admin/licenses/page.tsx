'use client'

/**
 * Admin License Management Panel — /admin/licenses
 * Access is enforced server-side by the middleware (signed gf_session JWT with
 * typ=admin). The API routes verify isAdminSession() independently.
 *
 * v2: ECC P-256 licenses. Key generation is server-side (private key never
 * leaves the server). The Generate modal calls POST /api/admin/licenses/generate.
 */

import { useState, useEffect, useCallback, FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import {
  Shield, ShieldCheck, ShieldX, ShieldAlert, Key, Plus, Trash2,
  Copy, Check, RefreshCw, Search, Edit3, Save, X,
  Crown, LogOut, ChevronDown, ChevronUp, AlertTriangle,
  ToggleLeft, ToggleRight, Loader2, Download, Fingerprint,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { GarageFlowIcon } from '@/components/GarageFlowLogo'
import WindowControls from '@/components/WindowControls'
import toast, { Toaster } from 'react-hot-toast'

// ─── Types ─────────────────────────────────────────────────────────────────────
interface LicenseRecord {
  id:          number
  licenseId:   string
  token:       string
  customerId:  string
  licenseType: string
  expiryAt:    string
  status:      'active' | 'revoked' | 'suspended'
  isAdmin:     boolean
  seats:       number
  hwid:        string | null
  label:       string | null
  notes:       string | null
  activatedAt: string | null
  revokedAt:   string | null
  lastSeenAt:  string | null
  createdAt:   string
}

type StatusFilter = 'all' | 'active' | 'revoked' | 'suspended'

const STATUS_CFG = {
  active:    { label: 'Active',     Icon: ShieldCheck,  bg: 'bg-emerald-500/15', text: 'text-emerald-400', border: 'border-emerald-500/25' },
  revoked:   { label: 'Révoquée',  Icon: ShieldX,      bg: 'bg-red-500/15',     text: 'text-red-400',     border: 'border-red-500/25'     },
  suspended: { label: 'Suspendue', Icon: ShieldAlert,  bg: 'bg-amber-500/15',   text: 'text-amber-400',   border: 'border-amber-500/25'   },
}

const TYPE_CFG: Record<string, { label: string; color: string; bg: string }> = {
  admin:      { label: 'Admin',      color: 'text-amber-400',   bg: 'bg-amber-500/15'   },
  enterprise: { label: 'Enterprise', color: 'text-purple-400',  bg: 'bg-purple-500/15'  },
  premium:    { label: 'Premium',    color: 'text-blue-400',    bg: 'bg-blue-500/15'    },
  trial:      { label: 'Essai',      color: 'text-slate-400',   bg: 'bg-slate-500/15'   },
}

// ─── Helpers ───────────────────────────────────────────────────────────────────
function fmtDate(s: string | null) {
  if (!s) return '—'
  return new Date(s).toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

function StatusBadge({ status }: { status: LicenseRecord['status'] }) {
  const { label, Icon, bg, text, border } = STATUS_CFG[status]
  return (
    <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border', bg, text, border)}>
      <Icon className="w-2.5 h-2.5" />{label}
    </span>
  )
}

function TypeBadge({ type }: { type: string }) {
  const cfg = TYPE_CFG[type] ?? { label: type, color: 'text-slate-400', bg: 'bg-slate-500/15' }
  return (
    <span className={cn('inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold', cfg.bg, cfg.color)}>
      {cfg.label}
    </span>
  )
}

function CopyBtn({ text }: { text: string }) {
  const [ok, setOk] = useState(false)
  return (
    <button onClick={() => navigator.clipboard.writeText(text).then(() => { setOk(true); setTimeout(() => setOk(false), 1400) })}
      title="Copier"
      className="p-1.5 rounded-lg hover:bg-white/[0.07] text-slate-500 hover:text-slate-300 transition-all">
      {ok ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  )
}

// ─── Generate Modal ────────────────────────────────────────────────────────────
function GenerateModal({
  onClose, onGenerated,
}: { onClose(): void; onGenerated(r: LicenseRecord): void }) {
  const [customerId,   setCustomerId]   = useState('')
  const [licenseType,  setLicenseType]  = useState('premium')
  const [years,        setYears]        = useState('1')
  const [seats,        setSeats]        = useState('1')
  const [label,        setLabel]        = useState('')
  const [hwid,         setHwid]         = useState('')
  const [generating,   setGenerating]   = useState(false)
  const [generated,    setGenerated]    = useState<LicenseRecord | null>(null)
  const [activating,   setActivating]   = useState(false)
  const [activated,    setActivated]    = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!customerId.trim()) { toast.error('ID client requis'); return }
    setGenerating(true)
    try {
      const res = await fetch('/api/admin/licenses/generate', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          customerId: customerId.trim(),
          licenseType,
          years:  parseInt(years) || 1,
          seats:  parseInt(seats) || 1,
          label:  label.trim() || null,
          hwid:   hwid.trim() || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error ?? 'Erreur génération'); return }
      toast.success('Licence générée et enregistrée')
      onGenerated(data)
      setGenerated(data)
    } finally {
      setGenerating(false)
    }
  }

  const INP = 'w-full px-3 py-2.5 rounded-xl bg-white/[0.05] border border-white/[0.10] text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md bg-[#111827] border border-white/[0.08] rounded-2xl p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-600/20 flex items-center justify-center">
              <Plus className="w-4 h-4 text-blue-400" />
            </div>
            <h3 className="font-bold text-white">Nouvelle licence ECC</h3>
          </div>
          <button onClick={onClose} className="gf-close p-1.5 rounded-lg hover:bg-white/[0.07] text-slate-500 hover:text-white transition-all">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="text-xs font-semibold text-slate-400 mb-1.5 block">ID Client *</label>
            <input value={customerId} onChange={e => setCustomerId(e.target.value)}
              placeholder="ex: CUST-042 ou Garage-Martin" required className={INP} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-slate-400 mb-1.5 block">Type</label>
              <select value={licenseType} onChange={e => setLicenseType(e.target.value)}
                className={INP + ' bg-[#1a2540]'}>
                <option value="trial">Essai (trial)</option>
                <option value="premium">Premium</option>
                <option value="enterprise">Enterprise</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-400 mb-1.5 block">Durée (ans)</label>
              <input type="number" min={1} max={10} value={years}
                onChange={e => setYears(e.target.value)} className={INP} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-slate-400 mb-1.5 block">Postes</label>
              <input type="number" min={1} value={seats}
                onChange={e => setSeats(e.target.value)} className={INP} />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-400 mb-1.5 block">Étiquette</label>
              <input value={label} onChange={e => setLabel(e.target.value)}
                placeholder="Garage Martin" className={INP} />
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-400 mb-1.5 flex items-center gap-1.5">
              <Fingerprint className="w-3.5 h-3.5 text-slate-600" />
              HWID (optionnel — lie au matériel)
            </label>
            <input value={hwid} onChange={e => setHwid(e.target.value)}
              placeholder="SHA-256 hex du hardware — laisser vide pour libre"
              className={INP + ' font-mono text-xs'} />
            <p className="text-[10px] text-slate-700 mt-1">
              Obtenez le HWID avec: <span className="font-mono text-slate-600">python scripts/keygen.py --hwid</span>
            </p>
          </div>

          {/* Generated token display + activation */}
          {generated && (
            <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/[0.05] p-3 space-y-2">
              <p className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider">Licence générée</p>
              <div className="flex items-start gap-2 p-2 rounded-lg bg-white/[0.03] border border-white/[0.05]">
                <p className="font-mono text-[10px] text-slate-500 break-all flex-1 leading-relaxed">
                  {generated.token}
                </p>
                <CopyBtn text={generated.token} />
              </div>
              {!activated && (
                <button
                  type="button"
                  onClick={async () => {
                    setActivating(true)
                    try {
                      const r = await fetch('/api/license/activate', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ license: generated.token }),
                      })
                      if (r.ok) setActivated(true)
                    } finally {
                      setActivating(false)
                    }
                  }}
                  disabled={activating}
                  className="mt-2 w-full py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors disabled:opacity-50"
                >
                  {activating ? 'Activation...' : 'Activer sur cette machine'}
                </button>
              )}
              {activated && (
                <p className="text-center text-sm font-semibold text-emerald-400 py-1">
                  ✓ Licence activée avec succès
                </p>
              )}
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 rounded-xl border border-white/[0.10] text-slate-400 text-sm font-semibold hover:bg-white/[0.05] transition-all">
              {generated ? 'Fermer' : 'Annuler'}
            </button>
            {!generated && (
              <button type="submit" disabled={generating}
                className="flex-1 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-500 disabled:opacity-40 transition-all flex items-center justify-center gap-2">
                {generating ? <><Loader2 className="w-4 h-4 animate-spin" />Signature…</> : <><Key className="w-4 h-4" />Générer et signer</>}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Key Row ───────────────────────────────────────────────────────────────────
function KeyRow({ item, onUpdate, onDelete }: {
  item:     LicenseRecord
  onUpdate: (id: number, data: Partial<LicenseRecord>) => void
  onDelete: (id: number) => void
}) {
  const [editingLabel, setEditingLabel] = useState(false)
  const [labelVal,     setLabelVal]     = useState(item.label ?? '')
  const [loading,      setLoading]      = useState(false)
  const [expanded,     setExpanded]     = useState(false)

  const expired = item.expiryAt ? new Date(item.expiryAt) < new Date() : false

  async function patch(data: object) {
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/licenses/${item.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(data),
      })
      if (res.ok) onUpdate(item.id, await res.json())
    } finally { setLoading(false) }
  }

  async function patchStatus(status: 'active' | 'revoked' | 'suspended') {
    await patch({ status })
    toast.success(status === 'active' ? 'Réactivée' : status === 'revoked' ? 'Révoquée' : 'Suspendue')
  }

  async function saveLabel() {
    await patch({ label: labelVal || null })
    setEditingLabel(false)
    toast.success('Étiquette mise à jour')
  }

  async function handleDelete() {
    if (!confirm('Supprimer cette licence définitivement ?')) return
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/licenses/${item.id}`, { method: 'DELETE' })
      if (res.ok) { onDelete(item.id); toast.success('Supprimée') }
    } finally { setLoading(false) }
  }

  const expDate = item.expiryAt ? new Date(item.expiryAt).toLocaleDateString('fr-FR') : '—'

  return (
    <div className={cn('border rounded-xl transition-all overflow-hidden',
      item.status === 'revoked'   ? 'border-red-500/20 bg-red-500/[0.03]' :
      item.status === 'suspended' ? 'border-amber-500/20 bg-amber-500/[0.03]' :
      'border-white/[0.07] bg-white/[0.02] hover:bg-white/[0.03]'
    )}>
      <div className="flex items-center gap-3 p-3">
        {/* Icon */}
        <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0',
          item.isAdmin ? 'bg-amber-500/20' : 'bg-slate-800')}>
          {item.isAdmin ? <Crown className="w-4 h-4 text-amber-400" /> : <Key className="w-4 h-4 text-slate-500" />}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-[11px] font-semibold text-slate-400 truncate max-w-[180px]" title={item.licenseId}>
              {item.licenseId.slice(0, 8)}…
            </span>
            <TypeBadge type={item.licenseType} />
            <StatusBadge status={item.status} />
            {expired && item.status === 'active' && (
              <span className="text-[9px] font-black text-orange-400 bg-orange-500/15 border border-orange-500/25 px-1.5 py-0.5 rounded-full">
                EXPIRÉ
              </span>
            )}
          </div>

          {/* Label / customer */}
          <div className="mt-0.5 flex items-center gap-1">
            {editingLabel ? (
              <div className="flex items-center gap-1 w-full max-w-xs">
                <input value={labelVal} onChange={e => setLabelVal(e.target.value)} autoFocus
                  className="flex-1 px-2 py-0.5 rounded-lg bg-white/[0.08] border border-white/[0.15] text-xs text-white focus:outline-none"
                  onKeyDown={e => { if (e.key === 'Enter') saveLabel(); if (e.key === 'Escape') setEditingLabel(false) }}
                />
                <button onClick={saveLabel} className="p-1 rounded hover:bg-emerald-500/20 text-emerald-400"><Save className="w-3 h-3" /></button>
                <button onClick={() => setEditingLabel(false)} className="p-1 rounded hover:bg-white/[0.07] text-slate-500"><X className="w-3 h-3" /></button>
              </div>
            ) : (
              <>
                <span className="text-[11px] text-slate-500">
                  {item.label ? `${item.label} · ` : ''}<span className="font-mono">{item.customerId}</span>
                </span>
                <button onClick={() => setEditingLabel(true)}
                  className="p-0.5 rounded hover:bg-white/[0.07] text-slate-700 hover:text-slate-400 transition-all">
                  <Edit3 className="w-2.5 h-2.5" />
                </button>
              </>
            )}
          </div>
        </div>

        {/* Expiry + seats */}
        <div className="hidden md:flex flex-col items-end text-[10px] text-slate-600 font-mono">
          <span>exp {expDate}</span>
          <span>{item.seats} poste{item.seats !== 1 ? 's' : ''}</span>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1">
          <CopyBtn text={item.token} />

          {!loading ? (
            item.status === 'active' ? (
              <button onClick={() => patchStatus('revoked')} title="Révoquer"
                className="p-1.5 rounded-lg hover:bg-red-500/15 text-slate-500 hover:text-red-400 transition-all">
                <ToggleRight className="w-4 h-4" />
              </button>
            ) : (
              <button onClick={() => patchStatus('active')} title="Réactiver"
                className="p-1.5 rounded-lg hover:bg-emerald-500/15 text-slate-500 hover:text-emerald-400 transition-all">
                <ToggleLeft className="w-4 h-4" />
              </button>
            )
          ) : (
            <Loader2 className="w-4 h-4 animate-spin text-slate-500 mx-1.5" />
          )}

          <button onClick={handleDelete} title="Supprimer"
            className="p-1.5 rounded-lg hover:bg-red-500/15 text-slate-600 hover:text-red-400 transition-all">
            <Trash2 className="w-3.5 h-3.5" />
          </button>

          <button onClick={() => setExpanded(v => !v)}
            className="p-1.5 rounded-lg hover:bg-white/[0.07] text-slate-600 hover:text-slate-400 transition-all">
            {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="px-3 pb-3 border-t border-white/[0.05]">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
            {[
              { label: 'Enregistrée',  value: fmtDate(item.createdAt)   },
              { label: 'Activée',      value: fmtDate(item.activatedAt) },
              { label: 'Dernière vue', value: fmtDate(item.lastSeenAt)  },
              { label: 'Révoquée le', value: fmtDate(item.revokedAt)   },
            ].map(({ label, value }) => (
              <div key={label}>
                <p className="text-[9px] text-slate-600 uppercase tracking-wider font-bold">{label}</p>
                <p className="text-xs text-slate-400 mt-0.5">{value}</p>
              </div>
            ))}
          </div>

          {/* Token */}
          <div className="mt-3">
            <p className="text-[9px] text-slate-600 uppercase tracking-wider font-bold mb-1">Token complet</p>
            <div className="flex items-start gap-2 p-2 rounded-lg bg-white/[0.03] border border-white/[0.05]">
              <p className="font-mono text-[10px] text-slate-600 break-all flex-1 leading-relaxed">
                {item.token}
              </p>
              <CopyBtn text={item.token} />
            </div>
          </div>

          {/* HWID + LID */}
          <div className="mt-2 grid grid-cols-1 gap-1">
            <p className="text-[9px] text-slate-700">
              LID: <span className="font-mono text-slate-600">{item.licenseId}</span>
            </p>
            {item.hwid && (
              <p className="text-[9px] text-slate-700">
                HWID: <span className="font-mono text-slate-600">{item.hwid}</span>
              </p>
            )}
          </div>

          {/* Quick actions */}
          {item.status === 'active' && (
            <div className="flex gap-2 mt-3">
              <button onClick={() => patchStatus('suspended')}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-amber-500/25 text-amber-400 hover:bg-amber-500/10 transition-all flex items-center gap-1.5">
                <ShieldAlert className="w-3 h-3" />Suspendre temporairement
              </button>
            </div>
          )}
          {item.status === 'suspended' && (
            <div className="flex gap-2 mt-3">
              <button onClick={() => patchStatus('active')}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-emerald-500/25 text-emerald-400 hover:bg-emerald-500/10 transition-all flex items-center gap-1.5">
                <ShieldCheck className="w-3 h-3" />Réactiver
              </button>
              <button onClick={() => patchStatus('revoked')}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-red-500/25 text-red-400 hover:bg-red-500/10 transition-all flex items-center gap-1.5">
                <ShieldX className="w-3 h-3" />Révoquer définitivement
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Main Page ─────────────────────────────────────────────────────────────────
export default function AdminLicensesPage() {
  const router = useRouter()
  const [keys,         setKeys]         = useState<LicenseRecord[]>([])
  const [loading,      setLoading]      = useState(true)
  const [search,       setSearch]       = useState('')
  const [filter,       setFilter]       = useState<StatusFilter>('all')
  const [showGenerate, setShowGenerate] = useState(false)
  const [authorized,   setAuthorized]   = useState(false)

  // Authorization is enforced by the middleware; confirm via first API call.
  useEffect(() => { setAuthorized(true) }, [])

  const fetchKeys = useCallback(async () => {
    setLoading(true)
    try {
      const res  = await fetch('/api/admin/licenses')
      if (res.status === 403) { router.replace('/license'); return }
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error ?? 'Erreur de chargement des licences')
        setKeys([])
        return
      }
      setKeys(Array.isArray(data) ? data : [])
    } catch {
      toast.error('Impossible de contacter le serveur')
    } finally { setLoading(false) }
  }, [router])

  useEffect(() => { if (authorized) fetchKeys() }, [authorized, fetchKeys])

  function handleUpdate(id: number, data: Partial<LicenseRecord>) {
    setKeys(prev => prev.map(k => k.id === id ? { ...k, ...data } : k))
  }

  function exportCSV() {
    const header = 'LID,CustomerID,Type,Statut,Expiry,Postes,Label,Créée le,Dernière vue'
    const rows   = keys.map(k => [
      k.licenseId, k.customerId, k.licenseType, k.status,
      k.expiryAt ? new Date(k.expiryAt).toLocaleDateString('fr-FR') : '',
      k.seats, k.label ?? '', fmtDate(k.createdAt), fmtDate(k.lastSeenAt),
    ].join(','))
    const blob = new Blob([header + '\n' + rows.join('\n')], { type: 'text/csv;charset=utf-8;' })
    const url  = URL.createObjectURL(blob)
    Object.assign(document.createElement('a'), { href: url, download: `gf-licences-${new Date().toISOString().slice(0, 10)}.csv` }).click()
    URL.revokeObjectURL(url)
  }

  const stats = {
    total:     keys.length,
    active:    keys.filter(k => k.status === 'active').length,
    revoked:   keys.filter(k => k.status === 'revoked').length,
    suspended: keys.filter(k => k.status === 'suspended').length,
  }

  const filtered = keys.filter(k => {
    if (filter !== 'all' && k.status !== filter) return false
    if (!search) return true
    const q = search.toLowerCase()
    return [k.licenseId, k.customerId, k.licenseType, k.label ?? ''].some(v => v.toLowerCase().includes(q))
  })

  if (!authorized) return null

  return (
    <div className="min-h-screen bg-[#070d1b] text-white">
      <Toaster position="top-right" toastOptions={{ style: { background: '#1e2d4e', color: '#f8fafc', border: '1px solid rgba(255,255,255,0.08)' } }} />

      {/* Header */}
      <header
        className="sticky top-0 z-20 bg-[#0f1629]/95 backdrop-blur-xl border-b border-white/[0.07] px-6 py-3"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
            <GarageFlowIcon size={36} />
            <div>
              <h1 className="font-black text-white text-base leading-tight">GarageFlow</h1>
              <div className="flex items-center gap-1.5">
                <Shield className="w-3 h-3 text-amber-400" />
                <span className="text-[10px] text-amber-400 font-black tracking-[0.15em] uppercase">Panneau Administrateur · ECC v2</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
            <button onClick={fetchKeys}
              className="p-2 rounded-lg hover:bg-white/[0.07] text-slate-500 hover:text-white transition-all" title="Actualiser">
              <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
            </button>
            <button onClick={exportCSV}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/[0.10] text-xs font-semibold text-slate-400 hover:bg-white/[0.05] hover:text-white transition-all">
              <Download className="w-3.5 h-3.5" />CSV
            </button>
            <button onClick={() => setShowGenerate(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-bold hover:bg-blue-500 transition-all shadow-lg shadow-blue-600/20">
              <Plus className="w-3.5 h-3.5" />Nouvelle licence
            </button>
            <button onClick={() => router.push('/login')}
              className="p-2 rounded-lg hover:bg-white/[0.07] text-slate-500 hover:text-white transition-all" title="Quitter">
              <LogOut className="w-4 h-4" />
            </button>
            <div className="ml-1 pl-2 border-l border-white/[0.07]">
              <WindowControls />
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-6">

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          {[
            { label: 'Total',      value: stats.total,     Icon: Key,         color: 'text-slate-400',   bg: 'bg-slate-500/10'   },
            { label: 'Actives',    value: stats.active,    Icon: ShieldCheck,  color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
            { label: 'Révoquées', value: stats.revoked,   Icon: ShieldX,      color: 'text-red-400',     bg: 'bg-red-500/10'     },
            { label: 'Suspendues', value: stats.suspended, Icon: ShieldAlert,  color: 'text-amber-400',   bg: 'bg-amber-500/10'   },
          ].map(({ label, value, Icon, color, bg }) => (
            <div key={label} className="bg-[#111827] border border-white/[0.07] rounded-xl p-4">
              <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center mb-2', bg)}>
                <Icon className={cn('w-4 h-4', color)} />
              </div>
              <p className="text-2xl font-black text-white">{value}</p>
              <p className="text-xs text-slate-500 mt-0.5">{label}</p>
            </div>
          ))}
        </div>

        {/* Search + filters */}
        <div className="flex flex-col sm:flex-row gap-3 mb-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-600" />
            <input type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Rechercher par LID, client, type, étiquette…"
              className="w-full pl-9 pr-4 py-2.5 rounded-xl bg-[#111827] border border-white/[0.08] text-sm text-white placeholder-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
          </div>
          <div className="flex items-center gap-1 bg-[#111827] border border-white/[0.08] rounded-xl p-1">
            {(['all', 'active', 'revoked', 'suspended'] as StatusFilter[]).map(s => (
              <button key={s} onClick={() => setFilter(s)}
                className={cn('px-3 py-1.5 rounded-lg text-xs font-semibold transition-all',
                  filter === s ? 'bg-blue-600 text-white' : 'text-slate-500 hover:text-white hover:bg-white/[0.07]')}>
                {s === 'all' ? 'Tout' : s === 'active' ? 'Actives' : s === 'revoked' ? 'Révoquées' : 'Suspendues'}
              </button>
            ))}
          </div>
        </div>

        {/* List */}
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-slate-600" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <Key className="w-10 h-10 text-slate-800 mx-auto mb-3" />
            <p className="text-slate-600 text-sm">
              {keys.length === 0
                ? 'Aucune licence enregistrée. Cliquez sur « Nouvelle licence » pour commencer.'
                : 'Aucune licence ne correspond à la recherche.'}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map(item => (
              <KeyRow key={item.id} item={item}
                onUpdate={handleUpdate}
                onDelete={id => setKeys(prev => prev.filter(k => k.id !== id))} />
            ))}
            <p className="text-[10px] text-slate-700 text-center pt-2">
              {filtered.length} licence{filtered.length !== 1 ? 's' : ''}
              {search || filter !== 'all' ? ` sur ${keys.length} au total` : ''}
            </p>
          </div>
        )}

        {/* Info banner */}
        <div className="mt-8 p-4 rounded-xl border border-amber-500/20 bg-amber-500/[0.05] flex items-start gap-3">
          <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="text-xs font-bold text-amber-400">Système de licence ECC P-256</p>
            <p className="text-xs text-amber-600/70">
              Chaque licence est signée avec ECDSA-SHA256. La clé privée reste sur votre serveur
              (<code className="text-amber-500/70">keys/private.pem</code> ou{' '}
              <code className="text-amber-500/70">GF_PRIVATE_KEY</code>).
              Révoquer une clé bloque l&apos;accès immédiatement à la prochaine vérification.
            </p>
            <p className="text-xs text-amber-600/70">
              Génération en ligne de commande :{' '}
              <code className="text-amber-500/70">python scripts/keygen.py --gen --customer CUST-001</code>
            </p>
          </div>
        </div>
      </main>

      {showGenerate && (
        <GenerateModal
          onClose={() => setShowGenerate(false)}
          onGenerated={r => setKeys(prev => [r, ...prev])}
        />
      )}
    </div>
  )
}
