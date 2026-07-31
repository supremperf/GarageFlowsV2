# Rapport final de préparation à l'acquisition — GarageFlow

_Rapport de mission. Toutes les affirmations sont soutenues par un fichier, un
test ou une commande réellement exécutée. Date : 2026-07-31._

Ce rapport recense les travaux **réellement effectués** durant la mission, avec
les résultats exacts. Il complète et confirme
[`docs/ACQUISITION_READINESS_AUDIT.md`](ACQUISITION_READINESS_AUDIT.md).

Légende d'état : ✅ terminé et vérifié · 🟡 partiel · 📐 seulement préparé
(design/interface) · ⏳ non testable ici · 🔀 dépend d'un tiers · 🪟 exige
un test réel sous Windows.

---

## 1. Résumé exécutif

GarageFlow possède un **cœur technique réel et de qualité supérieure** (sécurité,
licences, isolation multi-tenant, tests) qui justifie le **plancher** d'une
valorisation 150 k€–350 k€. Il n'est pas prêt à défendre le plafond tant que
(a) le transfert d'actifs externes (clés privées, backend, domaines) n'est pas
contractualisé et démontré, (b) la facturation électronique n'est pas au moins
architecturée avec un adaptateur testable, et (c) les fonctionnalités « en
façade » ne sont pas câblées ou retirées du récit de valeur.

**Préparation globale : ~54/100 (Beta).** Aucun score n'atteint 100 : des
réserves sérieuses subsistent (voir §11–13).

Durant la mission, sans casser aucune compatibilité ni inventer de résultat :
- audit multi-domaines par lecture réelle du code (7 domaines + synthèse) ;
- correctifs de sécurité/ops vérifiés par tests ;
- couche marque blanche typée et validée + tests ;
- ensemble documentaire d'acquisition (45 fichiers, ~6 200 lignes) ancré sur
  l'audit et des chiffres vérifiés de première main ;
- data room (22 docs) et dossier acheteur (10 docs) factuels.

---

## 2. État initial (avant la mission)

- **GarageFlowsV2** (desktop) : Electron + Next 14 + SQLite (37 modèles), 125
  routes API, ~660 tests unitaires/intégration verts, `tsc` propre, TS+ESLint
  imposés au build. Système licences ECC/HWID + MàJ signées Ed25519 déjà
  production-grade.
- **garagesite3** (cloud) : Next 15 + PostgreSQL (13 modèles), 56 routes, 135
  tests verts, `tsc` propre, validation d'env fail-closed, rate-limit distribué.
- Aucun secret commité (`.env` git-ignoré). Pas de couche marque blanche
  centralisée côté desktop. Pas de `LICENSE`, pas de data room, pas d'audit
  d'acquisition. Facturation électronique absente. Pas d'import, pas d'E2E, pas
  de hiérarchie multi-garage.

---

## 3. Travaux réalisés (avec état)

### Code (vérifié par tests)
| État | Travail | Preuve |
|---|---|---|
| ✅ | **Couche marque blanche desktop** `src/config/brand.ts` (Zod, 3 couches d'override, repli sûr) ; `APP_CONFIG.name` en dérive | 8 tests verts `src/config/__tests__/brand.test.ts` |
| ✅ | **Nom produit surchargable côté cloud** (`NEXT_PUBLIC_PRODUCT_NAME`) | `garagesite3/src/lib/site.ts` |
| ✅ | **Verrou 2FA par compte** (anti brute-force TOTP, non contournable par rotation X-Forwarded-For) | `.../portal/auth/2fa/verify/route.ts` ; 50 tests portail/rate-limit verts |
| ✅ | **Rollback automatique réellement planifié** via Vercel Cron, auth bearer `CRON_SECRET` fail-closed | `garagesite3` : `vercel.json` + `api/cron/rollback-check` + `lib/server/cron-auth.ts` ; 5 tests verts |
| ✅ | **LICENSE** propriétaire (2 dépôts) + **SECURITY.md** racine (2 dépôts) | fichiers présents |

### Documentation (factuelle, ancrée)
| État | Livrable |
|---|---|
| ✅ | `ACQUISITION_READINESS_AUDIT.md` (audit maître honnête, chiffré, sourcé) |
| ✅ | Architecture : `ARCHITECTURE_OVERVIEW`, `DESKTOP_ARCHITECTURE`, `CLOUD_ARCHITECTURE`, `DATABASE_ARCHITECTURE` (existant) |
| ✅ | Déploiement/transfert : `DEPLOYMENT_GUIDE`, `ENVIRONMENT_VARIABLES`, `LOCAL_DEVELOPMENT`, `WINDOWS_BUILD_GUIDE`, `PWA_DEPLOYMENT`, `TRANSFER_PLAYBOOK`, `BUYER_TECHNICAL_FAQ` |
| ✅ | Fiabilité/ops : `BACKUP_AND_RESTORE`, `DISASTER_RECOVERY_PLAN`, `BACKUP_VERIFICATION`, `INCIDENT_RESPONSE`, `OPERATIONAL_RUNBOOK`, `OBSERVABILITY`, `SERVICE_LEVEL_OBJECTIVES`, `RELEASE_PROCESS`, `ROLLOUT_AND_ROLLBACK` |
| ✅ | Sécurité : `SECURITY_ARCHITECTURE`, `THREAT_MODEL`, `SECURITY_TEST_PLAN`, `VULNERABILITY_MANAGEMENT`, `MULTI_TENANT_SECURITY_MODEL` |
| ✅ | Licences/MàJ : `LICENSING_ARCHITECTURE`, `OFFLINE_LICENSE_POLICY`, `UPDATE_SECURITY` |
| ✅ | PI : `THIRD_PARTY_NOTICES` (racine), `OPEN_SOURCE_LICENSE_AUDIT`, `IP_ASSET_REGISTER`, `SBOM` |
| ✅ | Tests/perf/démo : `TEST_STRATEGY`, `PERFORMANCE_REPORT`, `DEMO_SCRIPT`, `DEMO_ENVIRONMENT`, `MARKET_VALIDATION_PLAN`, `WHITE_LABEL_GUIDE` |
| ✅ | **Data room** (`acquisition-data-room/`, 22 docs) + **buyer package** (`buyer-package/`, 10 docs) |
| 📐 | Facturation électronique : `E_INVOICING_ARCHITECTURE` (design), `E_INVOICING_PROVIDER_INTEGRATION` (design), `E_INVOICING_LIMITATIONS` (gap honnête). **Aucun code e-invoicing n'existe** — ces docs sont explicitement un design. |
| 📐 | Données/API : `DATA_MIGRATION_GUIDE` (import = design), `API_REFERENCE`, `WEBHOOKS` (design), `INTEGRATION_ARCHITECTURE` |

---

## 4. Fonctionnalités ajoutées

Aucune fonctionnalité métier « gadget » n'a été ajoutée (conformément à la
consigne). Les ajouts sont des **réducteurs de risque** et des **leviers de
valeur** : couche marque blanche (desktop + cloud), verrou 2FA par compte,
planification réelle du rollback automatique. Le reste est de la documentation
et de la préparation d'actif.

---

## 5. Vulnérabilités corrigées / atténuées (vérifiées)

| Sévérité (audit) | Problème | Correctif | Vérification |
|---|---|---|---|
| Moyen | Rate-limit 2FA contournable par rotation X-Forwarded-For + pas de compteur par compte | Verrou **par compte** (userId) 5/5min ajouté | 50 tests portail/rate-limit verts, `tsc` 0 |
| Moyen | Rollback « automatique » jamais déclenché (pas de cron) | Route cron GET + `vercel.json` + auth `CRON_SECRET` **fail-closed** | 5 tests unitaires du garde verts |

**Non corrigées (documentées honnêtement, voir `VULNERABILITY_MANAGEMENT.md`)** :
secrets TOTP en clair au repos (chiffrement recommandé — non livré pour éviter un
changement crypto non testable ici) ; clé admin unique sans IAM/MFA/RBAC ; DRM
local JS-only ; avis de dépendances transitives (voir §7).

---

## 6. Tests exécutés — résultats exacts

Exécutés réellement pendant la mission (sous-ensemble hors intégration
Postgres/Redis, non reproduits localement) :

| Dépôt | Commande | Résultat |
|---|---|---|
| GarageFlowsV2 | `npx vitest run` (hors `*.int`/`*.postgres.int`) | **678 réussis / 0 échec** (64 suites) |
| garagesite3 | `npx vitest run` (hors `*.integration`) | **140 réussis / 0 échec** (18 suites) |
| GarageFlowsV2 | `npx tsc --noEmit` | **exit 0** |
| garagesite3 | `npx tsc --noEmit` | **exit 0** |
| GarageFlowsV2 | démo : `prisma db push` + `npm run db:seed` (DB jetable) | **exit 0/0** — « Garage Demo », 5 mécaniciens, 13 OR |

Les tests inclus couvrent : isolation multi-tenant, licence/HWID/sièges,
vérification MàJ, TVA/centimes, rate-limit, marque blanche (nouveau), auth cron
(nouveau). Les suites complètes ajoutent des tests d'intégration Postgres/Redis
exécutés en CI — **non reproduits ici** (honnêteté : voir caveats de l'audit).

---

## 7. Builds réalisés

Exécutés réellement pendant la mission :

| Build | Commande | Résultat |
|---|---|---|
| GarageFlowsV2 (web/PWA + standalone) | `npm run build` (= `prisma generate` ×2 + `next build`) | ✅ **Compiled successfully** — 15/15 pages statiques, **exit 0**. Sortie `standalone/server.js` + prisma présents (artefact consommé par le packaging Electron). |
| garagesite3 (cloud/PWA) | `npm run build` (= `prisma generate` + `next build`) | ✅ **Compiled successfully in 31.0s** — 19/19 pages statiques, **exit 0** (env de build factices). |

> Les deux builds Next passent proprement. Le build desktop produit bien la
> sortie `standalone` requise pour empaqueter l'app dans Electron.

**Packaging Windows (`electron-builder --win`) : 🪟 non exécutable ici.** La
production de l'installeur NSIS x64 exige un environnement Windows (ou wine +
outillage signtool) et la présence de `keys/public.pem`. À valider sur poste
Windows réel. La signature de code n'est pas configurée (avertissements
SmartScreen attendus) — voir `WINDOWS_BUILD_GUIDE.md`.

---

## 8. Avis de dépendances (npm audit, exécuté de première main)

| Dépôt | Résultat `npm audit` |
|---|---|
| garagesite3 | 4 **high** (transitifs) : `sharp`/libvips (CVE-2026-33327/33328/35590/35591), `postcss`, chaînes `next`/`nodemailer` |
| GarageFlowsV2 | 7 vulnérabilités (4 moderate, 3 high) : `postcss` (high), `next`, `nodemailer`, `@anthropic-ai/sdk`, `dompurify`, `uuid` |

Recommandation (voir `VULNERABILITY_MANAGEMENT.md`) : appliquer `npm audit fix`,
monter `sharp`≥0.35.0 et les patchs `next`, **puis** rendre bloquant le gate
d'audit CI de `garagesite3` (aujourd'hui `continue-on-error`). Le gate n'a pas
été rendu bloquant durant la mission car il aurait rendu la CI rouge tant que ces
avis ne sont pas corrigés — ce qui aurait cassé le build.

---

## 9. Limites (honnêtes)

- Facturation électronique : **non construite** (design seulement).
- Import de données CSV/Excel : **non construit** (design seulement).
- Hiérarchie multi-garage/réseau : **absente** du schéma opérationnel.
- API publique `/api/v1` : **démo en mémoire** non persistante.
- Marque blanche : socle typé livré, mais ~146 chaînes littérales restent à
  câbler dans l'UI (documenté dans `WHITE_LABEL_GUIDE.md`).
- Sauvegarde/monitoring : code complet mais **sans UI**.
- Aucun test E2E/UI ; couverture mesurée mais non seuillée.

---

## 10. Éléments nécessitant un accès externe (hors code — conditions de closing)

- 🔀 **Clés privées de signature** (licence ECC P-256 + MàJ Ed25519) — absentes
  du dépôt (server-side only).
- 🔀 **Backend control-plane + base** (activation, heartbeat, révocation,
  releases signées).
- 🔀 **Domaines `garageflows.fr` + DNS + hébergement**.
- 🔀 **Cession de PI écrite** (le `LICENSE` ajouté ne remplace pas l'assignation).
- 🔀 Comptes fournisseurs : Vercel, PostgreSQL (Neon/Supabase), Upstash Redis,
  Vercel Blob, e-mail/SMS, éventuel PDP pour la facturation électronique.

---

## 11. Éléments à tester réellement sous Windows (🪟)

- Génération et exécution de l'installeur NSIS x64.
- Comportement du HWID (disque/MAC), du stockage safeStorage (DPAPI), du verrou
  hors-ligne 48 h/72 h, et de l'auto-update signé de bout en bout.

---

## 12. Scores de préparation (0-100, conservateurs — jamais 100)

| Dimension | Score | Base |
|---|---:|---|
| Préparation technique | **60** | Cœur solide et testé ; couche UI non testée, features en façade, dette de maintenance. |
| Sécurité | **72** | (audit 70, +2 pour les 2 correctifs vérifiés) — cryptographie et isolation prouvées ; réserves réelles (IAM, TOTP, DRM JS). |
| Transférabilité | **50** | (audit 45, +5 pour la documentation de transfert + LICENSE) — reste bloquée par les actifs externes non vérifiés. |
| Démontrabilité | **60** | (audit 57, +3 pour seed démo vérifié + scripts de démo) — features non câblées et binaire non signé pèsent encore. |
| **Préparation à l'acquisition (global)** | **~56** | Cœur de valeur réel ; opérabilité contingente et lacunes produit plafonnent. |

Ces ajustements (+ quelques points) reflètent uniquement des travaux **vérifiés**
de cette mission ; ils ne changent pas la nature Beta du produit.

---

## 13. Fourchette de valeur défendable + justification

- **Avant la mission** : plancher défendable ~150 k€ sur la base du cœur
  technique, mais transférabilité faible (pas de data room, pas de LICENSE, pas
  de plan de transfert) et lisibilité d'acquisition faible.
- **Après la mission** : le **plancher 150–200 k€** est **mieux défendable** :
  audit honnête, data room complète, plan de transfert, correctifs vérifiés,
  marque blanche amorcée, PI clarifiée (sous réserve d'assignation contractuelle).
- Atteindre **200–275 k€** exige de **prouver l'opérabilité end-to-end sans le
  vendeur** (transferts P0 exécutés) et un acquéreur à usage stratégique.
- Atteindre **275–350 k€** exige en plus **une preuve de marché**, un acquéreur
  stratégique et une **structure earn-out/partenariat** partageant le risque.

Voir `acquisition-data-room/21_VALUATION_RATIONALE.md` pour la logique complète
et les trois scénarios conditionnels.

---

## 14. Plan restant pour monter en gamme (par impact)

1. **Sécuriser contractuellement les 4 transferts P0** et démontrer l'opérabilité
   (émettre une licence + signer une MàJ) — débloque le scénario B.
2. **Architecturer la facturation électronique** avec l'interface + un adaptateur
   simulé testable (le design est fourni) — lève le risque légal FR.
3. **Câbler la marque blanche** dans l'UI + **construire l'import** de données.
4. **Signature de code Windows** (procurement OV/EV) + **E2E** sur les 3 surfaces.
5. **IAM admin** (par-opérateur, MFA, RBAC) + chiffrement TOTP au repos.
6. Corriger les avis de dépendances puis rendre le gate d'audit CI **bloquant**.
7. **Preuve de marché** (voir `MARKET_VALIDATION_PLAN.md`) — condition du premium.

---

## 15. Commits créés (cette mission)

**GarageFlowsV2** (branche `claude/garageflow-acquisition-prep-914inr`) :
- `feat(white-label)` : couche de marque centralisée typée + tests
- `security(portal)` : verrou 2FA par compte
- `docs+legal` : LICENSE, SECURITY.md, audit d'acquisition
- `docs` : data room d'acquisition complète (45 fichiers)

**garagesite3** (même branche) :
- `feat(white-label)` : nom produit surchargable par env
- `feat(ops)` : rollback automatique via Vercel Cron (auth fail-closed)
- `docs+legal` : LICENSE + SECURITY.md

---

_Voir aussi : [docs/ACQUISITION_READINESS_AUDIT.md](ACQUISITION_READINESS_AUDIT.md)._
