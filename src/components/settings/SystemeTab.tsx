'use client'

/**
 * Réglages SYSTÈME du poste — aujourd'hui : démarrage automatique de Windows.
 *
 * ─── Pourquoi ce panneau existe ──────────────────────────────────────────────
 *
 * Le garage qui ouvre son atelier à 7 h n'a aucune raison particulière de penser
 * à lancer GarageFlows chaque matin : c'est exactement le genre de tâche qu'un
 * logiciel métier doit prendre en charge. Windows le permet depuis toujours,
 * l'application packagée n'y touchait pas.
 *
 * ─── L'interrupteur dit la VÉRITÉ ────────────────────────────────────────────
 *
 * Il n'affiche pas ce que l'utilisateur a demandé, mais ce que WINDOWS a retenu :
 * l'état est relu par le processus principal à chaque affichage de l'onglet
 * (`getLoginItemSettings`), donc après un retrait de l'entrée depuis le
 * Gestionnaire des tâches ou une désinstallation, l'interrupteur se remet tout
 * seul dans la bonne position. Un interrupteur qui persiste un booléen local
 * afficherait « Activé » sur un poste où l'application ne démarre plus toute
 * seule — le garage n'aurait aucun moyen de s'en apercevoir.
 *
 * ─── Hors application installée ──────────────────────────────────────────────
 *
 * Dans un navigateur, il n'existe aucun mécanisme de ce genre : le panneau
 * n'affiche pas un interrupteur factice mais explique franchement où le réglage
 * se trouve (l'application de bureau) — conformément à la règle « jamais de faux
 * bouton ». Aucun droit administrateur n'est demandé : l'entrée va dans la ruche
 * de l'utilisateur (HKCU), jamais dans la machine.
 */

import { useCallback, useEffect, useState } from 'react'
import { Power, Loader2, AlertCircle, CheckCircle2, Info } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useElectronApi } from '@/lib/use-electron-api'

interface EtatDemarrage {
  supported: boolean
  enabled: boolean
  raison?: string
  erreur?: string
  statut?: string
}

/** Pont Electron, tel que `preload.js` l'expose. */
interface ApiDemarrage {
  getAutostart?: () => Promise<EtatDemarrage>
  setAutostart?: (actif: boolean) => Promise<EtatDemarrage>
}

export function SystemeTab() {
  const api = useElectronApi<ApiDemarrage>()

  const [etat, setEtat]         = useState<EtatDemarrage | null>(null)
  const [chargement, setChargement] = useState(true)
  const [bascule, setBascule]   = useState(false)
  const [message, setMessage]   = useState<string | null>(null)

  /**
   * Relit l'état RÉEL. À appeler à l'affichage et après chaque bascule : la
   * réponse du processus principal est la seule source de vérité.
   */
  const relire = useCallback(async () => {
    if (!api?.getAutostart) { setChargement(false); return }
    setChargement(true)
    try {
      const e = await api.getAutostart()
      setEtat(e)
      setMessage(e?.erreur ?? null)
    } catch {
      setEtat(null)
      setMessage('Lecture du réglage impossible.')
    } finally {
      setChargement(false)
    }
  }, [api])

  useEffect(() => { void relire() }, [relire])

  async function basculer(actif: boolean) {
    if (!api?.setAutostart) return
    setBascule(true)
    setMessage(null)
    try {
      const e = await api.setAutostart(actif)
      setEtat(e)
      // Le réglage est écrit : on RELIT pour afficher l'état réel, et non la
      // réponse (qui peut être un échec propre — Windows verrouillé par une
      // stratégie d'entreprise, par exemple).
      await relire()
      if (e?.erreur) setMessage(e.erreur)
    } catch {
      setMessage('Modification impossible — vérifiez que rien ne verrouille le démarrage de Windows.')
    } finally {
      setBascule(false)
    }
  }

  // ── Navigateur : pas d'interrupteur factice ────────────────────────────────
  const dansApplication = !!api
  if (!dansApplication) {
    return (
      <div className="space-y-4">
        <Section
          titre="Démarrage de Windows"
          icone={<Power className="w-4 h-4 text-blue-400" />}
        >
          <div className="flex items-start gap-2 text-xs text-slate-400">
            <Info className="w-4 h-4 flex-shrink-0 mt-px text-slate-500" />
            <p>
              Ce réglage pilote le démarrage automatique de l’
              <strong className="text-slate-300">application de bureau</strong> au lancement de
              Windows. Depuis un navigateur, aucun mécanisme de ce type n’existe : les
              applications web ne peuvent pas s’inscrire au démarrage du système.
              <br />
              Installez GarageFlows sur le poste du comptoir pour activer cette option.
            </p>
          </div>
        </Section>
      </div>
    )
  }

  const actif = etat?.enabled === true
  const indisponible = etat?.supported === false

  return (
    <div className="space-y-4">
      <Section
        titre="Démarrage de Windows"
        icone={<Power className="w-4 h-4 text-blue-400" />}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm text-slate-200">Lancer GarageFlows au démarrage de Windows</p>
            <p className="text-xs text-slate-500 mt-1 max-w-md">
              L’application s’ouvre automatiquement à l’ouverture de votre session, sans
              clic. Elle est inscrite dans votre propre session utilisateur&nbsp;:
              aucun droit administrateur n’est requis, et la retirer ne touche ni vos
              données ni votre licence.
            </p>
          </div>

          <div className="flex items-center gap-3 flex-shrink-0">
            {chargement || bascule ? (
              <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
            ) : (
              <button
                type="button"
                role="switch"
                aria-checked={actif}
                aria-label="Lancer GarageFlows au démarrage de Windows"
                disabled={indisponible || chargement || bascule}
                onClick={() => void basculer(!actif)}
                className={cn(
                  'relative w-12 h-7 rounded-full border transition-colors gf-touch',
                  actif
                    ? 'bg-blue-600 border-blue-500'
                    : 'bg-white/[0.06] border-white/[0.12]',
                  (indisponible || bascule) && 'opacity-50 cursor-not-allowed',
                )}
              >
                <span
                  className={cn(
                    'absolute top-0.5 w-6 h-6 rounded-full bg-white shadow transition-all',
                    actif ? 'left-[1.375rem]' : 'left-0.5',
                  )}
                />
              </button>
            )}
            <span className={cn('text-xs font-medium w-16', actif ? 'text-emerald-400' : 'text-slate-500')}>
              {chargement ? '…' : actif ? 'Activé' : 'Désactivé'}
            </span>
          </div>
        </div>

        {indisponible && (
          <p className="text-xs text-slate-500 mt-3">
            Ce réglage est propre à Windows. Sur cet appareil, il n’est pas disponible.
          </p>
        )}

        {message && (
          <div className="flex items-start gap-2 mt-3 text-xs text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-px" />
            <span>{message}</span>
          </div>
        )}

        {!message && !chargement && actif && (
          <div className="flex items-start gap-2 mt-3 text-xs text-emerald-400/90">
            <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0 mt-px" />
            <span>Réglage actif dans Windows (confirmé par le système).</span>
          </div>
        )}

        {!message && !chargement && !actif && etat?.statut === 'disabled' && (
          <div className="flex items-start gap-2 mt-3 text-xs text-amber-300/90">
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-px" />
            <span>
              Windows indique une entrée de démarrage DÉSACTIVÉE (retirée depuis le
              Gestionnaire des tâches). Réactivez l’interrupteur pour la rétablir.
            </span>
          </div>
        )}
      </Section>
    </div>
  )
}

/** Bloc de réglage, aligné sur les autres onglets des paramètres. */
function Section({ titre, icone, children }: { titre: string; icone: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4">
      <div className="flex items-center gap-2 mb-3">
        {icone}
        <h3 className="text-sm font-semibold text-white">{titre}</h3>
      </div>
      {children}
    </div>
  )
}

export default SystemeTab
