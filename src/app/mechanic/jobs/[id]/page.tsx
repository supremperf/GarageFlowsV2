'use client'

/**
 * Espace MÉCANICIEN — détail d'une intervention attribuée.
 *
 * Actions AUTORISÉES uniquement : ajouter photo / commentaire / note /
 * observation / signalement, compléter la checklist, démarrer/terminer le
 * chrono. Le mécanicien ne peut ni modifier ni supprimer l'intervention, ni
 * voir la moindre donnée financière. Toutes les autorisations sont appliquées
 * côté serveur — cette page n'est qu'une vue.
 */

import { useEffect, useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import {
  Loader2, ChevronLeft, Camera, Play, Square, Send, MessageSquarePlus,
  AlertTriangle, CheckCircle2, Car, Clock, ImagePlus,
} from 'lucide-react'
import { mechFetch } from '@/lib/mechanic-client'

interface JobView {
  id: string; date: string; startTime: string; estimatedDuration: number
  actualDuration: number | null; status: string; repairType: string
  isUrgent: boolean; vehicleModel: string; licensePlate: string | null
  customerName: string; notes: string | null; timerStartedAt: string | null
}
interface Photo { id: string; phase: string; caption: string | null; photoPath: string | null; base64?: string; mechanicId: string | null; createdAt: string }
interface Note { id: string; type: string; body: string; mechanicId: string | null; createdAt: string }
interface ChkItem { id: string; category: string; label: string; status: string; notes: string | null; sortOrder: number }
interface Inspection { id: string; status: string; items: ChkItem[] }
interface Detail { job: JobView; photos: Photo[]; notes: Note[]; inspections: Inspection[] }

const NOTE_LABEL: Record<string, string> = { comment: 'Commentaire', note: 'Note', observation: 'Observation', issue: 'Problème signalé' }
const CHK_STATUS: { value: string; label: string; style: string }[] = [
  { value: 'ok', label: 'OK', style: 'bg-emerald-500/15 text-emerald-300' },
  { value: 'warning', label: 'À surveiller', style: 'bg-amber-500/15 text-amber-300' },
  { value: 'critical', label: 'Critique', style: 'bg-red-500/15 text-red-300' },
  { value: 'na', label: 'N/A', style: 'bg-slate-500/15 text-slate-400' },
]

export default function MechanicJobPage({ params }: { params: { id: string } }) {
  const router = useRouter()
  const [detail, setDetail] = useState<Detail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [noteType, setNoteType] = useState('comment')
  const [noteBody, setNoteBody] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(() => {
    setLoading(true)
    mechFetch<Detail>(`/api/mechanic/jobs/${params.id}`)
      .then(setDetail).catch((e) => setError(e.message)).finally(() => setLoading(false))
  }, [params.id])

  useEffect(() => { load() }, [load])

  async function timer(action: 'start' | 'stop') {
    setBusy(true)
    try { await mechFetch(`/api/mechanic/jobs/${params.id}/timer`, { method: 'POST', body: JSON.stringify({ action }) }); load() }
    catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }

  async function addNote() {
    if (!noteBody.trim() || busy) return
    setBusy(true)
    try {
      await mechFetch(`/api/mechanic/jobs/${params.id}/notes`, { method: 'POST', body: JSON.stringify({ type: noteType, body: noteBody.trim() }) })
      setNoteBody('')
      load()
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }

  async function onPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || busy) return
    // Lecture en data URL puis envoi (validation/type réel vérifiés côté serveur).
    setBusy(true)
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const r = new FileReader()
        r.onload = () => resolve(String(r.result))
        r.onerror = () => reject(new Error('Lecture du fichier impossible'))
        r.readAsDataURL(file)
      })
      await mechFetch(`/api/mechanic/jobs/${params.id}/photos`, { method: 'POST', body: JSON.stringify({ base64, phase: 'during' }) })
      load()
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }

  async function setChk(itemId: string, status: string) {
    setBusy(true)
    try { await mechFetch(`/api/mechanic/jobs/${params.id}/checklist/${itemId}`, { method: 'PATCH', body: JSON.stringify({ status }) }); load() }
    catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }

  if (loading) return <div className="flex justify-center py-24"><Loader2 className="w-6 h-6 animate-spin text-slate-500" /></div>
  if (error && !detail) return (
    <div className="mx-auto max-w-2xl px-4 py-16 text-center">
      <p className="text-red-400 text-sm mb-4">{error}</p>
      <button onClick={() => router.push('/mechanic')} className="text-blue-400 text-sm">← Retour au planning</button>
    </div>
  )
  if (!detail) return null
  const { job, photos, notes, inspections } = detail
  const items = inspections.flatMap((i) => i.items)

  return (
    <div className="mx-auto max-w-2xl px-4 pt-safe pb-safe-3">
      <header className="flex items-center gap-2 py-4 sticky top-0 bg-[#0a0f1e]/95 backdrop-blur z-10">
        <button onClick={() => router.push('/mechanic')} className="p-2 -ml-2 rounded-lg hover:bg-white/5 text-slate-300" aria-label="Retour">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <div className="min-w-0">
          <p className="font-bold text-white truncate">{job.repairType}</p>
          <p className="text-xs text-slate-500 flex items-center gap-1"><Clock className="w-3 h-3" />{job.startTime} · {job.estimatedDuration} min</p>
        </div>
        {job.isUrgent && <span className="ml-auto inline-flex items-center gap-1 text-[10px] text-amber-400 bg-amber-500/10 px-2 py-1 rounded"><AlertTriangle className="w-3 h-3" />Urgent</span>}
      </header>

      {error && <div className="mb-3 p-2.5 bg-red-500/10 border border-red-500/25 rounded-lg text-red-400 text-xs">{error}</div>}

      {/* Véhicule / instructions */}
      <section className="bg-[#111827] border border-white/[0.06] rounded-xl p-4 mb-4">
        <div className="flex items-center gap-2 text-sm text-slate-200"><Car className="w-4 h-4 text-slate-500" /><span className="font-medium">{job.vehicleModel}</span>{job.licensePlate && <span className="text-slate-400">· {job.licensePlate}</span>}</div>
        <p className="text-xs text-slate-500 mt-1">Client : {job.customerName}</p>
        {job.notes && <p className="mt-3 text-sm text-slate-300 whitespace-pre-wrap border-t border-white/[0.06] pt-3">{job.notes}</p>}
      </section>

      {/* Chrono */}
      <section className="mb-4 flex gap-2">
        {job.timerStartedAt ? (
          <button disabled={busy} onClick={() => timer('stop')} className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-red-600/90 hover:bg-red-600 text-white font-semibold disabled:opacity-50">
            <Square className="w-4 h-4" /> Terminer l&apos;intervention
          </button>
        ) : (
          <button disabled={busy} onClick={() => timer('start')} className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold disabled:opacity-50">
            <Play className="w-4 h-4" /> Démarrer l&apos;intervention
          </button>
        )}
      </section>

      {/* Checklist */}
      {items.length > 0 && (
        <section className="mb-4">
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2 flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4" />Checklist</h2>
          <ul className="space-y-2">
            {items.map((it) => (
              <li key={it.id} className="bg-[#111827] border border-white/[0.06] rounded-xl p-3">
                <p className="text-sm text-slate-200">{it.label}</p>
                <p className="text-[11px] text-slate-500 mb-2">{it.category}</p>
                <div className="flex flex-wrap gap-1.5">
                  {CHK_STATUS.map((s) => (
                    <button key={s.value} disabled={busy} onClick={() => setChk(it.id, s.value)}
                      className={`text-[11px] px-2.5 py-1 rounded-full font-medium transition ${it.status === s.value ? s.style + ' ring-1 ring-white/20' : 'bg-white/[0.03] text-slate-500 hover:text-slate-300'}`}>
                      {s.label}
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Photos */}
      <section className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wide flex items-center gap-1.5"><Camera className="w-4 h-4" />Photos</h2>
          <button disabled={busy} onClick={() => fileRef.current?.click()} className="inline-flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 disabled:opacity-50">
            <ImagePlus className="w-4 h-4" /> Ajouter
          </button>
          <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={onPhoto} className="hidden" />
        </div>
        {photos.length === 0 ? (
          <p className="text-xs text-slate-600 py-3 text-center">Aucune photo. Prenez ou importez une photo de l&apos;intervention.</p>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {photos.map((p) => (
              <div key={p.id} className="aspect-square rounded-lg overflow-hidden bg-[#111827] border border-white/[0.06]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={p.photoPath ? `/api/mechanic/photos/${p.photoPath}` : (p.base64 || '')}
                  alt={p.caption ?? 'photo'} className="w-full h-full object-cover"
                />
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Notes / commentaires / signalement */}
      <section className="mb-6">
        <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2 flex items-center gap-1.5"><MessageSquarePlus className="w-4 h-4" />Observations</h2>
        <div className="bg-[#111827] border border-white/[0.06] rounded-xl p-3 mb-3">
          <div className="flex flex-wrap gap-1.5 mb-2">
            {Object.entries(NOTE_LABEL).map(([v, l]) => (
              <button key={v} onClick={() => setNoteType(v)}
                className={`text-[11px] px-2.5 py-1 rounded-full font-medium transition ${noteType === v ? (v === 'issue' ? 'bg-red-500/15 text-red-300 ring-1 ring-red-500/30' : 'bg-blue-500/15 text-blue-300 ring-1 ring-blue-500/30') : 'bg-white/[0.03] text-slate-500 hover:text-slate-300'}`}>
                {l}
              </button>
            ))}
          </div>
          <textarea value={noteBody} onChange={(e) => setNoteBody(e.target.value)} rows={2} maxLength={4000}
            placeholder={noteType === 'issue' ? 'Décrivez le problème rencontré…' : 'Ajoutez une observation…'}
            className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-600 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500/40" />
          <div className="flex justify-end mt-2">
            <button disabled={busy || !noteBody.trim()} onClick={addNote} className="inline-flex items-center gap-1.5 text-sm bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white px-3 py-1.5 rounded-lg font-medium">
              <Send className="w-3.5 h-3.5" /> Envoyer
            </button>
          </div>
        </div>
        <ul className="space-y-2">
          {notes.map((n) => (
            <li key={n.id} className="bg-[#111827] border border-white/[0.06] rounded-xl p-3">
              <div className="flex items-center justify-between mb-1">
                <span className={`text-[10px] font-semibold uppercase tracking-wide ${n.type === 'issue' ? 'text-red-400' : 'text-blue-400'}`}>{NOTE_LABEL[n.type] ?? n.type}</span>
                <span className="text-[10px] text-slate-600">{new Date(n.createdAt).toLocaleString('fr-FR')}</span>
              </div>
              <p className="text-sm text-slate-200 whitespace-pre-wrap">{n.body}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
