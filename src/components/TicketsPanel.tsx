'use client'

/**
 * Messagerie — côté GARAGE (GF-DUR-014).
 *
 * ─── Pourquoi ce panneau existe ─────────────────────────────────────────────
 * `/api/tickets` et `/api/tickets/[id]` servaient la boîte de réception du
 * garage, avec la même machine à états que le portail. Aucun écran du poste ne
 * les appelait : un client aurait pu écrire — s'il avait eu une page pour le
 * faire — sans que personne au garage ne le voie jamais.
 *
 * ─── Le tri par défaut n'est pas neutre ─────────────────────────────────────
 * L'ouverture montre « À traiter » — les fils `open` et `pending`, ceux où le
 * client attend une réponse. Montrer tout par défaut noierait ces deux-là dans
 * l'historique, et un message sans réponse est exactement ce qu'une messagerie
 * doit rendre impossible à manquer.
 *
 * `answered` n'y figure pas : la balle est chez le client. C'est le sens de la
 * distinction `pending` / `answered` de la machine à états, et le seul intérêt
 * de la conserver.
 */

import { useCallback, useEffect, useState } from 'react'
import {
  X, MessageSquare, Loader2, Send, ArrowLeft, Lock, RotateCcw, Check,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { cn } from '@/lib/utils'

interface Fil {
  id: string
  subject: string
  category: string
  priority: string
  status: string
  lastMessageAt: string
  createdAt: string
  messageCount: number
}

interface Message {
  id: string
  authorType: string
  authorName: string
  body: string
  createdAt: string
}

/** Ce que le statut signifie POUR LE GARAGE : qui attend qui. */
const ETAT: Record<string, { texte: string; teinte: string }> = {
  open: { texte: 'Nouveau', teinte: 'text-amber-300 bg-amber-500/15' },
  pending: { texte: 'Relance client', teinte: 'text-amber-300 bg-amber-500/15' },
  answered: { texte: 'Répondu', teinte: 'text-emerald-300 bg-emerald-500/15' },
  closed: { texte: 'Clôturé', teinte: 'text-slate-400 bg-slate-500/15' },
}

const CATEGORIE: Record<string, string> = {
  general: 'Question générale',
  invoice: 'Facture',
  repair: 'Réparation',
  appointment: 'Rendez-vous',
  other: 'Autre',
}

/** `open` et `pending` : le client attend. C'est le seul filtre qui a un enjeu. */
const A_TRAITER = new Set(['open', 'pending'])

function quand(v: string): string {
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })
}

export default function TicketsPanel({ onClose }: { onClose: () => void }) {
  const [fils, setFils] = useState<Fil[] | null>(null)
  const [vue, setVue] = useState<'a-traiter' | 'tous'>('a-traiter')
  const [ouvert, setOuvert] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[] | null>(null)
  const [reponse, setReponse] = useState('')
  const [occupe, setOccupe] = useState(false)

  const chargerFils = useCallback(async () => {
    try {
      // La route accepte `?status=` pour UN statut ; « à traiter » en couvre
      // deux. Le filtre se fait donc ici, sur la liste complète — la borne de
      // garage, elle, reste côté serveur.
      const r = await fetch('/api/tickets', { cache: 'no-store' })
      const d = await r.json().catch(() => null)
      if (!r.ok || !d) { toast.error(d?.error ?? 'Chargement impossible.'); return }
      setFils(d.tickets ?? [])
    } catch {
      toast.error('Serveur injoignable.')
    }
  }, [])

  useEffect(() => { void chargerFils() }, [chargerFils])

  const ouvrir = useCallback(async (id: string) => {
    setOuvert(id)
    setMessages(null)
    setReponse('')
    const r = await fetch(`/api/tickets/${id}`, { cache: 'no-store' })
    const d = await r.json().catch(() => null)
    if (!r.ok || !d?.ticket) { toast.error('Conversation introuvable.'); return }
    setMessages(d.ticket.messages ?? [])
  }, [])

  async function agir(corps: Record<string, unknown>, succes: string) {
    if (!ouvert) return
    setOccupe(true)
    try {
      const r = await fetch(`/api/tickets/${ouvert}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(corps),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { toast.error(d?.error ?? 'Action refusée par le serveur.'); return false }
      // Le fil ET la liste sont relus : le statut a changé, et c'est lui qui
      // décide si la conversation reste dans « À traiter ».
      await Promise.all([ouvrir(ouvert), chargerFils()])
      toast.success(succes)
      return true
    } catch {
      toast.error('Serveur injoignable.')
      return false
    } finally {
      setOccupe(false)
    }
  }

  const filCourant = fils?.find((f) => f.id === ouvert) ?? null
  const visibles = (fils ?? []).filter((f) => vue === 'tous' || A_TRAITER.has(f.status))
  const aTraiter = (fils ?? []).filter((f) => A_TRAITER.has(f.status)).length

  return (
    <div className="fixed right-0 top-0 bottom-0 w-full max-w-[520px] bg-[#0f1629] z-40 shadow-2xl shadow-black/50 flex flex-col border-l border-white/[0.07] pt-safe pb-safe pr-safe">
      <div className="bg-[#111827] border-b border-white/[0.07] px-5 py-4 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-blue-500/15 border border-blue-500/30 flex items-center justify-center">
            <MessageSquare className="w-4 h-4 text-blue-400" />
          </div>
          <div>
            <h2 className="font-bold text-white text-base">Messages clients</h2>
            {aTraiter > 0 && (
              <p className="text-[10px] text-amber-400">
                {aTraiter} conversation{aTraiter > 1 ? 's' : ''} en attente de réponse
              </p>
            )}
          </div>
        </div>
        <button onClick={onClose} className="gf-close p-2 rounded-lg hover:bg-white/[0.07] text-slate-400 transition-colors">
          <X className="w-5 h-5" />
        </button>
      </div>

      {!ouvert && (
        <div className="flex gap-1 px-5 py-3 border-b border-white/[0.05] flex-shrink-0">
          {([['a-traiter', 'À traiter'], ['tous', 'Toutes']] as const).map(([v, libelle]) => (
            <button
              key={v}
              onClick={() => setVue(v)}
              className={cn(
                'px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors',
                vue === v
                  ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                  : 'text-slate-500 hover:bg-white/[0.06] hover:text-slate-300',
              )}
            >
              {libelle}
            </button>
          ))}
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4">
        {fils === null ? (
          <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-blue-500" /></div>
        ) : ouvert && filCourant ? (
          <>
            <button
              onClick={() => { setOuvert(null); setMessages(null) }}
              className="flex items-center gap-1.5 text-[11px] text-slate-500 hover:text-slate-300 mb-3"
            >
              <ArrowLeft className="w-3 h-3" />Toutes les conversations
            </button>

            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-bold text-white truncate">{filCourant.subject}</p>
                <p className="text-[11px] text-slate-500">
                  {CATEGORIE[filCourant.category] ?? filCourant.category} · ouvert le {quand(filCourant.createdAt)}
                </p>
              </div>
              <span className={cn('shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full', ETAT[filCourant.status]?.teinte)}>
                {ETAT[filCourant.status]?.texte ?? filCourant.status}
              </span>
            </div>

            <div className="mt-4 space-y-3">
              {messages === null ? (
                <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-slate-600" /></div>
              ) : messages.map((m) => {
                const duGarage = m.authorType === 'staff'
                return (
                  <div key={m.id} className={cn('flex', duGarage ? 'justify-end' : 'justify-start')}>
                    <div className={cn(
                      'max-w-[85%] rounded-2xl px-3.5 py-2.5',
                      duGarage ? 'bg-blue-600/90 text-white' : 'bg-white/[0.06] text-slate-200',
                    )}>
                      <p className="text-[10px] font-semibold opacity-70">
                        {m.authorName || (duGarage ? 'Le garage' : 'Client')} · {quand(m.createdAt)}
                      </p>
                      {/* Le texte du client est rendu tel quel, jamais interprété. */}
                      <p className="mt-1 whitespace-pre-line text-sm leading-relaxed">{m.body}</p>
                    </div>
                  </div>
                )
              })}
            </div>

            {filCourant.status === 'closed' ? (
              <div className="mt-5 flex flex-col items-start gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                <p className="flex items-center gap-1.5 text-[11px] text-slate-500">
                  <Lock className="w-3 h-3" />Conversation clôturée : aucun message n’y entre plus.
                </p>
                <button
                  onClick={() => agir({ reopen: true }, 'Conversation rouverte')}
                  disabled={occupe}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-white/10 text-[11px] font-semibold text-slate-300 hover:bg-white/[0.06] disabled:opacity-50"
                >
                  <RotateCcw className="w-3 h-3" />Rouvrir
                </button>
              </div>
            ) : (
              <div className="mt-5">
                <textarea
                  value={reponse}
                  onChange={(e) => setReponse(e.target.value)}
                  rows={3}
                  placeholder="Votre réponse au client…"
                  aria-label="Votre réponse au client"
                  className="w-full resize-none rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/60"
                />
                <div className="mt-2 flex items-center gap-2">
                  <button
                    onClick={async () => { if (await agir({ message: reponse.trim() }, 'Réponse envoyée')) setReponse('') }}
                    disabled={occupe || !reponse.trim()}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold disabled:opacity-50 transition-colors"
                  >
                    {occupe ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                    Répondre
                  </button>
                  <button
                    onClick={() => agir({ close: true }, 'Conversation clôturée')}
                    disabled={occupe}
                    className="flex items-center gap-1.5 px-2.5 py-2 rounded-lg border border-white/10 text-[11px] text-slate-400 hover:bg-white/[0.06] disabled:opacity-50"
                  >
                    <Check className="w-3 h-3" />Clôturer
                  </button>
                </div>
              </div>
            )}
          </>
        ) : visibles.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-14 h-14 rounded-2xl bg-white/[0.04] flex items-center justify-center mx-auto mb-4">
              <MessageSquare className="w-6 h-6 text-slate-600" />
            </div>
            <p className="text-slate-400 font-medium">
              {vue === 'a-traiter' ? 'Aucun message en attente.' : 'Aucune conversation.'}
            </p>
            {vue === 'a-traiter' && (fils?.length ?? 0) > 0 && (
              <button onClick={() => setVue('tous')} className="mt-2 text-blue-400 text-sm hover:text-blue-300">
                Voir toutes les conversations
              </button>
            )}
          </div>
        ) : (
          <ul className="space-y-2">
            {visibles.map((f) => (
              <li key={f.id}>
                <button
                  onClick={() => ouvrir(f.id)}
                  className="w-full rounded-xl border border-white/[0.07] bg-white/[0.02] p-3 text-left hover:bg-white/[0.04] transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-white truncate">{f.subject}</p>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        {CATEGORIE[f.category] ?? f.category}
                        {' · '}{f.messageCount} message{f.messageCount > 1 ? 's' : ''}
                        {' · '}{quand(f.lastMessageAt)}
                      </p>
                    </div>
                    <span className={cn('shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full', ETAT[f.status]?.teinte)}>
                      {ETAT[f.status]?.texte ?? f.status}
                    </span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
