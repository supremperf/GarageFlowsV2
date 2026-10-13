# Inventaire des dépôts — GarageFlows

> Cartographie préliminaire exploitable par une équipe qui ne connaît PAS le
> projet. Issue de 12 lectures parallèles en LECTURE SEULE (Phase 0/1 de l'audit
> maître). Deux dépôts forment un seul produit :
>
> - **GarageFlowsV2** — l'application : PWA `app.garageflows.fr` + client desktop
>   Windows (Electron 31) + routes internes de licence. Next.js 14, Prisma 5.22,
>   double client (SQLite desktop + PostgreSQL serveur). ~680 fichiers suivis.
> - **garagesite3** — le site vitrine `garageflows.fr` ET le **control-plane**
>   complet : serveur de licences, distribution des mises à jour signées,
>   ingestion de crashs, notifications, leads, back-office admin, API de démo.
>   Next.js 15, Prisma 5 sur PostgreSQL. ~213 fichiers suivis.
>
> Preuves `fichier:ligne` dans `docs/audit/RISK_REGISTER.md`. Aucun secret en clair.

## Vue d'ensemble des sous-systèmes

| Sous-système | Dépôt | Rôle | Criticité | Couverture de test |
|---|---|---|---|---|
| Socle auth & routes API | V2 | Point de contrôle unique `requireSession` (NextAuth + session licenciée) ; ~141 routes | critique | dense sur le socle, fine sur les handlers (22/141) |
| Auth & sessions | V2 | NextAuth, cookies `gf_session`, middleware, portail, 2FA/TOTP | critique | middleware + auth-secret couverts ; portail = fonctions pures |
| Licences & crypto | V2 | Keygen ECDSA P-256, activation/heartbeat/révocation, licences mécaniciens, HWID | critique | très dense (licences, appareils, sessions, HWID) |
| Monnaie / e-invoicing / signature | V2 | Entiers exacts, numérotation, immuabilité, FEC, connecteurs, signature | critique | money/tva/json couverts ; concurrence numérotation sur mock |
| Base de données & migrations | V2 | Schémas SQLite+PostgreSQL, runner fail-closed, template baseliné | critique | migrations réelles (node:sqlite) couvertes |
| Electron & desktop | V2 | BrowserWindow durci, IPC, updates signées, sauvegarde pré-migration | haute | modules purs couverts ; main.js jamais exécuté |
| PWA & frontend | V2 | Service worker, 41 composants, 4 thèmes, i18n 14 langues | haute | quasi nulle sur les composants ; SW en statique |
| Scripts, CI/CD, supply chain | V2 | 12 gardes d'invariants, keygen Python, rotation PowerShell, packaging | critique | gardes = tests ; scripts destructifs peu testés |
| Portail client | V2 | Inscription/connexion client, 2FA, liens tokenisés, tickets/RDV | haute | logique pure couverte ; 0 test de handler (20 routes) |
| Documentation & affirmations | V2+site3 | Source de vérité, runbooks, docs modules ; manques PI/RGPD | critique | gardes docs/branding (V2 seul) |
| Vitrine + control-plane | site3 | Marketing + licences + updates + crashs + admin + API démo | critique | licences/updates/rate-limit couverts ; 2/55 handlers |
| Inventaire des tests | V2+site3 | 104 fichiers vitest (V2) + 21 (site3) + 1 spec Playwright | — | voir trous critiques ci-dessous |

## 1. Socle auth & routes API (V2) — critique

Point de contrôle **unique** de toutes les routes métier.

| Composant | Fichiers clés | Rôle | Données sensibles | Tests |
|---|---|---|---|---|
| Socle auth métier | `api-helpers.ts`, `auth/[...nextauth]/route.ts`, `middleware.ts` | `requireSession()` = session NextAuth (garageId obligatoire) + `validateLicensedSession` (licence active/non expirée/non révoquée, appareil actif, rattachement garage) ; `withAuth()` (rate limit, capture des `NextResponse`, 500 générique sans stack) | secret d'auth, cookie HttpOnly | require-session-enforcement, licensed-session |
| garages / users | `garages/route.ts`, `users/route.ts` | GET garage sauf `smtpPass` ; PATCH réservé OWNER ; inscription publique rate-limitée ; création staff OWNER seul | `smtpPass`, mots de passe bcrypt(12), IBAN/SIRET | aucun dédié |
| clients / vehicles | `clients/route.ts`, `vehicles/[id]/route.ts` | CRUD scopé garageId, Zod, upsert véhicule par (plaque, garageId), vérif clientId∈garage | PII clients | client-policy |
| jobs (+ parts/photos/timer) | `jobs/[id]/route.ts`, `jobs/[id]/parts/route.ts` | CRUD scopé ; changement mécanicien re-vérifié ; décrément stock atomique conditionnel ; photos cap+MIME | photos, données client | stock-parts, business-logic |
| quotes / invoices (+ FEC) | `invoices/[id]/route.ts`, `quotes/[id]/convert/route.ts`, `export/fec/route.ts` | Entiers exacts ; numérotation transactionnelle ; immuabilité facture émise (**corrigée AUD-001**) ; FEC réservé `financial:read` ; `unitCost` jamais exposé au portail | montants légaux, marges | money-document-consistency, document-numbering, financial-authz |
| work/purchase-orders, suppliers, parts | `work-orders/[id]/sign/route.ts`, `purchase-orders/[id]/receive/route.ts` | OR signés ; réception idempotente atomique ; stock | signatures, coûts d'achat | money-json, suppliers |
| mechanic-licenses (admin) | `mechanic-licenses/[lid]/assign/route.ts`, `.../token/route.ts` | Enregistrement/attribution/révocation par le patron ; `can()` ; token complet = POST + réauth bcrypt, no-store | token de licence signé | mechanic-admin, mechanic-record-mac |
| espace mécanicien | `mechanic-api.ts`, `mechanic/jobs/[id]/photos/route.ts` | Routes auto-portantes `requireMechanic()` ; scope garageId+mechanicId ; append-only ; IDOR photo bloqué | photos, notes | mechanic-session, mechanic-photo, mechanic-device-lifecycle |

## 2. Auth & sessions (V2) — critique

NextAuth (JWT staff), cookie licence `gf_session`, portail client (`gf_portal`), 2FA TOTP + codes de secours, verrouillage anti-bruteforce, `DUMMY_HASH` anti-énumération. Ordre middleware NextAuth→licence documenté et testé. **Point d'attention** : session staff JWT sans invalidation serveur (rôle figé ≤ 30 j — AUD-033). Tests : `middleware.test.ts`, `auth-authorize`, `auth-secret`, portail (`auth-core`, `session`).

## 3. Licences & cryptographie (V2) — critique

Keygen ECDSA P-256 (`keygen.py` + modules), tokens `GF2.<header>.<payload>.<sig>`, licences garages ET mécaniciens (distinctes, rattachement `plid` signé), HWID haché HMAC. **Clé publique** embarquée (empreinte `7bed…`) — cohérente entre V2, Electron et vitrine (vérifié). **Points d'attention** : recalcul `recordMac` incomplet dans certains chemins admin (AUD-035), divergence HWID keygen↔Electron possible (AUD-036), décision ECDSA en suspens (AUD-007). Clé privée jamais dans le dépôt (variable d'environnement uniquement). Tests : license-activate, license-devices, hwid-verify, public-key-consistency, + concurrence sièges sur PostgreSQL réel.

## 4. Monnaie, facturation, e-invoicing, signature (V2) — critique

Entiers exacts (dix-millièmes/centimes, zéro Float — imposé par 3 gardes CI). Numérotation transactionnelle unique `@@[garageId, number]`. **Immuabilité facture émise / OR signé** : machine à états `document-status.ts` (**AUD-001/002 corrigés `a5044a0`**). E-invoicing : fondations (`einvoicing/`), formats à valider. Signature : `signature/document.ts` canonicalise le JSON verbatim (gelé). **Point d'attention** : `docs/SIGNATURE.md` qualifie la signature d'« inviolable » (HMAC local, non eIDAS — AUD-043). Tests : money, tva, money-json, money-document-consistency, signature, einvoicing-foundation.

## 5. Base de données & migrations (V2) — critique

Deux schémas Prisma (SQLite desktop, PostgreSQL serveur) alignés. Runner de migration fail-closed (`migrations.ts` + `/api/internal/migrate`, 179 entrées), registre `_gf_migrations` avec checksums, template baseliné, migrations PostgreSQL à vérification par colonne. **Points d'attention** : index FK manquants sur tables chaudes (AUD-034). Tests : migrations-unique-index, pre-migration-backup, money-schema-migration (node:sqlite ≥ 22.5).

## 6. Electron & desktop (V2) — haute

BrowserWindow durci (contextIsolation, sandbox, Fuses), IPC validé, garde de navigation (**AUD-003 corrigée**), updates signées vérifiées, sauvegarde pré-migration vérifiée, stockage local chiffré (DPAPI/keytar), secret d'installation unique. **Point d'attention** : `main.js` (2578 lignes) et `preload.js` jamais exécutés par un test (seulement lus comme texte). Tests : electron-fuses, electron-integrity, electron-nav-guard, electron-loopback, update-verify.

## 7. PWA & frontend (V2) — haute

Service worker manuel (`sw.js`) : `/api/*` exclu du cache, assets cache-first, navigations network-first. CSP globale (mais `script-src 'unsafe-inline'/'unsafe-eval'` — AUD-024). 41 composants (~11 400 lignes), 4 thèmes CSS, i18n 14 langues. **Points d'attention** : `skipWaiting()` inconditionnel → rechargement forcé (AUD-025), RTL/lang non restaurés (AUD-026), pas d'error boundary (AUD-027), StockPanel a11y/contraste (AUD-028), couverture de test quasi nulle sur les composants. Tests : pwa.test.ts (statique), e2e/responsive (skippé sans identifiants).

## 8. Scripts, CI/CD, supply chain (V2) — critique

CI moindre privilège (`permissions: contents: read`), Node 22, `npm ci`, 12 gardes d'invariants, porte de vulnérabilités datée (`audit-ci.js`). Keygen Python, rotation PowerShell (dry-run/backup/restore, masquage par empreinte), packaging desktop (Fuses + manifeste HMAC). **Points d'attention** : installeur non signé (AUD-008), `check-critical-files.js` non câblé (AUD-029), pipeline desktop non exécuté en CI (AUD-030), gitleaks sans checksum + actions sur tags mobiles (AUD-031), pas de SBOM, `restore.js` interactif cassé (AUD-039).

## 9. Portail client (V2) — haute

Inscription/connexion client, 2FA TOTP, gestion d'appareils révocables, liens publics par JWT signé (`/portal/[token]` 48 h, `/portal/quote/[token]`). Scoping clientId+garageId. **Point d'attention** : 20 routes, **0 test de handler** (AUD-022) ; seule la logique pure est couverte. Déconnexion portail ne purge pas le cache SW (jeton dans la clé d'URL).

## 10. Documentation & affirmations (V2 + site3) — critique

V2 : gouvernance volontariste (`PRODUCTION-READINESS.md` source de vérité, 12 rapports marqués historiques, gardes docs/branding). **Points d'attention** : `docs/history/` référencé mais absent (AUD-040), marque « GarageFlow » dans docs/ hors scanner (AUD-041), comptes de tests divergents (AUD-042). **Manques de due diligence** : aucun LICENSE (AUD-013), aucun THIRD_PARTY_NOTICES/SBOM (AUD-015), aucune provenance/registre IA (AUD-016), aucun registre RGPD/DPA (AUD-014). garagesite3 : aucune gouvernance équivalente (3 rapports finaux contradictoires, 6 comptes de tests, marque sans « s », mentions légales pilotées par env vides).

## 11. Vitrine + control-plane (garagesite3) — critique

Bien plus qu'une vitrine : marketing (Hero, Tarifs, FAQ, pages légales) **et** control-plane (activation/heartbeat licences, updates signées Ed25519, ingestion crashs + rollback auto, notifications, leads/newsletter SMTP, back-office `/admin/*`, API démo `/api/v1/*` en mémoire). **Aucun paiement** (plans déclaratifs, vente hors site via Keygen). Clé publique alignée sur le keygen (vérifié). **Points d'attention** : 7 routes sur limiteur mémoire (AUD-009), clé admin unique en sessionStorage (AUD-010), notifications sans preuve d'appareil (AUD-011), type `mechanic` rejeté (AUD-012), CORS `*` par défaut + blob-upload hors guard (AUD-037), `LICENSE_ADMIN_API_KEY` réutilisée en clé HMAC SSE (AUD-038). PostgreSQL, 13 modèles, 5 migrations.

## 12. Inventaire des tests (V2 + site3)

104 fichiers vitest (V2) + 21 (site3) + 1 spec Playwright. CI provisionne PostgreSQL 16 + Redis 7 réels. Couverture **dense** sur crypto/licences/monnaie/migrations, **fine** sur les handlers HTTP. **Trous critiques** : restauration de sauvegarde jamais exécutée (AUD-017), `requireAdminKey` non testé (AUD-018), isolation inter-garage non permutée systématiquement (AUD-019), concurrence numérotation/stock sur mock mémoire (AUD-020/021), portail sans test de handler (AUD-022), E2E jamais lancé en CI (AUD-023).

## Questions ouvertes

Regroupées et dédupliquées dans `docs/audit/RISK_REGISTER.md` (12 questions : rotations de secrets, purge d'historique, état des clés ECDSA, entité juridique, sous-traitants UE, consentement cookies, protections de branche, cible de déploiement, pipeline de release).
