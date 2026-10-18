'use client'

/**
 * Clients — annuaire et gestion des ACCÈS PORTAIL.
 *
 * ─── Pourquoi ce panneau existe (GF-PORT-005) ───────────────────────────────
 * `/api/clients` existe depuis longtemps, avec recherche et pagination, mais
 * AUCUN écran ne l'appelait : la gestion des clients était entièrement sans
 * interface. Les routes d'accès portail — ouverture, réinitialisation,
 * désactivation — étaient donc elles aussi inatteignables, quel que soit leur
 * bon fonctionnement.
 *
 * Le mot de passe temporaire n'est affiché QU'UNE FOIS, au retour de l'appel :
 * seul son haché est conservé. Le garage doit le communiquer immédiatement.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { X, Users, Search, Loader2, KeyRound, RotateCcw, Ban, Check, Copy, Pencil, Save } from 'lucide-react'
import toast from 'react-hot-toast'
import { cn } from '@/lib/utils'
import { AddressAutocomplete } from '@/components/AddressAutocomplete'
import { useBrouillonPersistant } from '@/lib/ui/brouillon'

interface Vehicule { id: string; licensePlate: string | null; make: string | null; model: string | null }
interface ClientRow {
  id: string; name: string; email: string | null; phone: string | null
  /** Adresse POSTALE — la colonne existait, aucun écran ne la remplissait. */
  address: string | null
  vehicles: Vehicule[]
}

/** Champ de la fiche, en cours de modification. */
interface Brouillon { name: string; email: string; phone: string; address: string }

const CHAMP = 'w-full px-2.5 py-1.5 rounded-lg bg-white/[0.05] border border-white/10 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/60'

interface EtatAcces {
  exists: boolean
  identifiant?: string
  actif?: boolean
  motDePasseTemporaire?: boolean
  derniereConnexion?: string | null
}

export interface ClientsPanelProps {
  onClose: () => void
  /**
   * Fiche à ouvrir dès l'affichage.
   *
   * Le sélecteur de client de la barre d'outils (`ClientPicker`) a déjà identifié
   * le client : demander à l'utilisateur de le rechercher une SECONDE fois dans
   * la liste serait une perte pure. La fiche est chargée par identifiant, même
   * si le client n'apparaît pas dans la page courante de l'annuaire.
   */
  initialClientId?: string | null
  /**
   * Prévient l'appelant qu'une écriture a réussi (fiche modifiée, accès ouvert,
   * réinitialisé, désactivé). Le menu déroulant s'en sert pour recharger sa
   * liste : il affichait sinon l'état d'avant l'écriture jusqu'au rechargement
   * de la page.
   */
  onClientsChanged?: () => void
}

export default function ClientsPanel({ onClose, initialClientId = null, onClientsChanged }: ClientsPanelProps) {
  const [recherche, setRecherche] = useState('')
  const [clients, setClients] = useState<ClientRow[]>([])
  const [chargement, setChargement] = useState(true)
  const [erreur, setErreur] = useState<string | null>(null)
  const [ouvert, setOuvert] = useState<string | null>(null)

  const [acces, setAcces] = useState<Record<string, EtatAcces>>({})
  const [occupe, setOccupe] = useState<string | null>(null)
  /** Mot de passe temporaire fraîchement émis — affiché une seule fois. */
  const [motDePasse, setMotDePasse] = useState<{ clientId: string; valeur: string } | null>(null)
  /**
   * Fiche en cours de modification (un seul client à la fois).
   *
   * Conservée par `useBrouillonPersistant` : passer au planning pour vérifier un
   * chiffre puis revenir sur la fiche ne fait plus disparaître la correction en
   * cours. Le brouillon n'est PAS écrit sur disque — seule la page « Clients »
   * le retrouve, et l'abandonner (fermer la page) l'efface.
   */
  const [brouillon, setBrouillon] = useBrouillonPersistant<{ clientId: string; valeurs: Brouillon } | null>(
    'clients:fiche',
    null,
  )

  // Recherche différée : sans cela, chaque frappe déclenche une requête.
  const minuterie = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (minuterie.current) clearTimeout(minuterie.current)
    minuterie.current = setTimeout(() => {
      let vivant = true
      setChargement(true)
      fetch(`/api/clients?limit=50&q=${encodeURIComponent(recherche)}`)
        .then(async (r) => {
          const d = await r.json().catch(() => null)
          if (!vivant) return
          if (!r.ok || !d) { setErreur('Chargement impossible.'); return }
          setErreur(null)
          setClients(d.data ?? [])
        })
        .catch(() => { if (vivant) setErreur('Serveur injoignable.') })
        .finally(() => { if (vivant) setChargement(false) })
      return () => { vivant = false }
    }, 250)
    return () => { if (minuterie.current) clearTimeout(minuterie.current) }
  }, [recherche])

  /**
   * Ouvre une fiche désignée de l'extérieur (sélecteur de la barre d'outils).
   *
   * La fiche est lue par sa route dédiée : l'annuaire est paginé (50 max), donc
   * le client demandé peut très bien ne pas figurer dans la page affichée. On
   * l'AJOUTE à la liste au lieu de l'y chercher — sinon le panneau s'ouvrirait
   * sur une fiche absente de son propre écran.
   */
  useEffect(() => {
    if (!initialClientId) return
    let vivant = true
    setMotDePasse(null)
    setBrouillon(null)
    setOuvert(initialClientId)
    fetch(`/api/clients/${initialClientId}`)
      .then(async (r) => (r.ok ? r.json() : null))
      .then((c) => {
        if (!vivant || !c) return
        setClients((liste) => (liste.some((x) => x.id === c.id) ? liste : [c, ...liste]))
      })
      .catch(() => { /* la fiche reste introuvable : la liste affichée fait foi */ })
    return () => { vivant = false }
    // `setBrouillon` est stable (mémorisé par clé) : l'ajouter évite un
    // avertissement de dépendance manquante sans relancer la requête.
  }, [initialClientId, setBrouillon])

  const chargerAcces = useCallback(async (clientId: string) => {
    const r = await fetch(`/api/clients/${clientId}/portal-access`)
    const d = await r.json().catch(() => null)
    if (r.ok && d) setAcces((a) => ({ ...a, [clientId]: d }))
  }, [])

  useEffect(() => {
    if (ouvert && !acces[ouvert]) void chargerAcces(ouvert)
    // `acces` est volontairement hors dépendances : on ne veut charger les accès
    // qu'à l'OUVERTURE d'une fiche, pas à chaque réponse reçue.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ouvert])


  function basculer(clientId: string) {
    const suivant = ouvert === clientId ? null : clientId
    setOuvert(suivant)
    setMotDePasse(null)
    setBrouillon(null)
    if (suivant && !acces[suivant]) chargerAcces(suivant)
  }

  /**
   * Enregistre la fiche, et rend compte des conséquences PORTAIL.
   *
   * Changer l'adresse d'un client qui a un accès change son IDENTIFIANT de
   * connexion : ses sessions tombent et sa vérification repart de zéro. Le
   * garage doit l'apprendre de l'écran, pas d'un appel du client trois jours
   * plus tard.
   */
  async function enregistrerFiche(clientId: string, valeurs: Brouillon) {
    setOccupe(clientId)
    try {
      const r = await fetch(`/api/clients/${clientId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: valeurs.name.trim(),
          // Une adresse effacée est une adresse RETIRÉE — `null`, pas `''` :
          // la chaîne vide passerait la validation et s'installerait comme
          // identifiant fantôme.
          email: valeurs.email.trim() || null,
          phone: valeurs.phone.trim() || null,
          // L'adresse postale n'était envoyée par AUCUN écran : la colonne
          // `Client.address` restait vide, et les documents imprimés n'avaient
          // rien à reprendre (GF-022).
          address: valeurs.address.trim() || null,
        }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { toast.error(d?.error ?? 'Modification refusée par le serveur.'); return }

      // L'affichage suit la réponse du serveur, jamais le brouillon local.
      setClients((liste) => liste.map((c) => (c.id === clientId
        ? { ...c, name: d.name, email: d.email, phone: d.phone, address: d.address ?? null }
        : c)))
      setBrouillon(null)

      if (d.portail?.identifiantModifie) {
        // Rechargé, sinon l'écran continuerait d'afficher l'ancien identifiant.
        await chargerAcces(clientId)
        toast.success('Fiche enregistrée — identifiant de connexion mis à jour')
        toast(
          d.portail.emailEnvoye === false
            ? 'Sessions du client fermées. L’avis n’a PAS pu être envoyé : prévenez-le de sa nouvelle adresse de connexion.'
            : 'Sessions du client fermées ; un avis lui a été envoyé à sa nouvelle adresse.',
          { duration: 9000 },
        )
      } else {
        toast.success('Fiche enregistrée')
      }

      // Le sélecteur de la barre d'outils affiche le nom, le téléphone et les
      // véhicules : il doit relire la liste après CHAQUE écriture réussie, sinon
      // il continue de proposer les valeurs d'avant la correction.
      onClientsChanged?.()
    } catch {
      toast.error('Serveur injoignable.')
    } finally {
      setOccupe(null)
    }
  }

  /** Appelle une route d'accès portail et rafraîchit l'état affiché. */
  async function agir(clientId: string, methode: 'POST' | 'PUT' | 'PATCH', corps?: unknown) {
    setOccupe(clientId)
    setMotDePasse(null)
    try {
      const r = await fetch(`/api/clients/${clientId}/portal-access`, {
        method: methode,
        ...(corps === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corps) }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { toast.error(d?.error ?? 'Action refusée par le serveur.'); return }

      setAcces((a) => ({ ...a, [clientId]: d }))

      // Une réinitialisation d'accès change l'identifiant de connexion du client :
      // la liste déroulante doit s'en apercevoir sans rechargement de page.
      onClientsChanged?.()

      // Le portail client est servi par le service en ligne. Tant que l'accès n'y
      // est pas parvenu, le client se heurtera à un refus de connexion : annoncer
      // « accès prêt, communiquez le mot de passe » ferait dicter à voix haute un
      // identifiant pour un service qui ne le connaît pas.
      const nonPublie = d.publieEnLigne === false
      const motif: Record<string, string> = {
        HORS_LIGNE: 'service en ligne injoignable — réessayez avec « Réinitialiser » une fois reconnecté',
        LICENCE_ABSENTE: 'aucune licence garage active sur ce poste',
        EMAIL_TAKEN_CLOUD: 'cette adresse a déjà un accès en ligne',
        REFUS: 'refusé par le service en ligne',
      }
      const detail = motif[String(d.motifPublication)] ?? 'cause inconnue'

      if (typeof d.motDePasseTemporaireEnClair === 'string') {
        setMotDePasse({ clientId, valeur: d.motDePasseTemporaireEnClair })
        if (nonPublie) {
          toast.error(`Accès créé mais PAS ENCORE en ligne : ${detail}. Ne communiquez pas encore le mot de passe.`)
        } else {
          toast.success('Accès prêt — communiquez le mot de passe maintenant')
        }
      } else if (nonPublie) {
        toast.error(`Changement enregistré localement mais PAS appliqué en ligne : ${detail}.`)
      } else {
        toast.success(d.actif === false ? 'Accès désactivé' : 'Accès réactivé')
      }
    } catch {
      toast.error('Serveur injoignable.')
    } finally {
      setOccupe(null)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-[#0a0f1e] flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.07] bg-[#0f1629]/80">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center">
            <Users className="w-4 h-4 text-white" />
          </div>
          <div>
            <p className="text-sm font-bold text-white leading-none">Clients</p>
            <p className="text-[11px] text-slate-500 mt-0.5">Annuaire et accès à l’espace client</p>
          </div>
        </div>
        <button onClick={onClose} aria-label="Fermer" title="Fermer" className="gf-close text-slate-400">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="px-4 py-3 border-b border-white/[0.05]">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-600 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
            placeholder="Rechercher un client…"
            className="w-full pl-9 pr-3 py-2 rounded-lg bg-white/[0.05] border border-white/10 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/60"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {chargement ? (
          <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-blue-500" /></div>
        ) : erreur ? (
          <p className="text-center text-sm text-red-400 py-10">{erreur}</p>
        ) : clients.length === 0 ? (
          <p className="text-center text-sm text-slate-500 py-10">Aucun client.</p>
        ) : (
          <div className="space-y-2 max-w-3xl mx-auto">
            {clients.map((c) => {
              const a = acces[c.id]
              const estOuvert = ouvert === c.id
              const enCours = occupe === c.id
              return (
                <div key={c.id} className="rounded-xl border border-white/[0.07] bg-white/[0.02] overflow-hidden">
                  <button
                    onClick={() => basculer(c.id)}
                    className="w-full flex items-center gap-3 p-3 text-left hover:bg-white/[0.03] transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-white truncate">{c.name}</p>
                      <p className="text-[11px] text-slate-500 truncate">
                        {c.email ?? 'Sans e-mail'}
                        {c.vehicles.length > 0 && ` · ${c.vehicles.length} véhicule${c.vehicles.length > 1 ? 's' : ''}`}
                      </p>
                    </div>
                    {a?.exists && (
                      <span className={cn(
                        'text-[10px] font-bold px-2 py-0.5 rounded-full',
                        a.actif ? 'text-emerald-300 bg-emerald-500/15' : 'text-slate-400 bg-slate-500/15',
                      )}>
                        {a.actif ? 'Accès actif' : 'Accès désactivé'}
                      </span>
                    )}
                  </button>

                  {estOuvert && (
                    <div className="px-3 pb-3 border-t border-white/[0.05] pt-3">
                      {/* ── Fiche client (GF-PORT-007) ──────────────────────
                          Aucune route ne permettait de modifier une fiche : le
                          garage ne pouvait pas corriger une adresse mal saisie,
                          et continuait donc d'écrire à la mauvaise. */}
                      {brouillon?.clientId === c.id ? (
                        <div className="mb-3 space-y-2">
                          <input
                            value={brouillon.valeurs.name}
                            onChange={(e) => setBrouillon({ clientId: c.id, valeurs: { ...brouillon.valeurs, name: e.target.value } })}
                            placeholder="Nom du client" aria-label="Nom du client" className={CHAMP}
                          />
                          <input
                            value={brouillon.valeurs.email}
                            onChange={(e) => setBrouillon({ clientId: c.id, valeurs: { ...brouillon.valeurs, email: e.target.value } })}
                            placeholder="Adresse e-mail" aria-label="Adresse e-mail" type="email" className={CHAMP}
                          />
                          <input
                            value={brouillon.valeurs.phone}
                            onChange={(e) => setBrouillon({ clientId: c.id, valeurs: { ...brouillon.valeurs, phone: e.target.value } })}
                            placeholder="Téléphone" aria-label="Téléphone" className={CHAMP}
                          />
                          {/* Adresse postale avec propositions (GF-022) : la
                              colonne existait et n'était remplie par aucun
                              écran — les documents imprimés n'avaient donc
                              jamais d'adresse à reprendre. */}
                          <AddressAutocomplete
                            value={brouillon.valeurs.address}
                            onChange={(v) => setBrouillon({ clientId: c.id, valeurs: { ...brouillon.valeurs, address: v } })}
                            placeholder="Adresse postale"
                            aria-label="Adresse postale"
                            className={CHAMP}
                          />
                          {/* L'avertissement est posé AVANT le clic : après, il
                              serait un constat, pas un choix. */}
                          {a?.exists && brouillon.valeurs.email.trim().toLowerCase() !== (c.email ?? '').toLowerCase() && (
                            <p className="text-[11px] text-amber-300 bg-amber-500/[0.07] border border-amber-500/25 rounded-lg px-2.5 py-1.5">
                              Ce client a un accès en ligne : cette adresse deviendra son identifiant de connexion.
                              Ses sessions ouvertes seront fermées et il recevra un lien de confirmation.
                            </p>
                          )}
                          <div className="flex gap-2">
                            <button
                              onClick={() => enregistrerFiche(c.id, brouillon.valeurs)}
                              disabled={enCours || !brouillon.valeurs.name.trim()}
                              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold disabled:opacity-50 transition-colors"
                            >
                              {enCours ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                              Enregistrer
                            </button>
                            <button
                              onClick={() => setBrouillon(null)}
                              className="px-3 py-2 rounded-lg border border-white/10 text-slate-400 text-xs hover:bg-white/[0.06] transition-colors"
                            >
                              Annuler
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          onClick={() => setBrouillon({
                            clientId: c.id,
                            valeurs: { name: c.name, email: c.email ?? '', phone: c.phone ?? '', address: c.address ?? '' },
                          })}
                          className="flex items-center gap-1.5 mb-3 px-3 py-1.5 rounded-lg border border-white/10 text-slate-300 text-xs hover:bg-white/[0.06] transition-colors"
                        >
                          <Pencil className="w-3.5 h-3.5" />Modifier la fiche
                        </button>
                      )}

                      {a === undefined ? (
                        <Loader2 className="w-4 h-4 animate-spin text-slate-500" />
                      ) : !a.exists ? (
                        <>
                          <p className="text-[11px] text-slate-500 mb-2">
                            Ce client n’a pas encore d’accès à son espace en ligne.
                          </p>
                          <button
                            onClick={() => agir(c.id, 'POST')}
                            disabled={enCours}
                            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold disabled:opacity-50 transition-colors"
                          >
                            {enCours ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <KeyRound className="w-3.5 h-3.5" />}
                            Ouvrir un accès
                          </button>
                        </>
                      ) : (
                        <>
                          <div className="text-[11px] text-slate-400 mb-2 space-y-0.5">
                            <p>Identifiant : <span className="text-slate-200 font-mono">{a.identifiant}</span></p>
                            {a.motDePasseTemporaire && (
                              <p className="text-amber-400">Mot de passe temporaire — le client doit le changer à sa première connexion.</p>
                            )}
                            {a.derniereConnexion && (
                              <p>Dernière connexion : {new Date(a.derniereConnexion).toLocaleString('fr-FR')}</p>
                            )}
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <button
                              onClick={() => agir(c.id, 'PUT')}
                              disabled={enCours}
                              className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-white/10 text-slate-300 text-xs hover:bg-white/[0.06] disabled:opacity-50 transition-colors"
                            >
                              <RotateCcw className="w-3.5 h-3.5" />Réinitialiser
                            </button>
                            <button
                              onClick={() => agir(c.id, 'PATCH', { actif: !a.actif })}
                              disabled={enCours}
                              className={cn(
                                'flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs disabled:opacity-50 transition-colors',
                                a.actif
                                  ? 'border-white/10 text-slate-400 hover:bg-red-500/10 hover:text-red-400'
                                  : 'border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/10',
                              )}
                            >
                              {a.actif ? <><Ban className="w-3.5 h-3.5" />Désactiver</> : <><Check className="w-3.5 h-3.5" />Réactiver</>}
                            </button>
                          </div>
                        </>
                      )}

                      {/* Affiché UNE SEULE FOIS : seul le haché est conservé. */}
                      {motDePasse?.clientId === c.id && (
                        <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/[0.07] p-3">
                          <p className="text-[11px] text-amber-300 font-semibold mb-1.5">
                            Mot de passe temporaire — il ne sera plus jamais affiché
                          </p>
                          <div className="flex items-center gap-2">
                            <code className="flex-1 px-2.5 py-1.5 rounded bg-black/30 text-sm text-white font-mono tracking-wide select-all">
                              {motDePasse.valeur}
                            </code>
                            <button
                              onClick={() => {
                                navigator.clipboard?.writeText(motDePasse.valeur)
                                  .then(() => toast.success('Copié'))
                                  .catch(() => toast.error('Copie impossible — sélectionnez le texte'))
                              }}
                              aria-label="Copier le mot de passe"
                              className="p-2 rounded-lg text-amber-300 hover:bg-amber-500/15 transition-colors"
                            >
                              <Copy className="w-3.5 h-3.5" />
                            </button>
                          </div>
                          <p className="text-[10px] text-amber-400/70 mt-1.5">
                            Communiquez-le au client par un canal sûr. Il devra le changer à sa première connexion.
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
