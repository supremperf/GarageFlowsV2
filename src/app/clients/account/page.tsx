'use client'

/**
 * Phase 2 — Client portal dashboard. Fetches /api/portal/me/dashboard (real,
 * client-scoped data) and shows vehicles, live repair timelines, quotes,
 * invoices and warranties. Redirects to the login page when unauthenticated.
 */

import { useEffect, useState, useCallback, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { lienPortail } from '@/lib/portal/garage-slug'
import { cheminPortail } from '@/lib/portal/routes'
import { redirectionPortail } from '@/lib/portal/redirection'
import { Car, Wrench, FileText, Receipt, ShieldCheck, LogOut, Loader2, MonitorSmartphone, MessageSquare, CalendarClock, KeyRound, Mail } from 'lucide-react'
import { cn } from '@/lib/utils'
import { PortalSessions } from '@/components/portal/PortalSessions'
import { PortalTwoFactor } from '@/components/portal/PortalTwoFactor'
import { PortalEmail } from '@/components/portal/PortalEmail'

type StageState = 'done' | 'current' | 'pending' | 'cancelled'
interface Stage { key: string; label: string; state: StageState }
interface Repair { id: string; repairType: string; status: string; date: string; vehicle: { model: string | null; licensePlate: string | null }; mechanic: string | null; timeline: { cancelled: boolean; stages: Stage[] } }
interface Doc { id: string; number: string; status: string; issueDate: string; totalTTC: number }
interface Vehicle { id: string; licensePlate: string; make: string; model: string; year: number | null; mileage: number | null; ctDate: string | null }
interface Warranty { id: string; partName: string; status: string; expiresAt: string; licensePlate: string | null; vehicleModel: string | null }
interface Dashboard {
  linkedClient: boolean
  vehicles: Vehicle[]
  activeRepairs: Repair[]
  quotes: Doc[]
  invoices: Doc[]
  warranties: Warranty[]
}

const STAGE_DOT: Record<StageState, string> = {
  done: 'bg-emerald-500 text-white',
  current: 'bg-blue-500 text-white ring-4 ring-blue-500/20',
  pending: 'bg-slate-700 text-slate-400',
  cancelled: 'bg-red-500/40 text-red-200',
}

export default function PortalAccountPage() {
  const router = useRouter()
  const [data, setData] = useState<Dashboard | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/portal/me/dashboard', { cache: 'no-store' })
      // Deux refus du serveur sont des ORDRES de navigation, pas des erreurs :
      // session finie (401), et mot de passe provisoire à remplacer (403). Le
      // second n'était traité nulle part : un client à qui le garage venait
      // d'ouvrir un accès voyait cette page BLANCHE, sans issue (GF-DUR-016).
      // Le garage mémorisé vit dans la session de l'ONGLET : `lienPortail` le
      // reporte, sans quoi le client retombe sur une connexion qui ne sait plus
      // à quel garage il appartient (GF31-AUD-061).
      const ailleurs = await redirectionPortail(res)
      if (ailleurs) { router.replace(ailleurs); return }
      if (!res.ok) throw new Error()
      setData((await res.json()) as Dashboard)
    } catch {
      // leave data null → empty state
    } finally {
      setLoading(false)
    }
  }, [router])

  useEffect(() => { load() }, [load])

  async function logout() {
    await fetch('/api/portal/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => {})
    router.replace(lienPortail(cheminPortail('login')))
  }

  if (loading) return <div className="flex min-h-screen items-center justify-center bg-[#0a0f1e]"><Loader2 className="h-8 w-8 animate-spin text-slate-600" /></div>

  return (
    <div className="min-h-screen bg-[#0a0f1e] px-4 py-8 text-slate-200 md:px-8">
      <div className="mx-auto w-full max-w-4xl">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-2xl font-black text-white">Mon espace <span className="text-blue-400">GarageFlows</span></h1>
          <div className="flex items-center gap-2">
            {/* `lienPortail` reporte le garage courant : un lien nu le perdrait,
                et le client retomberait sur une connexion qui ne sait plus à
                quel garage il appartient. */}
            <Link
              href={lienPortail(cheminPortail('appointments'))}
              className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-white/[0.08]"
            >
              <CalendarClock className="h-3.5 w-3.5" /> Mes rendez-vous
            </Link>
            <Link
              href={lienPortail(cheminPortail('messages'))}
              className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-white/[0.08]"
            >
              <MessageSquare className="h-3.5 w-3.5" /> Mes messages
            </Link>
            {/* `/clients/password` n'était atteinte QUE par redirection, quand le
                serveur impose un changement. Un client qui voulait simplement
                changer son mot de passe — parce qu'il le soupçonne connu — n'avait
                aucun chemin pour y aller. Même défaut que la double
                authentification, en plus discret. */}
            <Link
              href={lienPortail(cheminPortail('password'))}
              className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-white/[0.08]"
            >
              <KeyRound className="h-3.5 w-3.5" /> Mot de passe
            </Link>
            <button onClick={logout} className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-white/[0.08]">
              <LogOut className="h-3.5 w-3.5" /> Déconnexion
            </button>
          </div>
        </div>

        {data && (
          <div className="mt-6 space-y-6">
            {/* Compte non encore RATTACHÉ à un dossier client.
                Le serveur le dit (`linkedClient: false`) ; l'écran l'ignorait et
                affichait « Aucune facture », « Aucun véhicule » — un client qui
                a bel et bien des documents concluait que son garage ne les avait
                pas mis en ligne, alors qu'il lui manquait seulement de vérifier
                son adresse e-mail (GF31-AUD-062). */}
            {!data.linkedClient && (
              <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-4 text-sm text-amber-300" role="status">
                <p className="font-semibold">Votre compte n’est pas encore relié à votre dossier client.</p>
                <p className="mt-1 text-amber-300/80">
                  Vos documents existent peut-être déjà, mais ils ne peuvent pas vous être
                  montrés tant que votre adresse e-mail n’est pas vérifiée. Ouvrez le lien
                  reçu par courriel, ou demandez à votre garage de vous le renvoyer.
                </p>
              </div>
            )}

            {/* Active repairs + timelines */}
            <Section icon={<Wrench className="h-4 w-4 text-blue-400" />} title="Réparations en cours">
              {data.activeRepairs.length === 0 ? <Empty>Aucune réparation en cours.</Empty> : data.activeRepairs.map(r => (
                <div key={r.id} className="rounded-xl border border-white/[0.08] bg-[#0d1424] p-4">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold text-white">{r.repairType}</div>
                    <div className="text-xs text-slate-500">{r.vehicle.licensePlate ?? r.vehicle.model ?? ''}</div>
                  </div>
                  <div className="mt-4 flex items-start justify-between gap-1 overflow-x-auto">
                    {r.timeline.stages.map(s => (
                      <div key={s.key} className="flex min-w-0 flex-1 flex-col items-center text-center">
                        <span className={cn('flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold', STAGE_DOT[s.state])}>
                          {s.state === 'done' ? '✓' : ''}
                        </span>
                        <span className={cn('mt-1 text-[9px] leading-tight', s.state === 'current' ? 'font-bold text-blue-300' : 'text-slate-500')}>{s.label}</span>
                      </div>
                    ))}
                  </div>
                  {r.mechanic && <div className="mt-2 text-[11px] text-slate-600">Mécanicien : {r.mechanic}</div>}
                </div>
              ))}
            </Section>

            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              <Section icon={<Car className="h-4 w-4 text-blue-400" />} title="Mes véhicules">
                {data.vehicles.length === 0 ? <Empty>Aucun véhicule.</Empty> : data.vehicles.map(v => (
                  <Row key={v.id} left={`${v.make} ${v.model}`} right={v.licensePlate} sub={v.mileage != null ? `${v.mileage} km` : undefined} />
                ))}
              </Section>

              <Section icon={<ShieldCheck className="h-4 w-4 text-blue-400" />} title="Garanties">
                {data.warranties.length === 0 ? <Empty>Aucune garantie.</Empty> : data.warranties.map(w => (
                  <Row key={w.id} left={w.partName} right={w.status} sub={`expire le ${new Date(w.expiresAt).toLocaleDateString('fr-FR')}`} />
                ))}
              </Section>

              <Section icon={<FileText className="h-4 w-4 text-blue-400" />} title="Devis">
                {data.quotes.length === 0 ? <Empty>Aucun devis.</Empty> : data.quotes.map(q => (
                  <Row key={q.id} left={q.number} right={`${q.totalTTC.toFixed(2)} €`} sub={q.status} />
                ))}
              </Section>

              <Section icon={<Receipt className="h-4 w-4 text-blue-400" />} title="Factures">
                {data.invoices.length === 0 ? <Empty>Aucune facture.</Empty> : data.invoices.map(i => (
                  <Row key={i.id} left={i.number} right={`${i.totalTTC.toFixed(2)} €`} sub={i.status} />
                ))}
              </Section>
            </div>

            {/* Sécurité du compte — la seule action qu'un client puisse
                entreprendre seul s'il craint que son compte soit ouvert
                ailleurs. Les routes existaient ; aucune page ne les appelait. */}
            <Section icon={<MonitorSmartphone className="h-4 w-4 text-blue-400" />} title="Mes connexions">
              <p className="text-[11px] text-slate-500">
                Les appareils sur lesquels votre espace client est ouvert. Fermez toute connexion
                que vous ne reconnaissez pas.
              </p>
              <PortalSessions />
            </Section>

            {/* Adresse de connexion. La route existait, éprouvée ; seul le
                garage pouvait s'en servir. Le client devait téléphoner pour
                corriger sa propre adresse — y compris quand c'est cette
                boîte-là qu'il venait de perdre (GF-DUR-028). */}
            <Section icon={<Mail className="h-4 w-4 text-blue-400" />} title="Mon adresse e-mail">
              <PortalEmail />
            </Section>

            {/* Second facteur. Tout existait côté serveur — enrôlement, secrets
                chiffrés, codes de secours, étape de connexion — sauf l'écran qui
                permet de l'activer. La protection était donc inatteignable, quoi
                que fasse le client (GF-DUR-026). */}
            <Section icon={<ShieldCheck className="h-4 w-4 text-blue-400" />} title="Double authentification">
              <PortalTwoFactor />
            </Section>
          </div>
        )}
      </div>
    </div>
  )
}

function Section({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-white/[0.08] bg-[#111827]/95 p-5">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-white">{icon} {title}</h2>
      <div className="space-y-2">{children}</div>
    </section>
  )
}

function Row({ left, right, sub }: { left: string; right?: string; sub?: string }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-white/[0.05] bg-white/[0.02] px-3 py-2 text-sm">
      <div>
        <div className="font-medium text-slate-200">{left}</div>
        {sub && <div className="text-[11px] capitalize text-slate-500">{sub}</div>}
      </div>
      {right && <div className="text-xs font-semibold text-slate-300">{right}</div>}
    </div>
  )
}

function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-dashed border-white/[0.06] px-3 py-4 text-center text-xs text-slate-600">{children}</div>
}
