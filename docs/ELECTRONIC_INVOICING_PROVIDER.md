# Facturation électronique — Intégration fournisseur (PDP)

_Comment brancher une plateforme agréée réelle. Date : 2026-08-01._

## 1. Interface (contrat)

`src/lib/einvoicing/provider.ts` :

```ts
interface EInvoiceProvider {
  readonly name: string
  submit(doc: EInvoiceDocument, opts?: SubmitOptions): Promise<SubmitResult>
  getStatus(transmissionId: string): Promise<StatusResult | null>
}
```

La logique métier ne dépend **jamais** d'un fournisseur concret : elle parle à
cette interface. Deux implémentations :
- **Sandbox** (`providers/sandbox.ts`) — fonctionnelle, en mémoire, pour
  démo/tests (dépôt, idempotence, avancement du cycle de vie).
- **PDP réelle** — à écrire (voir §3). Non fournie : nécessite un **contrat** et
  des **accès** (non disponibles dans ce dépôt).

## 2. Adaptateur sandbox (réel, testé)

`new SandboxEInvoiceProvider()` :
- `submit(doc, {format})` → valide, sérialise (UBL/CII), attribue un
  `transmissionId`, statut `SUBMITTED` (ou `REJECTED` si invalide) ; idempotent
  via `idempotencyKey`.
- `advance(id, status)` → simule un retour plateforme (transitions contrôlées).
- `getStatus(id)` / `getDocumentXml(id)` → suivi + preuve (XML transmis).

Horloge et générateur d'id **injectables** → tests déterministes.

## 3. Écrire un adaptateur PDP réel

```ts
export class MyPdpProvider implements EInvoiceProvider {
  async submit(doc, opts) {
    const xml = opts?.format === 'UBL' ? toUBL(doc) : toCII(doc)
    // 1. Authentification OAuth2 auprès de la PDP (client credentials).
    // 2. POST du flux (UBL/CII, ou PDF/A-3 Factur-X une fois l'embarquement ajouté).
    // 3. Récupérer l'identifiant de dépôt → transmissionId.
    // 4. Mapper le statut PDP → LifecycleStatus.
  }
  async getStatus(id) { /* GET statut PDP → StatusResult */ }
}
```

Réception des mises à jour : exposer une route webhook qui appelle
`verifyWebhook(rawBody, header, process.env.EINVOICE_WEBHOOK_SECRET)` puis met à
jour le statut (idempotent via `event.id`).

## 4. Accès / prérequis réels (à obtenir — hors code)

- Contrat avec une **PDP agréée** (ou raccordement au **PPF**).
- Identifiants OAuth2 sandbox **puis** production.
- Annuaire des destinataires (routage par SIRET).
- Le cas échéant, incorporation **PDF/A-3** (ajout d'une bibliothèque PDF) pour
  produire un Factur-X complet (aujourd'hui : XML CII seul).

## 5. Variables d'environnement (proposées)

| Variable | Rôle |
|---|---|
| `EINVOICE_PROVIDER` | `sandbox` (défaut) \| `<pdp>` |
| `EINVOICE_API_BASE` | URL de base de la PDP |
| `EINVOICE_CLIENT_ID` / `EINVOICE_CLIENT_SECRET` | OAuth2 |
| `EINVOICE_WEBHOOK_SECRET` | vérification HMAC des webhooks |

Aucune de ces valeurs n'est fournie dans le dépôt (aucun secret commité).

Voir `ELECTRONIC_INVOICING_LIMITATIONS.md`.
