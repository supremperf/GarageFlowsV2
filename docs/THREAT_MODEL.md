# Modèle de menaces (STRIDE) — GarageFlow

> Document de data room (due diligence M&A). Analyse de type STRIDE fondée sur le code
> source vérifié au 31/07/2026. Complète [SECURITY_ARCHITECTURE.md](./SECURITY_ARCHITECTURE.md).
> Les risques résiduels repris ici proviennent de l'audit de sécurité (domaine
> `security-multitenant`) et sont présentés sans enjolivement.

## 1. Périmètre et actifs

| Actif | Sensibilité | Support |
|---|---|---|
| Données atelier locales (clients, véhicules, OR, factures, devis) | Élevée (données personnelles + financières) | SQLite local, chiffré au niveau OS |
| Jetons de licence + clé privée d'émission | Critique (monétisation) | Serveur uniquement (hors dépôt) |
| Clé privée de signature des mises à jour (Ed25519) | Critique (intégrité chaîne de distribution) | Serveur uniquement (hors dépôt) |
| Clé maître admin (`LICENSE_ADMIN_API_KEY`) | Critique (contrôle total licences) | Env serveur + `sessionStorage` navigateur |
| Secrets TOTP du portail client | Moyenne | BDD (**en clair**, voir M-3) |
| Secrets de session / device / HWID HMAC | Élevée | Env serveur, fail-closed |

## 2. Acteurs (modèle d'adversaire)

- **A1 — Utilisateur local malveillant** : possède la machine, veut contourner la
  licence ou lire les ressources chiffrées.
- **A2 — Attaquant réseau** : MITM sur les mises à jour / activation ; forge de requêtes.
- **A3 — Locataire malveillant** : garage authentifié tentant d'accéder aux données d'un
  autre garage (IDOR / cross-tenant).
- **A4 — Attaquant du portail client** : brute-force login / 2FA du portail.
- **A5 — Compromission de la BDD (lecture seule)** : fuite de la base cloud/portail.
- **A6 — Initié / fuite de clé admin** : compromission de la clé maître unique.

## 3. Frontières de confiance

1. Renderer Electron ↔ processus principal (pont `contextBridge`, isolé — `preload.js:10-118`).
2. Application ↔ serveur loopback `127.0.0.1:4028` (jamais exposé au LAN — `main.js:1547`).
3. Client desktop ↔ plan de contrôle cloud `api.garageflows.fr` (HTTPS + allowlist d'hôtes).
4. Requête authentifiée ↔ données d'un `garageId` (isolation multi-locataire, `tenant.ts`).
5. Back-office admin ↔ plan de contrôle (clé maître unique — frontière la plus faible).

## 4. Analyse STRIDE

### Spoofing (usurpation)
| Menace | Mitigation | Résiduel |
|---|---|---|
| Faux jeton de licence | ECDSA P-256, clé publique embarquée, vérif sans exception (`verify.ts:96-226`) | Faible |
| Faux serveur de mise à jour / MITM | Manifeste Ed25519 obligatoire + HTTPS + allowlist d'hôtes (`update-verify.js:20-104`) | Faible |
| Usurpation d'appareil | Device token HMAC + révocation par `tokenVersion` (`device-token.ts:48-135`) | Faible |
| Usurpation d'identité admin | Clé maître unique, aucune identité par opérateur | **Moyen (M-1)** |

### Tampering (altération)
| Menace | Mitigation | Résiduel |
|---|---|---|
| Binaire de MAJ altéré | SHA-256 en flux, comparé en temps constant avant exécution (`main.js:2144-2173`) | Faible |
| Altération des assets locaux | Manifeste d'intégrité HMAC vérifié au runtime (`integrity.js:84-145`) | **Moyen (M-4)** — vérif JS contournable |
| Altération de sauvegarde | AES-256-GCM authentifié, échec au déchiffrement (`backup/crypto.ts:33-74`) | Faible |

### Repudiation (répudiation)
| Menace | Mitigation | Résiduel |
|---|---|---|
| Action admin non imputable | Journal d'audit (`AuditLog`), mais **une seule clé partagée** → pas d'attribution nominative | **Moyen (M-1)** |
| Consentement crash reporting | Opt-in explicite, OFF par défaut (`control-plane.js:104-157`) | Faible |

### Information Disclosure (divulgation)
| Menace | Mitigation | Résiduel |
|---|---|---|
| Fuite HWID | Jamais stocké en clair — HMAC-SHA256 seulement (`schema.prisma:81`) | Faible |
| Fuite de secrets dans les crashs | Redaction secrets/tokens/JWT/DB-URL avant envoi (`control-plane.js:104-157`) | Faible |
| Reverse-engineering du secret d'intégrité | Secret fragmenté embarqué, **extractible** (auto-documenté, `secure-key.js:16-22`) | **Moyen (M-4)** |
| Fuite BDD → secrets TOTP | TOTP stockés **en clair** ; codes de secours hashés | **Moyen (M-3)** |
| CORS wildcard par défaut (API v1) | Retombe sur `*` si non configuré (`api/http.ts:9`) | Faible (API v1 = démo) |

### Denial of Service (déni de service)
| Menace | Mitigation | Résiduel |
|---|---|---|
| Abus des routes licence/admin | Rate limiting distribué Upstash, fail-closed 503 (`rate-limit-distributed.ts:96-129`) | Faible |
| Abus de l'API v1 publique | Rate limiter **par instance** (non distribué) (`api/auth.ts:48-67`) | Faible (API démo) |
| DoS anonyme du rollout par faux crashs | Seuls les HWID d'appareils enregistrés comptent (`crashes/service.ts:202-221`) | Faible |
| Auto-verrouillage 72h hors ligne | *Aucune* — `app.quit()` après 72h (`main.js:298-299,1193-1206`) | **Élevé (produit)** — voir note |

### Elevation of Privilege (élévation de privilège)
| Menace | Mitigation | Résiduel |
|---|---|---|
| IDOR / accès cross-garage | Scoping `where:{id, garageId}` systématique + garde 2nd ordre `assertRelations` (`tenant.ts:15-54`, `jobs/[id]/route.ts:11-86`), prouvé par tests | Faible |
| Session non licenciée | `validateLicensedSession`, licence liée à un garage immuable (`license/session.ts:109-152`) — testé 401/403 | Faible |
| Brute-force 2FA portail | Rate limit IP (partiel), **pas de compteur par compte** à l'origine ; corrigé cette session (voir note) | **Moyen (M-2)** → mitigé |
| Bypass licence par patch JS | Intégrité/anti-tamper JS-only + binaire non signé | **Moyen (M-4)** |

## 5. Risques résiduels prioritaires (repris de l'audit)

- **M-1 — Clé admin unique partagée.** Toute la surface licence/admin est protégée par
  une seule clé statique ; pas d'identité par opérateur, pas de MFA, pas de rotation sans
  redéploiement ; audit non imputable ; blast radius = contrôle total des licences.
  `garagesite3/src/lib/licenses/auth.ts:28-41` ; `src/app/admin/_lib/client.ts:9-52`.
  *Remédiation : IAM admin (comptes, rôles, MFA, rotation) post-acquisition.*

- **M-2 — Contournement du rate limit login/2FA du portail via `X-Forwarded-For`
  forgeable.** `portal/auth-helpers.ts:31-35` lit l'en-tête sans gate proxy de confiance,
  contrairement à `security/rate-limit.ts:262-270`. Combiné à l'absence initiale de
  compteur par compte sur `2fa/verify`, exposition au brute-force du TOTP 6 chiffres si le
  mot de passe est connu. `src/app/api/portal/auth/2fa/verify/route.ts:17-20`.
  *Correctif livré cette session : limite 2FA par compte ajoutée (voir VULNERABILITY_MANAGEMENT).
  Reste à faire : gate `X-Forwarded-For` sur proxy de confiance.*

- **M-3 — Secrets TOTP du portail stockés en clair.** `twoFactorSecret` /
  `twoFactorPending` écrits sans chiffrement au repos ; une fuite BDD en lecture seule
  donne des graines 2FA exploitables pour tous les utilisateurs.
  `src/app/api/portal/auth/2fa/setup/route.ts:18`. *Remédiation : chiffrement au repos.*

- **M-4 — DRM / anti-tamper en JavaScript uniquement + binaire non signé.** Le manifeste
  d'intégrité est vérifié en JS avec un secret embarqué extractible (`integrity.js:22-26`,
  `secure-key.js:16-22`) ; l'installeur Windows n'est pas signé. Protection des revenus
  « best-effort », pas dure. *Remédiation : signature de code EV/OV + acceptation que la
  protection reste une défense en profondeur.*

- **Fail-open hors ligne (device auth).** Le heartbeat est fail-open sur erreur réseau
  (jamais de verrouillage transitoire — `verified-facts.md`). C'est un choix de
  disponibilité assumé ; à mettre en regard du verrou dur 72h qui, lui, coupe l'app.

## 6. Notes produit ayant un impact sécurité

- Le **verrou hors ligne 72h** (`app.quit()`) est classé risque **élevé** produit
  (disponibilité/churn) plutôt que sécurité : un outil « desktop » qui s'arrête après un
  long week-end sans réseau contredit un positionnement offline. `main.js:298-299`.
- L'API publique `/api/v1` du cloud est un **bac à sable en mémoire non persistant**
  (`api/store.ts:1-8`) : la surface de menace y est limitée mais toute valorisation
  comme « plateforme d'intégration » serait trompeuse.

---

*Référence croisée : voir [docs/ACQUISITION_READINESS_AUDIT.md](./ACQUISITION_READINESS_AUDIT.md).*
