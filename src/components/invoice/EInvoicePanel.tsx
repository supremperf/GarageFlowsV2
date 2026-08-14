'use client'

/**
 * Transmission d'une facture à la plateforme agréée — depuis la facture.
 *
 * ─── Pourquoi ce panneau existe ─────────────────────────────────────────────
 * La chaîne d'émission était complète et éprouvée côté serveur : validation de
 * profil, document CII, clé d'idempotence persistée, prise exclusive du rejeu,
 * relecture de statut, sortie tracée de l'impasse « issue inconnue ». Et aucun
 * écran ne l'appelait. Pas un seul : `envoyerFacture` avait une route que
 * personne n'ouvrait, `rafraichirStatut` n'avait même pas de route. Une
 * fonctionnalité qu'aucun utilisateur ne peut atteindre n'existe pas — quel que
 * soit le nombre de tests qui la couvrent.
 *
 * ─── Ce que le panneau ne fait jamais ───────────────────────────────────────
 * Il ne DÉCIDE rien. Le droit d'émettre, le droit de relire, le droit de
 * déclarer non parvenue sont calculés par le serveur et rendus tels quels
 * (`peutEmettre`, `peutRelireStatut`, `peutDeclarerNonParvenue`). Recopier ici
 * la règle des quinze minutes, ou celle des statuts rejouables, garantirait
 * qu'un jour les deux divergent et qu'un bouton proposé mène à un refus.
 *
 * Il n'affiche pas non plus d'état optimiste : rien ne change à l'écran avant
 * la réponse du serveur. Sur une transmission réglementaire, montrer « envoyée »
 * avant de le savoir serait le pire des mensonges.
 */

import { useCallback, useEffect, useState } from 'react'
import { Loader2, Send, RefreshCw, AlertTriangle, ShieldQuestion, Landmark } from 'lucide-react'
import toast from 'react-hot-toast'

interface Transmission {
  id: string
  providerId: string
  environment: string
  status: string
  externalId: string | null
  errorMessage: string | null
  createdAt: string
  updatedAt: string
  peutDeclarerNonParvenue: boolean
  peutRelireStatut: boolean
}

interface Etat {
  transmissions: Transmission[]
  outgoingEnabled: boolean
  environment: string
  peutEmettre: boolean
}

/** Libellés des statuts canoniques — le statut brut de la plateforme n'est jamais réécrit. */
const LIBELLE: Record<string, string> = {
  draft: 'Brouillon',
  submission_pending: 'Envoi en cours',
  submitted: 'Transmise',
  received_by_platform: 'Reçue par la plateforme',
  delivered: 'Remise au destinataire',
  accepted: 'Acceptée',
  rejected: 'Rejetée',
  refused: 'Refusée par le destinataire',
  paid: 'Payée',
  error: 'Échec — renvoi possible',
  unknown: 'Issue inconnue',
}

const TEINTE: Record<string, string> = {
  submission_pending: 'bg-blue-100 text-blue-700',
  submitted: 'bg-blue-100 text-blue-700',
  received_by_platform: 'bg-blue-100 text-blue-700',
  delivered: 'bg-emerald-100 text-emerald-700',
  accepted: 'bg-emerald-100 text-emerald-700',
  paid: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-red-100 text-red-700',
  refused: 'bg-red-100 text-red-700',
  error: 'bg-red-100 text-red-700',
  unknown: 'bg-amber-100 text-amber-800',
}

const BTN = 'flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg disabled:opacity-50 transition-colors'

export function EInvoicePanel({ invoiceId, statutFacture }: { invoiceId: string; statutFacture: string }) {
  const [etat, setEtat] = useState<Etat | null>(null)
  const [occupe, setOccupe] = useState<string | null>(null)

  const recharger = useCallback(async () => {
    try {
      const res = await fetch(`/api/einvoicing/invoices/${invoiceId}/submit`, { cache: 'no-store' })
      // 501 sur le poste (base SQLite), 403 sans droit de lecture financière :
      // dans les deux cas le panneau n'a rien à dire, il disparaît. Afficher une
      // erreur ferait croire à une panne là où il n'y a qu'une absence.
      setEtat(res.ok ? ((await res.json()) as Etat) : null)
    } catch {
      setEtat(null)
    }
  }, [invoiceId])

  useEffect(() => { void recharger() }, [recharger])

  async function agir(corps: Record<string, unknown>, cle: string, succes: string) {
    setOccupe(cle)
    try {
      const res = await fetch(`/api/einvoicing/invoices/${invoiceId}/submit`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(corps),
      })
      const data = await res.json().catch(() => null)
      if (res.ok) toast.success(succes)
      // Le refus du serveur est montré TEL QUEL : il porte l'information dont
      // l'exploitant a besoin (règle de profil violée, statut réel, marche à
      // suivre). Le remplacer par « échec » lui retirerait tout moyen d'agir.
      else toast.error(data?.message ?? data?.error ?? 'Opération refusée.')
      // Les règles de validation du profil, quand il y en a, valent d'être lues
      // une par une : ce sont elles qui disent quoi corriger sur la facture.
      for (const i of (data?.issues ?? []).slice(0, 4)) toast.error(i.message, { duration: 8000 })
      await recharger()
    } catch {
      toast.error('Réseau indisponible.')
    } finally {
      setOccupe(null)
    }
  }

  if (!etat) return null

  const derniere = etat.transmissions[0] ?? null
  const aboutie = Boolean(derniere?.externalId)
  const sandbox = etat.environment !== 'production'
  // Un brouillon n'est pas opposable, une facture annulée a été retirée : ni
  // l'une ni l'autre n'a à être déclarée. Le serveur le refuse déjà ; ne pas
  // proposer le bouton évite d'y envoyer l'exploitant pour rien.
  const transmissible = statutFacture !== 'draft' && statutFacture !== 'cancelled'

  return (
    <div className="mx-8 mb-8 rounded-xl border border-gray-200 bg-gray-50/70 p-4" data-gf-einvoice-panel>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
          <Landmark className="w-3.5 h-3.5" /> Facturation électronique
        </p>
        {derniere && (
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${TEINTE[derniere.status] ?? 'bg-gray-100 text-gray-600'}`}>
            {LIBELLE[derniere.status] ?? derniere.status}
          </span>
        )}
      </div>

      {sandbox && (
        <p className="mt-2 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
          Environnement <span className="font-mono">sandbox</span> : les envois partent vers l’environnement d’essai
          de votre plateforme, pas à l’administration.
        </p>
      )}

      {!etat.outgoingEnabled ? (
        <p className="mt-2 text-xs text-gray-500">
          L’émission de factures électroniques n’est pas activée sur ce service.
        </p>
      ) : !derniere ? (
        <p className="mt-2 text-xs text-gray-500">
          {transmissible
            ? 'Cette facture n’a pas encore été transmise à votre plateforme agréée.'
            : 'Une facture en brouillon ou annulée ne se transmet pas.'}
        </p>
      ) : (
        <div className="mt-2 space-y-1 text-xs text-gray-600">
          <p>
            Plateforme <span className="font-mono text-gray-700">{derniere.providerId}</span>
            {derniere.externalId && <> · référence <span className="font-mono text-gray-700">{derniere.externalId}</span></>}
          </p>
          {derniere.errorMessage && (
            <p className="text-red-700 bg-red-50 border border-red-200 rounded-lg px-2.5 py-1.5">
              {derniere.errorMessage}
            </p>
          )}
          {derniere.status === 'unknown' && (
            <p className="flex items-start gap-1.5 text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
              <ShieldQuestion className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>
                La connexion est tombée sans réponse : impossible de savoir si la facture est parvenue.
                Vérifiez sur le portail de votre plateforme, puis déclarez-la non parvenue si elle n’y figure pas.
              </span>
            </p>
          )}
        </div>
      )}

      {etat.outgoingEnabled && (
        <div className="mt-3 flex items-center gap-2 flex-wrap">
          {etat.peutEmettre && transmissible && !aboutie && (
            <button
              onClick={() => agir({}, 'envoi', 'Facture transmise à la plateforme.')}
              disabled={occupe !== null || derniere?.status === 'submission_pending'}
              className={`${BTN} bg-blue-600 text-white hover:bg-blue-700`}
            >
              {occupe === 'envoi' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              {derniere ? 'Renvoyer' : 'Transmettre à la plateforme'}
            </button>
          )}

          {derniere?.peutRelireStatut && (
            <button
              onClick={() => agir({ action: 'refresh-status', transmissionId: derniere.id }, 'statut', 'Statut relu auprès de la plateforme.')}
              disabled={occupe !== null}
              className={`${BTN} bg-gray-100 text-gray-700 hover:bg-gray-200`}
            >
              {occupe === 'statut' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              Actualiser le statut
            </button>
          )}

          {etat.peutEmettre && derniere?.peutDeclarerNonParvenue && (
            <button
              onClick={() => {
                // Confirmation exigée : cette déclaration rouvre le droit de
                // renvoyer. Faite à tort, elle produit exactement ce que toute
                // la chaîne existe pour empêcher — deux déclarations de la même
                // facture à l'administration.
                if (!window.confirm(
                  'Confirmez-vous avoir vérifié sur le portail de votre plateforme que cette facture n’y figure pas ?\n\n'
                  + 'Cette déclaration autorise un nouvel envoi. Si la facture y figure déjà, elle serait déclarée deux fois.',
                )) return
                void agir(
                  { action: 'declare-not-received', transmissionId: derniere.id },
                  'declaration',
                  'Déclarée non parvenue : le renvoi est autorisé.',
                )
              }}
              disabled={occupe !== null}
              className={`${BTN} bg-amber-50 text-amber-800 border border-amber-200 hover:bg-amber-100`}
            >
              {occupe === 'declaration' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <AlertTriangle className="w-3.5 h-3.5" />}
              Déclarer non parvenue
            </button>
          )}
        </div>
      )}

      {etat.transmissions.length > 1 && (
        <p className="mt-2 text-[11px] text-gray-400">
          {etat.transmissions.length} tentatives enregistrées pour cette facture.
        </p>
      )}
    </div>
  )
}
