'use client'

/**
 * Messagerie du CLIENT avec son garage (GF-DUR-014).
 *
 * ─── Pourquoi cette page existe ─────────────────────────────────────────────
 * Cinq routes portaient toute la mécanique — ouverture d'un fil, historique,
 * réponse, clôture, réouverture — avec une machine à états éprouvée
 * (`lib/portal/tickets`) qui distingue qui attend qui. Aucune des cinq pages du
 * portail ne les appelait. Le client ne pouvait donc pas écrire à son garage
 * depuis son espace : il lui restait le téléphone, et le garage n'avait aucune
 * trace.
 *
 * ─── Ce que la page doit montrer honnêtement ────────────────────────────────
 * Le statut d'un fil dit QUI DOIT AGIR, et c'est la seule information qui
 * compte pour le client :
 *
 *   · `open`     — envoyé, le garage n'a pas encore répondu ;
 *   · `pending`  — le client a relancé, la balle est chez le garage ;
 *   · `answered` — le garage a répondu, la balle est chez le client ;
 *   · `closed`   — le fil est clos, aucun message n'y entre plus.
 *
 * Les libellés le disent en clair (« En attente du garage », « Réponse reçue »)
 * plutôt que de recopier l'état technique : « pending » et « answered » sont
 * ambigus dans les deux sens pour qui ne connaît pas la machine à états.
 *
 * Un fil CLOS n'affiche pas de champ de réponse : le serveur refuserait le
 * message (409), et laisser le client écrire pour se voir refuser après coup
 * serait une perte de son texte.
 */

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  MessageSquare, Send, Plus, Loader2, ArrowLeft, Lock, RotateCcw, X,
} from 'lucide-react'
import { lienPortail } from '@/lib/portal/garage-slug'
import { cheminPortail } from '@/lib/portal/routes'
import { redirectionPortail } from '@/lib/portal/redirection'
import { TICKET_CATEGORIES, type TicketCategory } from '@/lib/portal/tickets'
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

interface Vehicule { id: string; licensePlate: string; make: string; model: string }

/** Ce que le statut signifie POUR LE CLIENT — jamais l'état technique brut. */
const ETAT: Record<string, { texte: string; teinte: string }> = {
  open: { texte: 'En attente du garage', teinte: 'bg-blue-500/15 text-blue-300' },
  pending: { texte: 'En attente du garage', teinte: 'bg-blue-500/15 text-blue-300' },
  answered: { texte: 'Réponse reçue', teinte: 'bg-emerald-500/15 text-emerald-300' },
  closed: { texte: 'Clôturé', teinte: 'bg-slate-500/15 text-slate-400' },
}

const CATEGORIE: Record<TicketCategory, string> = {
  general: 'Question générale',
  invoice: 'Facture',
  repair: 'Réparation',
  appointment: 'Rendez-vous',
  other: 'Autre',
}

function quand(v: string): string {
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })
}

export default function PortalMessagesPage() {
  const router = useRouter()
  const [fils, setFils] = useState<Fil[] | null>(null)
  const [ouvert, setOuvert] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[] | null>(null)
  const [vehicules, setVehicules] = useState<Vehicule[]>([])
  const [redaction, setRedaction] = useState(false)
  const [occupe, setOccupe] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)

  const chargerFils = useCallback(async () => {
    try {
      const r = await fetch('/api/portal/tickets', { cache: 'no-store' })
      // Session finie, ou mot de passe provisoire à remplacer : dans les deux
      // cas le serveur ordonne une navigation, il ne signale pas une panne.
      const ailleurs = await redirectionPortail(r)
      if (ailleurs) { router.replace(ailleurs); return }
      const d = await r.json().catch(() => null)
      if (!r.ok || !d) { setErreur('Chargement impossible.'); return }
      setErreur(null)
      setFils(d.tickets ?? [])
    } catch {
      setErreur('Serveur injoignable.')
    }
  }, [router])

  useEffect(() => { void chargerFils() }, [chargerFils])

  // Les véhicules servent à rattacher un fil : le garage sait alors de quelle
  // voiture on parle sans avoir à le demander.
  useEffect(() => {
    fetch('/api/portal/me/dashboard', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.vehicles) setVehicules(d.vehicles) })
      .catch(() => {})
  }, [])

  const ouvrir = useCallback(async (id: string) => {
    setOuvert(id)
    setMessages(null)
    const r = await fetch(`/api/portal/tickets/${id}`, { cache: 'no-store' })
    const d = await r.json().catch(() => null)
    if (!r.ok || !d?.ticket) { setErreur('Conversation introuvable.'); return }
    setMessages(d.ticket.messages ?? [])
  }, [])

  const filCourant = fils?.find((f) => f.id === ouvert) ?? null

  async function repondre(texte: string) {
    if (!ouvert || !texte.trim()) return
    setOccupe(true)
    try {
      const r = await fetch(`/api/portal/tickets/${ouvert}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: texte.trim() }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { setErreur(d?.error ?? 'Message refusé.'); return false }
      await Promise.all([ouvrir(ouvert), chargerFils()])
      return true
    } catch {
      setErreur('Serveur injoignable.')
      return false
    } finally {
      setOccupe(false)
    }
  }

  async function clore(reopen: boolean) {
    if (!ouvert) return
    setOccupe(true)
    try {
      const r = await fetch(`/api/portal/tickets/${ouvert}/close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reopen }),
      })
      if (!r.ok) { setErreur('Action refusée.'); return }
      await Promise.all([ouvrir(ouvert), chargerFils()])
    } finally {
      setOccupe(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#0a0f1e] px-4 py-8 text-slate-200 md:px-8">
      <div className="mx-auto w-full max-w-4xl">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-black text-white">Mes <span className="text-blue-400">messages</span></h1>
          <Link
            href={lienPortail(cheminPortail('account'))}
            className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-white/[0.08]"
          >
            <ArrowLeft className="h-3.5 w-3.5" />Mon espace
          </Link>
        </div>

        {erreur && (
          <p className="mt-4 rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-300" role="alert">
            {erreur}
          </p>
        )}

        {redaction ? (
          <NouveauFil
            vehicules={vehicules}
            onAnnuler={() => setRedaction(false)}
            onCree={async (id) => { setRedaction(false); await chargerFils(); void ouvrir(id) }}
            onErreur={setErreur}
          />
        ) : ouvert && filCourant ? (
          <Conversation
            fil={filCourant}
            messages={messages}
            occupe={occupe}
            onRetour={() => { setOuvert(null); setMessages(null) }}
            onRepondre={repondre}
            onClore={clore}
          />
        ) : (
          <ListeFils
            fils={fils}
            onOuvrir={ouvrir}
            onNouveau={() => { setErreur(null); setRedaction(true) }}
          />
        )}
      </div>
    </div>
  )
}

function ListeFils({ fils, onOuvrir, onNouveau }: {
  fils: Fil[] | null
  onOuvrir: (id: string) => void
  onNouveau: () => void
}) {
  return (
    <>
      <button
        onClick={onNouveau}
        className="mt-6 flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-500"
      >
        <Plus className="h-4 w-4" />Écrire à mon garage
      </button>

      {fils === null ? (
        <div className="mt-8 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-slate-600" /></div>
      ) : fils.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-dashed border-white/[0.08] p-10 text-center">
          <MessageSquare className="mx-auto mb-3 h-8 w-8 text-slate-700" />
          <p className="text-sm text-slate-500">Aucun message pour l’instant.</p>
          <p className="mt-1 text-[11px] text-slate-600">
            Une question sur une facture, une réparation ou un rendez-vous ? Votre garage vous répond ici.
          </p>
        </div>
      ) : (
        <ul className="mt-4 space-y-2">
          {fils.map((f) => {
            const e = ETAT[f.status] ?? { texte: f.status, teinte: 'bg-slate-500/15 text-slate-400' }
            return (
              <li key={f.id}>
                <button
                  onClick={() => onOuvrir(f.id)}
                  className="w-full rounded-xl border border-white/[0.08] bg-[#111827]/95 p-4 text-left transition-colors hover:bg-white/[0.04]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-white">{f.subject}</p>
                      <p className="mt-0.5 text-[11px] text-slate-500">
                        {CATEGORIE[f.category as TicketCategory] ?? f.category}
                        {' · '}{f.messageCount} message{f.messageCount > 1 ? 's' : ''}
                        {' · '}{quand(f.lastMessageAt)}
                      </p>
                    </div>
                    <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold', e.teinte)}>
                      {e.texte}
                    </span>
                  </div>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}

function Conversation({ fil, messages, occupe, onRetour, onRepondre, onClore }: {
  fil: Fil
  messages: Message[] | null
  occupe: boolean
  onRetour: () => void
  onRepondre: (texte: string) => Promise<boolean | undefined>
  onClore: (reopen: boolean) => void
}) {
  const [texte, setTexte] = useState('')
  const clos = fil.status === 'closed'
  const e = ETAT[fil.status] ?? { texte: fil.status, teinte: 'bg-slate-500/15 text-slate-400' }

  return (
    <div className="mt-6 rounded-2xl border border-white/[0.08] bg-[#111827]/95 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <button onClick={onRetour} className="mb-2 flex items-center gap-1.5 text-[11px] text-slate-500 hover:text-slate-300">
            <ArrowLeft className="h-3 w-3" />Toutes mes conversations
          </button>
          <h2 className="truncate text-base font-bold text-white">{fil.subject}</h2>
          <p className="text-[11px] text-slate-500">
            {CATEGORIE[fil.category as TicketCategory] ?? fil.category} · ouvert le {quand(fil.createdAt)}
          </p>
        </div>
        <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold', e.teinte)}>{e.texte}</span>
      </div>

      <div className="mt-4 space-y-3">
        {messages === null ? (
          <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-slate-600" /></div>
        ) : messages.map((m) => {
          const duGarage = m.authorType === 'staff'
          return (
            <div key={m.id} className={cn('flex', duGarage ? 'justify-start' : 'justify-end')}>
              <div className={cn(
                'max-w-[85%] rounded-2xl px-3.5 py-2.5',
                duGarage ? 'bg-white/[0.06] text-slate-200' : 'bg-blue-600/90 text-white',
              )}>
                <p className="text-[10px] font-semibold opacity-70">
                  {duGarage ? m.authorName || 'Votre garage' : 'Vous'} · {quand(m.createdAt)}
                </p>
                {/* `whitespace-pre-line` conserve les retours à la ligne du
                    client sans jamais interpréter son texte comme du balisage. */}
                <p className="mt-1 whitespace-pre-line text-sm leading-relaxed">{m.body}</p>
              </div>
            </div>
          )
        })}
      </div>

      {clos ? (
        // Aucun champ de saisie : le serveur refuserait le message (409), et le
        // client aurait écrit pour rien.
        <div className="mt-5 flex flex-col items-start gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
          <p className="flex items-center gap-1.5 text-[11px] text-slate-500">
            <Lock className="h-3 w-3" />Cette conversation est clôturée.
          </p>
          <button
            onClick={() => onClore(true)}
            disabled={occupe}
            className="flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 text-[11px] font-semibold text-slate-300 hover:bg-white/[0.06] disabled:opacity-50"
          >
            <RotateCcw className="h-3 w-3" />Rouvrir la conversation
          </button>
        </div>
      ) : (
        <div className="mt-5">
          <textarea
            value={texte}
            onChange={(ev) => setTexte(ev.target.value)}
            rows={3}
            placeholder="Votre message…"
            aria-label="Votre message"
            className="w-full resize-none rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/60"
          />
          <div className="mt-2 flex items-center gap-2">
            <button
              onClick={async () => { if (await onRepondre(texte)) setTexte('') }}
              disabled={occupe || !texte.trim()}
              className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
            >
              {occupe ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              Envoyer
            </button>
            <button
              onClick={() => onClore(false)}
              disabled={occupe}
              className="flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-2 text-[11px] text-slate-400 hover:bg-white/[0.06] disabled:opacity-50"
            >
              <X className="h-3 w-3" />Clôturer
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function NouveauFil({ vehicules, onAnnuler, onCree, onErreur }: {
  vehicules: Vehicule[]
  onAnnuler: () => void
  onCree: (id: string) => void
  onErreur: (e: string | null) => void
}) {
  const [sujet, setSujet] = useState('')
  const [categorie, setCategorie] = useState<TicketCategory>('general')
  const [vehiculeId, setVehiculeId] = useState('')
  const [message, setMessage] = useState('')
  const [envoi, setEnvoi] = useState(false)

  async function envoyer() {
    setEnvoi(true)
    onErreur(null)
    try {
      const r = await fetch('/api/portal/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject: sujet.trim(),
          message: message.trim(),
          category: categorie,
          ...(vehiculeId ? { vehicleId: vehiculeId } : {}),
        }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok || !d?.ticket?.id) {
        // Le texte du client reste à l'écran : le lui faire perdre sur un refus
        // serait la pire réponse possible à un message qu'il vient d'écrire.
        onErreur(d?.error ?? 'Envoi refusé.')
        return
      }
      onCree(d.ticket.id)
    } catch {
      onErreur('Serveur injoignable.')
    } finally {
      setEnvoi(false)
    }
  }

  const champ = 'w-full rounded-lg border border-white/10 bg-white/[0.05] px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/60'

  return (
    <div className="mt-6 space-y-3 rounded-2xl border border-white/[0.08] bg-[#111827]/95 p-5">
      <h2 className="text-base font-bold text-white">Écrire à mon garage</h2>

      <input
        value={sujet}
        onChange={(e) => setSujet(e.target.value)}
        placeholder="Objet (ex. question sur ma facture FAC-2026-014)"
        aria-label="Objet"
        maxLength={200}
        className={champ}
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <select
          value={categorie}
          onChange={(e) => setCategorie(e.target.value as TicketCategory)}
          aria-label="Catégorie"
          className={champ}
        >
          {TICKET_CATEGORIES.map((c) => (
            <option key={c} value={c} className="bg-[#111827]">{CATEGORIE[c]}</option>
          ))}
        </select>

        {vehicules.length > 0 && (
          <select
            value={vehiculeId}
            onChange={(e) => setVehiculeId(e.target.value)}
            aria-label="Véhicule concerné"
            className={champ}
          >
            <option value="" className="bg-[#111827]">Aucun véhicule précis</option>
            {vehicules.map((v) => (
              <option key={v.id} value={v.id} className="bg-[#111827]">
                {v.make} {v.model} — {v.licensePlate}
              </option>
            ))}
          </select>
        )}
      </div>

      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        rows={5}
        placeholder="Votre message…"
        aria-label="Votre message"
        className={cn(champ, 'resize-none')}
      />

      <div className="flex items-center gap-2">
        <button
          onClick={envoyer}
          disabled={envoi || !sujet.trim() || !message.trim()}
          className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
        >
          {envoi ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          Envoyer
        </button>
        <button onClick={onAnnuler} className="rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-400 hover:bg-white/[0.06]">
          Annuler
        </button>
      </div>
    </div>
  )
}
