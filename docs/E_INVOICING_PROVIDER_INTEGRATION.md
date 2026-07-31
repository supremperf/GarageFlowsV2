# Intégration d'un PDP / Chorus Pro réel — GUIDE DE CONCEPTION

> **STATUT : DESIGN / PROPOSITION — NON CONSTRUIT.**
> Ce document explique **comment** brancher ultérieurement une Plateforme de
> Dématérialisation Partenaire (PDP) réelle ou Chorus Pro. **Aucun connecteur
> n'existe aujourd'hui** : le code Factur-X/UBL/CII, l'interface `EInvoiceProvider`
> et tout adaptateur PDP sont à construire (audit `data-model-einvoicing`, risque
> HIGH). Le branchement réel dépend en outre d'**actifs externes** (contrat PDP,
> immatriculation, identifiants API) qui ne font pas partie du code source et
> doivent être acquis séparément.

---

## 1. Prérequis externes (hors code — à acquérir)

Le branchement d'un PDP réel n'est **pas** un simple travail de développement.
Sont requis, en dehors du dépôt :

| Prérequis | Nature | Fourni par le code ? |
|---|---|---|
| Contrat avec une PDP immatriculée (ou raccordement Chorus Pro) | Contractuel / commercial | **Non — externe** |
| Identifiants API du PDP (client_id/secret, certificats) | Secret externe | **Non — externe** |
| Immatriculation / conformité de l'émetteur (SIRET, mandats) | Réglementaire | **Non — externe** |
| Environnement de recette (sandbox) fourni par le PDP | Accès externe | **Non — externe** |
| URL de webhook accessible publiquement (cycle de vie entrant) | Infrastructure | Partiellement (à exposer) |

Ces éléments s'ajoutent aux transferts d'actifs déjà identifiés comme bloquants P0
de la cession (clés de signature privées, backend, domaines) : voir
`ACQUISITION_READINESS_AUDIT.md`.

---

## 2. Interface fournisseur générique (rappel)

Le branchement réel implémenterait le contrat `EInvoiceProvider` défini dans
`E_INVOICING_ARCHITECTURE.md` §6. Rappel du contrat *proposé* :

```ts
// PROPOSÉ — non implémenté.
interface EInvoiceProvider {
  readonly name: string
  submit(doc: EInvoiceDocument): Promise<{ providerRef: string; state: LifecycleState }>
  fetchStatus(providerRef: string): Promise<LifecycleState>
  fetchInbound(): Promise<EInvoiceDocument[]>
  reportPayment(ref: string, payment: PaymentReport): Promise<void>
}
```

Un `PdpProvider` réel serait un adaptateur qui traduit ces appels vers l'API HTTP
du PDP choisi. Le métier resterait inchangé : seule la variable d'environnement
de sélection du provider basculerait de `simulated` vers `pdp`.

---

## 3. Flux d'émission (sortant) — conception

```
Facture émise (métier)
   → InvoiceDocumentBuilder.build(...)   // Factur-X/UBL/CII (§5 archi)
   → PdpProvider.submit(doc)             // POST authentifié vers le PDP
   → stockage providerRef + hash SHA-256 // EInvoiceDocument
   → transition lifecycle: issued → submitted → deposited
```

Points de conception :

- **Authentification** : jeton OAuth2 client-credentials ou mTLS selon le PDP ;
  secrets stockés via la couche `env.ts` (fail-closed en production, déjà en place
  côté cloud : `src/lib/env.ts`).
- **Idempotence** : `submit()` doit être idempotent (clé = numéro de facture +
  hash document) pour tolérer les retries sans double dépôt.
- **Persistance** : contrairement au bac à sable `/api/v1` actuel (en mémoire,
  non persistant — `src/lib/api/store.ts`), le canal PDP doit écrire en base
  (PostgreSQL côté control-plane) pour survivre aux cold starts serverless.

---

## 4. Webhooks (entrant / cycle de vie) — conception

Le PDP notifie les changements d'état (reçu, approuvé, refusé, paiement) et la
réception de factures fournisseurs. Il faut donc **exposer un endpoint webhook**.

> **À noter honnêtement** : le control-plane actuel **n'a aucun système de
> webhooks sortants ni de réception d'événements** ; le seul « webhook » présent
> est le callback inactif `onUploadCompleted` de Vercel Blob
> (`blob-upload/route.ts:70-72`). Toute la couche webhook est **à construire**.

Conception proposée d'un endpoint `POST /api/einvoice/webhook` :

1. **Vérification de signature** : valider la signature HMAC/mTLS du PDP avant
   tout traitement (rejet fail-closed en cas d'échec). Réutiliser le motif de
   comparaison temps-constant déjà employé (`crypto.timingSafeEqual`,
   ex. `src/lib/licenses/auth.ts:9-14`).
2. **Authentification par secret partagé** : à l'image du `CRON_SECRET`
   fail-closed déjà introduit pour l'auto-rollback (audit / verified-facts),
   le webhook exigerait un secret dédié.
3. **Idempotence** : dédupliquer par identifiant d'événement PDP.
4. **Mise à jour d'état** : appliquer la transition sur la machine à états (§8 archi)
   et journaliser dans `AuditLog`.

```ts
// PROPOSÉ.
export async function POST(req: Request) {
  if (!verifyPdpSignature(req)) return new Response('unauthorized', { status: 401 }) // fail-closed
  const evt = await req.json()
  await applyLifecycleTransition(evt.providerRef, evt.state) // idempotent
  return new Response('ok')
}
```

---

## 5. Gestion des erreurs — conception

| Cas | Politique proposée |
|---|---|
| PDP injoignable à l'émission | File de reprise (retry exponentiel), état `submit_pending`, alerte admin ; **ne jamais** marquer « transmis » sans accusé. |
| Signature webhook invalide | Rejet **fail-closed** (401), aucune mutation d'état. |
| Facture refusée par le PDP | Transition `refused`, remontée UI, invitation à correction via **Avoir** (modèle `CreditNote` à construire). |
| Secret / certificat manquant en production | Refus de démarrage (motif `env.ts` fail-closed déjà appliqué côté cloud). |
| Rejeu / doublon d'événement | Déduplication idempotente par identifiant d'événement. |

La philosophie « fail-closed en production » est **déjà** la ligne du code existant
(rate-limiting Redis, validation d'environnement, route license/check) ; le
connecteur PDP devrait s'y conformer.

---

## 6. Adaptateurs concrets envisagés

- **`SimulatedProvider`** (démo, sans réseau) — voir `E_INVOICING_ARCHITECTURE.md` §7.
- **`PdpProvider`** — adaptateur générique vers une PDP immatriculée (contrat requis).
- **`ChorusProProvider`** — raccordement au portail public pour la sphère B2G.

Chaque adaptateur n'est qu'une implémentation de l'interface `EInvoiceProvider` ;
aucun n'existe aujourd'hui.

---

## 7. Récapitulatif du reste-à-faire pour un branchement réel

1. Construire la couche format (Factur-X/UBL/CII) — inexistante.
2. Construire l'interface `EInvoiceProvider` et le modèle enrichi — inexistants.
3. Exposer + sécuriser l'endpoint webhook — inexistant.
4. **Acquérir** le contrat PDP, les identifiants et l'accès sandbox — externes.
5. Recette de bout en bout sur l'environnement du PDP — non commencée.

Chiffrage et écart réglementaire détaillés dans `E_INVOICING_LIMITATIONS.md`.

---

*Référence croisée : voir [`docs/ACQUISITION_READINESS_AUDIT.md`](./ACQUISITION_READINESS_AUDIT.md) pour l'audit complet et le classement des risques.*
