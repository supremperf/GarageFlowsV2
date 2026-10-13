'use client'

import { useRef } from 'react'
import { Image as ImageIcon, X, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import type { GarageSettings } from './types'
import { AddressAutocomplete } from '@/components/AddressAutocomplete'
import { CoordonneesBancaires } from './CoordonneesBancaires'
import {
  CRENEAUX_30MIN, CRENEAUX_FERMETURE, creneauEnMinutes, minutesEnCreneau,
  enHeureEtMinute, DEBUT_PAR_DEFAUT, FIN_PAR_DEFAUT,
} from '@/lib/planning/horaires'

const CURRENCIES    = ['EUR', 'USD', 'GBP', 'CHF', 'CAD', 'AUD', 'JPY', 'MAD', 'TND', 'DZD', 'XOF']
const PAYMENT_TERMS = ['À réception', '15 jours net', '30 jours net', '45 jours net', '60 jours net']

/** Valeur affichée par la liste : `HH:MM` reconstitué depuis l'heure + minutes. */
function creneauCourant(heure: string, minute: string): string {
  const h = Number.parseInt(heure, 10)
  const m = Number.parseInt(minute, 10)
  if (!Number.isFinite(h)) return minutesEnCreneau(DEBUT_PAR_DEFAUT)
  return minutesEnCreneau(h * 60 + (Number.isFinite(m) ? m : 0))
}

// Redimensionne une image (fichier) à `maxSide` px max, renvoie un data URL PNG léger.
function downscaleImage(file: File, maxSide: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = reject
    reader.onload = () => {
      const img = new window.Image()
      img.onload = () => {
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height))
        const w = Math.max(1, Math.round(img.width * scale))
        const h = Math.max(1, Math.round(img.height * scale))
        const canvas = document.createElement('canvas')
        canvas.width = w; canvas.height = h
        const ctx = canvas.getContext('2d')
        if (!ctx) return reject(new Error('canvas'))
        ctx.imageSmoothingQuality = 'high'
        ctx.drawImage(img, 0, 0, w, h)
        resolve(canvas.toDataURL('image/png'))
      }
      img.onerror = reject
      img.src = reader.result as string
    }
    reader.readAsDataURL(file)
  })
}

interface Props {
  s: GarageSettings
  set: <K extends keyof GarageSettings>(k: K, v: GarageSettings[K]) => void
  loading: boolean
}

function Field({ label, k, type = 'text', placeholder = '', optional = false, s, set }: {
  label: string; k: keyof GarageSettings; type?: string; placeholder?: string; optional?: boolean
  s: GarageSettings; set: <K extends keyof GarageSettings>(k: K, v: GarageSettings[K]) => void
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-400 mb-1">
        {label}{optional && <span className="ml-1 text-slate-600">(optionnel)</span>}
      </label>
      <input
        type={type}
        value={s[k]}
        onChange={e => set(k, e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-white/10 bg-white/[0.05] text-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-slate-600"
      />
    </div>
  )
}

export function CompanyTab({ s, set, loading }: Props) {
  const fileRef = useRef<HTMLInputElement>(null)

  async function handleLogo(file: File) {
    if (file.size > 15 * 1024 * 1024) { toast.error('Logo trop lourd (max 15 Mo)'); return }
    try {
      // On redimensionne côté client (max 512 px) : le logo importé reste léger,
      // s'affiche partout et n'alourdit pas la base — quelle que soit la taille source.
      const dataUrl = await downscaleImage(file, 512)
      set('logoBase64', dataUrl)
      toast.success('Logo importé')
    } catch {
      toast.error("Impossible de lire cette image")
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
      </div>
    )
  }

  const f = (props: Omit<Parameters<typeof Field>[0], 's' | 'set'>) =>
    <Field {...props} s={s} set={set} />

  return (
    <div className="space-y-4">
      {/* Logo */}
      <div>
        <label className="block text-xs font-medium text-slate-400 mb-2">Logo du garage</label>
        <div
          className="flex items-center gap-4 p-3 rounded-xl border-2 border-dashed border-white/10 hover:border-blue-500/40 cursor-pointer transition-all group"
          onClick={() => fileRef.current?.click()}
        >
          {(s.logoBase64 || s.logoPath) ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={s.logoBase64 || `/api/photos/${s.logoPath}`}
              alt="logo"
              className="w-12 h-12 object-contain rounded-lg border border-white/10"
            />
          ) : (
            <div className="w-12 h-12 rounded-lg bg-white/[0.05] flex items-center justify-center group-hover:bg-blue-500/10 transition-colors">
              <ImageIcon className="w-5 h-5 text-slate-500 group-hover:text-blue-400" />
            </div>
          )}
          <div>
            <p className="text-sm font-medium text-slate-300">Importer un logo</p>
            <p className="text-xs text-slate-500">PNG, JPG, SVG · max 15 Mo</p>
          </div>
          {(s.logoBase64 || s.logoPath) && (
            <button className="ml-auto text-slate-500 hover:text-red-400"
              onClick={e => { e.stopPropagation(); set('logoBase64', ''); set('logoPath', '') }}>
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        <input ref={fileRef} type="file" accept="image/*" className="hidden"
          onChange={e => { const file = e.target.files?.[0]; if (file) handleLogo(file) }} />
      </div>

      {f({ label: 'Nom du garage *', k: 'name', placeholder: 'Mon Garage SARL' })}

      {/* Adresse avec propositions (GF-022) — la saisie reste libre : un
          lieu-dit ou une adresse absente de la base doit rester possible. */}
      <div>
        <label className="block text-xs font-medium text-slate-400 mb-1" htmlFor="gf-adresse-garage">
          Adresse<span className="ml-1 text-slate-600">(optionnel)</span>
        </label>
        <AddressAutocomplete
          id="gf-adresse-garage"
          value={s.address}
          onChange={(v) => set('address', v)}
          placeholder="12 rue de la Mécanique"
          className="w-full rounded-lg border border-white/10 bg-white/[0.05] text-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-slate-600"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        {f({ label: 'Téléphone', k: 'phone', type: 'tel', placeholder: '+33 1 23 45 67', optional: true })}
        {f({ label: 'Email', k: 'email', type: 'email', placeholder: 'contact@garage.fr', optional: true })}
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-400 mb-1">
          Numéro SMS rappels <span className="text-slate-600">(optionnel)</span>
        </label>
        <input
          type="tel"
          value={s.smsPhone}
          onChange={e => set('smsPhone', e.target.value)}
          placeholder="Numéro affiché dans vos rappels SMS"
          className="w-full rounded-lg border border-white/10 bg-white/[0.05] text-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-slate-600"
        />
        <p className="text-[10px] text-slate-600 mt-1">Ce numéro sera inclus dans les messages SMS envoyés aux clients pour les rappels d&apos;entretien.</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {f({ label: 'Site web', k: 'website', placeholder: 'www.garage.fr', optional: true })}
        {f({ label: 'Taux horaire (€/h)', k: 'hourlyRate', type: 'number', placeholder: '60' })}
      </div>

      {/* ── Horaires d'atelier, au pas de 30 minutes (GF-021) ──────────────────
          Les deux listes n'offraient que des heures PLEINES, et seulement de 6 h
          à 18 h pour l'ouverture, 12 h à 24 h pour la fermeture : un atelier qui
          ouvre à 8 h 30, ferme à 18 h 30, ou travaille de nuit ne pouvait pas se
          déclarer. La journée entière est proposée, par demi-heures. */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1" htmlFor="gf-ouverture">
            Heure d&apos;ouverture
          </label>
          <select
            id="gf-ouverture"
            value={creneauCourant(s.workshopStartHour, s.workshopStartMinute)}
            onChange={e => {
              const { heure, minute } = enHeureEtMinute(creneauEnMinutes(e.target.value) ?? DEBUT_PAR_DEFAUT)
              set('workshopStartHour', String(heure))
              set('workshopStartMinute', String(minute))
            }}
            className="w-full rounded-lg border border-white/10 bg-white/[0.05] text-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            {CRENEAUX_30MIN.map(c => (
              <option key={c} value={c} className="bg-[#111827]">{c.replace(':', 'h')}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1" htmlFor="gf-fermeture">
            Heure de fermeture
          </label>
          <select
            id="gf-fermeture"
            value={creneauCourant(s.workshopEndHour, s.workshopEndMinute)}
            onChange={e => {
              const { heure, minute } = enHeureEtMinute(creneauEnMinutes(e.target.value) ?? FIN_PAR_DEFAUT)
              set('workshopEndHour', String(heure))
              set('workshopEndMinute', String(minute))
            }}
            className="w-full rounded-lg border border-white/10 bg-white/[0.05] text-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            {CRENEAUX_FERMETURE.map(c => (
              <option key={c} value={c} className="bg-[#111827]">{c.replace(':', 'h')}</option>
            ))}
          </select>
        </div>
      </div>
      <p className="text-[10px] text-slate-600 -mt-1">
        Ces horaires bornent la grille du planning. L&apos;atelier doit rester ouvert au moins une heure.
      </p>

      <div className="border-t border-white/[0.07] pt-4">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Informations légales</p>
        <div className="grid grid-cols-2 gap-3">
          {f({ label: 'SIRET', k: 'siret', placeholder: '123 456 789 00012', optional: true })}
          {f({ label: 'N° TVA', k: 'vatNumber', placeholder: 'FR12345678901', optional: true })}
        </div>
        <div className="mt-3">
          {f({ label: 'Taux TVA (%)', k: 'taxRate', type: 'number', placeholder: '20' })}
        </div>
      </div>

      {/* Recherche de banque, BIC proposé seulement quand il est SÛR, et clé de
          contrôle de l'IBAN vérifiée à la saisie (GF-023). */}
      <CoordonneesBancaires s={s} set={set} />

      <div className="border-t border-white/[0.07] pt-4">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Facturation</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Devise</label>
            <select value={s.currency} onChange={e => set('currency', e.target.value)}
              className="w-full rounded-lg border border-white/10 bg-white/[0.05] text-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              {CURRENCIES.map(c => <option key={c} className="bg-[#111827]">{c}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Conditions de paiement</label>
            <select value={s.paymentTerms} onChange={e => set('paymentTerms', e.target.value)}
              className="w-full rounded-lg border border-white/10 bg-white/[0.05] text-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              {PAYMENT_TERMS.map(p => <option key={p} className="bg-[#111827]">{p}</option>)}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 mt-3">
          {f({ label: 'Préfixe facture', k: 'invoicePrefix', placeholder: 'FAC' })}
          {f({ label: 'Préfixe devis', k: 'quotePrefix', placeholder: 'DEV' })}
        </div>
        <div className="mt-3">
          <label className="block text-xs font-medium text-slate-400 mb-1">
            Pied de facture <span className="text-slate-600">(optionnel)</span>
          </label>
          <textarea value={s.invoiceFooter} onChange={e => set('invoiceFooter', e.target.value)}
            rows={2} placeholder="TVA non applicable…"
            className="w-full rounded-lg border border-white/10 bg-white/[0.05] text-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none placeholder-slate-600" />
        </div>
      </div>
    </div>
  )
}
