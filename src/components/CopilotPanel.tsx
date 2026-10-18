'use client'

/**
 * GarageFlow AI Copilot — conversational panel over /api/copilot.
 *
 * Read intents show grounded answers (numbers come from the engine, flagged
 * "vérifié"); action intents render a confirmation-gated card — nothing is
 * written without the user's explicit confirmation.
 */
import { useEffect, useRef, useState } from 'react'
import { X, Sparkles, Send, ShieldCheck, User } from 'lucide-react'
import { useTranslation } from '@/lib/i18n'
import { useBrouillonPersistant } from '@/lib/ui/brouillon'

interface CopilotResponse {
  type: string
  intent?: string
  message?: string
  phrasing?: string
  /**
   * Provenance de la réponse, décidée par le serveur — seul à savoir si un
   * résolveur a réellement lu les données du garage. Le panneau ne la recalcule
   * pas : la déduire ici de la présence d'un champ était précisément le défaut.
   */
  ancrage?: { verifie?: boolean; source?: 'llm' | 'fallback' | 'fallback_ungrounded' }
  planning?: { source?: 'local' | 'model'; fallback?: string }
  execution?: { complete?: boolean; observations?: { toolId: string; title: string; status: string; verified: boolean; evidence: string }[] }
  model?: { state?: string }
  sources?: { id: string; title: string; path: string; version: string }[]
  data?: unknown
  action?: { id?: string; confirmationRequired?: boolean; endpoint?: string; method?: string }
}
interface Msg { role: 'user' | 'ai'; text: string; res?: CopilotResponse; confirmed?: boolean; declined?: boolean }

export default function CopilotPanel({ onClose, onAction }: { onClose: () => void; onAction?: (intent: string) => void }) {
  const { t } = useTranslation()
  // The intent router matches French keyword phrases; chips show the localized
  // label but always send the canonical French query so they classify correctly.
  const SUGGESTIONS = [
    { label: t.cpSug1, query: 'Quel est le CA du jour ?' },
    { label: t.cpSug2, query: 'Quelles pièces sont en rupture de stock ?' },
    { label: t.cpSug3, query: 'Crée un devis pour ce client' },
    { label: 'Comment préparer un devis ?', query: 'Comment préparer un devis ?' },
  ]
  /**
   * Conversation en cours. Conservée d'une page à l'autre : quitter l'assistant
   * pour aller appliquer ce qu'il propose, puis revenir, ne doit pas remettre la
   * discussion à zéro.
   */
  const [messages, setMessages] = useBrouillonPersistant<Msg[]>('copilot:conversation', [])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const activeRequest = useRef<AbortController | null>(null)
  const history = useRef<{ role: 'user'; content: string }[]>([])
  const [readiness, setReadiness] = useState('Vérification de la disponibilité…')
  useEffect(() => {
    const controller = new AbortController()
    let disposed = false
    const timer = setTimeout(() => controller.abort(), 5000)
    fetch('/api/copilot', { signal: controller.signal, cache: 'no-store' })
      .then(async r => {
        const status = await r.json()
        if (!r.ok && status.operational !== false) throw new Error('readiness')
        if (!controller.signal.aborted) setReadiness(`${status.operational ? 'Opérationnel' : 'Indisponible'} · Base : ${status.database ?? 'non vérifiée'} · Modèle externe : ${status.model?.state ?? 'non vérifié'} (instantané à l’ouverture)`)
      }).catch(() => { if (!disposed) setReadiness('Disponibilité non vérifiée : contrôle impossible ou délai dépassé.') })
      .finally(() => clearTimeout(timer))
    return () => { disposed = true; clearTimeout(timer); controller.abort(); activeRequest.current?.abort(); activeRequest.current = null }
  }, [])

  function resetConversation() {
    activeRequest.current?.abort()
    activeRequest.current = null
    history.current = []
    setMessages([])
    setInput('')
    setBusy(false)
  }

  async function ask(q: string, display?: string) {
    const query = q.trim()
    if (!query || busy || activeRequest.current) return
    const controller = new AbortController()
    activeRequest.current = controller
    const timer = setTimeout(() => controller.abort(), 15000)
    const context = history.current.slice(-6)
    history.current = [...context, { role: 'user' as const, content: query }].slice(-6)
    setInput('')
    setMessages((m) => [...m.slice(-39), { role: 'user', text: display ?? query }])
    setBusy(true)
    try {
      const r = await fetch('/api/copilot', { method: 'POST', headers: { 'content-type': 'application/json' }, signal: controller.signal, body: JSON.stringify({ query, history: context }) })
      const res: CopilotResponse & { error?: string } = await r.json().catch(() => ({ type: 'error' }))
      if (activeRequest.current !== controller) return
      if (!r.ok) {
        setMessages((m) => [...m, { role: 'ai', text: res?.error ?? t.cpGenericError }])
        return
      }
      const text = res.phrasing || res.message || '—'
      setMessages((m) => [...m, { role: 'ai', text, res }])
    } catch {
      if (activeRequest.current === controller) setMessages((m) => [...m, { role: 'ai', text: controller.signal.aborted ? 'Demande interrompue. Aucun résultat confirmé ; vous pouvez réessayer.' : t.cpCommError }])
    } finally {
      clearTimeout(timer)
      if (activeRequest.current === controller) { activeRequest.current = null; setBusy(false) }
      requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: 1e9, behavior: 'smooth' }))
    }
  }

  // Confirming an action proposal never writes here — it hands off to the real,
  // fully-formed tool (where the user finalises and confirms the actual write).
  const onConfirmAction = (idx: number) => {
    const res = messages[idx]?.res
    const intent = res?.intent ?? res?.action?.id
    if (!onAction || !intent || messages[idx]?.confirmed || messages[idx]?.declined) return
    setMessages((m) => m.map((msg, i) => (i === idx ? { ...msg, confirmed: true } : msg)))
    if (onAction && intent) onAction(intent)
  }

  const onDeclineAction = (idx: number) =>
    setMessages((m) => m.map((msg, i) => (i === idx ? { ...msg, declined: true } : msg)))

  return (
    <div style={overlay}>
      <Bg />
      <div style={bar}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={logo}><Sparkles size={16} color="#fff" /></div>
          <div><p style={{ color: '#fff', fontSize: 14, fontWeight: 700, lineHeight: 1 }}>{t.cpTitle}</p><p style={{ color: '#475569', fontSize: 11 }}>{t.cpSubtitle}</p></div>
        </div>
        <button type="button" onClick={resetConversation} style={btnSec}>Nouvelle conversation</button>
        <button onClick={onClose} style={closeBtn} aria-label={t.uiClose}><X size={16} /></button>
      </div>

      <p role="status" style={{ color: '#94a3b8', fontSize: 11, padding: '8px 24px', position: 'relative', zIndex: 1 }}>{readiness}. Sans apprentissage ni mémoire persistante.</p>
      <div ref={scrollRef} style={{ flex: 1, overflow: 'auto', padding: '22px 0', position: 'relative', zIndex: 1 }}>
        <div style={{ maxWidth: 760, margin: '0 auto', padding: '0 20px' }}>
          {messages.length === 0 && (
            <div style={{ textAlign: 'center', marginTop: 40 }}>
              <div style={{ ...logo, width: 48, height: 48, borderRadius: 14, margin: '0 auto 14px' }}><Sparkles size={24} color="#fff" /></div>
              <p style={{ color: '#e8edf4', fontSize: 17, fontWeight: 600 }}>{t.cpEmptyTitle}</p>
              <p style={{ color: '#64748b', fontSize: 13, marginTop: 4 }}>{t.cpEmptyHint}</p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center', marginTop: 18 }}>
                {SUGGESTIONS.map((s) => (
                  <button key={s.query} onClick={() => ask(s.query, s.label)} style={chip}>{s.label}</button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m, i) => <Bubble key={i} m={m} onConfirm={() => onConfirmAction(i)} onDecline={() => onDeclineAction(i)} />)}
          {busy && <div style={{ color: '#64748b', fontSize: 13, padding: '6px 42px' }}>{t.cpThinking}</div>}
        </div>
      </div>

      <div style={{ position: 'relative', zIndex: 1, borderTop: '1px solid rgba(255,255,255,0.07)', background: 'rgba(255,255,255,0.02)', padding: 14, paddingBottom: 'calc(14px + env(safe-area-inset-bottom))' }}>
        <form onSubmit={(e) => { e.preventDefault(); ask(input) }} style={{ maxWidth: 760, margin: '0 auto', display: 'flex', gap: 10 }}>
          <input maxLength={500} aria-label={t.cpInputPh} value={input} onChange={(e) => setInput(e.target.value)} placeholder={t.cpInputPh} style={inputBox} />
          <button type="submit" disabled={busy || !input.trim()} style={{ ...sendBtn, opacity: busy || !input.trim() ? 0.5 : 1 }}><Send size={16} /></button>
        </form>
      </div>
    </div>
  )
}

function Bubble({ m, onConfirm, onDecline }: { m: Msg; onConfirm: () => void; onDecline: () => void }) {
  const { t } = useTranslation()
  if (m.role === 'user') {
    return (
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginBottom: 14 }}>
        <div style={{ ...bubble, background: 'rgba(59,130,246,0.14)', border: '1px solid rgba(59,130,246,0.25)', borderBottomRightRadius: 5 }}>{m.text}</div>
        <div style={avatar}><User size={15} color="#93c5fd" /></div>
      </div>
    )
  }
  // `!!m.res?.phrasing` affichait l'écusson sur TOUTE réponse — y compris sur un
  // message d'erreur de base ou une demande de précision, qui ne portent aucun
  // chiffre. Un écusson qui ne distingue rien ne vaut rien : c'est le serveur
  // qui tranche, et l'absence d'information vaut « non vérifié ».
  const grounded = m.res?.ancrage?.verifie === true
  const action = m.res?.action?.confirmationRequired
  return (
    <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
      <div style={{ ...avatar, background: 'linear-gradient(135deg,#3b82f6,#6366f1)', border: 'none' }}><Sparkles size={15} color="#fff" /></div>
      <div style={{ ...bubble, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderBottomLeftRadius: 5 }}>
        <div style={{ color: '#e8edf4' }}>{m.text}</div>
        {m.res?.planning?.fallback && <p style={{ fontSize: 11, color: '#fbbf24', marginTop: 6 }}>Plan du modèle indisponible ou invalide : réponse du repli local.</p>}
        {m.res?.execution?.observations?.map(step => <div key={step.toolId} style={{ fontSize: 11, color: step.verified ? '#94a3b8' : '#fbbf24', marginTop: 6 }}>{step.title} · {step.verified ? 'lecture effectuée' : 'lecture non confirmée'} · {step.evidence === 'estimate' ? 'estimation' : step.evidence === 'hypothesis' ? 'piste de diagnostic' : step.evidence === 'decode' ? 'décodage' : 'observation métier'} · {step.verified ? 'résultat du moteur contrôlé' : 'résultat non confirmé'}</div>)}
        {m.res?.sources?.map(source => <div key={source.id} style={{ fontSize: 11, color: '#94a3b8', marginTop: 6 }}>Source : {source.title} · {source.path} · v{source.version}</div>)}
        {grounded && !action && (
          <span style={verified}><ShieldCheck size={13} /> {t.cpVerified}</span>
        )}
        {action && (
          <div style={actionCard(m.confirmed, m.declined)}>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: m.confirmed ? '#4ade80' : m.declined ? '#94a3b8' : '#fbbf24', display: 'flex', alignItems: 'center', gap: 7 }}>
              {m.confirmed ? `✓ ${t.cpActionConfirmed}` : m.declined ? t.cpActionDeclined : `⚠ ${t.cpActionNeedsConfirm}`}
            </div>
            {m.confirmed && <p style={{ fontSize: 11.5, color: '#94a3b8', marginTop: 6 }}>Ouverture de l’outil demandée. L’enregistrement ou l’envoi doit être validé et vérifié dans son formulaire ; le chat n’a effectué aucune écriture.</p>}
            {!m.confirmed && !m.declined && (
              <>
                <p style={{ fontSize: 11.5, color: '#64748b', margin: '6px 0 9px' }}>{t.cpActionHint}</p>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="button" onClick={onConfirm} style={btnPri}>✓ {t.cpConfirmOpen}</button>
                  <button type="button" onClick={onDecline} style={btnSec}>{t.uiCancel}</button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── styles ──────────────────────────────────────────────────────────────────
const overlay: React.CSSProperties = { position: 'fixed', inset: 0, zIndex: 50, display: 'flex', flexDirection: 'column', background: '#070d1b' }
const bar: React.CSSProperties = { position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 24px', paddingTop: 'calc(14px + env(safe-area-inset-top))', borderBottom: '1px solid rgba(255,255,255,0.07)', background: 'rgba(255,255,255,0.02)', flexShrink: 0 }
const logo: React.CSSProperties = { width: 34, height: 34, borderRadius: 9, background: 'linear-gradient(135deg,#3b82f6,#6366f1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }
const closeBtn: React.CSSProperties = { width: 34, height: 34, borderRadius: 9, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.05)', cursor: 'pointer', color: '#94a3b8', display: 'flex', alignItems: 'center', justifyContent: 'center' }
const bubble: React.CSSProperties = { maxWidth: '74%', padding: '12px 15px', borderRadius: 14, fontSize: 14, lineHeight: 1.5 }
const avatar: React.CSSProperties = { width: 30, height: 30, borderRadius: 8, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }
const verified: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, fontWeight: 700, padding: '4px 9px', borderRadius: 999, background: 'rgba(74,222,128,0.12)', color: '#4ade80', marginTop: 9 }
const chip: React.CSSProperties = { fontSize: 12.5, fontWeight: 600, color: '#93c5fd', background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.22)', padding: '8px 13px', borderRadius: 999, cursor: 'pointer' }
const inputBox: React.CSSProperties = { flex: 1, padding: '11px 15px', borderRadius: 11, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.04)', color: '#fff', fontSize: 14, outline: 'none' }
const sendBtn: React.CSSProperties = { width: 44, borderRadius: 11, border: 'none', background: '#3b82f6', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }
const btnPri: React.CSSProperties = { fontSize: 13, fontWeight: 700, padding: '7px 14px', borderRadius: 9, border: 'none', background: '#3b82f6', color: '#fff', cursor: 'pointer' }
const btnSec: React.CSSProperties = { fontSize: 13, fontWeight: 700, padding: '7px 14px', borderRadius: 9, border: '1px solid rgba(255,255,255,0.12)', background: 'transparent', color: '#94a3b8', cursor: 'pointer' }
const actionCard = (confirmed?: boolean, declined?: boolean): React.CSSProperties => ({
  marginTop: 11, padding: 12, borderRadius: 11,
  border: `1px solid ${confirmed ? 'rgba(74,222,128,0.35)' : declined ? 'rgba(148,163,184,0.25)' : 'rgba(251,191,36,0.35)'}`,
  background: confirmed ? 'rgba(74,222,128,0.08)' : declined ? 'rgba(148,163,184,0.06)' : 'rgba(251,191,36,0.07)',
})

function Bg() {
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
      <div style={{ position: 'absolute', top: '-10%', left: '15%', width: 600, height: 600, borderRadius: '50%', background: 'radial-gradient(circle, rgba(59,130,246,0.07) 0%, transparent 65%)' }} />
      <div style={{ position: 'absolute', bottom: '-10%', right: '5%', width: 500, height: 500, borderRadius: '50%', background: 'radial-gradient(circle, rgba(139,92,246,0.06) 0%, transparent 65%)' }} />
    </div>
  )
}
