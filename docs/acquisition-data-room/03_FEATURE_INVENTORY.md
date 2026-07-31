# 03 — Inventaire des fonctionnalités

Classification reprise **verbatim** de l'audit à sept domaines. Légende des statuts :

- **operational** — câblé et fonctionnel (UI + backend).
- **partial** — partiellement construit / limité.
- **code-only-no-ui** — logique présente mais aucune interface utilisateur.
- **non-operational** — non construit / démo / roadmap.

Chaque table cite le domaine d'audit d'origine.

## 1. Control-plane cloud (garagesite3)

| Fonctionnalité | Statut | Note (verbatim) |
|---|---|---|
| Activation licence / heartbeat device-token / check | operational | DB-backed Prisma, ES256 verify + HMAC device tokens, atomic seat limits, fail-closed; unit + integration tests |
| Publication de releases + rollout/rollback manuel | operational | releases/service.ts publishRelease/updateRelease, admin PATCH route, admin UI /admin/updates |
| Rollback automatique sur crash | code-only-no-ui | autoRollbackIfUnhealthy implémenté et abuse-hardened, mais aucun cron/vercel.json ne le déclenche automatiquement (service.ts:206-228) |
| Crash reporting (fingerprinting, grouping, stats, triage) | operational | crashes/service.ts + /api/crash + /admin/crashes |
| Modules / entitlements | operational | modules/service.ts computeEffectiveModules, servis dans activate/check, /admin/modules UI |
| Centre de notifications (ciblé, receipts/ack) | operational | notifications/service.ts + public /api/notifications + /admin/notifications |
| Journal d'audit global (search/filter/CSV) | operational | server/audit.ts, AuditLog model, /admin/audit |
| Dashboard admin temps réel (SSE) | partial | SSE fonctionne avec cookie token mais durée de connexion serverless limitée; fallback polling sur /api/admin/stats |
| Manifeste de mise à jour signé (Ed25519) | operational | manifest.ts; émis uniquement si UPDATE_SIGNING_PRIVATE_KEY/KEY_ID configurés, sinon null |
| Upload d'installeur via Vercel Blob | operational | blob-upload/route.ts, admin-key gated; renvoie 501 si BLOB_READ_WRITE_TOKEN absent |
| API REST publique v1 pour intégrations tierces | non-operational | sandbox en mémoire non persistant, reset au cold start, non DB-backed (store.ts) |
| Webhooks / livraison d'événements sortants | non-operational | aucun; seul le callback Vercel Blob onUploadCompleted, qui est un no-op |
| Rate limiting distribué (routes licence/admin) | operational | Upstash Redis, fail-closed en prod (rate-limit-distributed.ts) |

## 2. Architecture desktop (Electron)

| Fonctionnalité | Statut | Note (verbatim) |
|---|---|---|
| Bridge IPC sécurisé (contextIsolation/sandbox + preload minimal) | operational | Toutes les fenêtres durcies; preload n'expose que des canaux whitelistés |
| Serveur Next.js standalone embarqué dans Electron (loopback) | operational | utilityProcess.fork de .next/standalone/server.js lié à 127.0.0.1:4028; packaging via post-build.js |
| Persistance SQLite/Prisma (37 modèles) + seeding & backups | operational | DB copiée depuis un template au premier lancement, quarantaine DB corrompue, backups horaires/quotidiens/hebdo |
| Auto-update signé Ed25519 avec vérif SHA-256 avant exécution | operational | Code-complet et vérifié in-repo; la correction runtime dépend du backend externe servant des manifestes signés valides |
| Manifeste d'intégrité HMAC build-time + vérif runtime | operational | Généré en afterPack, vérifié au démarrage; protection niveau JS uniquement |
| Système de licence (tokens ECC P-256, HWID, révocation, fail-open offline) | operational | Vérification client OK avec clé publique embarquée; l'émission requiert la clé privée server-side absente du repo |
| Grâce offline (48h warn) / lock dur (72h quit) + détection rollback horloge | operational | Fonctionne comme conçu mais le quit forcé à 72h est un risque produit |
| Pipeline de build Windows x64 nsis | partial | Viable mais requiert un keygen pour keys/public.pem, seule cible, sortie non signée |
| Signature de code de l'installeur Windows | non-operational | Aucun certificat de signature configuré nulle part |
| Module ressources chiffrées (AES-256-GCM) | code-only-no-ui | secure-resources.js implémente encrypt/decrypt mais aucun asset .enc n'est livré dans l'arbre audité |

## 3. Modèle de données & facturation

| Fonctionnalité | Statut | Note (verbatim) |
|---|---|---|
| Modèle Invoice / InvoiceLine + API CRUD | operational | GET/POST/PATCH/DELETE complet avec isolation tenant, guard d'immutabilité, et totaux |
| Numérotation séquentielle des documents (facture/devis/OR/BC) | operational | Incrément transactionnel du compteur + contrainte unique, gap-safe |
| Calcul TVA | partial | Math en centimes entiers exact mais taux d'en-tête unique; pas de catégorie TVA par ligne |
| Parité schéma desktop/serveur | operational | Modèles métier quasi identiques, seules des différences d'infra |
| Génération e-invoice structurée Factur-X / UBL / CII | non-operational | Aucun code; tous les hits grep étaient des faux positifs de sous-chaîne sur 'invoice' |
| Transmission Chorus Pro / PDP & cycle e-reporting | non-operational | Aucun champ PDP, aucun statut de cycle, aucun code de transmission |
| Workflow avoir (Credit note) | non-operational | L'UI y fait référence mais aucun modèle/endpoint CreditNote/Avoir n'existe |
| Suivi paiement / paiement partiel | non-operational | money.ts modélise paiements/avoirs en tests mais aucun modèle Payment ne les persiste |
| Complétude de l'historique de migration desktop | partial | Seulement 2 patchs incrémentaux, pas de baseline init, pas de migration_lock.toml; repose sur db push + template DB |

## 4. Tests, CI & build

| Fonctionnalité | Statut | Note (verbatim) |
|---|---|---|
| Tests unitaires + logique (money, TVA, licensing, HWID, isolation) | operational | 708 cas côté V2, 149 côté site3; exécutés à chaque push CI |
| Tests d'intégration route-API sur SQLite réel | operational | src/integration/*.test.ts exécutent de vrais route handlers |
| Tests d'isolation multi-tenant | operational | tenant-isolation.test.ts sème deux garages sur SQLite temporaire; checks cross-garage |
| Tests licence / seats device | operational | license-activate, hwid-verify, licensed-session + postgres int; device-auth côté site3 |
| Tests d'intégration PostgreSQL/Redis | operational | *.postgres.int.test.ts s'exécutent en CI avec vrais postgres:16+redis:7; self-skip local |
| Tests de vérification update/release | operational | update-verify.test.ts (V2); tests manifest/rollout/semver (site3) |
| Tests import (OCR + catalogue) | operational | integration/ocr.test.ts, integration/catalog.test.ts + tests unitaires |
| Tests PWA | partial | pwa.test.ts existe mais seulement 72 lignes; pas de validation E2E service-worker/offline |
| CI : typecheck + lint + build + secret scan | operational | Les deux ci.yml exécutent tsc --noEmit, next lint, next build, gitleaks; pas d'ignoreBuildErrors |
| Tests E2E / navigateur | non-operational | Aucun Playwright/Cypress/Puppeteer dans les deux dépôts; 0 répertoire e2e |
| Tests composants / UI React | non-operational | 0 fichier de test .tsx; pas de jsdom/testing-library; tous les tests en node-environment |
| Enforcement de la couverture | partial | V2 mesure la couverture v8 mais sans seuils; site3 sans config de couverture — mesurée/absente, jamais gated |
| Tests directs des fichiers main-process Electron | code-only-no-ui | electron/*.js sont des doublons non testés; les tests de parité n'existent que contre les copies src/lib |

## 5. Sécurité & multi-tenant

| Fonctionnalité | Statut | Note (verbatim) |
|---|---|---|
| Auth session next-auth garage-app (JWT, bcrypt) | operational | auth.ts + middleware.ts; sessions portant garageId/role, JWT strategy, 30-day maxAge |
| Enforcement de session liée à la licence (revocation-aware, garage-scoped) | operational | validateLicensedSession via requireSession/withAuth sur toutes les routes métier; prouvé par test |
| Scoping IDOR multi-tenant (query-level + relation guard) | operational | inline where:{id,garageId}; assertRelations 2nd-order guard dans 8 routes |
| Auth portail client + 2FA (TOTP + backup codes à usage unique) | operational | lockout login, challenge 2FA, TOTP RFC-testé; gap de keying rate-limit noté en risque |
| ECDSA licence / updates signés Ed25519 / backups AES-256-GCM | operational | verify.ts, electron/update-verify.js, backup/crypto.ts; asymétrique + authentifié + anti-downgrade |
| Enforcement limite seats/HWID | operational | transaction SELECT FOR UPDATE avec re-count de contrôle |
| Rate limiting distribué (catégories critiques fail-closed) | operational | Upstash en prod; fallback mémoire en Electron/dev; certaines routes site publiques encore en mémoire |
| Auth opérations admin / license-server | operational | fonctionnel et constant-time, mais modèle à clé statique partagée unique (pas d'identité/MFA par admin) |
| API REST publique /api/v1 (garagesite3) | partial | sandbox en mémoire seedé; isolation par clé OK mais aucune persistance réelle |

## 6. Analyse de value-gap (leviers d'acquisition)

| Fonctionnalité | Statut | Note (verbatim) |
|---|---|---|
| White-label / centralisation branding | partial | Excellente config Zod typée (env/JSON/default), mais ~2 consommateurs BRAND.* hors config; nom/logo/titre/couleurs codés en dur dans ~40+ endroits |
| Import / migration de données (CSV/Excel/JSON, mapping, dry-run) | non-operational | Aucun importeur: pas de dépendance de parsing, pas de fichier *import*, pas de mapping. CSV = export-only |
| Mode démo / données seed | operational | prisma/seed.ts crée un garage démo réaliste, skip si présent, npm db:reset = force-reset + reseed |
| Multi-garage / réseau / hiérarchie org | non-operational | Schéma mono-garage: Garage est le tenant top-level; aucun modèle Organization/Network/Tenant-group au-dessus |
| Observabilité — logging structuré / correlation ids / metrics | partial | Logger structuré redacting + monitoring hôte/DB réel; mais AUCUN correlation/request/trace id ni export metrics |
| Backups / restore | code-only-no-ui | Service de backup chiffré complet (AES-256-GCM) + routes API admin. Aucune UI ne l'invoque |

## 7. Dépendances & PI

| Fonctionnalité | Statut | Note (verbatim) |
|---|---|---|
| OCR plaque via @anthropic-ai/sdk (photo → plaque) | operational | Câblé à l'UI; auth-gated, rate-limited, size-capped; requiert ANTHROPIC_API_KEY optionnel, 503 si absent |
| Fallback lookup plaque IA via @anthropic-ai/sdk | operational | Câblé à l'UI; tente API SIV externe, repli Claude Haiku si clé définie, sinon source:'unknown' |
| Intégration provider LLM Copilot | partial | Interface + prompts + UI existent, Copilot tourne en déterministe, mais aucun provider LLM bundlé (stub documenté) |
| Posture conformité licences/dépendances | operational | Deps directes permissives; copyleft limité au transitif LGPL(sharp)/MPL(tooling); pas de GPL/AGPL |
| Documentation propriété PI | non-operational | Pas de fichier LICENSE/cession PI d'origine dans le repo; propriété à établir par contrat (voir §note ci-dessous) |

> **Note d'actualisation :** un fichier `LICENSE` a été ajouté cette session dans les deux dépôts. La **cession de propriété** reste néanmoins **contractuelle** (voir `09_INTELLECTUAL_PROPERTY.md`). Le statut « non-operational » ci-dessus reflète l'état au moment de l'audit d'origine.

---
*Référence croisée : voir `docs/ACQUISITION_READINESS_AUDIT.md` pour l'audit de préparation complet.*
