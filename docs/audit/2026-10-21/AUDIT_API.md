# AUDIT_API — 2026-10-21

## 1. Inventaire

169 fichiers `route.ts` sous `src/app/api`, soit 246 couples méthode × route
(GET, POST, PUT, PATCH, DELETE ; recompté le 21/10 en fin de campagne, le
chiffre de 244 donné ici auparavant était faux). Familles principales : `admin`, `auth`,
`clients`, `vehicles`, `jobs`, `work-orders`, `quotes`, `invoices`, `parts`,
`purchase-orders`, `suppliers`, `mechanics`, `mechanic-licenses`, `license`,
`sync`, `portal`, `einvoicing`, `export`, `internal`, `keygen`, `copilot`.

Mécanismes d'authentification constatés :

| Mécanisme | Routes | Fichier |
|---|---|---|
| Session NextAuth + licence | métier (`clients`, `jobs`, `invoices`…) | `src/lib/api-helpers.ts`, `src/lib/license/session.ts` |
| Session administrateur vérifiée en base | `admin/*` | `isAdminSession` |
| Clé interne en en-tête | `internal/*` | `src/lib/internal-auth.ts` |
| Licence garage GF2 signée dans le corps | `sync/*` | `src/lib/sync/garage-auth.ts` |
| Jeton d'appareil (HMAC) | `license/check`, `license/devices`, `license/status` | `src/lib/license/devices.ts` |
| Signature HMAC du corps | `einvoicing/webhooks/[providerId]` | `src/lib/einvoicing/webhook.ts` |
| Session portail client (+ 2FA) | `portal/*` | `src/lib/portal` |

## 2. Balayage dynamique sans authentification

Serveur `next dev` local (SQLite), chaque méthode exportée appelée **sans cookie
ni en-tête d'authentification**, corps `{}` pour les écritures : 245 couples
sur 246 (capture 17). Le seul couple non balayé est `GET /api/auth/[...nextauth]`,
exporté par `export { handler as GET }`, que la découverte automatique des
méthodes n'a pas reconnu ; c'est le gestionnaire NextAuth lui-même.

| Code | Nombre | Lecture |
|---|---|---|
| 401 | 196 | refus d'authentification |
| 403 | 14 | refus d'autorisation (administration, origine) |
| 400 | 20 | corps rejeté avant toute donnée : `sync/*` exige une licence signée (licence absente → 400, invalide → 403), `license/activate`, `portal/auth/*` |
| 404 | 4 | ressource inconnue, ou route serveur seule sur un poste |
| 303 | 1 | `portal/auth/verify-email` sans jeton → redirection |
| 500 | 4 | `admin/diagnostics`, `admin/licenses/create`, `license/devices`, `license/status` : configuration absente (`GARAGEFLOW_API_KEY`, poivre d'appareil) — refus fail-closed, message générique, aucun secret |
| 200 | 6 | publics par conception (ci-dessous) |

Réponses 200 sans authentification, vérifiées une à une :

| Route | Contenu | Jugement |
|---|---|---|
| `GET /api/health`, `GET /api/ping` | `{"status":"ok"}` | sonde de vie |
| `GET /api/version` | version applicative | public |
| `GET /api/license/type` | type d'offre, sans donnée client | public |
| `POST /api/mechanic/logout` | efface un cookie | sans effet hors session |
| `GET /api/admin/updates` | métadonnées de la dernière mise à jour publiée (`{"hasUpdate":false}` ici) | flux interrogé par les postes ; l'intégrité repose sur le manifeste Ed25519 vérifié par Electron, pas sur la confidentialité. La **publication** (POST) exige `isAdminSession` |

Une licence GF2 forgée envoyée à `sync/jobs`, `sync/invoice`, `sync/quote` et
`sync/portal` est refusée (400 `BAD_REQUEST`, aucune donnée renvoyée).

## 3. Contrats, isolement des comptes, concurrence

Couverts par les suites exécutées et vertes dans cette session (voir
`TEST_RESULTS.md`), notamment :

- isolement entre garages et IDOR : `tenant-isolation-matrix`,
  `tenant-idor-patch`, `portail-2fa-idor`, `portal-token-isolation`,
  `invoice-authz` ;
- affectation de masse : `status-mass-assignment-v15` ;
- RBAC de bout en bout : `rbac-enforcement-e2e`, `portal-rbac-p3`,
  `copilot-financial-authz-v15` ;
- webhook e-facturation : signature, fenêtre de 5 min, doublons ;
- concurrence réelle PostgreSQL : activations (`FOR UPDATE`), numérotation,
  stock ; Redis : limiteur partagé.

## 4. Problèmes et corrections

Aucune route n'a renvoyé de donnée métier sans authentification. Aucune
correction d'API n'a été nécessaire dans cette session.

Observation non corrigée : les quatre refus de configuration absente répondent
500. Un 503 décrirait mieux « service non configuré », mais les postes et la
supervision s'appuient peut-être sur ce code : le changer sans eux serait une
rupture de contrat.
