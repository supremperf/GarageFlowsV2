# Webhooks

> Document de data room — diligence technique M&A.
> **CONCEPTION / PROPOSITION.** Rien de ce document n'est construit.

## 1. État actuel — honnête

**GarageFlow ne dispose d'AUCUN système de webhooks.** Il n'existe pas de livraison d'événements sortants vers des systèmes tiers, dans aucun des deux dépôts.

Vérifié à l'audit : la seule occurrence de « webhook » est le callback `onUploadCompleted` de Vercel Blob dans `src/app/api/blob-upload/route.ts:70-72` (upload d'installeurs), qui est **inactif / no-op** et ne constitue pas un système d'événements métier.

Conséquence pour l'acquéreur : toute mention de « webhooks » ou d'« intégration événementielle temps réel » dans le matériel commercial serait **non fondée**. Les webhooks sont un **élément de feuille de route**, à construire.

> Note de dépendance : un système de webhooks utile suppose au préalable une **API de données persistante**. Or l'API publique `/api/v1` est aujourd'hui un bac à sable en mémoire non persistant (voir API_REFERENCE.md). Les webhooks doivent donc être conçus **conjointement** avec la persistance de l'API.

## 2. CONCEPTION proposée

### 2.1 Modèle général
Livraison HTTP `POST` sortante, au moins une fois (*at-least-once*), signée, avec ré-essais et idempotence côté récepteur. Endpoints d'abonnement gérés par le titulaire de la clé d'API.

### 2.2 Types d'événements proposés
Nommage `ressource.action` :

| Événement | Déclencheur |
|---|---|
| `client.created` / `client.updated` / `client.deleted` | cycle de vie client |
| `vehicle.created` / `vehicle.updated` | cycle de vie véhicule |
| `appointment.scheduled` / `appointment.updated` / `appointment.cancelled` | planning |
| `quote.created` / `quote.accepted` / `quote.refused` | devis |
| `invoice.created` / `invoice.paid` / `invoice.overdue` | facturation |
| `part.low_stock` | stock sous seuil |

(Optionnel, plan de contrôle) `license.activated`, `license.revoked`, `release.published`, `crash.reported`.

### 2.3 Format d'enveloppe proposé
```json
{
  "id": "evt_9f2c…",
  "type": "invoice.paid",
  "created_at": "2026-07-31T10:00:00Z",
  "api_version": "1.0",
  "livemode": true,
  "data": { "object": { "id": "inv_…", "object": "invoice", "status": "paid", "…": "…" } }
}
```

### 2.4 Signatures
- En-tête `X-GarageFlow-Signature: t=<timestamp>,v1=<hmac_sha256>`.
- HMAC-SHA256 du corps brut concaténé au timestamp, avec un **secret d'endpoint** propre à chaque abonnement (`whsec_…`).
- Comparaison **à temps constant** côté récepteur, et **fenêtre de tolérance** (ex. ±5 min) sur le timestamp pour contrer le rejeu.
- Le projet possède déjà les briques cryptographiques de référence (HMAC, comparaison timing-safe) dans le plan de contrôle et le desktop — réutilisables comme modèle.

### 2.5 Ré-essais et fiabilité
- Politique *at-least-once* avec **back-off exponentiel** (ex. tentatives à 0s, 1min, 5min, 30min, 2h, 6h ; abandon après ~24h).
- Succès = réponse `2xx` sous un timeout court (ex. 5s).
- Journal de livraison par événement (tentatives, code HTTP, latence) consultable par le titulaire.
- File d'attente durable requise (Redis/DB) — à aligner avec l'infrastructure Upstash déjà utilisée par le plan de contrôle.

### 2.6 Idempotence
- Chaque événement porte un `id` **stable** (`evt_…`) ; le récepteur doit **dédupliquer** sur cet identifiant (au moins une fois ⇒ doublons possibles).
- Recommander aux intégrateurs une table d'idempotence côté récepteur.

### 2.7 Interface d'abstraction proposée (illustrative, non implémentée)
```ts
// CONCEPTION — n'existe pas dans le code
interface WebhookEndpoint { id: string; url: string; secret: string; events: string[]; enabled: boolean }
interface WebhookEvent { id: string; type: string; createdAt: string; data: { object: unknown } }
interface WebhookDelivery {
  enqueue(event: WebhookEvent): Promise<void>       // fan-out vers les endpoints abonnés
  sign(body: string, secret: string, ts: number): string
  attempt(endpoint: WebhookEndpoint, event: WebhookEvent): Promise<{ status: number; ok: boolean }>
}
```

### 2.8 Sécurité et conformité
- HTTPS obligatoire sur les URLs d'endpoint ; refus des adresses privées/loopback (anti-SSRF).
- Chiffrement au repos des secrets d'endpoint.
- Rotation des secrets sans interruption (double secret pendant la fenêtre de rotation).
- Journalisation dans l'`AuditLog` (déjà présent côté plan de contrôle).

## 3. Estimation d'effort (indicative)
Système de webhooks complet (abonnements, signatures, file durable, ré-essais, journal de livraison, UI de gestion) : **effort de plusieurs semaines-personnes**, à séquencer **après** la persistance de l'API `/api/v1`.

## 4. Point de vigilance acquéreur
Ne pas présenter les webhooks comme une capacité livrée. C'est une **proposition** ; la dépendance à une API persistante en fait un chantier à part entière.

---
*Voir aussi : [docs/ACQUISITION_READINESS_AUDIT.md](./ACQUISITION_READINESS_AUDIT.md).*
