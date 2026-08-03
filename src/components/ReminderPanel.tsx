'use client'

import { useState, useEffect, useCallback } from 'react'
import { X, Plus, Bell, CheckCircle2, Mail, Phone, Trash2, Loader2, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { format, parseISO, isPast, isToday, isTomorrow, addDays } from 'date-fns'
import type { Locale } from 'date-fns'
import { useTranslation } from '@/lib/i18n'
import type { T } from '@/lib/i18n'
import { dateLocale } from '@/lib/i18n/date-locale'
import toast from 'react-hot-toast'
import { DateField } from '@/components/DateField'

// value canonique → clé de traduction (les valeurs stockées restent en FR)
const TYPE_LABEL_KEYS: Record<string, keyof T> = {
  vidange: 'rmTVidange', ct: 'rmTCt', distribution: 'rmTDistribution',
  freins: 'rmTFreins', pneus: 'rmTPneus', batterie: 'rmTBatterie', autre: 'catOther',
}
function typeLabel(t: T, value: string): string {
  const k = TYPE_LABEL_KEYS[value]
  return k ? t[k] : value
}

interface Reminder {
  id: string
  clientName: string
  vehicleModel?: string
  licensePlate?: string
  phone?: string
  email?: string
  type: string
  scheduledDate: string
  scheduledTime?: string
  notes?: string
  status: string
}

interface Props {
  onClose: () => void
}

const REMINDER_TYPES = [
  { value: 'vidange',      label: 'Vidange',            icon: '🛢️' },
  { value: 'ct',           label: 'Contrôle technique', icon: '📋' },
  { value: 'distribution', label: 'Distribution',       icon: '⚙️' },
  { value: 'freins',       label: 'Freins',             icon: '🔧' },
  { value: 'pneus',        label: 'Pneus',              icon: '🔄' },
  { value: 'batterie',     label: 'Batterie',           icon: '🔋' },
  { value: 'autre',        label: 'Autre',              icon: '📌' },
]

function dateBadge(dateStr: string, t: T, loc: Locale) {
  const d = parseISO(dateStr)
  if (isPast(d) && !isToday(d)) return { label: t.rmBadgeOverdue, className: 'text-red-400 bg-red-500/15 border-red-500/25' }
  if (isToday(d)) return { label: t.todayLabel, className: 'text-amber-400 bg-amber-500/15 border-amber-500/25' }
  if (isTomorrow(d)) return { label: t.rmBadgeTomorrow, className: 'text-blue-400 bg-blue-500/15 border-blue-500/25' }
  return { label: format(d, 'd MMM', { locale: loc }), className: 'text-slate-400 bg-white/[0.06] border-white/10' }
}

function ReminderRow({ reminder, onStatusChange, onDelete, garagePhone }: {
  reminder: Reminder
  onStatusChange: (id: string, status: string) => void
  onDelete: (id: string) => void
  garagePhone?: string
}) {
  const { t, lang } = useTranslation()
  const loc = dateLocale(lang)
  const typeConfig = REMINDER_TYPES.find(rt => rt.value === reminder.type) ?? REMINDER_TYPES[6]
  const typeName = typeLabel(t, reminder.type)
  const dl = dateBadge(reminder.scheduledDate, t, loc)
  const [sending, setSending] = useState(false)

  async function handleSendEmail() {
    if (!reminder.email) return
    setSending(true)
    try {
      const res = await fetch('/api/reminders/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: reminder.id }),
      })
      const data = await res.json()
      if (data.sent) {
        toast.success(t.rmEmailSent)
        onStatusChange(reminder.id, 'sent')
      } else if (data.reason === 'no_smtp') {
        const sub = encodeURIComponent(data.subject ?? `${t.rmTitle} - ${typeName}`)
        const bod = encodeURIComponent(data.body ?? '')
        window.open(`mailto:${reminder.email}?subject=${sub}&body=${bod}`)
        onStatusChange(reminder.id, 'sent')
      }
    } finally {
      setSending(false)
    }
  }

  function handleSmsClick() {
    if (!reminder.phone) return
    // If garage has configured an SMS phone, open sms: link
    const phoneNum = reminder.phone.replace(/\s/g, '')
    const whenStr = `${format(parseISO(reminder.scheduledDate), 'd MMMM yyyy', { locale: loc })}${reminder.scheduledTime ? ` ${t.rmTime.toLowerCase()} ${reminder.scheduledTime}` : ''}`
    const msg = encodeURIComponent(`${t.rmSmsHello} ${reminder.clientName}, ${t.rmTitle}: ${typeName} — ${whenStr}. ${t.rmSmsCallUs}${garagePhone ? ` ${t.rmSmsTel} ${garagePhone}` : ''}`)
    window.open(`sms:${phoneNum}?body=${msg}`)
  }

  return (
    <div className={cn(
      'bg-white/[0.04] rounded-xl border border-white/[0.07] p-3.5 transition-opacity',
      reminder.status === 'sent' && 'opacity-50',
    )}>
      <div className="flex items-start gap-3">
        <div className="text-xl flex-shrink-0 mt-0.5">{typeConfig.icon}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="font-semibold text-white text-sm">{reminder.clientName}</span>
            <span className={cn('text-[10px] font-semibold px-1.5 py-0.5 rounded-full border', dl.className)}>
              {dl.label}
            </span>
            {reminder.status === 'sent' && (
              <span className="text-[10px] bg-emerald-500/15 text-emerald-400 font-semibold px-1.5 py-0.5 rounded-full border border-emerald-500/25">
                {t.rmSent}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-400">
            {typeName}
            {reminder.scheduledTime && <span className="ml-1 text-slate-300">· {reminder.scheduledTime}</span>}
            {reminder.vehicleModel && ` · ${reminder.vehicleModel}`}
            {reminder.licensePlate && <span className="ml-1 font-mono text-blue-400">{reminder.licensePlate}</span>}
          </p>
          {reminder.notes && <p className="text-xs text-slate-500 mt-1 italic">{reminder.notes}</p>}

          <div className="flex items-center gap-2 mt-2 flex-wrap">
            {reminder.phone && (
              <button
                onClick={handleSmsClick}
                className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors"
              >
                <Phone className="w-3 h-3" />
                {reminder.phone}
              </button>
            )}
            {reminder.email && (
              <button
                onClick={handleSendEmail}
                disabled={sending}
                className="flex items-center gap-1 text-xs text-purple-400 hover:text-purple-300 transition-colors disabled:opacity-50"
              >
                <Mail className="w-3 h-3" />
                {sending ? t.rmSending : t.rmSendEmail}
              </button>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {reminder.status === 'pending' && (
            <button
              onClick={() => onStatusChange(reminder.id, 'sent')}
              className="p-1.5 rounded-lg hover:bg-emerald-500/15 text-emerald-500 transition-colors"
              title={t.rmMarkSent}
            >
              <CheckCircle2 className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={() => onDelete(reminder.id)}
            className="p-1.5 rounded-lg hover:bg-red-500/15 text-red-400 transition-colors"
            title={t.uiDeleteTip}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  )
}

function AddReminderForm({ onAdd, onCancel }: { onAdd: () => void; onCancel: () => void }) {
  const { t } = useTranslation()
  const [form, setForm] = useState({
    clientName: '', vehicleModel: '', licensePlate: '',
    phone: '', email: '', type: 'vidange',
    scheduledDate: format(addDays(new Date(), 30), 'yyyy-MM-dd'), scheduledTime: '', notes: '',
  })
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      const res = await fetch('/api/reminders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (res.ok) {
        toast.success(t.rmAdded)
        onAdd()
        onCancel()
      }
    } finally {
      setSaving(false)
    }
  }

  const inp = 'w-full px-3 py-2 bg-white/[0.06] border border-white/10 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent'
  const lbl = 'block text-xs font-medium text-slate-400 mb-1'

  return (
    <form onSubmit={handleSubmit} className="bg-white/[0.04] rounded-xl border border-blue-500/30 p-4 space-y-3">
      <h3 className="font-semibold text-white text-sm flex items-center gap-2">
        <Bell className="w-4 h-4 text-blue-400" />
        {t.rmNewReminder}
      </h3>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={lbl}>{t.wrClient} *</label>
          <input className={inp} required value={form.clientName} onChange={e => setForm(f => ({ ...f, clientName: e.target.value }))} placeholder={t.wrClientName} />
        </div>
        <div>
          <label className={lbl}>{t.rmType} *</label>
          <select className={inp + ' bg-[#1a2235]'} value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
            {REMINDER_TYPES.map(rt => (
              <option key={rt.value} value={rt.value}>{rt.icon} {typeLabel(t, rt.value)}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={lbl}>{t.wrVehicle}</label>
          <input className={inp} value={form.vehicleModel} onChange={e => setForm(f => ({ ...f, vehicleModel: e.target.value }))} placeholder={t.uiVehicleMakeModel} />
        </div>
        <div>
          <label className={lbl}>{t.wrPlate}</label>
          <input className={inp} value={form.licensePlate} onChange={e => setForm(f => ({ ...f, licensePlate: e.target.value }))} placeholder="AB-123-CD" />
        </div>
        <div>
          <label className={lbl}>{t.uiPhone}</label>
          <input className={inp} value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="06 xx xx xx xx" type="tel" />
        </div>
        <div>
          <label className={lbl}>{t.uiEmail}</label>
          <input className={inp} value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="client@email.fr" type="email" />
        </div>
        <div>
          <label className={lbl}>{t.rmDueDate} *</label>
          <DateField value={form.scheduledDate} onChange={v => setForm(f => ({ ...f, scheduledDate: v }))} wrapperClassName="w-full" className={inp} />
        </div>
        <div>
          <label className={lbl}>{t.rmTime} <span className="text-slate-600">({t.uiOptional})</span></label>
          <input type="time" step={300} className={inp} value={form.scheduledTime} onChange={e => setForm(f => ({ ...f, scheduledTime: e.target.value }))} />
        </div>
        <div className="col-span-2">
          <label className={lbl}>{t.uiNotes}</label>
          <input className={inp} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder={t.uiOptional} />
        </div>
      </div>
      <div className="flex gap-2 justify-end">
        <button type="button" onClick={onCancel} className="px-3 py-1.5 text-sm text-slate-400 hover:bg-white/[0.07] rounded-lg transition-colors">
          {t.uiCancel}
        </button>
        <button type="submit" disabled={saving} className="px-4 py-1.5 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-500 disabled:opacity-50 flex items-center gap-1.5 transition-colors">
          {saving && <Loader2 className="w-3 h-3 animate-spin" />}
          {saving ? t.uiSaving : t.uiAdd}
        </button>
      </div>
    </form>
  )
}

export default function ReminderPanel({ onClose }: Props) {
  const { t } = useTranslation()
  const [reminders, setReminders] = useState<Reminder[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [filter, setFilter] = useState<'pending' | 'sent' | 'all'>('pending')
  const [garagePhone, setGaragePhone] = useState<string | undefined>()

  const fetchReminders = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/reminders?status=${filter}`)
      if (res.ok) setReminders(await res.json())
    } finally {
      setLoading(false)
    }
  }, [filter])

  useEffect(() => { fetchReminders() }, [fetchReminders])

  useEffect(() => {
    fetch('/api/garages')
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.smsPhone) setGaragePhone(data.smsPhone) })
  }, [])

  async function handleStatusChange(id: string, status: string) {
    await fetch('/api/reminders', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status }),
    })
    fetchReminders()
  }

  async function handleDelete(id: string) {
    await fetch('/api/reminders', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    fetchReminders()
  }

  const overdueCount = reminders.filter(r => {
    const d = parseISO(r.scheduledDate)
    return r.status === 'pending' && isPast(d) && !isToday(d)
  }).length

  const FILTER_LABELS = { pending: t.rmFilterTodo, sent: t.rmFilterSent, all: t.catAll }

  return (
    <div className="fixed right-0 top-0 bottom-0 w-full max-w-[480px] bg-[#0f1629] z-40 shadow-2xl shadow-black/50 flex flex-col border-l border-white/[0.07] pt-safe pb-safe pr-safe">
      {/* Header */}
      <div className="bg-[#111827] border-b border-white/[0.07] px-5 py-4 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-purple-500/15 border border-purple-500/30 flex items-center justify-center">
            <Bell className="w-4 h-4 text-purple-400" />
          </div>
          <div>
            <h2 className="font-bold text-white text-base">{t.rmTitle}</h2>
            {overdueCount > 0 && (
              <p className="text-[10px] text-red-400 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                {overdueCount} {t.rmOverdue}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowAdd(!showAdd)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-lg transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            {t.rmNew}
          </button>
          <button onClick={onClose} className="gf-close p-2 rounded-lg hover:bg-white/[0.07] text-slate-400 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-1 px-5 py-3 border-b border-white/[0.05] flex-shrink-0">
        {(['pending', 'sent', 'all'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              'px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors',
              filter === f ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30' : 'text-slate-500 hover:bg-white/[0.06] hover:text-slate-300'
            )}
          >
            {FILTER_LABELS[f]}
          </button>
        ))}
        {garagePhone && (
          <div className="ml-auto flex items-center gap-1 text-xs text-slate-500">
            <Phone className="w-3 h-3" />
            {garagePhone}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {showAdd && (
          <AddReminderForm onAdd={fetchReminders} onCancel={() => setShowAdd(false)} />
        )}
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
          </div>
        ) : reminders.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-14 h-14 rounded-2xl bg-white/[0.04] flex items-center justify-center mx-auto mb-4">
              <Bell className="w-6 h-6 text-slate-600" />
            </div>
            <p className="text-slate-400 font-medium mb-1">{t.rmEmpty}</p>
            <button onClick={() => setShowAdd(true)} className="mt-1 text-blue-400 text-sm hover:text-blue-300 transition-colors">
              + {t.rmAddOne}
            </button>
          </div>
        ) : (
          reminders.map(r => (
            <ReminderRow
              key={r.id}
              reminder={r}
              onStatusChange={handleStatusChange}
              onDelete={handleDelete}
              garagePhone={garagePhone}
            />
          ))
        )}
      </div>
    </div>
  )
}
