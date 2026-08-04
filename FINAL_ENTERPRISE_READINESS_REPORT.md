# GarageFlow — Rapport de mise en état « Enterprise Production Ready »

> Suite du rapport `FINAL_UNIFIED_GARAGEFLOW_REPORT.md`. Cette phase durcit la
> version unifiée : cycle de vie des appareils, sièges, chrono, photos, et
> correction des failles/dettes trouvées par un audit complet du projet.
> **Aucune fusion dans `main`, aucun déploiement en production.**
>
> Branche : `claude/garageflow-final-unified-merge-ub0l67`.
> Chaque affirmation ci-dessous est adossée aux résultats des commandes réellement exécutées.

## 0. Résultats de vérification (EXACTS)

| Commande | Résultat |
|---|---|
| `tsc --noEmit` | **0 erreur** ✅ |
| `next lint` (ESLint) | **0 warning / 0 erreur** ✅ |
| `vitest run` | **92 fichiers OK / 3 ignorés ; 947 tests OK / 26 ignorés ; 0 échec** ✅ |
| `next build` | **✓ Compiled successfully ; 16/16 pages statiques** ✅ |
| `prisma validate` (SQLite + PostgreSQL) | **les deux valides** ✅ ; `prisma generate` (les deux) : OK |
| `node scripts/audit-ci.js` (gate prod high/critical) | **PASS** (0 non-dérogée) ✅ |
| `node scripts/check-critical-files.js` | **PASS** ✅ |

Point de départ de la phase : 869 tests OK. Après cette phase : **947 tests OK** (+78 tests), 0 échec.

## 1. Cycle de vie des appareils (§1, §2, §3)

Machine à états formalisée (`src/lib/license/devices.ts`) : états canoniques
`active` / `deactivated` (= *disconnected*) / `revoked`, avec :
- `isSeatConsumingStatus` : **seul `active` consomme un siège** ; `deactivated` et
  `revoked` le LIBÈRENT → les révoqués/déconnectés ne comptent JAMAIS dans le quota.
- `canTransitionDevice` : `revoked` est **terminal** (revoked→active / revoked→deactivated
  interdits) — révocation irréversible.

Effets par transition de licence mécanicien (`mechanic-admin.ts`, routes) :
- **Déconnexion** → `disconnectDevices` passe les appareils à `deactivated` : session
  coupée, **siège libéré, reconnexion possible**, licence reste `active`. Ne révoque JAMAIS.
- **Révocation** → `revokeDevices` : appareils `revoked` (permanent).
- **Suspension** → **les appareils ne sont PAS touchés** : la licence `suspended` bloque
  déjà toute session, l'appareil reste `active` → le **siège est conservé** (les clés
  suspendues comptent) et l'accès est rétabli **instantanément** au retour en `active`,
  sans réactivation ni re-consommation de siège.

Le plafond de sièges à l'activation (`devices.ts::activateDevice`) était déjà **atomique**
(transaction + `SELECT … FOR UPDATE` sur PostgreSQL, re-comptage de contrôle sur SQLite).
Preuves : `mechanic-device-lifecycle.test.ts` (15 tests).

## 2. Chrono mécanicien (§6)

`src/app/api/mechanic/jobs/[id]/timer/route.ts` — actions `start | pause | resume | stop` :
- **Anti double-démarrage** : `start/resume` n'agissent que si aucun segment n'est en cours
  (`where timerStartedAt: null`) — deux clics rapides ne réinitialisent jamais le chrono.
- **Durée jamais négative** : chaque segment est clampé à ≥ 0 (anti recul d'horloge) →
  `actualDuration` ne diminue jamais.
- **Pause/reprise sans perte** : nouveau `Job.timerAccumulatedSec` (Int, migration additive
  SQLite + PostgreSQL) accumule les secondes des segments ; `actualDuration` (minutes,
  compat historique) n'est incrémenté qu'à l'arrêt → des pauses répétées n'accumulent
  aucune erreur d'arrondi.
- **Atomicité** : chaque écriture est un `updateMany` re-scopé (garageId + mechanicId) +
  garde optimiste (`timerStartedAt` ET `timerAccumulatedSec`) → réattribution ou double-clic
  concurrent ⇒ 409, jamais de double comptage. UI câblée (Pause / Reprendre / Terminer).

Preuves : `timer-pause-resume.test.ts` (horloge figée) + `timer-route.test.ts` (17 tests).

## 3. Photos mécanicien (§7)

`mechanic-photo.ts` / route photos : type réel par **octets magiques** (JPEG/PNG/WebP/HEIC ;
GIF/PDF/exe-renommé/zip-renommé refusés), taille plafonnée, **plafond de 50 photos par
intervention**, **empreinte sha256** (intégrité/traçabilité, journalisée). Nom de fichier
généré côté serveur (aucun chemin relatif). Preuves : `mechanic-photo.test.ts` (9 tests).

## 4. Audit complet du projet (§11) — failles et bugs corrigés

Deux audits indépendants (sécurité/isolation ; qualité/concurrence) ont balayé routes,
composants, middleware, migrations, Electron, secrets. **Aucun bloquant/critique** : pas
d'IDOR, pas de fuite inter-tenant, pas de RCE Electron, aucun secret journalisé. Corrigé :

| Sévérité | Faille / bug | Correctif | Preuve |
|---|---|---|---|
| Moyen (autorisation) | 5 routes financières (finance, profitability, forecast, reports, export **FEC**) protégées par `requireSession()` seul → un RECEPTIONIST (sans `financial:read`) lisait finances/marges/coûts et l'export comptable FEC | Gate `financial:read` (403 sinon) | `financial-authz.test.ts` |
| Moyen (crash) | `JSON.parse(specialty)` non gardé → une ligne corrompue faisait planter `/api/suggestions` pour tout le garage | `src/lib/specialty.ts` (parse never-throw + normalize à l'écriture) | `specialty.test.ts` |
| Moyen (corruption données) | Décrément de stock non atomique (SET lecture-modif-écriture) sur le retour de bon de commande → lost-update sur PostgreSQL | Décrément atomique conditionnel (`updateMany qty>=q → { decrement }`), plancher 0 | code |
| Faible (intégrité) | Édition concurrente d'une licence admin (statut vs hwid) → recordMac calculé sur un état périmé → licence « tampered » bloquée | Lecture+recalcul+écriture sous transaction + verrou de ligne (FOR UPDATE PostgreSQL) | code |
| Faible (diagnostic) | Bouton « Test email » : `secure ?? true` divergent → échec sur port 587 (STARTTLS) | Défaut aligné `secure ?? (port===465)` | code |
| Faible (fuite mémoire) | Intervalle IA de `app/page.tsx` créé après démontage pendant le bootstrap → jamais nettoyé | Garde `alive` | code |

`stats` / `dashboard` NON verrouillés (servent le Header/Dashboard de tous les rôles ; les
gater serait une régression) — leur exposition de chiffres agrégés à un RECEPTIONIST est un
**point résiduel** documenté (à traiter par un filtrage de champs côté UI, hors périmètre ici).
La factorisation du transporteur SMTP en 3 exemplaires reste une amélioration recommandée
(non faite : refactor de routes d'envoi d'e-mail = risque > valeur immédiate).

## 5. Dette technique supprimée (§12) — après preuve d'inutilisation

Supprimés APRÈS vérification de **zéro référence** dans tout `src/` (tests compris) :
- **2 fichiers** : `src/lib/seed-data.ts`, `src/hooks/useWorkOrders.ts`.
- **10 exports morts** : `withLoginRateLimit`, `logLogin`, `estimateRepairDuration`,
  `searchMakes`, `searchModels`, `resolvePhoto`, `formatEuros`, `GarageFlowLockup`,
  `useIsBelowLg`, `useIsShortLandscape`.
tsc 0, ESLint propre, suite complète verte → aucun changement de comportement.

## 6. Régression détectée et corrigée par la suite de tests

L'ajout de `Job.timerAccumulatedSec` a cassé un test d'intégration RÉEL
(`tenant-isolation.test.ts`) qui sème dans le **modèle SQLite committé**
(`prisma/garageflow-template.db`), lequel ne connaissait pas la colonne. Le modèle a été
**synchronisé** (colonne additive, DEFAULT 0). Cela illustre la règle « exécuter TOUS les
tests » : la régression a été vue et corrigée, jamais ignorée ni le test désactivé.

## 7. Tests ajoutés (5 fichiers, +78 tests cette phase)

`mechanic-device-lifecycle.test.ts`, `timer-pause-resume.test.ts`, `mechanic-photo.test.ts`,
`specialty.test.ts`, `financial-authz.test.ts` — tous verts.

## 8. Risques restants (classés)

- **Bloquant / Critique** : aucun identifié dans le périmètre code.
- **Élevé** : `EnableEmbeddedAsarIntegrityValidation=false` dans les Fuses (identique à la
  base durcissement, compensé par le manifeste HMAC runtime) — à réévaluer avant release Windows.
- **Moyen** : exposition de chiffres agrégés (stats/dashboard) à un RECEPTIONIST — filtrage
  de champs côté UI recommandé. Réauth token mécanicien par mot de passe (TOTP staff absent
  du modèle). Factorisation SMTP (3 copies) recommandée.
- **Faible** : le modèle SQLite committé doit être re-synchronisé à chaque changement de
  schéma d'une table qu'il contient (gotcha de maintenance ; alternative : `prisma db push`
  dans le `beforeAll` du test).
- **Externe** : voir §9.

## 9. Éléments nécessitant une validation humaine / infrastructure réelle

- **Concurrence PostgreSQL réelle** (50/20 créations simultanées, activations, révocations,
  chrono, notes) : les protections sont en place (transactions, verrous, gardes optimistes,
  contraintes uniques) et prouvées au niveau unité/route avec prisma simulé ; **la charge
  concurrente réelle sur un PostgreSQL multi-instance reste à exécuter en CI/staging** (aucun
  serveur PostgreSQL dans cet environnement).
- **Gitleaks** & **migrations PostgreSQL sur base vide** : exécutés par la **CI** (`ci.yml`).
- **Electron** packagé + Fuses sur l'exécutable + **Authenticode** / installation Windows 10-11
  / mise à jour signée / rollback → **validation humaine**.
- **Bout-en-bout complet** avec services réels (SMTP, OCR, Upstash, PostgreSQL managé), **FEC**
  et validation **juridique**, **tests avec de vrais garages**, **déploiement de production**.

## 10. Pull Request

Poursuite sur la même branche et la même PR **draft #6** (base `main`, **non fusionnée**).
Commits de cette phase (base `main` étendue) :
`2f299f8` device · `54dc9a0` chrono · `4931c1e` photos · `c17e591` specialty/stock ·
`bfde296` authz financier · `2785477` MAC/SMTP/interval · `4f6958f` template DB ·
`716813f` dead code.

**Rollback** : branche isolée ; les migrations ajoutées sont **additives** (colonne nullable
à défaut, aucune table détruite) → aucune perte de données. Le modèle SQLite committé est
re-synchronisé. **Ne pas fusionner automatiquement.**

---

*Aucun résultat inventé. Tout ce qui n'a pas pu être exécuté ici (concurrence PostgreSQL
réelle, Gitleaks, build Electron/Windows) est explicitement signalé et renvoyé à la CI ou à
une validation humaine.*
