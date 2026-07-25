'use client'

import { useState, useEffect } from 'react'
import { Save, Zap, ShieldCheck, Car, Bell, ClipboardList, Package } from 'lucide-react'
import { cn } from '@/lib/utils'
import toast from 'react-hot-toast'

interface FeaturesSettings {
  workOrderPrefix: string
  warrantyMonthsDefault: number
  loanerEnabled: boolean
  smartReminderMonths: number
  purchaseOrderPrefix: string
  hourlyRate: number
}

const DEFAULT: FeaturesSettings = {
  workOrderPrefix: 'OR',
  warrantyMonthsDefault: 12,
  loanerEnabled: false,
  smartReminderMonths: 11,
  purchaseOrderPrefix: 'BC',
  hourlyRate: 60,
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-3 border-b border-white/[0.05] last:border-0">
      <div className="flex-1 min-w-0">
        <p className="text-sm text-slate-200">{label}</p>
        {hint && <p className="text-xs text-slate-500 mt-0.5">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-5 w-9 items-center rounded-full transition-colors',
        checked ? 'bg-blue-600' : 'bg-white/10'
      )}
    >
      <span className={cn(
        'inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform',
        checked ? 'translate-x-4.5' : 'translate-x-0.5'
      )} style={{ transform: checked ? 'translateX(18px)' : 'translateX(2px)' }} />
    </button>
  )
}

function NumberInput({ value, onChange, min, max }: { value: number; onChange: (v: number) => void; min?: number; max?: number }) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      onChange={e => onChange(Number(e.target.value))}
      className="w-20 bg-white/[0.05] border border-white/10 rounded-lg px-2.5 py-1.5 text-white text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-500"
    />
  )
}

function TextInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <input
      type="text"
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-24 bg-white/[0.05] border border-white/10 rounded-lg px-2.5 py-1.5 text-white text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-500"
    />
  )
}

export function FeaturesTab() {
  const [settings, setSettings] = useState<FeaturesSettings>(DEFAULT)
  const [loading, setLoading]   = useState(true)
  const [saving, setSaving]     = useState(false)

  useEffect(() => {
    fetch('/api/garages')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data) {
          setSettings({
            workOrderPrefix:       data.workOrderPrefix       ?? DEFAULT.workOrderPrefix,
            warrantyMonthsDefault: data.warrantyMonthsDefault ?? DEFAULT.warrantyMonthsDefault,
            loanerEnabled:         data.loanerEnabled         ?? DEFAULT.loanerEnabled,
            smartReminderMonths:   data.smartReminderMonths   ?? DEFAULT.smartReminderMonths,
            purchaseOrderPrefix:   data.purchaseOrderPrefix   ?? DEFAULT.purchaseOrderPrefix,
            hourlyRate:            data.hourlyRate            ?? DEFAULT.hourlyRate,
          })
        }
        setLoading(false)
      })
  }, [])

  async function save() {
    setSaving(true)
    try {
      const res = await fetch('/api/garages', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      })
      if (res.ok) {
        toast.success('Paramètres enregistrés')
      } else {
        toast.error('Erreur lors de l\'enregistrement')
      }
    } finally { setSaving(false) }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <span className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-6 py-2">
      {/* Work orders */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <ClipboardList className="w-4 h-4 text-blue-400" />
          <h3 className="text-sm font-semibold text-slate-200">Ordres de réparation</h3>
        </div>
        <div className="bg-white/[0.02] border border-white/[0.07] rounded-xl px-4">
          <Field label="Préfixe numéro" hint="ex: OR → OR-2026-001">
            <TextInput value={settings.workOrderPrefix} onChange={v => setSettings(s => ({ ...s, workOrderPrefix: v }))} placeholder="OR" />
          </Field>
          <Field label="Taux horaire (€/h)" hint="Utilisé dans les ordres de réparation">
            <NumberInput value={settings.hourlyRate} onChange={v => setSettings(s => ({ ...s, hourlyRate: v }))} min={1} max={999} />
          </Field>
        </div>
      </section>

      {/* Warranties */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <ShieldCheck className="w-4 h-4 text-emerald-400" />
          <h3 className="text-sm font-semibold text-slate-200">Garanties pièces</h3>
        </div>
        <div className="bg-white/[0.02] border border-white/[0.07] rounded-xl px-4">
          <Field label="Durée garantie par défaut (mois)" hint="Appliquée automatiquement à chaque nouvelle garantie">
            <NumberInput value={settings.warrantyMonthsDefault} onChange={v => setSettings(s => ({ ...s, warrantyMonthsDefault: v }))} min={1} max={120} />
          </Field>
        </div>
      </section>

      {/* Loaner vehicles */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <Car className="w-4 h-4 text-blue-400" />
          <h3 className="text-sm font-semibold text-slate-200">Prêt de véhicules</h3>
        </div>
        <div className="bg-white/[0.02] border border-white/[0.07] rounded-xl px-4">
          <Field label="Activer le prêt de véhicules" hint="Affiche le module de planning de prêt dans la barre d'outils">
            <Toggle checked={settings.loanerEnabled} onChange={v => setSettings(s => ({ ...s, loanerEnabled: v }))} />
          </Field>
        </div>
      </section>

      {/* Smart reminders */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <Bell className="w-4 h-4 text-amber-400" />
          <h3 className="text-sm font-semibold text-slate-200">Rappels clients intelligents</h3>
        </div>
        <div className="bg-white/[0.02] border border-white/[0.07] rounded-xl px-4">
          <Field label="Délai de relance (mois)" hint="Proposer un rappel si le client n'a pas eu de visite depuis N mois">
            <NumberInput value={settings.smartReminderMonths} onChange={v => setSettings(s => ({ ...s, smartReminderMonths: v }))} min={1} max={36} />
          </Field>
        </div>
      </section>

      {/* Purchase orders */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <Package className="w-4 h-4 text-purple-400" />
          <h3 className="text-sm font-semibold text-slate-200">Bons de commande</h3>
        </div>
        <div className="bg-white/[0.02] border border-white/[0.07] rounded-xl px-4">
          <Field label="Préfixe numéro" hint="ex: BC → BC-2026-001">
            <TextInput value={settings.purchaseOrderPrefix} onChange={v => setSettings(s => ({ ...s, purchaseOrderPrefix: v }))} placeholder="BC" />
          </Field>
        </div>
      </section>

      <div className="pt-2">
        <button onClick={save} disabled={saving}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium disabled:opacity-50">
          {saving ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Save className="w-4 h-4" />}
          Enregistrer les paramètres
        </button>
      </div>
    </div>
  )
}
