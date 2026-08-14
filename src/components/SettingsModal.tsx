'use client'

import { useState, useCallback, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { useTranslation, type LangCode } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { X, Building2, Globe, Save, Users, Palette, Zap, Mail, RefreshCw, KeyRound, ReceiptText } from 'lucide-react'
import toast from 'react-hot-toast'

import { CompanyTab }   from './settings/CompanyTab'
import { MechanicsTab, MECHANIC_COLORS } from './settings/MechanicsTab'
import { MechanicAccessTab } from './settings/MechanicAccessTab'
import { EInvoicingTab } from './settings/EInvoicingTab'
import { ThemeTab }     from './settings/ThemeTab'
import { LanguageTab }  from './settings/LanguageTab'
import { FeaturesTab }  from './settings/FeaturesTab'
import { EmailTab }     from './settings/EmailTab'
import { UpdatesTab }   from './settings/UpdatesTab'
import type { GarageSettings, MechanicRecord } from './settings/types'
import { nombreSaisi, entierSaisi } from '@/lib/settings/saisie-numerique'

interface Props { onClose: () => void }

export default function SettingsModal({ onClose }: Props) {
  const { t, lang, setLang, theme, setTheme } = useTranslation()
  const { data: sessionData } = useSession()
  const role = (sessionData?.user as { role?: string } | undefined)?.role
  // La gestion des accès mécaniciens est réservée au propriétaire / responsable.
  const canManageAccess = role === 'OWNER' || role === 'MANAGER'
  // La CONNEXION à une plateforme agréée relève de `settings:manage`, réservé à
  // OWNER. L'onglet était proposé au MANAGER, qui n'y trouvait que des 403 :
  // une fonctionnalité visible et inutilisable (GF31-AUD-063).
  const canManageSettings = role === 'OWNER'
  const [tab, setTab] = useState<'company' | 'mechanics' | 'access' | 'einvoicing' | 'language' | 'theme' | 'features' | 'email' | 'updates'>('company')
  const [exporting, setExporting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [s, setS] = useState<GarageSettings>({
    name: '', address: '', phone: '', email: '', website: '',
    siret: '', vatNumber: '', taxRate: '20',
    iban: '', bic: '', bankName: '',
    currency: 'EUR', paymentTerms: '30 jours net',
    invoicePrefix: 'FAC', quotePrefix: 'DEV',
    invoiceFooter: '', logoBase64: '', logoPath: '', hourlyRate: '60',
    workshopStartHour: '8', workshopEndHour: '18',
    smsPhone: '',
  })

  const [mechanics, setMechanics]       = useState<MechanicRecord[]>([])
  const [mechLoading, setMechLoading]   = useState(false)
  const [editingMech, setEditingMech]   = useState<MechanicRecord | null>(null)
  const [newMech, setNewMech]           = useState({ name: '', color: MECHANIC_COLORS[0], specialty: [] as string[] })
  const [showAddForm, setShowAddForm]   = useState(false)
  const [addingMechanic, setAddingMechanic] = useState(false)

  useEffect(() => {
    fetch('/api/garages')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data) {
          setS({
            name: data.name ?? '',
            address: data.address ?? '',
            phone: data.phone ?? '',
            email: data.email ?? '',
            website: data.website ?? '',
            siret: data.siret ?? '',
            vatNumber: data.vatNumber ?? '',
            taxRate: String(data.taxRate ?? 20),
            iban: data.iban ?? '',
            bic: data.bic ?? '',
            bankName: data.bankName ?? '',
            currency: data.currency ?? 'EUR',
            paymentTerms: data.paymentTerms ?? '30 jours net',
            invoicePrefix: data.invoicePrefix ?? 'FAC',
            quotePrefix: data.quotePrefix ?? 'DEV',
            invoiceFooter: data.invoiceFooter ?? '',
            logoBase64: data.logoBase64 ?? '',
            logoPath: data.logoPath ?? '',
            hourlyRate: String(data.hourlyRate ?? 60),
            workshopStartHour: String(data.workshopStartHour ?? 8),
            workshopEndHour: String(data.workshopEndHour ?? 18),
            smsPhone: data.smsPhone ?? '',
          })
        }
      })
      .finally(() => setLoading(false))
  }, [])

  const loadMechanics = useCallback(async () => {
    setMechLoading(true)
    try {
      const res = await fetch('/api/mechanics')
      if (res.ok) setMechanics(await res.json())
    } finally {
      setMechLoading(false)
    }
  }, [])

  useEffect(() => {
    if (tab === 'mechanics') loadMechanics()
  }, [tab, loadMechanics])

  const set = useCallback(<K extends keyof GarageSettings>(k: K, v: GarageSettings[K]) =>
    setS(prev => ({ ...prev, [k]: v })), [])

  async function handleSave() {
    setSaving(true)
    try {
      const res = await fetch('/api/garages', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        // `|| 60` / `|| 20` ne distinguaient pas « rien saisi » de « zéro
        // saisi » : un garage en franchise de TVA voyait 20 % réécrits sur son
        // dos, un atelier qui ne facture pas l'heure voyait 60 €/h. Un champ
        // illisible n'est plus envoyé du tout — le serveur garde alors sa
        // valeur, plutôt que d'en recevoir une inventée par l'écran.
        body: JSON.stringify({
          ...s,
          hourlyRate:        nombreSaisi(s.hourlyRate),
          taxRate:           nombreSaisi(s.taxRate),
          workshopStartHour: entierSaisi(s.workshopStartHour),
          workshopEndHour:   entierSaisi(s.workshopEndHour),
        }),
      })
      if (!res.ok) {
        // Le refus du serveur porte la raison — tarif hors bornes, fermeture
        // avant ouverture. La remplacer par « Erreur » laisserait l'utilisateur
        // sans rien à corriger.
        const d = await res.json().catch(() => null)
        toast.error(d?.error ?? t.error)
        return
      }
      toast.success(t.success)
    } catch {
      toast.error(t.error)
    } finally {
      setSaving(false)
    }
  }

  async function handleAddMechanic() {
    const name = newMech.name.trim()
    if (!name) { toast.error('Le nom du mécanicien est obligatoire.'); return }
    if (addingMechanic) return // anti double-clic / double création
    setAddingMechanic(true)
    try {
      // Initiales robustes (accents/apostrophes/tirets OK) ; le serveur re-dérive
      // si vide. Espaces multiples filtrés pour éviter un avatar incohérent.
      const avatar =
        name.split(/\s+/).filter(Boolean).map(w => w[0]).join('').toUpperCase().slice(0, 2)
        || name.slice(0, 2).toUpperCase()
      const res = await fetch('/api/mechanics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, color: newMech.color, specialty: newMech.specialty, avatar }),
      })
      if (!res.ok) {
        const serverMsg = await res.json().then(d => (d && typeof d.error === 'string' ? d.error : null)).catch(() => null)
        throw new Error(serverMsg || "Erreur lors de l'ajout")
      }
      toast.success('Mécanicien ajouté avec succès')
      setNewMech({ name: '', color: MECHANIC_COLORS[0], specialty: [] })
      setShowAddForm(false)
      loadMechanics() // rafraîchissement immédiat de la liste
    } catch (e) {
      // Conserver les données saisies pour permettre un nouvel essai.
      toast.error(e instanceof Error ? e.message : "Erreur lors de l'ajout")
    } finally {
      setAddingMechanic(false)
    }
  }

  async function handleUpdateMechanic() {
    if (!editingMech) return
    try {
      const res = await fetch(`/api/mechanics/${editingMech.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name:      editingMech.name,
          color:     editingMech.color,
          specialty: typeof editingMech.specialty === 'string'
            ? JSON.parse(editingMech.specialty)
            : editingMech.specialty,
        }),
      })
      if (!res.ok) throw new Error()
      toast.success('Mécanicien mis à jour')
      setEditingMech(null)
      loadMechanics()
    } catch {
      toast.error('Erreur lors de la mise à jour')
    }
  }

  async function handleDeleteMechanic(id: string, name: string) {
    if (!confirm(`Supprimer ${name} ? Les interventions planifiées seront annulées.`)) return
    try {
      const res = await fetch(`/api/mechanics/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error()
      toast.success('Mécanicien supprimé')
      loadMechanics()
    } catch {
      toast.error('Erreur lors de la suppression')
    }
  }

  const TABS = [
    { id: 'company'   as const, label: t.companyTab  ?? 'Entreprise',  icon: <Building2  className="w-4 h-4" /> },
    { id: 'mechanics' as const, label: t.mechanics   ?? 'Mécaniciens', icon: <Users      className="w-4 h-4" /> },
    ...(canManageAccess ? [{ id: 'access' as const, label: 'Accès mécaniciens', icon: <KeyRound className="w-4 h-4" /> }] : []),
    ...(canManageSettings ? [{ id: 'einvoicing' as const, label: 'Facturation électronique', icon: <ReceiptText className="w-4 h-4" /> }] : []),
    { id: 'email'     as const, label: t.emailTab    ?? 'Email',       icon: <Mail       className="w-4 h-4" /> },
    { id: 'updates'   as const, label: t.updatesTab  ?? 'Mises à jour',icon: <RefreshCw  className="w-4 h-4" /> },
    { id: 'features'  as const, label: 'Fonctionnalités',              icon: <Zap        className="w-4 h-4" /> },
    { id: 'theme'     as const, label: t.themeTab    ?? 'Thèmes',      icon: <Palette    className="w-4 h-4" /> },
    { id: 'language'  as const, label: t.languageTab ?? 'Langue',      icon: <Globe      className="w-4 h-4" /> },
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div className="relative bg-[#111827] border border-white/[0.08] rounded-2xl shadow-2xl shadow-black/60 w-full max-w-2xl max-h-modal flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.07]">
          <h2 className="text-lg font-bold text-white">Paramètres</h2>
          <button onClick={onClose} className="gf-close p-2 rounded-lg hover:bg-white/[0.07] text-slate-400 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex flex-wrap border-b border-white/[0.07] px-1">
          {TABS.map(tb => (
            <button
              key={tb.id}
              onClick={() => setTab(tb.id)}
              className={cn(
                'flex items-center gap-1 px-2.5 py-2.5 text-[11px] font-medium border-b-2 -mb-px transition-colors whitespace-nowrap',
                tab === tb.id ? 'border-blue-500 text-blue-400' : 'border-transparent text-slate-500 hover:text-slate-300'
              )}
            >
              {tb.icon}{tb.label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {tab === 'company' && (
            <CompanyTab s={s} set={set} loading={loading} />
          )}
          {tab === 'mechanics' && (
            <MechanicsTab
              mechanics={mechanics}
              mechLoading={mechLoading}
              editingMech={editingMech}
              setEditingMech={setEditingMech}
              newMech={newMech}
              setNewMech={setNewMech}
              showAddForm={showAddForm}
              setShowAddForm={setShowAddForm}
              adding={addingMechanic}
              onAdd={handleAddMechanic}
              onUpdate={handleUpdateMechanic}
              onDelete={handleDeleteMechanic}
            />
          )}
          {tab === 'access' && canManageAccess && <MechanicAccessTab />}
          {tab === 'einvoicing' && canManageSettings && <EInvoicingTab />}
          {tab === 'email'    && <EmailTab />}
          {tab === 'updates'  && <UpdatesTab />}
          {tab === 'features' && <FeaturesTab />}
          {tab === 'theme' && (
            <ThemeTab
              theme={theme}
              setTheme={setTheme}
              t={t}
              exporting={exporting}
              setExporting={setExporting}
            />
          )}
          {tab === 'language' && (
            <LanguageTab lang={lang} setLang={setLang as (l: LangCode) => void} languageHint={t.languageHint} />
          )}
        </div>

        {/* Footer — only shown on company tab (other tabs have inline save) */}
        {tab === 'company' && (
          <div className="border-t border-white/[0.07] px-6 py-4 flex justify-end gap-3">
            <button onClick={onClose}
              className="px-4 py-2.5 rounded-lg border border-white/10 text-slate-400 text-sm font-medium hover:bg-white/[0.05] transition-colors">
              {t.cancel}
            </button>
            <button onClick={handleSave} disabled={saving}
              className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold shadow-md shadow-blue-600/30 disabled:opacity-50 transition-all">
              <Save className="w-4 h-4" />
              {saving ? (t.loading ?? 'Enregistrement...') : t.save}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
