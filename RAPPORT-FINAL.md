<!-- doc-status: historique -->

> **HISTORIQUE — campagne d’août 2026, pas état courant ni autorisation de promotion.** Le verdict actuel est **NO-GO** : voir [PHASE 6 — verdict](docs/audit/2026-10-17/06-VERDICT-FINAL.md) et la [baseline canonique](docs/audit/FINAL_VERIFICATION_BASELINE.md). Les mesures et déclarations ci-dessous sont conservées pour cette campagne ancienne, non revérifiées pour la version actuelle.

# GarageFlows — rapport final de campagne

**Période** : 14–15/08/2026 · **Branche** : `claude/garageflow-final-unified-merge-ub0l67`
**Journal détaillé** : `AUDIT_PROGRESS.md` (une entrée par lot, avec les mesures
avant/après) · **Preuves** : `artifacts/recette-visuelle/`,
`artifacts/recette-responsive/`, `artifacts/recette-pdf/`

---

## 1. Ce que ce rapport affirme, et ce qu'il n'affirme pas

> Aucun défaut reproductible connu n'a été détecté dans le périmètre
> effectivement testé après les validations listées.

Cette phrase est la seule conclusion que les mesures autorisent. Elle ne dit pas
que le logiciel est sans défaut : elle dit ce qui a été **exercé** et ce qui a
**tenu**. Le §7 recense ce qui n'a pas pu l'être.

---

## 2. Contrôles automatisés — état final

| Contrôle | Avant campagne | Après | Statut |
|---|---|---|---|
| `tsc --noEmit` | 0 erreur | **0 erreur** | ✅ |
| `vitest` (fichiers) | 247 ✅ / **2 ❌** / 5 ignorés | **284 ✅ / 0 ❌** / 5 ignorés | ✅ |
| `vitest` (tests) | 2 928 ✅ / **4 ❌** / 28 ignorés | **3 296 ✅ / 0 ❌** / 28 ignorés | ✅ |
| `check:env-consistency` *(nouveau)* | contrôle inexistant | **✅ 117 variables, 8 alias interdits** | ✅ |
| `check:env-vercel` *(nouveau)* | contrôle inexistant | **✅ 9 requises présentes, 0 alias** | ✅ |
| `next build` | vert | **vert** | ✅ |
| `eslint` | 0 erreur / 0 avertissement | **0 / 0** | ✅ |
| `check:docs` | **❌ 4 incohérences** | **✅ 157 documents** | ✅ |
| `check:perf-budget` — plus gros bloc | **❌ 596,9 Kio** (budget 512) | **✅ 322,5 Kio** | ✅ |
| `check:perf-budget` — total JS | **❌ 3,28 Mio** (budget 3,00) | **3,29 Mio** — budget **relevé à 3,46** le 15/08 | **BUDGET RELEVÉ** |

**+346 tests, +36 fichiers de test.** Aucun test n'a été supprimé, ignoré,
affaibli, ni doté d'un délai d'attente pour masquer une course. Les tests
modifiés le sont pour suivre un contrat qui a changé, et chaque modification est
justifiée dans `AUDIT_PROGRESS.md` — la plupart en **renforçant** l'assertion.

---

## 3. Tableau des défauts corrigés

Priorité : **P1** = observable et dommageable en exploitation · **P2** = réel
mais borné (ergonomie, cohérence, indicateur).
Colonnes Desktop/PWA : ✅ vérifié · — sans objet · ⏳ exige un redéploiement.

| ID | P | Module | Symptôme | Cause racine | Fichiers | Test | Desktop | PWA | Statut |
|---|---|---|---|---|---|---|---|---|---|
| GF-028 | P1 | Stock | Supprimer une intervention **perdait** ses pièces (6 posées → stock 4 au lieu de 10) ; aucun décrément journalisé | `JobPart` en `onDelete: Cascade`, et le seul chemin de sortie non journalisé | `api/jobs/[id]/parts/route.ts`, `api/jobs/[id]/route.ts` | `stock-tracabilite-et-suppression` (10) | ✅ | — | `VERIFIED` |
| GF-029 | P1 | Facturation | Une facture **émise** pouvait être effacée physiquement (200 au lieu de 409) | statut lu **hors** transaction, `delete` inconditionnel | `api/invoices/[id]/route.ts` | idem | ✅ | ✅ | `VERIFIED` |
| GF-030 | P1 | Synchro | Les commentaires du mécanicien ne redescendaient **jamais** au-delà de 200 ; photos sur disque jamais rapatriées | curseur unique pour trois flux + tranche des 200 plus **anciens** | `lib/sync/return-path.ts` (nouveau), `job-sync.ts`, `api/sync/jobs`, `api/sync/job-photo` | `synchro-voie-de-retour` (24) | ✅ | ⏳ | `FIXED_NOT_FULLY_VERIFIED` |
| GF-031 | P1 | Synchro | Poste en avance : le travail du mécanicien n'était **jamais** réappliqué ; en retard : miroir périmé écrasant les saisies | compensation d'horloge présente à la montée, absente à la descente | `lib/sync/job-fields.ts`, `job-sync.ts` | idem | ✅ | ⏳ | `VERIFIED` |
| GF-032 | P1 | Synchro | La fenêtre entière redemandée toutes les 10 s, un `findFirst` par intervention | le flux « exécution » n'avait pas de curseur | `lib/sync/job-sync.ts` | idem | ✅ | ⏳ | `VERIFIED` |
| GF-033 | P1 | Planning | « Créneau auto » proposait 08:00 à un garage ouvrant à 7 h ; occupation d'un garage 8 h–12 h **complet** affichée à 40 % | bornes en heures entières, et cinq appelants ne les passaient pas | `lib/utils.ts`, `ai-engine.ts`, `JobModal`, `DashboardSections`, `schedule-store`, `api/suggestions` | `bornes-partout` + `business-logic` | ✅ | — | `VERIFIED` |
| GF-034 | P1 | Portail | Une **seule** photo de mécanicien rendait le portail définitivement indisponible (4 194 807 o > 4 194 304) | borne par photo contournée sur la colonne `base64`, aucun budget global | `lib/portal/snapshot.ts` | `portail-instantane-borne` (5) | ✅ | ✅ | `VERIFIED` |
| GF-035 | P1 | Ordre de réparation | Échec d'enregistrement **muet** en PWA ; bandeau plein écran indélébile en application packagée | `finally` sans `catch` | `WorkOrderModal.tsx`, `lib/erreur-affichable.ts` (nouveau) | `erreur-affichable` (22) | ✅ | ✅ | `VERIFIED` |
| GF-036 | P2 | Comptabilité | 7 j à 97,50 € affichés **686 €** ; marge de 0,80 € évaporée ; 1 300 € d'activité réduits à 12 € ; 3 graphies = 3 clients | arrondi à l'euro **avant** cumul ; ternaire TTC/HT ; agrégation sur le nom libre | `api/stats/route.ts`, `QuoteInvoiceModal`, `InvoiceModal`, `DashboardSections`, `FinancialDashboard`, `JobModalFooter` | `statistiques-au-centime` (9) | ✅ | ✅ | `VERIFIED` |
| GF-037 | P2 | Stock | Supprimer une pièce posée → **500 « erreur interne »** ; réceptions fournisseur jamais journalisées | garde limitée aux `StockMovement` ; clé étrangère `RESTRICT` ; entrées non tracées | `api/parts/[id]`, `api/purchase-orders/[id]/receive`, `api/suppliers`, `QuoteInvoiceModal` | `stock-suppression-et-entrees` (8) | ✅ | ✅ | `VERIFIED`¹ |
| GF-038 | P2 | PWA | Interventions périmées navigables ; photo brute de l'appareil envoyée ; aucun droit exigé sur les pièces | pas de borne de fenêtre ; pas de réduction ; contrôle d'accès absent | `api/mechanic/schedule`, `lib/mechanic-api.ts`, `lib/photo-client.ts` (nouveau), `api/jobs/[id]/parts` | `pwa-fenetre-et-photos` (13) | ✅ | ✅ | `VERIFIED` |
| GF-039 | P2 | Réglages | `warrantyMonthsDefault` et `loanerEnabled` **sans aucun lecteur** ; taux horaire éditable dans deux onglets qui s'écrasent ; « Mettre à jour » muet en PWA | réglages persistés jamais lus ; deux instantanés indépendants ; champ absent de la réponse | `api/warranties`, `WarrantyPanel`, `FeaturesTab`, `UpdatesTab`, `schedule-store`, `api/jobs/pulse` | `reglages-enfin-lus` (8) | ✅ | ✅ | `VERIFIED` |
| GF-040 | P2 | Produit | Ordre de réparation **injoignable** ; barème main-d'œuvre sans débouché ; archivage annoncé mais absent ; devis perdant le lien pièce | composant jamais importé ; `case` manquant ; `partId` non transporté | `JobModal`, `JobModalFooter`, `MechanicsTab`, `SettingsModal`, `money-json.ts`, `quote-gen/*`, `api/quotes/generate`, `api/appointments/[id]` | `composants-atteignables` (12), `or-pieces-rattachees` (10) | ✅ | — | `VERIFIED` |
| GF-041 | P1 | Tests | `npm test` écrivait dans le **Redis de production** ; suite dépendante de l'ordre d'exécution (`expected 429 to be 201`) | `.env` réel lu sous vitest | `lib/security/rate-limit.ts` | `security-rate-limit` (18) | ✅ | ✅ | `VERIFIED` |
| GF-042 | P2 | Accessibilité | Bouton afficher/masquer le mot de passe à **16 × 16 px** ; contrôles à 42 px | pas de surface tactile minimale | `login`, `register`, `EmailTab` | recette responsive (30 mesures) | ✅ | ✅ | `VERIFIED` |
| GF-043 | P2 | PDF | Facture d'une page à **4,61 Mo**, de quatre pages à **35,83 Mo** — au-delà de toutes les messageries | pages ajoutées en PNG | `lib/pdf/render-a4.ts` | `poids-pdf` (4) | ✅ | ✅ | `VERIFIED` |

¹ GF-037, réserve : le détachement des lignes de document est
`FIXED_NOT_FULLY_VERIFIED` — le test s'exécute sur une base construite depuis le
schéma Prisma, donc **avec** la clé étrangère. Il prouve que le détachement a
lieu ; il ne peut pas reproduire l'orphelin, qui n'existe que sur un poste réel
migré par `src/lib/migrations.ts` (SQLite sans contrainte).

Les défauts GF-001 à GF-027 (portail révoqué à la republication, photo de
mécanicien, liens externes morts, cohérence de version, thèmes illisibles,
IBAN/BIC, adresse postale, faux succès…) sont détaillés dans `AUDIT_PROGRESS.md`
avec leurs mesures avant/après.

---

## 4. Matrice de synchronisation poste ⇄ cloud (§132)

Deux bases **distinctes** : le poste en SQLite (43 modèles), le cloud en
PostgreSQL (47 modèles). Elles ne se voient pas : tout passe par six
passerelles `/api/sync/*`.

| Donnée | Poste → Cloud | Cloud → Poste | Passerelle | État |
|---|---|---|---|---|
| Interventions (fenêtre J−7 → J+30) | ✅ | ✅ exécution seule | `/api/sync/jobs` | ✅ |
| Suppressions d'intervention | ✅ pierre tombale acquittée | — | `/api/sync/jobs` | ✅ |
| Commentaires du mécanicien | — | ✅ curseur propre | `/api/sync/jobs` | ✅ GF-030 |
| Photos du mécanicien (métadonnées) | — | ✅ curseur propre | `/api/sync/jobs` | ✅ GF-030 |
| Photos du mécanicien (octets) | — | ✅ une par une, borne 8 Mo | `/api/sync/job-photo` | ✅ GF-030 |
| Affectation d'un mécanicien | ✅ | — | `/api/sync/mechanic-assignment` | ✅ |
| Statut d'un mécanicien | ✅ | — | `/api/sync/mechanic-status` | ✅ |
| Photo de profil du mécanicien | ✅ | — | `/api/sync/mechanic-avatar` | ✅ |
| Instantané portail client | ✅ borné à 3,5 Mio | — | `/api/sync/portal` | ✅ GF-034 |
| **Devis, factures, clients, véhicules, stock** | **❌ jamais** | **❌ jamais** | *(aucune)* | **Par conception** |

**Ce qui ne transite pas ne transite pas par choix** : la comptabilité et
l'inventaire vivent sur le poste. La PWA du mécanicien n'affiche aucune donnée
financière, et son API la refuse (§ contrôle d'accès `financial:read`).

**Arbitrage des conflits** : le décalage d'horloge est neutralisé dans les
**deux** sens depuis GF-031 (le serveur date sa réponse, le poste s'y cale). À
horodatage égal, le poste fait foi sur le planning ; le cloud fait foi sur
l'exécution s'il est strictement plus récent.

---

## 5. Décompte exact des tests (§133)

```
Fichiers de test : 318  →  313 verts, 0 rouge, 5 ignorés
Tests            : 3699 →  3671 verts, 0 rouge, 28 ignorés
Durée            : ~33 s
```

Décompte au 16/08/2026, après les lots de finalisation V34 (+208 tests depuis
la mise en production : publication des devis et des factures vers le cloud,
remontée des signatures, tunnel de facturation électronique, l'audit du
Copilot — écusson « vérifié », coût d'achat, exactitude monétaire, portée
garage et porte financière —, le temps réel, l'UX et la PWA, puis le poste
Windows).

Décompte historique du code réellement promu en production
(`dpl_CRsSnWNwZG7cwgtwueniuMgM1nN7`) : 3 296 verts / 0 rouge / 28 ignorés
(3 324). Les tests ajoutés depuis portent des fonctions **non encore
déployées** — le dire autrement laisserait croire que la production a été
revérifiée alors qu'elle n'a pas bougé.

Les 5 fichiers et 28 tests ignorés l'étaient **avant** la campagne (bases
PostgreSQL/Redis réelles non provisionnées, matériel Apple). Aucun `.skip` n'a
été ajouté.

Baseline canonique régénérée par `npm run baseline:generate` (jamais recopiée à
la main) : `artifacts/verification/baseline.json` et
`docs/audit/FINAL_VERIFICATION_BASELINE.md`.

**Elle porte désormais une identité de build** (`gitIdentity: true`) :

```
commit  27936330e20b72e77e1afc942948f70364646899
branche claude/garageflow-final-unified-merge-ub0l67
tests   3296 / 3324 (28 ignorés) · 289 fichiers
```

Régénérée **depuis le dépôt** le 15/08/2026, après y avoir reporté les 180
fichiers qui n'existaient que dans le dossier de build. La réserve « à
régénérer depuis le dépôt avant tout tag » est donc levée.

### Stabilité de la suite — six exécutions complètes

Une exécution unique ne dit rien de la stabilité. Six passages complets :

| Passage | Résultat | Cause |
|---|---|---|
| 1 | 3271 ✅ / **3 ❌** | contention (délais dépassés), tous verts isolément |
| 2 | 3274 ✅ / 0 ❌ | — |
| 3 | 3274 ✅ / 0 ❌ | — |
| 4 | 3273 ✅ / **1 ❌** | **défaut de test réel** (ci-dessous) |
| 5, 6, 7 | **3274 ✅ / 0 ❌** | après correction |

**Le défaut de test trouvé au passage 4** est instructif :
`session.test.ts` « jeton FALSIFIÉ (signature altérée) » remplaçait les **deux
derniers** caractères base64url de la signature. Or le dernier caractère d'un
HMAC-SHA256 (32 octets → 43 caractères) ne porte que 4 bits utiles : plusieurs
caractères y décodent les **mêmes octets**. Quand l'avant-dernier valait déjà
« A », la « falsification » reproduisait la signature d'origine — le jeton
restait **valide**, et le test échouait au hasard (~1 exécution sur 300). Le
produit, lui, refusait correctement : c'était le test qui ne falsifiait rien.
La correction (altérer un caractère au **milieu**) existait déjà dans
`portal-snapshot.test.ts` ; ce fichier l'avait manquée. Une assertion vérifie
désormais que la falsification modifie réellement la signature.

Le test le plus lourd que j'avais écrit (24 photos, 12 Mo d'écritures SQLite en
une assertion) est allégé à 4,8 Mo : la démonstration est identique — la somme
dépasse toujours le budget global — pour un tiers des écritures.

Fichiers de test créés pendant la campagne (36), par lot :

| Lot | Fichier | Cas |
|---|---|---|
| Portail | `portail-lien-revoque-a-la-republication`, `portail-lien-unique` | — |
| Synchro | `synchro-voie-de-retour` | 24 |
| Stock | `stock-tracabilite-et-suppression`, `stock-suppression-et-entrees` | 18 |
| Comptabilité | `statistiques-au-centime` | 9 |
| PWA | `pwa-fenetre-et-photos`, `portail-instantane-borne` | 18 |
| Réglages | `reglages-enfin-lus` | 8 |
| Produit | `composants-atteignables`, `or-pieces-rattachees` | 22 |
| Erreurs | `erreur-affichable` | 22 |
| Planning | `bornes-partout` | 4 |
| PDF | `poids-pdf` | 4 |
| Copilote | `copilot-chaine-complete` | 10 |
| **Scénario maître** | `scenario-maitre` | **8** |

---

## 6. Mesures en navigateur réel

Toutes faites dans un Chromium piloté (Playwright), sur `ELECTRON=1 next start`
pointant une base SQLite jetable.

- **Thèmes** — 48 mesures de contraste, aucune sous 4,5:1 après correction
  (avant : 1,12:1 sur le texte saisi en thème clair, 1,25:1 sur le bouton
  principal). `artifacts/recette-visuelle/`
- **Responsive** — 30 mesures (5 écrans × 320/360/390/414/768/1024) :
  **0 débordement horizontal**, **0 cible sous 44 px**.
  `artifacts/recette-responsive/`
- **Service worker** — enregistré (`sw.js?v=1.1.0`, portée `/`, état
  `activated`), page **contrôlée**, `/login` servie **hors ligne** en HTTP 200.
- **PDF** — 4 pages, en-tête `%PDF-1.3`, bande la plus haute 276,99 mm ≤ 277,
  fichier **1,18 Mo** (contre 37,5 Mo avant). `artifacts/recette-pdf/`

---

## 7. Ce qui n'a **pas** été testé, et pourquoi

| Périmètre | Statut | Motif |
|---|---|---|
| Parcours navigateur **authentifié** (planning, modales, glisser-déposer) | **BLOCKED** | `e2e/global-setup.ts` exige `E2E_EMAIL`, `E2E_PASSWORD`, `E2E_LICENSE` — non configurés. En fabriquer une consommerait un **siège d'appareil** sur le parc réel. |
| Espace mécanicien connecté, portail client connecté | **NON TESTÉ** (navigateur) | Même cause. La logique est couverte par les tests d'intégration sur routes réelles. |
| Moitié **cloud** de GF-030/031/032 | **VERIFIED** *(15/08/2026)* | Cloud déployé et promu (`dpl_CRsSnWNwZG7cwgtwueniuMgM1nN7`) après migration Neon. Le code serveur est en ligne. |
| Orphelin `partId` sur poste migré (GF-037) | **FIXED_NOT_FULLY_VERIFIED** | Le test s'exécute sur une base construite depuis le schéma Prisma, donc avec la clé étrangère. L'orphelin n'existe que sur un SQLite migré par `migrations.ts`. |
| Rendu **WebKit/Safari réel** | **NON TESTÉ** | Seul Chromium est installé ; les gabarits iPhone/iPad sont émulés sous Chromium. Validation externe sur matériel Apple. |
| Installateur `.exe` signé, mise à jour du parc | **NON TESTÉ** | `npm run dist` exige `keys/` et une signature Authenticode ; générer une clé casserait le parc installé. |
| Total JS client (3,29 Mio) | **BUDGET RELEVÉ** *(15/08/2026)* | Le budget est passé de 3,00 à 3,46 Mio pour débloquer `release:publish`, **sur décision de l'exploitant après que la campagne l'eut refusé**. Le produit n'a pas été allégé d'un octet : la dette de 3,29 Mio demeure entière, et le contrôle ne mesure plus qu'une non-régression à partir de ce nouveau plancher. Motif complet dans `perf-budget.json` (`raisedWhy`). |
| Comportement sous Windows en conditions réelles | **NON TESTÉ** | La campagne s'est déroulée sous Windows 10, mais l'application **packagée** n'a pas été lancée : seul le serveur de développement l'a été. |

---

## 8. Actions requises avant mise en production

1. ~~**Redéployer le cloud**~~ — **FAIT le 15/08/2026.** Migrations Neon
   appliquées jusqu'à `20260814200000_workshop_half_hours`, puis déploiement
   construit sans aliasage (`--skip-domain`), vérifié en isolation, promu
   (`dpl_CRsSnWNwZG7cwgtwueniuMgM1nN7`). Voir `AUDIT_PROGRESS.md`.
2. **Publier le poste** via `npm run release:publish` (nouvelle commande
   unique : contrôle de version → porte complète → build desktop → signature).
   Publier l'installateur ne met **jamais** la PWA à jour, et inversement.
3. **Fournir des identifiants E2E** sur un environnement de recette pour lever
   le `BLOCKED` du §7.

---

## 9. Réserve de méthode

Deux erreurs de ma part, corrigées et signalées ici parce qu'elles auraient pu
fausser une conclusion :

- la recette responsive annonçait « mécanicien : OK » en ayant mesuré la page
  de **connexion** (`/mechanic` redirige sans session). Le script relève
  désormais l'URL réellement atteinte et refuse de conclure sur un écran
  redirigé ;
- un remplacement PowerShell a doublement encodé `ScheduleBoard.tsx`
  (accents corrompus). Réparé par décodage inverse, vérifié octet par octet, et
  le dépôt entier scanné : aucun autre fichier touché.

---

## 10. Mise en production du 15/08/2026 — preuves (instantané figé)

### Déploiement promu

```
ID       : dpl_CRsSnWNwZG7cwgtwueniuMgM1nN7
URL      : garagesite5-qqk6mrnv7-garage-flows.vercel.app
Domaine  : app.garageflows.fr
Décompte : 3296 verts / 0 rouge / 28 ignorés (3324)
```

Le code portant ces 3 296 tests verts — décompte historique arrêté au
15/08/2026 — est **exactement** celui qui tourne en production : construit avec
`--skip-domain` (aucun aliasage automatique), vérifié en isolation, puis promu
**sans reconstruction**. Les tests ajoutés depuis ne sont pas en production.

### Contrôles sur le domaine public

| Route | Résultat |
|---|---|
| `/api/health` | 200 — `{"status":"ok"}` (exécute un `SELECT 1` réel) |
| `/api/auth/providers` | 200 |
| `/login` | 200 |
| `/api/license/status` | 200 — passe par `enforceRateLimit()`, donc Upstash a répondu |
| `/clients/login` | 200 |

Journaux d'exécution : **aucune erreur** — ni validation d'environnement, ni
Upstash/Redis, ni instrumentation.

### Lecture d'une vraie table PostgreSQL — réserve levée

La réserve « aucune route lisant une **table** n'a été sollicitée » est close.

```
POST /api/license/check   { deviceToken: <inexistant>, installId, version, platform }
→ 200 en 0,5 s   {"allowed":true,"status":"unknown","deviceRequired":true}
```

Chaîne de preuve, vérifiée dans le code : un `deviceToken` présent emprunte le
chemin 1 → `validateDeviceToken()` exécute
`prisma.licenseDevice.findUnique({ where: { tokenHash } })` sur **PostgreSQL** →
introuvable → `{ ok:false, code:'device_unknown' }` →
`deviceFailureResponse('device_unknown')` retourne exactement ce JSON. Une panne
d'infrastructure aurait produit `infraFailure()`, soit un **503**.

La sonde est **strictement en lecture** : sur ce chemin, `validateDeviceToken`
n'exécute qu'un `findUnique` et retourne avant tout `update`, `create` ou
journal d'audit — vérifié ligne à ligne (`src/lib/license/devices.ts:339-340`).

### Délai Upstash

`UPSTASH_REDIS_TIMEOUT_MS` est **absente** de Vercel Production (vérifié avant
et après déploiement). Le délai effectif est donc le défaut, **1500 ms** —
exactement la valeur qui était codée en dur avant que le réglage ne devienne
configurable. Aucun changement de comportement.
