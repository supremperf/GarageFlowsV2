# GarageFlows — Remédiation phase 3 : Vercel, Neon, API, cron

**Date :** 2026-10-20
**Dépôt :** `supremperf/GarageFlowsV2` · branche **`test-100-pourcent-valide`**
**Base :** `4bfe1c0` · Commits de remédiation : `b5614f9`, `b0c5b31`
**Référence :** `artifacts/audit-2026-10-20/RAPPORT-VERCEL.md` (11 constats V-01 à V-11)

> Aucune valeur de secret ne figure ici. Noms de variables et empreintes tronquées uniquement.

---

## 0. Section 9 — chaîne GitHub : RÉSOLUE

Le blocage de départ était que le dossier de travail n'avait aucun `.git` : `git`
y remontait au répertoire personnel, dont le remote est un projet sans rapport.

Résolution, vérifiée : `gh` est authentifié comme `supremperf` (scope `repo`), le
dépôt `supremperf/GarageFlowsV2` existe, et la branche `arena/3b9ee17c-garageflowsv2`
(commit `4bfe1c0`, 19/10) **est la base exacte du dossier de travail** — son suffixe
correspond au nom du dossier. Un clone autonome a été créé
(`git rev-parse --show-toplevel` y renvoie le clone, pas le répertoire personnel),
la branche `test-100-pourcent-valide` créée depuis cette base, et les corrections
portées en normalisant les fins de ligne pour que le diff ne contienne **que** les
modifications réelles.

**La production est restée protégée tout du long** : `gh api repos/.../hooks`
retourne **aucun webhook**, donc le projet Vercel n'est pas connecté à GitHub et
**un push ne déclenche aucun déploiement**. Les deux commits ont été scannés avant
chaque push (34 valeurs sensibles du `.env` + motifs PEM / token Blob / URL PG
avec identifiants) : **aucune fuite**.

---

## 1. Les quatre P0

### V-01 — Variables d'environnement · **EN ATTENTE DE ROTATION** (décision prise)

**Cause.** Le projet `app.garageflows.fr` ne déclare aucune variable sur ses trois
environnements, alors que l'application en service en utilise. Les variables sont
attachées au déploiement actif mais ne sont plus déclarées : sur Vercel elles sont
résolues à la création du déploiement, qui survit à leur suppression.

**Inventaire établi** (manifeste, `requiredProduction=true`) : 9 variables, dont
**5 qu'aucune intégration ne peut fournir** — `DIRECT_URL`, `NEXTAUTH_SECRET`,
`GARAGEFLOW_API_KEY`, `DEVICE_TOKEN_PEPPER`, `GF_DB_MAC_SECRET`. Les 4 autres
viennent des intégrations Neon et Upstash, ou de la plateforme.

**Correction appliquée** : aucune sur Vercel — **par décision explicite de
l'exploitant** : roter d'abord, déclarer ensuite. Déclarer maintenant figerait dix
identifiants connus compromis dans la configuration. Le déploiement actuel continue
de fonctionner pendant ce temps.

**Outillage rendu opérationnel** (`b5614f9`) : `check-env-vercel.mjs` sait
désormais rapporter ce défaut — il en était incapable (voir V-05).

**État : NON VALIDÉ — action exploitant requise** (procédure :
`artifacts/audit-2026-10-20/PROCEDURE-ROTATION-SECRETS.md`).

### V-02 — Isolation Preview · **CORRIGÉ dans le code, provisionnement à faire**

**Cause racine, vérifiée.** `VERCEL_ENV` n'était lu **nulle part** dans le code hors
route de diagnostics : rien ne distinguait Preview de Production. Or les intégrations
Neon et Upstash sont attachées **au projet**, donc injectées dans les trois
environnements : sans surcharge, un Preview écrit dans les données clients.

**Correction** (`b0c5b31`, `src/lib/env.ts`) — une protection **active**, pas une note :

- `empreinteCibleBase(url)` : SHA-256 de l'hôte + chemin, **sans les identifiants**.
  Deux propriétés la rendent utilisable comme variable ordinaire : ce n'est pas un
  secret, et elle est **insensible au mot de passe**, donc elle survit à une rotation.
- `verifierIsolationPreview()` : en Preview, si la base visée porte l'empreinte de
  production → configuration refusée. Sur Vercel un Preview a `NODE_ENV=production`,
  donc `assertEnv` **lève** et la fonction ne sert aucune requête — fail-closed.
- `GF_PRODUCTION_DB_FINGERPRINT` déclarée `requiredProduction` pour que son absence
  soit **détectée** : une garde non provisionnée est une garde absente.

**Tests négatifs** (`isolation-preview.test.ts`, 11/11) — écrits à l'envers, ils
vérifient que la configuration **dangereuse échoue** :

| Cas | Attendu | Obtenu |
|---|---|---|
| Preview → base de production | refus | **refus** |
| Preview → production, mot de passe roté | refus | **refus** (piège d'une garde naïve) |
| Preview → branche dédiée | accepté | **accepté** |
| Production → sa propre base | accepté | **accepté** |
| Empreinte de référence absente | se tait, sans fausse assurance | **conforme** |
| `assertEnv` sur Preview dangereux (`NODE_ENV=production`) | **lève** | **lève** |

**Reste à faire (exploitant)** : créer la branche Neon dédiée, surcharger
`DATABASE_URL`/`DIRECT_URL` au niveau Preview, déclarer
`GF_PRODUCTION_DB_FINGERPRINT` sur les trois environnements. Calcul de l'empreinte
donné dans la note du manifeste.

**État : code VALIDÉ · infrastructure NON VALIDÉE.**

### V-03 — Cinq routes absentes · **CAUSE ÉTABLIE, pas un défaut de code**

**Cause racine.** Le commit `4bfe1c0` du **19/10** *ajoute* les routes
`/api/keygen/**` ; le déploiement de production date du **17/10**. Deux preuves
indépendantes que le code déployé est antérieur : le journal de build annonce
`Detected Next.js version: 14.2.35` (local : 15.5.27) et exécute
`… && next build` là où le `package.json` actuel finit par `node scripts/next-build.cjs`.

**Les routes ne sont pas cassées.** J'ai relu leur code :

- `/api/keygen/licenses` — `GARAGEFLOW_API_KEY` **refusée si absente ou < 16
  caractères**, en-tête vide refusé, `timingSafeEqual` après égalité de longueur,
  rate-limit `admin` en amont, 403 non révélateur. Le piège `'' === ''` que je
  soupçonnais est **impossible**.
- `/api/einvoicing/webhooks/[providerId]` — signature **HMAC du corps brut** avec le
  secret de la connexion du garage, fenêtre anti-rejeu de 5 min, 401 si absente ou
  fausse, aucune fuite dans les erreurs.
- `/api/internal/einvoicing/queue` — jeton dédié ≥ 32 caractères en `Bearer`,
  `timingSafeEqual`, **503 sans jeton configuré**, fermée si la fonctionnalité est
  désactivée, et limites métier explicites (jamais de reprise d'un `rejected`, max
  5 tentatives).

**Correction : redéployer** — mais **après V-01**, sinon le nouveau déploiement
refuse de démarrer (`assertEnv` est dans l'artefact compilé).

**État : NON VALIDÉ — bloqué par V-01.**

### V-04 — Tâches planifiées · **CORRIGÉ, et constat initial RECTIFIÉ**

**Rectification nécessaire.** Mon rapport Vercel affirmait que « rappels,
notifications, file e-invoicing et sauvegardes ne partent jamais d'eux-mêmes ».
**C'était faux**, et l'erreur venait d'un grep qui avait matché `scheduledDate` —
un champ métier — dans `/api/reminders/send`. La lecture des gardes donne :

| Route | Garde réelle | Verdict |
|---|---|---|
| `reminders/send`, `notifications/dispatch`, `jobs/pulse`, `vehicles/ct-alerts`, `warranties/alerts`, `parts/low-stock` | `withAuth` + `requireSession` | routes d'**interface** : un cron n'a pas de session et ne pourrait les appeler sans affaiblir leur garde |
| `internal/backup` | clé interne + **origine loopback** + 409 `SQLITE_ONLY` | sauvegarde du **poste desktop**, déclenchée par Electron — inatteignable depuis Vercel par conception |
| `einvoicing/webhooks/[providerId]` | HMAC | **poussé** par la plateforme, pas planifié |
| `admin/backups/**`, `admin/diagnostics` | déclencheurs d'exploitation nommés | `scripts/reset-garageflow.ps1`, pas des crons |
| **`internal/einvoicing/queue`** | jeton dédié | **seule** tâche réellement planifiée manquante |

L'inventaire autoritatif est `src/lib/__tests__/routes-sans-appelant.test.ts`, qui
exige un « DÉCLENCHEUR RÉEL » nommé pour toute route sans appelant. L'expiration des
licences est évaluée **à chaque vérification** (`verify.ts`, `state-machine.ts`) :
aucune tâche de balayage n'est nécessaire, et en ajouter une créerait deux sources
de vérité.

**Correction** (`b5614f9`) : `vercel.json` déclare **un** cron,
`/api/internal/einvoicing/queue`, à `17 * * * *`. `vercel.json` plutôt que `vercel.ts`
car `@vercel/config` n'est pas installé et un fichier ne portant que `crons`
n'écrase aucun réglage.

**Authentification du cron — point d'exploitation.** Vercel envoie
`Authorization: Bearer $CRON_SECRET` ; la route compare à `EINVOICING_QUEUE_TOKEN`
sans repli. **Je n'ai pas modifié la route** : son commentaire affirme « aucun repli
sur une autre clé », et élargir la frontière d'authentification d'une route sensible
pour un gain nul serait un mauvais échange. Les deux variables doivent donc porter la
**même valeur** ; `CRON_SECRET` est déclarée au manifeste avec cette contrainte, car
si elles divergent le cron reçoit 401 **en silence**.

**Tests** (`vercel-crons.test.ts`, 7/7) : cron déclaré, cible **existante**,
exportant GET ou POST, **authentifiée**, hors minute de pointe, et couplage déclaré
au manifeste. Détection de régression prouvée : cron orphelin → 4 échecs ;
minute 0 → 1 échec.

**État : code VALIDÉ · exécution réelle NON TESTÉE** — un cron ne s'exécute que sur
un déploiement de production, donc après V-01.

---

## 2. Les autres constats

| # | Constat | État |
|---|---|---|
| V-05 | `check:env-vercel` aveugle au défaut V-01 | **CORRIGÉ** |
| V-06 | `validateEnv()` ne couvre que 5 des 9 variables | **OUVERT** (mesuré : non contrôlées = `DIRECT_URL`, `GARAGEFLOW_API_KEY`, `GF_DB_MAC_SECRET`, `NEXTAUTH_URL`) |
| V-07 | Node 24 sur Vercel vs `engines <23` | **OUVERT — décision** |
| V-08 | Repli SQLite de `db.ts` | **NON RETENU** : neutralisé par `assertEnv` en production PWA |
| V-09 | Résidus dans l'équipe Vercel | **OUVERT — nettoyage console** |
| V-10 | Données personnelles hébergées aux USA (`iad1`, `us-east-2`) | **OUVERT — arbitrage RGPD** |
| V-11 | 5 variables Upstash inconnues du manifeste | **OUVERT — décision de conception** |

**V-05 — trois défauts cumulés, corrigés** (`b5614f9`) : pas de `--project` (échec
attribué à tort à `vercel login`) ; `presents.size === 0` traité en « format
inattendu / NON EFFECTUÉ », donc **le défaut le plus grave était le seul que le
contrôle ne savait pas rapporter** ; lecture de `stdout` seul alors que le CLI écrit
« No Environment Variables found » sur `stderr`. Vérifié : sans `--projet` →
diagnostic correct (exit 2) ; avec → **exit 1** énumérant les 9 manquantes.

**V-07 — analyse, et pourquoi je n'ai pas modifié `engines`.** `node:sqlite` n'est
utilisé que dans des **tests**, et `docs/CONFIG.md` documente la plage `<23` comme
une exigence du **lanceur de configuration Windows**, pas du runtime PWA. Relâcher
`engines` affaiblirait un contrat qui protège l'outillage local. La correction juste
est de **fixer Vercel sur Node 22.x** — réglage de projet, action exploitant.

---

## 3. Audit des 169 routes (section 7) — le résultat est largement POSITIF

158 routes revues par famille, puis les constats les plus graves **re-vérifiés à la
main**. Les tests d'isolation du dépôt ont été exécutés.

**Vérifié et trouvé sain** — ce sont des résultats, pas des vides :

- **Aucun contournement d'authentification** sur les 23 routes admin/internal/keygen.
  Le middleware exclut `/api/*`, donc chaque handler se protège lui-même : vérifié un
  par un.
- **Aucun IDOR sur les 53 routes métier.** Toutes portent un `garageId` issu de la
  **session** ; aucune n'accepte un `garageId` client ; aucune n'utilise
  `findUnique({ id: params.id })` nu. 64 tests d'isolation passent.
- **Traversée de chemin fermée deux fois** sur `/api/photos/[...path]` :
  assainissement par segment, puis contrôle par `path.relative`, plus une
  vérification d'appartenance en base bornée au garage de la session.
- **Jetons du portail** : JWT HS256 vérifiés contre un secret fail-closed et
  cloisonnés par `garageId`. Aucun IDOR trouvé sur les 21 routes.
- **Routes `/api/sync/**`** : l'identité vient toujours de la licence GARAGE GF2
  **signée**, jamais d'un `garageId` libre ; verrou anti-revendication rejoué dans la
  transaction d'écriture.

**Constats retenus** (écarts de durcissement, aucune faille d'authentification) :

1. **P3 — `/api/admin/licenses` sans limiteur** → **CORRIGÉ** (`b0c5b31`). C'étaient
   les deux seuls handlers de `admin/licenses/**` sans `enforceRateLimit`.
   *J'ai failli surévaluer ce constat* : le listing renvoie bien le jeton GF2 complet
   de chaque licence, et j'allais le signaler comme exfiltration de masse. Vérification
   faite, la console admin **utilise** `item.token` pour l'afficher et le copier
   (`src/app/admin/licenses/page.tsx:427,522`) : c'est une fonction délibérée du
   produit. Restreindre le `select` l'aurait cassée. La bonne correction était le
   limiteur, pas le `select`.
2. **P2 — compteur de débit partagé** entre huit routes `sync` et le chemin de
   vérification de licence : auto-blocage d'un poste démontrable par les constantes du
   code, et déni de service possible depuis une même sortie NAT. **OUVERT.**
3. **P2 — coût d'achat (la marge) accessible par quatre portes du stock** sans le
   contrôle `financial:read` que le projet applique pourtant sur six autres routes.
   **OUVERT.**
4. **P2 — correction GF31-AUD-050** (prix non numérique silencieusement enregistré à
   0 €) appliquée à `labor-operations/bulk-import` mais **pas** aux routes unitaires
   de la même famille. **OUVERT.**
5. **P2 — portail** : l'inscription distingue un courriel déjà inscrit par la forme de
   sa réponse (énumération de comptes) ; les trois routes qui re-vérifient le mot de
   passe n'ont **aucune** limitation de débit ; l'enrôlement 2FA n'exige pas de
   ré-authentification alors que sa désactivation l'exige. **OUVERT.**
6. **P3 — `/api/internal/migrate`** sans garde moteur ni `catch` : sur PostgreSQL
   l'erreur SQL s'échappe du contrat documenté. **OUVERT.**

**Réserve de méthode, à dire clairement.** La vérification adversariale prévue n'a
pas pu tourner (limite de session). J'ai re-vérifié personnellement les constats
décisifs — dont un **rectifié** (point 1) et un **écarté** (V-08) — mais les constats
2 à 6 reposent sur une seule lecture et doivent être re-vérifiés avant correction.

---

## 4. État final mesuré sur la branche

| Contrôle | Résultat |
|---|---|
| `tsc --noEmit` | **exit 0** |
| `eslint` | **exit 0** |
| `vitest run` (suite complète) | **exit 0** — 354 fichiers, **4341 réussis, 0 échec**, 37 ignorés |
| Scan de secrets sur `4bfe1c0..HEAD` | **aucune fuite**, aucun motif PEM / token / URL PG |

**Instabilité observée.** À une passe intermédiaire,
`src/integration/synchro-voie-de-retour.test.ts` a échoué, puis passé 3 fois sur 3
isolément et à la passe finale. Cause **non élucidée** — probablement un partage
d'état entre fichiers de test exécutés en parallèle. Ce n'est pas une régression de
ce travail (le fichier n'a pas été modifié), mais c'est un test **non déterministe**
à instrumenter : une suite qui échoue une fois sur trois ne prouve rien.

---

## 5. Ce qui reste à faire, dans l'ordre

Inversé, cet ordre casse la production.

1. **Roter** les 10 secrets compromis chez Neon et Vercel.
2. **Déclarer** les 9 variables sur le projet (Production), valeurs post-rotation.
3. Vérifier : `node scripts/check-env-vercel.mjs --environnement production --projet app.garageflows.fr` → **exit 0**.
4. **Branche Neon dédiée** à Preview + surcharge `DATABASE_URL`/`DIRECT_URL` + `GF_PRODUCTION_DB_FINGERPRINT` sur les trois environnements.
5. **Déployer en Preview** depuis `test-100-pourcent-valide` : la garde d'isolation doit se taire (base dédiée), et les 5 routes manquantes apparaître.
6. Tester le parcours keygen de bout en bout **avec une autorité de test** (section 6 — non abordée, bloquée jusqu'ici).
7. Promouvoir en Production **sur votre autorisation seule** ; le cron s'activera alors.
8. Fixer Vercel sur Node 22.x ; nettoyer les intégrations orphelines ; arbitrer V-10 et V-11.

**Ne rien faire sur le DNS** : les serveurs de noms restent chez Hostinger et les MX
pointent vers Google Workspace. Le ☓ affiché par Vercel est ici un piège — déléguer
les NS interromprait la messagerie.
