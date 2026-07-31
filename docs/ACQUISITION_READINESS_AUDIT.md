# GarageFlow — Audit de préparation à l'acquisition

> **Objet.** Évaluer honnêtement l'écosystème GarageFlow (application desktop
> `GarageFlowsV2` + control-plane/site `garagesite3`) comme un **actif logiciel
> en préparation de cession**, du point de vue d'un acquéreur stratégique menant
> une due diligence technique.
>
> **Méthode.** Audit multi-domaines par lecture directe du code réel (sept
> domaines : desktop, cloud, sécurité/multi-tenant, modèle de données &
> facturation électronique, tests/CI/build, analyse des leviers de valeur,
> dépendances/PI), synthèse contradictoire, puis vérification indépendante des
> chiffres clés (tests, typecheck, secrets) exécutés réellement pendant l'audit.
>
> **Date.** 2026-07-31 · **Périmètre.** `supremperf/GarageFlowsV2` @
> `claude/garageflow-acquisition-prep-914inr`, `supremperf/garagesite3` @
> `claude/garageflow-acquisition-prep-914inr`.
>
> **Principe directeur.** Aucune affirmation sans preuve. Chaque note de maturité
> renvoie à un fichier réel. Les chiffres proviennent d'exécutions réelles, pas
> d'estimations. Ce document distingue systématiquement ce qui est *opérationnel*,
> *partiel*, *présent en code sans interface*, et *non construit*.

---

## 1. Résumé exécutif

GarageFlow est un produit français de gestion d'atelier automobile **mono-garage**
livré sous trois formes : une application desktop Electron (`GarageFlowsV2`,
Next.js 14 + SQLite/Prisma), une PWA partageant ce code, et un control-plane +
site vitrine (`garagesite3`, Next.js 15 + PostgreSQL) qui émet les licences et
signe les mises à jour.

**Le cœur technique — sécurité, licences, logique métier backend — est
authentiquement solide, nettement au-dessus d'un SaaS artisanal typique :**
isolation renderer Electron exemplaire, vérification de licence asymétrique
ECDSA, mises à jour Ed25519 avec vérification SHA-256 *avant exécution*,
sauvegardes AES-256-GCM authentifiées, énforcement des sièges transactionnel et
robuste au TOCTOU, isolation multi-tenant en défense en profondeur *prouvée par
des tests*, et une suite de tests backend substantielle derrière une CI
complète. **Ce cœur est le véritable actif.**

**Mais une partie notable du produit est « en façade » ou non construite, et
l'opération comporte des dépendances externes que le dépôt ne peut satisfaire
seul.** Le point le plus important : le produit **ne peut être ni exploité ni
monétisé sans le transfert des clés privées de signature, du backend
control-plane et des domaines `garageflows.fr`** — dont aucun n'est dans le code
et qu'aucune due diligence ne peut vérifier depuis le dépôt. À cela s'ajoutent :
une préparation à la **facturation électronique** française (mandat 2026-2027)
quasi nulle sur le marché cible exact, une **« API REST ouverte »** annoncée qui
est en réalité une démo en mémoire non persistante, et des thèses de valeur
(marque blanche, hiérarchie multi-garage, import de données) qui exigent du
développement réel, pas de la configuration.

**Verdict de maturité globale : Beta.** Un cœur sécurité/licences *candidat à la
production* entouré de fonctionnalités en façade, non construites, ou dépendantes
d'actifs hors dépôt. Ce n'est pas une entreprise clé en main : l'exploitabilité
est conditionnée à un transfert d'actifs externes.

### Scores de préparation (0-100, conservateurs, justifiés ci-dessous)

| Dimension | Score | Justification en une ligne |
|---|---:|---|
| Technique | **60** | Cœur solide et testé ; couche présentation non testée, features en façade, dette de maintenance (Electron 31, Next 14/15). |
| Sécurité | **70** | Excellente cryptographie et isolation prouvée par tests ; réserves réelles (IAM admin à clé unique, 2FA portail, DRM local JS). |
| Transférabilité | **45** | Bloquée par les actifs hors dépôt (clés, backend, domaines) et l'absence de fichier de PI ; documentation en cours de construction. |
| Démontrabilité | **57** | Seed de démo réaliste + control-plane fonctionnel ; mais features non câblées à l'UI et binaire non signé nuisent à une démo « propre ». |
| **Global** | **54** | Cœur de valeur réel, mais opérabilité contingente et lacunes produit qui plafonnent la valeur. |

Ces scores plaident pour **défendre le plancher** d'une fourchette 150 000 –
350 000 € (voir `acquisition-data-room/21_VALUATION_RATIONALE.md`) grâce au cœur
sécurité/licences et à la propreté des dépendances ; l'opérabilité contingente,
le vide de facturation électronique et les features en façade **s'opposent au
plafond** tant qu'ils ne sont pas traités.

---

## 2. Ce que l'audit a vérifié en exécutant réellement l'outillage

Chiffres obtenus par exécution réelle pendant l'audit (pas d'estimation) :

| Vérification | GarageFlowsV2 (desktop) | garagesite3 (cloud) |
|---|---|---|
| `tsc --noEmit` | **exit 0 (propre)** | **exit 0 (propre)** |
| Tests unitaires/intégration exécutés | **660 réussis / 10 ignorés** (hors tests Postgres/Redis) | **135 réussis / 0 échec** |
| Suites | 62 réussies, **1 échec** (`suppliers.test.ts` — hook `prisma db push` en timeout à 10 s : échec d'infra/timing, non logique) | 17 réussies |
| Contrôles de build | TS **et** ESLint imposés (aucun `ignoreBuildErrors` / `ignoreDuringBuilds`) | ESLint `ignoreDuringBuilds: true` (typecheck séparé conservé) — *à corriger* |
| `@ts-ignore` / `@ts-nocheck` (src+electron) | **1** au total | — |
| Secrets commités | **Aucun** (`.env` git-ignoré, `.env.example` = placeholders documentés) | Aucun ; validation env fail-closed |

> **Note d'honnêteté sur les tests.** La suite *complète* comprend aussi des
> tests d'intégration nécessitant PostgreSQL + Redis réels
> (`*.postgres.int.test.ts`, `*.integration.test.ts`), exécutés en CI mais **non
> reproduits localement** durant cet audit. Les auditeurs de domaine ont
> dénombré ~708 (V2) et ~149 (site3) cas *au total* en incluant ces tests. Les
> chiffres ci-dessus (660 / 135) sont ceux **réellement exécutés** ici, hors
> intégration. Le passage effectif en CI et les compteurs complets ne sont **pas
> indépendamment reproduits** dans cette revue.

---

## 3. Forces du produit (leviers de valeur avérés)

1. **Posture de sécurité délibérément forte, desktop et backend.** Isolation
   renderer manuelle (contextIsolation/sandbox/webSecurity, preload minimal),
   serveur Next.js embarqué lié à `127.0.0.1` uniquement, mises à jour Ed25519
   signées avec SHA-256 vérifié *avant* exécution + anti-downgrade, sauvegardes
   AES-256-GCM authentifiées, jetons d'appareil HMAC, comparaisons *timing-safe*.
2. **Control-plane licences/appareils/releases réel et adossé à une base.**
   Vérification ES256, énforcement des sièges transactionnel *TOCTOU-safe*
   (`SELECT ... FOR UPDATE` + recomptage), rate-limiting distribué *fail-closed*,
   validation d'environnement au démarrage. 135 tests unitaires verts.
3. **Isolation multi-tenant en défense en profondeur, prouvée par tests.** 401
   non-licencié / 403 inter-garage / 403 appareil révoqué, plus un garde de
   relation dédié contre l'IDOR de 2nd ordre (`src/lib/tenant.ts`).
4. **Suite de tests substantielle et réaliste derrière une CI complète.** ~857
   cas au total sur ~87 fichiers, peu de mocks, sur les deux dépôts (typecheck,
   lint, build, migrations sur Postgres réel, tests contre Postgres/Redis réels,
   gitleaks, audit de dépendances).
5. **Posture licences/dépendances propre pour la PI.** Toutes les dépendances
   directes permissives (MIT/ISC/Apache/BSD) ; aucun GPL/AGPL/SSPL ; copyleft
   limité à du LGPL transitif à faible risque (`sharp`) et à de l'outillage MPL
   au niveau fichier.
6. **Fondamentaux de facturation conformes.** Numérotation séquentielle sans
   trou et transactionnelle, immuabilité des factures émises, arithmétique TVA en
   centimes entiers exacte.
7. **Fonctions IA bien abstraites, sans verrou fournisseur.** OCR de plaque /
   lookup plaque côté serveur, authentifiés, rate-limités, dégradation propre
   sans clé API ; couche Copilot agnostique du fournisseur.
8. **Fondations bien conçues (même si non finalisées).** Config marque blanche
   typée (`src/config/brand.ts`) et sous-système de sauvegarde chiffré de
   qualité production — réduisent le coût de développement futur.

---

## 4. Faiblesses et éléments de décote

1. **Le produit ne peut être exploité/monétisé sans un transfert d'actifs hors
   dépôt** (clés privées + backend + domaines) que la due diligence ne peut
   vérifier depuis le code.
2. **Préparation à la facturation électronique quasi nulle** face à un mandat
   légal imminent sur le marché cible exact (garages français) — chantier de
   plusieurs mois avant utilisabilité légale.
3. **L'« API REST ouverte » annoncée est une démo en mémoire non persistante**
   qui perd ses données à chaque *cold start* serverless.
4. **Motif récurrent « en façade ».** Marque blanche, sauvegarde/restauration,
   monitoring existent en code mais sont non câblés ou sans UI/navigation.
5. **Aucun chemin d'import/migration de données** (coût de bascule élevé) et
   **aucune hiérarchie multi-garage** (une thèse de roll-up exige une refonte
   schéma + RBAC).
6. **Frictions de déploiement réel :** binaire Windows non signé (avertissements
   SmartScreen) et verrou hors-ligne à 72 h qui *ferme* l'application.
7. **Zéro test automatisé de la couche UI/présentation** (E2E ou composant) sur
   les trois surfaces — contraint la vitesse de changement post-acquisition.
8. **Réserves de sécurité concrètes** (détaillées §6) : clé admin unique
   partagée sans IAM/MFA/RBAC ; contournement du rate-limit 2FA portail +
   secrets TOTP en clair ; anti-tamper local JS auto-avoué contournable.
9. **Dette de maintenance :** Electron 31 en retard de correctifs, scission Next
   14/15, `next-auth` v4 déprécié, migrations desktop non reproductibles,
   fichiers `electron/*.js` embarqués = duplicatas non testés.

---

## 5. Éléments bloquants (P0) — conditions de closing, pas du code

Ces points **ne peuvent pas être résolus dans le dépôt**. Ils doivent devenir
des **conditions suspensives explicites et vérifiées** de la cession.

| # | Bloquant | Preuve | Remédiation |
|---|---|---|---|
| P0-1 | Transfert des **deux clés privées de signature** (licence ECC/ECDSA P-256 + mise à jour Ed25519), absentes du dépôt (server-side only) | `electron/main.js:98-104`, `electron/update-verify.js:20-33`, `.gitignore` (keys/private.pem) | Séquestre ou re-keying avant closing ; valider que l'acquéreur peut émettre une licence et signer une MàJ de bout en bout. |
| P0-2 | Transfert du **backend control-plane + base** (activation, heartbeat, révocation, publication de releases, service des manifestes signés) | Dépendance à `api.garageflows.fr` dans `electron/main.js`, allowlist de hôtes de téléchargement | Remise de l'infrastructure et de la base ; test d'exploitation indépendant. |
| P0-3 | Transfert des **domaines `garageflows.fr`, DNS et hébergement** (codés en dur dans les allowlists MàJ/licence) | `electron/update-verify.js`, `src/lib/domains.ts` | Cession des noms de domaine + DNS + hébergement. |
| P0-4 | **Cession de PI écrite / chaîne de titre** — aucun fichier `LICENSE` ni assignation dans les dépôts | `package.json` (`private:true`, pas de LICENSE) dans les deux dépôts | Contrat d'assignation couvrant les deux bases de code et tous les actifs de marque de `public/`. |

> Un correctif partiel a été apporté durant cette mission pour P0-4 côté dépôt
> (ajout de fichiers `LICENSE` propriétaires + `THIRD_PARTY_NOTICES.md`) — voir
> le rapport final. Cela **ne remplace pas** l'assignation contractuelle de PI.

---

## 6. Registre des risques classé (hors P0)

Sévérité → titre → impact acquéreur (extraits ; références fichier dans
`acquisition-data-room/20_DUE_DILIGENCE_CHECKLIST.md`).

**HAUT**
- **Facturation électronique : zéro préparation** face au mandat 2026-2027.
  Modèle de données : une seule TVA au niveau en-tête (pas de ventilation par
  ligne EN16931), pas de totaux HT/TTC/TVA figés à l'émission, dates stockées en
  chaînes, pas d'identifiants SIRET/SIREN/TVA intra vendeur/acheteur, pas de
  modèle Avoir ni Paiement. *Chantier pluri-mois obligatoire.*
- **`/api/v1` = démo en mémoire.** Non persistant, non partagé entre lambdas ;
  rate-limiter par instance ; aucun webhook. `src/lib/api/store.ts`.
- **Installeur Windows non signé.** Friction SmartScreen ; sape le récit
  d'intégrité. `package.json` (bloc `win`/`nsis` sans certificat).
- **Verrou hors-ligne 72 h qui ferme l'app.** `electron/main.js:298-299,1193-1206`.
- **Zéro automatisation de test E2E/UI** sur les trois surfaces.
- **Marque blanche « source unique » largement non câblée** (~146 littéraux
  « GarageFlow », ~2 consommateurs `BRAND.*`). *Le socle `brand.ts` est bon ; le
  câblage UI reste à faire (documenté honnêtement dans `WHITE_LABEL_GUIDE.md`).*
- **Aucun import de données + aucune hiérarchie org/multi-garage.**

**MOYEN**
- Clé admin statique unique pour tout le backend licences ; pas d'identité
  par-admin, MFA, RBAC ; stockée en `sessionStorage`.
- Features marquetées *code-complètes mais sans UI* (sauvegarde/restauration,
  monitoring accessibles seulement par URL directe).
- Pas de modèle Avoir/Paiement ; totaux recalculés à la lecture (non figés).
- Rollback automatique sur crash : code présent mais **aucun cron** ne
  l'invoque. *(Corrigé durant la mission : ajout de `vercel.json` cron — voir
  rapport final.)*
- 2FA portail : contournement du rate-limit (X-Forwarded-For non filtré) +
  secrets TOTP en clair au repos.
- Anti-tamper/DRM local JS-only, contournable ; énforcement licence *fail-open*
  hors-ligne.

**BAS**
- Electron 31 en retard ; scission Next 14/15 ; `next-auth` v4 ; pas de pin
  `engines` Node ; migrations desktop non reproductibles (pas de baseline) ;
  fichiers `electron/*.js` embarqués non testés ; audit de dépendances non
  bloquant côté `garagesite3`.

---

## 7. Inventaire honnête des fonctionnalités (opérationnel / partiel / code-only / non construit)

### Cloud control-plane (`garagesite3`)
| État | Fonctionnalité |
|---|---|
| ✅ Opérationnel | Activation licence / heartbeat jeton d'appareil / check (ES256 + HMAC, sièges atomiques, fail-closed) |
| ✅ Opérationnel | Publication de releases + rollout/rollback manuel |
| ✅ Opérationnel | Crash reporting (fingerprint, groupage, stats, triage) |
| ✅ Opérationnel | Modules / entitlements ; Notifications (ciblage, accusés) ; Journal d'audit global (recherche/CSV) |
| ✅ Opérationnel | Manifeste de MàJ signé Ed25519 ; upload d'installeur (Vercel Blob) ; rate-limiting distribué fail-closed |
| ⚠️ Partiel | Dashboard admin temps réel (SSE) — durée de connexion serverless limitée |
| 🧩 Code sans UI | Rollback automatique sur crash — implémenté mais aucun cron *(cron ajouté durant la mission)* |
| ❌ Non construit | **API REST v1 publique** (démo en mémoire non persistante) ; **Webhooks** (inexistants) |

### Desktop (`GarageFlowsV2`)
| État | Fonctionnalité |
|---|---|
| ✅ Opérationnel | IPC sécurisé ; serveur Next standalone en loopback ; SQLite/Prisma (37 modèles) + template DB + sauvegardes 3 niveaux |
| ✅ Opérationnel | MàJ Ed25519 vérifiée SHA-256 avant exécution ; manifeste d'intégrité HMAC ; licence ECC P-256 + HWID + révocation |
| ✅ Opérationnel | Grâce hors-ligne 48 h / verrou dur 72 h + détection recul d'horloge *(le verrou 72 h est un risque produit)* |
| ⚠️ Partiel | Pipeline de build Windows x64 NSIS (viable ; requiert keygen ; cible unique) |
| 🧩 Code sans UI | Module de ressources chiffrées AES-256-GCM (aucun asset `.enc` embarqué) |
| ❌ Non construit | **Signature de code de l'installeur Windows** |

### Modèle de données & facturation électronique
| État | Fonctionnalité |
|---|---|
| ✅ Opérationnel | Modèle Invoice/InvoiceLine + CRUD (isolation, immuabilité) ; numérotation séquentielle sans trou ; parité schéma desktop/serveur |
| ⚠️ Partiel | TVA (centimes exacts mais taux unique en-tête, pas de ventilation par ligne) ; historique de migrations desktop incomplet |
| ❌ Non construit | **Factur-X/UBL/CII** ; **Chorus Pro/PDP + e-reporting** ; **Avoir** ; **Paiement/partiel** |

### Tests / CI / build
| État | Fonctionnalité |
|---|---|
| ✅ Opérationnel | Tests unitaires/logique ; intégration route sur SQLite réel ; isolation multi-tenant ; licence/sièges ; intégration Postgres/Redis (CI) ; vérif MàJ ; CI typecheck+lint+build+gitleaks |
| ⚠️ Partiel | Tests PWA (72 lignes, pas de SW/offline E2E) ; enforcement de couverture (mesurée, non seuillée) |
| 🧩 Code sans UI | Tests directs des `electron/*.js` (duplicatas non testés) |
| ❌ Non construit | **E2E navigateur** (aucun Playwright/Cypress) ; **tests composants React** (0 `.tsx`) |

### Leviers de valeur
| État | Levier |
|---|---|
| ✅ Opérationnel | Mode démo / seed réaliste (`prisma/seed.ts`) |
| ⚠️ Partiel | Marque blanche (config Zod excellente mais peu câblée) ; observabilité (logger + monitoring) |
| 🧩 Code sans UI | Sauvegarde/restauration (service complet, sans écran) |
| ❌ Non construit | **Import de données (CSV/Excel/JSON)** ; **hiérarchie multi-garage/réseau** |

### Dépendances / PI
| État | Élément |
|---|---|
| ✅ Opérationnel | OCR plaque + lookup plaque IA (câblés UI, auth, rate-limit) ; posture licences dépendances propre |
| ⚠️ Partiel | Intégration LLM Copilot (interface + UI présentes) |
| ❌ Non construit | **Documentation de propriété (LICENSE/assignation)** *(fichiers LICENSE ajoutés durant la mission ; l'assignation reste contractuelle)* |

---

## 8. Risques de transfert à un acquéreur

- **Dépendance au créateur.** Le produit dépend d'un backend et de clés que seul
  l'éditeur actuel détient (P0-1/2/3). Sans plan de transfert accompagné, un
  acquéreur ne peut pas émettre une licence le lendemain du closing.
- **Reproductibilité du desktop.** Le schéma SQLite n'est pas reconstructible
  depuis les migrations (repose sur `db push` + template DB commité). Un
  acquéreur doit *baseliner* les migrations pour faire évoluer le schéma en
  sécurité.
- **Fichiers embarqués divergents.** Les `electron/*.js` livrés sont des
  duplicatas non testés de copies `src` : risque de divergence silencieuse du
  code sensible (MàJ/intégrité).
- **Conformité légale.** Sans facturation électronique, le produit deviendra
  progressivement inutilisable pour des garages français assujettis au mandat
  2026-2027 — un acquéreur doit budgéter ce chantier avant commercialisation.

**Atténuations livrées durant la mission** (voir `TRANSFER_PLAYBOOK.md` et le
rapport final) : documentation de transfert complète, guide de build Windows,
guide marque blanche honnête, fichiers LICENSE + notices tierces, cron de
rollback, et data room d'acquisition prête à examiner.

---

## 9. Ordre de priorité (rapport valeur / temps)

- **P0 — Bloquants (conditions de closing) :** clés privées, backend, domaines,
  assignation de PI. *Hors code ; à traiter contractuellement.*
- **P1 — Réduction du risque acquéreur :** chiffrer les secrets TOTP + corriger
  le contournement rate-limit 2FA ; câbler le cron de rollback ; ajouter
  LICENSE/notices ; rendre l'audit de dépendances bloquant ; documenter transfert
  / sécurité / déploiement / restauration. *Fort ROI, effort modéré.*
- **P2 — Augmentation directe de la valeur :** câbler `BRAND.*` dans l'UI ;
  interfaces d'abstraction + adaptateur simulé pour facturation électronique et
  import ; UI de sauvegarde/monitoring ; data room. *Effort moyen à élevé.*
- **P3 — Finition commerciale :** onboarding, scripts de démo, dossier acheteur.
- **P4 — Secondaire :** signature de code (procurement externe), montée Electron
  /next-auth, baseline des migrations, E2E.

---

## 10. Estimation honnête du niveau de préparation

**Préparation à l'acquisition : ~54/100 (Beta).** Le produit possède un **cœur
de valeur réel et défendable** (sécurité, licences, isolation, tests, propreté
PI) qui justifie le **plancher** d'une fourchette 150 000 – 350 000 €. Il n'est
**pas** prêt à défendre le plafond tant que : (a) le transfert des actifs hors
dépôt n'est pas contractuellement sécurisé et démontré, (b) la facturation
électronique n'est pas au moins *architecturée* avec un adaptateur testable, et
(c) les features « en façade » ne sont pas soit câblées, soit retirées du récit
de valeur.

Voir la fourchette de valorisation détaillée et ses trois scénarios (prudent /
stratégique / premium) dans
`docs/acquisition-data-room/21_VALUATION_RATIONALE.md`, et le plan de transfert
dans `docs/TRANSFER_PLAYBOOK.md`.

---

*Ce document est mis à jour par le rapport final
`docs/FINAL_ACQUISITION_READINESS_REPORT.md`, qui recense les travaux
réellement effectués durant la mission, avec les résultats de tests et builds
exacts.*
