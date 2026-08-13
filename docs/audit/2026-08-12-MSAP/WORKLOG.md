<!-- doc-numbers: journal -->
<!-- Journal de mesures DATÉES : chaque compte de tests cité est le résultat
     d'une exécution horodatée de cet audit, et non une revendication d'état
     courant. L'état courant fait foi dans docs/audit/FINAL_VERIFICATION_BASELINE.md. -->

# JOURNAL DE TRAVAIL — MSAP GarageFlows V31

Journal reprenable après interruption (§9). Base : `e0a2ef7`.
Voir `BASELINE.md` (état initial figé) et `FINDINGS.md` (registre GF31-AUD-*).

---

## Lot 1 — Baseline et remise en état de l'environnement

**Objectif.** Figer l'état initial et obtenir des gates de référence dignes de foi.

**Constats.**
- `node_modules` contenait **0 entrée** (élagué par un `npm run dist` antérieur).
  Les premières tentatives de gate exécutaient donc des binaires du cache `npx`,
  pas ceux du projet : `npx tsc` répondait « This is not the tsc command you are
  looking for » et `npx vitest` échouait sur `MODULE_NOT_FOUND`. **Aucun résultat
  antérieur au `npm ci` n'est retenu.** Rétabli : 591 paquets.
- Le répertoire de travail (Bureau) **n'est pas un dépôt git** ; le dépôt réel est
  `C:\Users\Mathys\.claude\jobs\2a11bc5b\tmp\repo`. Comparaison fichier à fichier
  avec retours chariot normalisés : **aucune divergence de code source**
  (10 différences, toutes des artefacts générés : `src/generated/server-client`,
  `__pycache__`, `tsconfig.tsbuildinfo`).
- `.env` est **identique à `.env.example`** et `keys/` est **absent** : c'est un
  environnement PROPRE, sans secret. Cela vaut validation « clean environment »
  (§180) et détermine ce qui est `BLOCKED_EXTERNAL`.

**Métriques recalculées.** 149 routes API · 626 fichiers `src` · 178 fichiers de
test · 58 scripts · 42 modèles Prisma desktop / 46 serveur · 16 migrations
PostgreSQL · 202 entrées dans `src/lib/migrations.ts` · 20 occurrences de
`skip`/`skipIf` (toutes justifiées par une dépendance externe : PostgreSQL admin,
Redis, Python, `keys/`, identifiants E2E, ou conditionnées au viewport).

**Gates de référence.**

| Gate | Résultat |
|---|---|
| `npm run type-check` | PASS |
| `npm run lint` | PASS |
| `npm test` | **FAIL** — 1 échec (→ GF31-AUD-001) |
| `npm run check:consistency` (13 contrôles) | PASS |
| `npm run check:perf-budget` | échoue faute de `.next/static` — exige `npm run build` d'abord, comportement attendu |

---

## Lot 2 — Vague 1 d'audit adversarial

**Méthode.** 12 auditeurs indépendants (cloisonnement multi-tenant ×3, autorisation
par rôle, licences, monnaie, stock, factures/devis, Electron/updater, secrets,
synchronisation, portail/XSS/uploads), chacun tenu de citer fichier + ligne +
extrait réel, puis **réfutation** de chaque finding P0/P1 par un sceptique
indépendant chargé de le démolir. 37 agents, 0 erreur, ~15 min.

**Récolte.** 60 findings uniques : **8 P0**, **19 P1**, **29 P2**, **4 P3**.
Six des huit P0 convergent sur une seule cause racine (GF31-AUD-003) — trois
auditeurs l'ont trouvée séparément.

---

## Lot 3 — Corrections P0 et P1 (première série)

Chaque correction suit le même protocole : reproduire → corriger la cause racine
→ test qui échoue avant / passe après → auditer la famille du bug (§156) →
**tenter de casser sa propre correction** par mutation (§140).

### GF31-AUD-001 — CI structurellement rouge · P1 · FIXED / VERIFIED
`forgery-resistance.test.ts:89` lisait `keys/public.pem` sans garde, alors que
`keys/*.pem` est gitignoré et non suivi. `npm test` échouait donc sur **tout clone
neuf**, y compris en CI (`ci.yml:163`), ce qui empêchait l'exécution de toutes les
étapes suivantes (build, perf-budget, audit-ci, npm audit). Garde alignée sur la
vérification jumelle du dépôt. → suite verte en environnement propre.

### GF31-AUD-002 — Bons de commande fournisseur · P1 · FIXED / VERIFIED
`action: 'create-orders'` écrit du v2 (objet `{schemaVersion:2, lines:[…]}`),
`action: 'transition'` lisait du v1 (tableau) par `JSON.parse` nu →
`TypeError: lines.filter is not a function` → **HTTP 500 et stock jamais
incrémenté à la réception**. Les tests existants passaient parce que leurs
fixtures utilisent l'ancien format. Correction par parsing versionné, test de
parcours complet **sans fixture** (l'écrivain de production fabrique la donnée),
et **règle 3 ajoutée à `check:money-json`** interdisant tout `JSON.parse` nu de
ces champs — vérifiée par mutation.

### GF31-AUD-003 — Prise de contrôle du garage d'un tiers · **P0** · FIXED / VERIFIED
`authenticateGarageLicense` ne comparait le garage revendiqué que si un
rattachement existait déjà — or `LicenseKey.garageId` est NUL à l'état nominal
côté cloud. Une licence garage valide non rattachée pouvait donc lire, écrire et
**supprimer** les interventions, photos et notes d'un autre garage, et se
rattacher **définitivement** à lui via `/api/sync/portal`.
Correction en trois volets : verrou de réservation
(`isGarageClaimedByAnotherLicense`, rejoué **dans** la transaction de
rattachement), `requireBound` sur les routes qui n'établissent pas de miroir, et
usage systématique de l'identité issue de la licence (`claimedGarageId` renommé
pour rendre la distinction lisible). 9 tests dédiés ; mutation : neutraliser les
gardes fait tomber exactement les 2 tests d'attaque.

### GF31-AUD-004 — Écriture de fichier arbitraire · **P0** · FIXED / VERIFIED
`savePhoto` dérivait l'extension du fichier du type MIME **fourni par le client**.
Un type `x/..\..\..\..\evil.bat` produisait une extension contenant des
séparateurs de chemin que `path.join` normalisait : sortie du dossier des photos,
contenu arbitraire. Atteignable depuis `/api/mechanic/jobs/[id]/photos`, donc
par le rôle le moins privilégié du produit. Liste blanche fermée MIME →
extension, validation du sous-dossier, et vérification de confinement avant
écriture. 20 tests sur un vrai dossier temporaire ; mutation : le code d'origine
fait tomber 13 tests.

### Gates après ce lot

| Gate | Avant | Après |
|---|---|---|
| `type-check` | PASS | PASS |
| `lint` | PASS | PASS |
| `npm test` | 1 échec · 1897 tests | **PASS · 1927 tests** (+30) |
| `check:consistency` | PASS | PASS |

---

---

## Lot 4 — Corrections P1 (deuxième série)

### GF31-AUD-005 — `recordMac = NULL` contourne l'anti-altération · P1 · FIXED / VERIFIED
`verifyRecordMac` distingue MAC faux (`tampered`) et MAC **absent** (`missing`).
Les trois chemins GARAGE (`activate`, `check`, `status`) ne bloquaient que sur le
premier. Or effacer une colonne est plus simple que forger un HMAC : mettre
`recordMac = NULL` puis repasser `status` de `revoked` à `active` neutralisait la
protection entière. Le dépôt appliquait déjà la bonne règle sur le chemin
MÉCANICIEN, commentaire à l'appui — un chemin sur deux. Politique centralisée
dans `recordIntegrityUsable()`.

### GF31-AUD-006 — MAC admin incohérent · P1 · FIXED / VERIFIED
Les deux routes d'administration recalculaient le MAC **sans** `parentLicenseId`
ni `mechanicId`, alors que ces champs entrent dans le message signé dès qu'ils
sont non nuls. Conséquence : suspendre, révoquer ou réactiver une clé mécanicien
attribuée la rendait définitivement « altérée », donc inutilisable, avec une
fausse alerte de compromission au journal. Mutation : 6 tests sur 7 tombent sans
la correction.

### GF31-AUD-009 — Matrice d'autorisation décorative · P1 · FIXED / VERIFIED
Aucune route de facturation n'appelait `can()` : tout utilisateur authentifié
émettait, modifiait, encaissait et supprimait des factures, alors que la matrice
réserve `invoice:manage` à MANAGER/OWNER. Et le verrou `financial:read` posé sur
`/api/finance`, `/api/profitability`, `/api/forecast`, `/api/export/fec` et
`/api/copilot/*` se contournait en lisant `/api/invoices`, qui servait les lignes
brutes **coût d'achat inclus**. Correction : garde `invoice:manage` sur les
mutations (conversion devis→facture comprise) + projection `redactLineCosts()`
qui retire la marge aux rôles sans `financial:read`, sans leur fermer la route.

### GF31-AUD-014 — Factures annulées comptées en chiffre d'affaires · P1 · FIXED / VERIFIED
L'export FEC filtrait `status: { not: 'draft' }` : les factures **annulées**
produisaient des écritures de vente (706) et de TVA collectée (445710). Le
fichier remis à l'administration fiscale surdéclarait donc CA et TVA. Test sur
base réelle vérifiant les **montants**, pas seulement l'absence du numéro.

### Effets de bord traités honnêtement

Trois fixtures de test ont dû être complétées — aucune assertion affaiblie :
- deux simulacres de `record-mac` n'exportaient pas la nouvelle politique
  d'intégrité (la route importait `undefined`) ;
- `document-numbering.test.ts` construisait une session **sans rôle**, situation
  qui n'existe pas en production : avec un refus par défaut, elle est légitimement
  rejetée.

### Gates après ce lot

| Gate | Résultat |
|---|---|
| `type-check` | PASS |
| `lint` | PASS |
| `npm test` | PASS — 175 fichiers, 1942 tests |
| `check:consistency` (13 contrôles) | PASS |

La baseline canonique `docs/audit/FINAL_VERIFICATION_BASELINE.md` n'a pas pu être
régénérée ici : `scripts/generate-verification-baseline.mjs` exige un dépôt git
pour horodater le commit de mesure, or le répertoire de travail n'en est pas un.
Les documents de cet audit portent donc le marqueur `doc-numbers: journal` prévu
par `check-docs-consistency` pour les journaux de mesures datées. À régénérer
depuis le dépôt lors de la synchronisation finale.

---

---

## Lot 5 — Corrections P1 (troisième série)

Décision d'exploitation enregistrée en préalable : *« les réceptionnistes ne
facturent pas, garde la matrice telle quelle »* (2026-08-12). La garde
`invoice:manage` de GF31-AUD-009 est donc le comportement **voulu** ; la matrice
`authz.ts` reste inchangée.

### GF31-AUD-007 — Appropriation de la licence garage d'un tiers · P1 · FIXED / VERIFIED
Le commentaire du code affirmait qu'un `plid` signé empêchait un autre garage de
s'approprier une licence. Faux : le `plid` prouve à quelle licence garage la clé
mécanicien appartient, pas que celui qui la présente a le droit d'en disposer.
Quiconque détenait la clé mécanicien d'un tiers l'enregistrait dans son garage
et, la licence parente n'étant pas encore rattachée, se l'appropriait
**définitivement**. Nouvel accesseur `activeGarageLicenseId()` : la licence
parente revendiquée doit être celle sous laquelle l'installation tourne
réellement (claim `lid` du cookie `gf_session` signé).

### GF31-AUD-011 — XSS stocké à l'impression de l'ordre de réparation · P1 · FIXED / VERIFIED
Le document est écrit par `doc.write()` dans une iframe de **même origine** :
sous Electron, un `<script>` y tourne dans le renderer. Nom du client,
téléphone, adresse, véhicule, immatriculation, notes, libellés de lignes,
références de pièces et URL de signature étaient interpolés bruts. Échappement
complet + `safeImageSrc()`, plus un garde-fou **à la source** qui échoue si une
interpolation brute réapparaît.

### GF31-AUD-013 — Aucune mise à jour installable depuis l'application · P1 · FIXED / VERIFIED
Le processus principal exige un manifeste signé Ed25519 dès qu'une clé de
vérification est embarquée. Le manifeste était bien produit et diffusé, mais les
**deux** interfaces d'installation ne le déclaraient ni ne le transmettaient :
dans la configuration sûre, chaque tentative échouait sur « Mise à jour non
signée ». Le mécanisme de sécurité était correct — son alimentation manquait.

### Gates après ce lot

| Gate | Résultat |
|---|---|
| `type-check` | PASS |
| `lint` | PASS |
| `npm test` | PASS — 177 fichiers, 1962 tests |
| `check:consistency` (13 contrôles) | PASS |

---

---

## Lot 6 — Corrections P1 (quatrième série)

### GF31-AUD-008 — Liaison matérielle signée non revérifiée · P1 · FIXED / VERIFIED
La liaison existe à deux endroits : la colonne `hwid` de la ligne, et le claim
`hwid` **signé** du jeton. Seule la première était contrôlée quand la ligne
existait déjà. Or `record.hwid` peut devenir nul sans aucune altération de base
(pierre tombale de `revoke-by-key`, `PATCH` admin avec `hwid: null`). Un jeton
volé, pourtant signé pour une machine précise, s'activait alors partout. Les deux
liaisons connues doivent désormais tenir.

### GF31-AUD-012 — Mot de passe SMTP inenregistrable sur le poste · P1 · FIXED / VERIFIED
`/api/email` refuse correctement d'enregistrer un mot de passe sans
`GF_SMTP_CIPHER_KEY` (503). Mais le bloc `env` transmis au serveur Next.js
interne ne la fournissait pas, alors qu'il donne bien `NEXTAUTH_SECRET`,
`GF_DB_MAC_SECRET`, `GF_INTERNAL_EXPORT_KEY` et `GF_PHOTOS_DIR`. Configurer
l'envoi d'e-mails était donc **impossible sur le poste**. Clé désormais résolue
comme le secret de session — fichier distinct, valeur d'environnement forte
prioritaire, et surtout **stable** entre démarrages (§105).

### GF31-AUD-015 — Facture inannulable après suppression d'une pièce · P1 · FIXED / VERIFIED
Deux défauts enchaînés : `StockMovement.part` est en `onDelete: Cascade`, donc
supprimer une pièce efface son journal ; et `reconcile()` levait un 409 dès
qu'une pièce à restituer manquait — alors que son propre commentaire annonçait
« on ne bloque pas l'annulation pour autant ». Résultat : blocage définitif.
Désormais la suppression d'une pièce **mouvementée** est refusée (409
`PART_HAS_HISTORY`, message actionnable), et la restitution ignore proprement ce
qui n'existe plus au lieu de figer l'opération comptable.

### Gates après ce lot

| Gate | Résultat |
|---|---|
| `type-check` | PASS |
| `lint` | PASS |
| `npm test` | PASS — 180 fichiers, 1979 tests |
| `check:consistency` (13 contrôles) | PASS |

---

---

## Lot 7 — Corrections P1 (dernière série) — **plus aucun P0 ni P1 ouvert**

### GF31-AUD-010 — Verrou d'immutabilité non verrouillant · P1 · FIXED / VERIFIED
La relecture « ANTI-TOCTOU » dans la transaction était un simple `findFirst` :
elle ne verrouille rien. Sous PostgreSQL en READ COMMITTED, deux transactions
concurrentes franchissent donc toutes deux le verrou. `SELECT … FOR UPDATE`
conditionné à `isPostgresDatabase()`, comme le fait déjà
`PATCH /api/admin/licenses/[id]`. Corollaire traité : les réponses de
`POST`/`PATCH` factures et devis renvoyaient encore le coût d'achat — la
projection de GF31-AUD-009 ne couvrait que les `GET`.

### GF31-AUD-016 — Arbitrage entre deux horloges différentes · P1 · FIXED / VERIFIED
`incoming.updatedAt` vient de l'horloge du POSTE, `mirrorUpdatedAt` de celle du
SERVEUR. Un poste en avance de quelques minutes gagnait donc systématiquement
l'arbitrage et écrasait en silence le statut et le chronomètre du mécanicien. Le
poste annonce désormais son heure, le serveur ramène l'horodatage dans sa propre
référence, et la compensation est bornée à 24 h — au-delà, une horloge faussée ne
doit pas décider.

### GF31-AUD-017 — Photos jamais rapatriées, interventions détruites · P1 · FIXED / VERIFIED
Curseur commun aux deux flux retenant le PLUS RÉCENT : les photos d'un garage
bavard en commentaires étaient définitivement sautées → on retient le plus
ancien. Et le cloud purgeait la fenêtre sur la base d'une remontée **tronquée** à
500 interventions, détruisant le surplus à chaque synchronisation sans jamais le
recréer → le poste annonce `truncated`, le serveur suspend alors la purge.

### GF31-AUD-018 — Lien de vérification d'e-mail jamais envoyé · P1 · FIXED / VERIFIED
Le jeton était généré et stocké « pour envoi ultérieur » — envoi inexistant. Le
client ne pouvait donc jamais vérifier son adresse, `clientId` restait NULL, et
le portail n'affichait rien. Envoi réel via `sendGarageMail()` ; l'échec n'empêche
pas l'inscription mais n'est jamais présenté comme un succès.

### GF31-AUD-019 — Portail inutilisable en multi-garage · P1 · FIXED / VERIFIED
`resolveGarageId(null)` ne devine le garage que s'il n'y en a **qu'un**. Les
pages de connexion et d'inscription n'envoyaient jamais `garageSlug` : sur le
déploiement PWA, multi-tenant par construction, les deux échouaient
systématiquement. Convention `?garage=<slug>`, mémorisée en session et propagée
dans les liens internes.

### Gates après ce lot

| Gate | Résultat |
|---|---|
| `type-check` | PASS |
| `lint` | PASS |
| `npm test` | PASS — 184 fichiers, 2016 tests |
| `check:consistency` (13 contrôles) | PASS |

---

---

## Lot 8 — Facturation électronique (§80-103)

**Décision d'architecture prise avec l'exploitant** (2026-08-12) : connecteur
**générique configurable** pour plateforme agréée, plutôt qu'un adaptateur dédié
à un éditeur nommé. Motif : les 130+ plateformes agréées exposent chacune une API
propriétaire sous contrat, sans spécification publique commune. Coder en dur les
routes de l'une aurait exigé d'**inventer** des chemins d'API — ce que §81
interdit. Ce qui varie est donc de la configuration explicite ; tout le reste est
réellement implémenté.

### Catalogue — les plateformes fictives ont disparu
`scripts/refresh-einvoicing-catalog.mjs` importe le registre des plateformes
agréées depuis le jeu de données ouvert data.gouv.fr (ODbL, republication du
registre DGFiP). **135 plateformes** retenues ; 13 entrées au statut
d'immatriculation inconnu **écartées** plutôt qu'inventées. La provenance et
l'autorité de référence (impots.gouv.fr) sont affichées à l'écran. Les méthodes
d'authentification, absentes de la source, ne sont pas fabriquées.

### Connecteur — `src/lib/einvoicing/adapters/generic-pa.ts`
OAuth2 `client_credentials` avec cache de jeton cloisonné par garage, ou clé API.
Requêtes HTTP réelles. Un test de connexion n'est jamais rendu `ok` sans échange
réseau ; un envoi sans identifiant de suivi est un **échec** ; un statut non
reconnu devient `unknown`, jamais `accepted`.

### Chaîne d'envoi — `src/lib/einvoicing/submit.ts`
Validation fail-closed → modèle canonique en centimes entiers → CII profil
Factur-X MINIMUM → empreinte SHA-256 → **clé d'idempotence réservée AVANT
l'appel réseau** → plateforme → identifiant externe → statut → persistance
(`EInvoiceTransmission`, `EInvoiceEvent`, `EInvoiceAuditEvent`).

Le point qui compte (§96) : la réservation précède l'appel, donc le cas « la
plateforme accepte, la réponse se perd, l'utilisateur réessaie » ne produit pas
de doublon. **Preuve : 20 envois concurrents de la même facture → une seule
soumission.**

### Routes et interface
`GET/PUT/DELETE /api/einvoicing/connection`, `POST …/connection/test`,
`POST/GET /api/einvoicing/invoices/[id]/submit`. Rôles : `settings:manage` pour
la connexion, `invoice:manage` pour l'émission, `financial:read` pour la lecture.
L'onglet Réglages offre le parcours complet ; les secrets ne sont jamais
réaffichés et laisser un champ vide conserve la valeur en base.

### Deux points corrigés en cours de route
- Mon sondage du manifeste d'environnement énumérait les **index** d'un tableau
  au lieu des noms : j'ai conclu à tort que les 10 variables e-facturation
  manquaient. Elles y sont, avec `autoManage: false` — §103 satisfait. Le fichier
  reformaté par mon script a été restauré à l'identique.
- Mes routes auraient renvoyé un **500 opaque** sur une installation poste (les 4
  modèles sont cloud-only) : elles répondent désormais `501 SERVER_ONLY`.

### GF31-AUD-023 — le catalogue partait dans le navigateur · P2 · FIXED / VERIFIED
Effet de bord mesuré de mon propre travail, et non défaut préexistant : importer
le registre depuis `catalog.ts` — module partagé avec l'onglet e-facturation —
embarquait ses ~54 Ko dans le bundle client, soit **+78 Ko sur le plus gros
chunk**, ne laissant plus que **102 octets** sous le budget de performance.
Données déplacées dans `catalog-data.ts` (serveur) ; `catalog.ts` ne garde que
types et fonctions pures. Le navigateur reçoit déjà le catalogue en projection
réduite par `/api/einvoicing/status`. `check:perf-budget` repasse avec marge.

### Statut honnête (§101)
`IMPLEMENTATION_COMPLETE` + `PRODUCTION_EXTERNAL_VALIDATION_REQUIRED`.
Aucun bac à sable de plateforme réelle n'a été exercé — cet environnement n'a
aucun identifiant (BASELINE §1.2). Ce n'est donc **pas**
`OFFICIAL_SANDBOX_VERIFIED` : un simulacre ne vaut jamais bac à sable officiel.

### Gates après ce lot

| Gate | Résultat |
|---|---|
| `type-check` · `lint` | PASS |
| `npm test` | PASS — 187 fichiers, 2075 tests |
| `check:consistency` (13 contrôles) | PASS |
| `npm run build` (production) | PASS |

---

---

## Lot 9 — Véhicules de prêt (premier lot P2/P3)

### GF31-AUD-022 — Réservation de prêt : disponibilité, dates et montants · P2/P3 · FIXED / VERIFIED
Trois défauts du même formulaire, corrigés ensemble parce qu'ils partagent la
route `POST /api/loaner-reservations` :

- **Aucun contrôle de disponibilité** (§64) : le même véhicule pouvait être
  réservé deux fois sur la même période, et le second prêt restait invisible.
  Le contrôle de chevauchement vit désormais **dans** la transaction, précédé
  d'un `SELECT … FOR UPDATE` sur le véhicule sous PostgreSQL — sans ce verrou,
  deux lectures « libre » se croisent. Seules les réservations vives
  (`reserved`, `active`) bloquent : une réservation rendue ou annulée libère.
- **Dates validées uniquement côté navigateur** : période inversée acceptée,
  date illisible persistée en `Invalid Date`. Refus en 400 désormais.
- **Montants non finis enregistrés à 0 €** : `toScaled`/`toCents` renvoient 0
  pour une valeur non finie — repli défensif justifié dans la couche monétaire,
  mais qui effaçait silencieusement tarif et caution. Refus en 400.

11 tests (`src/integration/loaner-availability.test.ts`), dont un test de
**concurrence réelle** (deux `POST` simultanés → une seule réservation).

### Gates après ce lot

| Gate | Résultat |
|---|---|
| `type-check` · `lint` | PASS |
| `npm test` | PASS — 188 fichiers, 2092 tests |
| `npm run build` (production) | PASS |

---

---

## Reprise du 2026-08-13 — vérification de l'état trouvé

Le travail a été interrompu **pendant** le lot 9 : les lots 9 et le volet
GF31-AUD-023 du lot 8 n'étaient pas journalisés. Reconstitués ci-dessus à partir
du code et des horodatages (§9 : le travail doit être reprenable).

**Gates rejoués ce jour, sur le code trouvé sur disque :**

| Gate | Résultat |
|---|---|
| `npm run type-check` | PASS |
| `npm run lint` | PASS |
| `npm test` | **1 fichier en échec** — voir ci-dessous |
| `npm run check:consistency` (13 contrôles) | PASS |
| `npm run check:perf-budget` | PASS — 2,64 MiB / 3,00 MiB, plus gros chunk 468,6 KiB / 512 KiB |
| `npm run check:desktop-audit` | PASS — aucune vulnérabilité high/critical non dérogée |
| `npm run db:desktop:validate` | PASS |
| `npm run db:server:validate` | **ÉCHEC** — `DIRECT_URL` absente (→ GF31-AUD-025) |

L'échec de `npm test` porte sur `src/integration/suppliers.test.ts` :
`Hook timed out in 30000ms` dans le `beforeAll` qui lance `npx prisma db push`.
Rejoué **seul**, le même fichier passe en 11,3 s. La cause n'est donc pas une
régression fonctionnelle mais le **coût d'amorçage** de la suite : 24 fichiers
d'intégration lancent chacun le CLI Prisma, et sous charge le `hookTimeout` de
30 s — déjà relevé une fois de 10 à 30 s pour ce motif exact — est de nouveau
dépassé. Traité comme un défaut de fiabilité de gate (§141), pas comme du bruit :
enregistré en GF31-AUD-024.

---

---

## Lot 10 — Triage P2/P3 et vague 2 adversariale (2026-08-13)

**Méthode.** Deux campagnes menées en parallèle, avant toute modification, pour
que les preuves portent sur le même état du code :

* **Triage** — les 33 findings P2/P3 de la vague 1 rejugés contre le code
  ACTUEL par 10 auditeurs indépendants, puis chaque finding jugé encore ouvert
  soumis à un sceptique chargé de le démolir. 20 agents, 0 erreur.
  Résultat : 5 déjà corrigés par les lots P0/P1, 2 réfutés, **26 confirmés**.
* **Vague 2 (§179 PASS 2)** — 11 attaquants lancés CONTRE les corrections des
  lots 1 à 9, avec la consigne explicite de chercher contournement, régression,
  garde incomplète ou faux succès ; réfutation indépendante de chaque finding.
  22 agents, 0 erreur. Résultat : **14 confirmés, 33 réfutés**.

**Le résultat qui compte.** La vague 2 a trouvé un **P1 dans une correction
écrite par cet audit** : la clé d'idempotence e-facturation réservée avant
l'appel réseau n'était jamais libérée, si bien qu'un envoi raté — un 401 sur une
clé pas encore activée, par exemple — rendait la facture **définitivement
intransmissible**, avec un message affirmant qu'elle avait été transmise. Et le
test livré avec la correction figeait ce comportement comme correct.
C'est précisément ce que « essaie de casser tes propres corrections » veut dire.

**Corrections de ce lot.** GF31-AUD-025 à 041 — détail complet, cause racine,
reproduction et preuve dans `FINDINGS.md` :

| Domaine | Findings |
|---|---|
| Facturation électronique | 033 (P1), 034, 035, 036, 037, 038 |
| Véhicules de prêt | 026, 027, 028, 031 |
| Stock | 029, 030 |
| Portail client | 032, 039, 040 |
| Updater | 041 |
| Gates / reproductibilité | 025 |

**Gates après ce lot**

| Gate | Résultat |
|---|---|
| `npm run type-check` | PASS |
| `npm run lint` | PASS — 0 avertissement |
| `npm test` | PASS — **191 fichiers, 2158 tests** (+67 depuis la reprise), 35 ignorés |
| `npm run check:consistency` (13 contrôles) | PASS |
| `npm run check:perf-budget` | PASS |
| `npm run check:desktop-audit` | PASS |
| `npm run db:desktop:validate` · `db:server:validate` | PASS |

---

---

## Lot 11 — Fiabilité des gates, artefact et rapport final (2026-08-13)

### GF31-AUD-024 — La suite de tests était sensible à la charge de la machine · P2 · FIXED / VERIFIED

Vingt-cinq suites d'intégration lançaient chacune `npx prisma db push` dans leur
`beforeAll`. Le `hookTimeout` avait déjà été relevé de 10 à 30 s pour ce motif ;
il a de nouveau été dépassé ce matin sur `suppliers.test.ts` — qui passe pourtant
**seul** en 11,3 s. Relever un délai déplace le seuil, il ne corrige rien (§151).

Le schéma est désormais construit **une fois** par empreinte de `schema.prisma`,
puis copié (`src/test-utils/prepare-test-db.ts`). Concurrence gérée sans verrou :
chaque processus construit dans un fichier temporaire puis tente de le renommer ;
le perdant utilise le modèle du gagnant.

**Mesure avant / après**, sur la même machine :

| | Avant | Après |
|---|---|---|
| Durée de `npm test` | 54,0 s | **16,2 s** |
| Temps de tests cumulé | 604 s | **83 s** |
| Démarrages du CLI Prisma | 25 | **1** |

### Artefact Windows — arrêté par une garde, à raison

`npm run dist` s'arrête sur `❌ keys/public.pem introuvable — artefact non
distribuable`. Ce n'est pas un défaut : c'est `post-build.js` qui refuse de
produire un installateur privé de l'ancre de confiance des licences.

Fabriquer une paire de clés ici pour « débloquer » aurait réécrit l'ancre publique
embarquée dans le code, donc la confiance de tout le parc installé (§161).
**Aucune clé n'a été générée.** Ce qui a pu être vérifié sur la charge utile
produite (`.next/standalone`) : aucun `.env`, aucune clé privée — les deux
correspondances au motif `BEGIN PRIVATE KEY` sont du code de la bibliothèque
`jose` qui **vérifie** le format PKCS#8. Statut retenu :
`BLOCKED_EXTERNAL_WINDOWS_RUNTIME`.

### Rapport final

`RAPPORT-FINAL.md` — 32 sections, verdict **`CONDITIONALLY READY`** avec les
cinq conditions de passage au verdict le plus favorable, chacune chiffrée en
effort.

### Gates à la clôture

| Gate | Résultat |
|---|---|
| `npm run type-check` · `npm run lint` | PASS |
| `npm test` | PASS — **192 fichiers, 2162 tests**, 35 ignorés justifiés |
| `check:consistency` (13 contrôles) · `check:docs` | PASS |
| `check:perf-budget` · `check:desktop-audit` | PASS |
| `db:desktop:validate` · `db:server:validate` | PASS |
| `npm run build` (production) | PASS |
| `npm run dist` | `BLOCKED_EXTERNAL` — `keys/` absent |

---

---

## Lot 12 — Clôture des P2 (2026-08-13)

Les quatre P2 encore ouverts corrigés. Deux d'entre eux ont révélé, **pendant**
leur correction, un défaut que le finding d'origine ne décrivait pas.

### GF31-AUD-042 — Manifeste signé absent de 2 sources de mise à jour sur 3 · FIXED / VERIFIED
La publication locale par la Zone Administrateur et le repli GitHub ne
produisaient aucun manifeste — donc aucune installation possible dès qu'une clé
de vérification est embarquée. GF31-AUD-013 avait corrigé le TRANSPORT du
manifeste ; sa PRODUCTION manquait. Désormais : la publication accepte le
manifeste signé de l'éditeur (refus motivé à la publication si le fichier n'en
est pas un), et toute mise à jour sans manifeste est annoncée `installable:
false` — les écrans ouvrent le téléchargement manuel au lieu de promettre une
installation dont l'échec est certain.

### GF31-AUD-043 — Plan de contrôle mort sur tout le parc packagé · FIXED / VERIFIED
`resolveRemoteBase` ne lisait que `GF_LICENSE_SERVER`, absente d'une
installation packagée : crashs, notifications et accusés de réception sortaient
**en silence**. Même règle que l'autorité de licence, importée du même module
pour qu'elles ne divergent pas. L'ancien test verrouillait le défaut — il exigeait
`null` sans distinguer développement et production.

### GF31-AUD-044 — Suppressions non propagées · FIXED / VERIFIED
Pierres tombales explicites : table `JobTombstone` (poste et serveur),
migrations SQLite `201`/`202` et PostgreSQL `20260813000000_job_tombstone`,
écriture dans la même transaction que la suppression, transmission indépendante
de la fenêtre, effacement sur accusé de réception seulement. Modèle SQLite livré
re-baseliné : **202 migrations, 0 en attente**.

### GF31-AUD-045 — Acceptation de devis sans preuve · FIXED / VERIFIED
L'acceptation portail produit un certificat scellé (empreinte du contenu,
horodatage, IP, agent) dans la même transaction que le statut. La lecture
distingue un accord client d'un statut posé par le garage et revérifie que la
preuve porte sur le document affiché aujourd'hui.
**Défaut supplémentaire trouvé en corrigeant** : `accepted → refused` est une
transition autorisée — le garage pouvait transformer un accord en refus tout en
conservant la preuve de l'accord. Toute sortie de l'état attesté invalide
désormais la preuve, sauf `accepted → converted`.

### Gates après ce lot

| Gate | Résultat |
|---|---|
| `npm run type-check` · `npm run lint` | PASS |
| `npm test` | PASS — **195 fichiers, 2192 tests**, 35 ignorés |
| `check:consistency` (13 contrôles) | PASS |
| `check:sqlite-template` | PASS — 202 migrations, 0 en attente |
| `check:pg-migrations` · `check:converge-additive` | PASS |
| `db:desktop:validate` · `db:server:validate` | PASS |

---

---

## Lot 13 — Clôture des P3 (2026-08-13)

Les 18 P3 encore ouverts corrigés (les 5 autres l'avaient été en chemin). Détail
complet et preuves dans `FINDINGS.md` (« Clôture des P3 »).

| Domaine | Findings |
|---|---|
| Facture / devis | 046 (écriture hors schéma), 047 (devis bloqué après suppression de sa facture), 048 (conversion sans journal d'audit), 049 (identité de l'acheteur non scellée) |
| Stock / monnaie | 050 (barème importé à 0 €), 051 (réception arrondie en silence), 052 (quantité 0 devenue 1) |
| Licences | 053 (politique de version inopérante), 054 (import sans signature ni MAC), 055 (HWID V1 rejeté par le client), 056 (secret du MAC recalculable) |
| Electron / reset | 057 (redirections non revalidées), 058 (clé de chiffrement locale régénérée) |
| Portail / RBAC | 059 (annuaire du personnel exposé), 060 (énumération de comptes), 061 (garage perdu à la redirection), 062 (« Aucune facture » trompeur), 063 (onglet e-facturation sans droits) |

Deux notes de portée, écrites plutôt que tues : **056** élève le coût de
l'attaque sans la fermer à un administrateur local (un scellement asymétrique
serait nécessaire), et **058** ne change rien à la rotation contrôlée, qui reste
réservée au processus dédié.

**Effet de bord traité :** ma première version du test de réception écrivait
`linesJson` à la main — `check:money-json` l'a refusée, à raison (règle posée par
GF31-AUD-002). Le test passe désormais par le sérialiseur de production, ce qui
le rend d'ailleurs plus fidèle.

### Gates après ce lot

| Gate | Résultat |
|---|---|
| `npm run type-check` · `npm run lint` | PASS |
| `npm test` | PASS — **199 fichiers, 2248 tests**, 35 ignorés |
| `check:consistency` (13 contrôles) | PASS |
| `npm run build` · `check:perf-budget` | PASS |

---

---

## Lot 14 — Artefact Windows (2026-08-13)

### `npm run dist` sur le dépôt de travail — arrêté par sa garde

```
✅ static assets copied (47) · public dir (9) · Prisma client (14)
✅ secrets retirés du package : .env (jamais distribués)
✅ DB template copied → standalone/prisma/garageflow-template.db
❌ keys/public.pem introuvable — artefact non distribuable.
EXIT=1
```

Ce n'est pas une panne : `post-build.js` refuse de produire un installateur
privé de l'ancre de confiance des licences. Cet environnement est propre
(BASELINE §1.2). **Aucune clé n'a été générée dans le dépôt de travail** :
fabriquer une paire ici réécrirait l'ancre publique embarquée dans le code —
donc la confiance de tout le parc installé (§161).

### Artefact REPRÉSENTATIF construit en copie isolée

Pour vérifier ce qui l'est sans clé de production : copie du dépôt hors arbre de
travail, paire ECDSA P-256 **de test** générée dans cette copie seulement,
`keys:sync` pour que la copie soit cohérente avec elle-même, puis `npm run dist`.
Le dépôt de travail n'a pas été touché.

`EXIT=0` — installateur produit, `check:artifact-secrets` PASS
(501 fichiers + installateur inspectés).

| Contrôle | Résultat |
|---|---|
| **Fuses lus SUR le binaire** | **PASS** — 7 fusibles conformes au plan : `RunAsNode=false`, `EnableNodeOptionsEnvironmentVariable=false`, `EnableNodeCliInspectArguments=false`, `EnableCookieEncryption=true`, `OnlyLoadAppFromAsar=true`, `EnableEmbeddedAsarIntegrityValidation=false` (choix documenté), `GrantFileProtocolExtraPrivileges=true` (doit rester vrai) |
| Secrets dans les ressources | PASS — 546 fichiers scannés, 0 trouvaille |
| Aucun `.env` empaqueté | PASS — racine + resources + standalone |
| Clé PRIVÉE non empaquetée | PASS — `resources/keys` = `public.pem` seul (le filtre `extraResources` tient) |
| Manifeste d'intégrité | PASS — 249 fichiers couverts, version 1.1.0 |
| `check:artifact-secrets` | PASS |
| Installateur produit | `GarageFlows Setup 1.1.0.exe`, SHA-256 `0384936b…c21b` |
| Binaire applicatif | `GarageFlows.exe`, SHA-256 `3c6340c5…d151` |
| Raccourci bureau à l'installation | **NON VÉRIFIÉ** — exige une installation réelle |

### GF31-AUD-064 — les fuses étaient demandés, jamais vérifiés · P2 · FIXED / VERIFIED

`afterPack.js` appelle `flipFuses` et le build affiche « ✓ Electron Fuses
appliqués ». Lire le code qui DEMANDE n'est pas vérifier le RÉSULTAT : une
montée de version d'`@electron/fuses`, un `afterPack` qui échouerait sans faire
échouer le build, ou un artefact reconstruit à la main produiraient exactement
le même message. §115 l'interdit explicitement.

`scripts/check-artifact-fuses.mjs` relit désormais le fil de fusibles **dans
l'exécutable empaqueté** et le compare au plan de `fuse-config.js` — une seule
source de vérité, pas une liste recopiée qui divergerait. Câblé dans
`npm run dist`, après `electron-builder`. Sans artefact : NON EXÉCUTÉ, jamais
vert en silence.

**Ma première version de ce contrôle a menti.** Elle comparait les valeurs du
fil à des booléens sans les décoder : `getCurrentFuseWire` rend des CODES
D'OCTET (48 = `'0'`, 49 = `'1'`, 114 = `'r'`). Elle annonçait donc trois
fusibles « désactivés » sur un binaire parfaitement conforme. Le décodage est
maintenant explicite, commenté, et verrouillé par un test — un contrôle de
sécurité qui se trompe est pire que pas de contrôle : il use la confiance.

### Deux faux positifs écartés, preuve à l'appui

* **URL PostgreSQL avec identifiants** dans `schema-engine-windows.exe` : la
  correspondance est `postgres://postgresql://`, deux libellés de schéma
  d'URL voisins dans la table de chaînes du moteur Prisma, suivis d'octets
  binaires dont l'un vaut `@`. Aucun identifiant. Le scan de motifs
  d'identifiants ne s'applique plus aux binaires tiers ; le matériel
  cryptographique, lui, y reste traqué — il ne peut pas apparaître par accident.
* **Taille de l'installateur (491 Mo)** : non représentative. La copie isolée
  utilise `node_modules` en JONCTION, ce qui a conduit le traçage de fichiers de
  Next à embarquer `electron/dist/electron.exe` (180 Mo) dans
  `standalone/node_modules`. Le `standalone` du dépôt de travail (140 Mo) n'en
  contient pas. Le poids réel de l'installateur reste donc à mesurer sur une
  vraie machine de build.

### Ce qui reste `BLOCKED_EXTERNAL`

| Élément | Pourquoi |
|---|---|
| Artefact **distribuable** | exige `keys/` de production ; l'artefact construit ici porte une clé de TEST et n'est pas installable chez un client |
| Raccourci bureau, cycle install → update → uninstall → reinstall, préservation des données (§116-118) | exige une installation réelle sur un poste Windows. Non exécutée : elle écrit dans `%LOCALAPPDATA%`, crée des raccourcis, enregistre un désinstalleur et pourrait heurter une installation GarageFlows existante |
| Poids et contenu exacts de l'installateur de production | voir ci-dessus |

---

---

## Lot 15 — Release gate final (2026-08-13)

`npm run release:gate` — 15 contrôles enchaînés, le « dernier mot avant un tag ».

### Résultat brut, sur le répertoire de travail

```
✅ TypeScript (tsc --noEmit)                        OK
✅ ESLint                                           OK
✅ Gardes de cohérence (check:consistency)          OK
❌ Suite de tests + baseline machine + humaine      ÉCHEC — exit 1
✅ Cohérence documentaire (post-baseline)           OK
⏭️  Tests PostgreSQL réels                           NON EXÉCUTÉ — TEST_POSTGRES_URL absent
⏭️  Migrations PostgreSQL sur base neuve             NON EXÉCUTÉ — TEST_POSTGRES_URL absent
⏭️  Rate-limit distribué (Redis réel)                NON EXÉCUTÉ — TEST_REDIS_URL absent
✅ Audit dépendances production (high/critical)     OK
✅ Audit runtime desktop empaqueté (Electron)       OK
✅ Manifeste de release (commit-bound)              OK
❌ Vérification d'artefact                          ÉCHEC — exit 1
❌ Empaquetage + vérification d'artefact RÉEL       ÉCHEC — exit 1
✅ Build de production (next build)                 OK
✅ Budget de performance (bundle client)            OK

❌ GATE ÉCHOUÉ : 3 contrôle(s) obligatoire(s) en échec.
```

### Diagnostic : une seule cause racine, environnementale

Les trois échecs remontent au même fait — **le répertoire de travail n'est pas
un dépôt git** (BASELINE §1.1) :

| Étape | Message réel | Cause |
|---|---|---|
| Suite de tests + baseline | `fatal: not a git repository` | **La suite elle-même passe** (rapport JSON écrit). C'est `generate-verification-baseline.mjs` qui échoue : il horodate la mesure par le commit |
| Vérification d'artefact | `buildId` manquant · `git.commit` non conforme · « `.env` présent dans l'artefact » | Sans `.git`, `verify-artifact` bascule en MODE ARTEFACT et signale — à raison, dans ce mode — le `.env` de développement. La règle est correcte, c'est le classement du répertoire qui ne l'est pas |
| Empaquetage ZIP | `git archive HEAD` → status 128 | Exige git par construction |

### Vérification de ce diagnostic — plutôt que de l'affirmer

Le code AUDITÉ a été déposé dans un dépôt git neuf
(`HEAD = f1b08a6f575bd83e3ce406202d1c0c92ad738b51`), et les trois étapes
rejouées telles quelles :

```
✅ Manifeste de release          → 1.1.0+f1b08a6f5
✅ Vérification d'artefact       → « Mode repository : commit manifeste == HEAD »
                                   « Aucun .env réel embarqué »
✅ Empaquetage + vérification    → garageflows-1.1.0-f1b08a6f5.zip (+ .sha256)
                                   969 fichiers extraits SANS .git, vérifiés en mode artefact
✅ Baseline régénérée            → 2255/2290 tests, Prisma résolu 5.22.0
✅ check-docs-consistency        → cohérent après régénération
```

Les trois contrôles passent dès que git est présent. **Aucun défaut produit** :
`.env` n'est pas suivi par git (`.gitignore:18`), il ne part donc jamais dans
l'artefact — la vérification en mode artefact réel vient de le prouver sur un
ZIP réellement extrait.

### Ce qui reste à faire au moment du merge

`docs/audit/FINAL_VERIFICATION_BASELINE.md` du répertoire de travail date encore
du 2026-08-09 (commit `bcfd1d9`, 1541 tests). La régénération fonctionne — elle
vient d'être exécutée et donne 2255/2290 — mais elle n'a **pas** été recopiée
ici : elle porterait le commit `f1b08a6` d'un dépôt jetable, c'est-à-dire une
identité de build qui n'existe nulle part. Une baseline canonique doit désigner
un commit réel (§150).

**À faire dans le dépôt réel, au merge :** `npm run verify:baseline`, qui
régénère la baseline machine ET le bloc AUTO du document canonique avec le vrai
commit. Les documents de cet audit portent d'ici là le marqueur
`doc-numbers: journal` prévu pour les mesures datées.

### Contrôles non exécutés — jamais réputés verts

PostgreSQL réel, migrations sur base neuve, rate-limit Redis : le gate les
affiche `NON EXÉCUTÉ` et le dit explicitement (« ils ne sont PAS réputés
verts »). C'est le comportement attendu (§3).

---

---

## Lot 16 — Tests E2E Playwright (2026-08-13)

### Exécution nominale — `npm run test:e2e`

```
54 passés · 36 ignorés · EXIT=0   (1,0 min)
```

Le serveur de développement est démarré par la configuration elle-même. Les 36
ignorés sont **les tests d'application** : sans `E2E_EMAIL` / `E2E_PASSWORD` /
`E2E_LICENSE`, la suite ne mesure que la page de connexion. C'est un choix
explicite du dépôt — « jamais de faux vert » — mais cela signifie que la porte
UX (§176) ne portait, en l'état, sur rien de l'application.

### Recette AUTHENTIFIÉE montée pour cet audit

Pour lever ces 36 ignorés : bac à sable isolé, base dédiée seedée, et **licence
GF2 signée par la paire de TEST** de la copie (jamais la clé de production ; le
dépôt de travail n'a reçu aucune clé). La licence a été vérifiée contre l'ancre
de la copie avant usage.

| Exécution | Résultat |
|---|---|
| Suite complète, limites de débit par défaut | 77 passés · **6 échecs** · 9 ignorés |
| Suite complète, limites desserrées pour la recette | 79 passés · **2 échecs** · 9 ignorés |
| `--project=mobile-landscape` seul | **15 / 15** |

**Les tests d'application s'exécutent donc réellement** — planning, barre de
navigation mobile, assistant, menu « Plus », changement d'orientation, contraste
des champs de contrôle véhicule — sur les six gabarits.

### Diagnostic des échecs : ni la mise en page, ni le produit

Trois hypothèses testées, deux écartées par l'expérience :

| Hypothèse | Test | Verdict |
|---|---|---|
| Compilation à la demande de `next dev` | rejeu sur serveur chaud | **écartée** — les échecs persistent, mais changent de gabarit |
| Saturation par le parallélisme | `--workers=2` | **écartée** — 3 échecs, sur un autre gabarit |
| Sièges de licence insuffisants (5 pour 6 gabarits) | licence à 20 sièges | **écartée** — 6 échecs |
| **Protections de débit déclenchées par 6 contextes sur une IP** | limites desserrées | **confirmée en partie** — 6 échecs → 2 |

La preuve décisive vient du cliché de page au moment de l'échec : la page servie
est **l'écran de connexion**. La session a été perdue en cours de suite, et les
tests d'application mesuraient donc l'écran de connexion — exactement le piège
que le `globalSetup` documente pour l'écran d'activation.

Un défaut de mise en page se reproduirait sur un gabarit lancé seul. Ce n'est
pas le cas : `mobile-landscape` passe 15/15 isolément.

### Ce qui a été inscrit au dépôt

`e2e/README.md` — recette authentifiée complète et vérifiée, avec la mise en
garde nécessaire pour interpréter un échec : *« un échec reproductible sur un
gabarit lancé seul est, lui, un vrai défaut »*. **Aucune limite de production
n'a été modifiée** : le desserrage vaut pour la recette, pas pour le produit.

### Incident d'environnement — et sa réparation

La construction de l'artefact représentatif (lot 14) utilisait `node_modules` en
**jonction** vers le dépôt de travail. L'empaquetage electron-builder a élagué
ce répertoire — **à travers le lien** —, vidant le `node_modules` du dépôt. Même
piège que celui déjà consigné en mémoire projet, et même symptôme qu'à
l'ouverture de l'audit (BASELINE §2.1).

Réparé par `npm ci` (591 paquets, identique à la baseline), puis vérifié :

| Contrôle | Résultat |
|---|---|
| `npx tsc --noEmit` | PASS |
| `npm test` | **4 passages consécutifs** — 200 fichiers, 2255 tests |
| `check:consistency` | PASS |

Le tout premier `npm test` après `npm ci` a signalé 2 échecs dans
`record-mac-admin-routes.test.ts` ; le fichier passe seul (7/7) et les quatre
passages suivants sont propres. Non reproductible, consigné ici plutôt
qu'effacé.

**Leçon retenue et appliquée** : plus aucune jonction `node_modules` pour un
travail qui empaquette. Le bac à sable E2E utilise une **copie réelle**.

---

## Lot 17 — Baseline canonique régénérée (2026-08-13)

### GF31-AUD-065 — La baseline canonique ne pouvait plus être régénérée · P3 · FIXED / VERIFIED

`generate-verification-baseline.mjs` appelait `git rev-parse` **sans repli**.
Hors dépôt, la génération s'arrêtait sur `fatal: not a git repository` — et le
document qui se déclare « single canonical source of truth » restait **figé sur
la mesure du 2026-08-09** : 1541 tests annoncés, contre 2255 réellement mesurés.
Une baseline périmée fait autorité en se trompant ; c'est exactement la
divergence que ce fichier existe pour empêcher (§165).

**Correction.** L'identité git devient optionnelle et **explicite** :
`gitIdentity: false`, `commit: null`, avertissement à l'écran. Les comptes
restent MESURÉS. Le relâchement porte sur la BASELINE, **jamais sur l'artefact** :
`verify-artifact` continue d'exiger 40 hex — un test verrouille la distinction.

**Prose canonique alignée** : le document affirmait encore « PostgreSQL 16.13 et
Redis 7 locaux réels » et un gate « 11/11 OK ». Ces mesures du 2026-08-07 sont
conservées comme preuve, mais datées et assorties de la mention explicite que la
regénération du 2026-08-13 n'en disposait pas.

### Résultat

```
docs/audit/FINAL_VERIFICATION_BASELINE.md — bloc AUTO régénéré
  Test files 206 · discovered 2294 · passed 2259 · failed 0 · skipped 35
  Commit : n/a · Branche : n/a · Généré (UTC) : 2026-08-13T13:24:22Z
  Prisma résolu 5.22.0 (déclaré ^5.16.1)
```

| Gate | Résultat |
|---|---|
| `npm run type-check` · `npm run lint` | PASS |
| `npm test` | PASS — **206 fichiers, 2259 tests** |
| `check:docs` · `check:consistency` | PASS |

**Réserve inscrite dans le document lui-même** : l'identité de build est absente.
Les comptes sont réels, le commit ne l'est pas. `npm run verify:baseline` reste à
rejouer **depuis le dépôt** avant tout tag.

---

## Reste à faire

1. **Aucun finding ouvert** — P0, P1, P2 et P3 tous corrigés et vérifiés.
2. **Artefact distribuable** : rejouer `npm run dist` avec les `keys/` de
   production. Les fuses, le scan de secrets et l'absence de clé privée sont
   déjà vérifiés SUR UN BINAIRE RÉEL (lot 14) ; restent le raccourci bureau et
   le cycle install → update → uninstall → reinstall, qui exigent une
   installation sur poste Windows.
3. **E2E Playwright** : exécutés (lot 16) — 54/54 en mode public, et la suite
   AUTHENTIFIÉE montée et exercée sur les six gabarits (79/90). L'instabilité
   résiduelle est documentée dans `e2e/README.md` et n'est pas un défaut de mise
   en page. Concurrence **PostgreSQL réel** et **Redis** : toujours
   `BLOCKED_EXTERNAL` (ni base, ni Redis).
4. **`npm run verify:baseline` dans le dépôt réel, au merge** : la baseline est
   désormais à jour (lot 17) mais **sans identité de build** — seul le dépôt peut
   la lui donner.
5. **`npm run release:gate` depuis le dépôt** : les 3 échecs constatés hors dépôt
   sont environnementaux et ont été levés un par un dans un checkout git
   (lot 15).

## Où sont les preuves

| Élément | Emplacement |
|---|---|
| Registre brut de la vague 1 (60 findings) | hors dépôt — `…/Temp/claude/…/35c48505-…/scratchpad/findings.json` |
| Verdicts du triage P2/P3 (33) | hors dépôt — `…/c98db1b6-…/scratchpad/triage.json` |
| Findings de la vague 2 (47 bruts, 14 retenus) | hors dépôt — `…/c98db1b6-…/scratchpad/vague2.json` |
| Journaux de construction et de gates | hors dépôt — `…/c98db1b6-…/scratchpad/*.log` |

Ces fichiers ne sont pas versionnés à dessein : ce sont des mesures datées, pas
des documents de produit. Les findings **retenus** sont, eux, intégralement
repris dans `FINDINGS.md` avec leur reproduction.

## Points à trancher par l'humain

- **Rattachement d'une licence de remplacement.** Depuis GF31-AUD-003, une
  licence non rattachée présentée sur un garage déjà réservé est refusée — c'est
  le même geste que l'attaque, indiscernable sans autre preuve. Le cas légitime
  (renouvellement, réinstallation) doit passer par une action d'administration.
  À décider : exposer ce rattachement dans `/api/admin/licenses`, ou le traiter
  au support.
- **Clé de signature `2dcd21a7…`** : distribuée dans des installateurs
  antérieurs, remplacée par `a6dd7dcd…` le 2026-08-10 ; le cloud doit être
  redéployé AVANT toute nouvelle licence, sans quoi les activations sont refusées
  à distance. Hors périmètre de cet audit de code, mais bloquant en production.
