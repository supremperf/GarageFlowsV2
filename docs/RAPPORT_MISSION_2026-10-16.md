# Rapport de mission — 16/10/2026

> Correctif, optimisation et finalisation de GarageFlows. Ce document est un
> **compte rendu daté et mesuré** : chaque affirmation renvoie à une commande
> rejouable et à son résultat. Les comptes de tests faisant foi pour l'ensemble
> du dépôt restent tenus par `docs/audit/FINAL_VERIFICATION_BASELINE.md`
> (bloc auto-généré) — rien n'est dupliqué ici.

| Champ | Valeur |
|---|---|
| Date | 16/10/2026 |
| Version du logiciel | 1.1.0 (`package.json`) |
| Branche de travail | `arena/57f91c28-garageflowsv2` |
| Environnement de mesure | Linux x64, Node 22.22.3, npm 10.9.8 |
| Environnement cible | Windows x64, installeur NSIS utilisateur (sans droits administrateur) |

## 1. Cause réelle du blocage de `npm run dist` (« server.js NOT found »)

**Le fichier existait.** Il était produit **un niveau plus bas** que l'endroit
cherché : `.next/standalone/<chemin-relatif-du-workspace>/server.js`.

Next.js détermine la racine du workspace en remontant le système de fichiers ;
la présence d'un `package-lock.json` hors du dépôt (par exemple dans le dossier
utilisateur) suffit à la lui faire adopter. Tout le traçage de fichiers se décale
alors d'un niveau, et le script de post-build, qui cherchait `server.js` à un
emplacement supposé, ne le trouvait plus.

Masquer le message était le choix facile et le plus coûteux : l'installeur aurait
embarqué une sortie sans serveur, donc une application qui ne démarre pas.

Correctifs :

- `next.config.mjs` : `outputFileTracingRoot` est épinglé sur la racine du projet.
  La sortie redevient déterministe, quel que soit l'environnement.
- `scripts/lib/standalone-layout.cjs` : localisation réelle de la racine autonome
  (`server.js` + `node_modules`), partagée par le post-build et les vérifications.
  La disposition est **trouvée**, jamais présumée.
- `scripts/post-build.js` : inspecte le système de fichiers, échoue avec la
  disposition réellement observée, et n'annonce un succès qu'après avoir vu la
  sortie.

## 2. La chaîne de bout en bout, et ses onze étapes

`npm run dist` =

```
preflight:release → build → verify:standalone → electron-builder --win --x64
  → check:artifact-secrets → check:artifact-fuses → verify:installer
```

Correspondance avec les onze étapes exigées :

| # | Étape exigée | Où c'est fait | Bloquant |
|---|---|---|---|
| 1 | `prisma generate` | `build` (`prisma generate` + schéma serveur) | oui |
| 2 | `next build` | `build` | oui |
| 3 | vérification de la sortie autonome | `verify:standalone` | oui |
| 4 | pages statiques | `postbuild` → `verify:standalone` | oui |
| 5 | `public/` | `postbuild` → `verify:standalone` | oui |
| 6 | fichiers requis | `verify:standalone` | oui |
| 7 | préparation Electron | `postbuild` (copie de la sortie, purge) | oui |
| 8 | `electron-builder` | `electron-builder --win --x64` | oui |
| 9 | contrôle des secrets dans l'artefact | `check:artifact-secrets` | oui |
| 10 | contrôle des fuses | `check:artifact-fuses` | oui |
| 11 | contrôle de l'artefact final | `verify:installer` | oui |

Deux étapes ont été ajoutées **avant** la compilation :

- `preflight:release` vérifie les pré-requis (clé publique de vérification des
  mises à jour, version cohérente entre `package.json` et les sources, espace
  disque, cible Windows). Un pré-requis manquant coûte désormais quelques
  secondes au lieu de vingt minutes de compilation.
- Aucun script de la chaîne n'annonce un succès sans avoir lu le résultat ; aucun
  `catch` vide ne masque un échec.

```bash
node --test tests/build-dist-chain.test.cjs   # → 9/9
node --test tests/*.cjs                       # → 203 pass / 0 fail
node scripts/check-version.js                 # → ✅ 1.1.0
```

## 3. Installeur Windows : nom, version, désinstalleur

`package.json` → `build.win` / `build.nsis` :

- cible `nsis`, `--x64`, installeur **utilisateur** (`perMachine: false`,
  `allowElevation: false`, `requestedExecutionLevel: asInvoker`) : aucune demande
  de droits administrateur ;
- nom de fichier produit : `GarageFlows Setup <version>.exe`, la version venant
  de `package.json` (contrôlée par `scripts/check-version.js`) ;
- désinstalleur inclus (NSIS le génère) et raccourcis bureau + menu Démarrer ;
- `include: scripts/installer.nsh`, icône `icon.ico`.

`scripts/verify-installer.cjs` relit l'artefact réel dans `dist/` : présence du
désinstalleur, taille plausible, moteur NSIS, nom et version conformes. Un
artefact absent ou incomplet fait échouer la chaîne.

## 4. Barre de navigation

**Cause réelle.** Les rangées d'outils utilisaient `overflow-x: auto`. Or la
spécification CSS force l'axe orthogonal à `auto` dès qu'un axe ne vaut plus
`visible` : la barre défilait donc **aussi verticalement**. Molette, pavé
tactile, et `scrollIntoView` des navigations au clavier faisaient glisser les
libellés hors du bandeau — « Tableau de bord » apparaissait tronqué.

**Correctif.** `.gf-hscroll` : `overflow-x: auto`, `overflow-y: hidden`,
`flex-wrap: nowrap`, `overscroll-behavior`. Appliquée à la rangée d'outils du
`Header` et à la bande des mécaniciens du `ScheduleBoard`. Le défilement
horizontal reste disponible ; la barre ne passe plus à la ligne et ne bouge plus
verticalement.

## 5. Tableau de bord — vue globale des rendez-vous

`src/components/dashboard/AppointmentsSection.tsx`, montée par `Dashboard.tsx`
(pas un écran parallèle) :

- **toutes les dates**, ordre chronologique, jour de la semaine + date complète ;
- client, véhicule (marque, modèle, immatriculation), prestation, heure, statut ;
- recherche plein texte et filtres : client, véhicule, immatriculation, date,
  période, statut, ordre ; ligne dépliable ;
- ouverture de l'**intervention**, de la **fiche client** et de la **fiche
  véhicule** ; édition en ligne ; confirmation, achèvement, annulation selon les
  droits (`can(role, 'job:manage')`).

Réemploi strict de l'existant, aucune donnée ni table parallèle : `GET
/api/appointments` (filtres `status`, `date`, `from`/`to`, `clientId`,
`vehicleId`, `plate`, `q`, `order`, `limit`, `offset`, portée garage) et `PATCH
/api/appointments/[id]` (schéma Zod `UpdateAppointmentSchema`, contrôle de
disponibilité `validateSlot`, refus hors garage). Le contrat d'action existant
(`POST … {action}`) est inchangé.

## 6. Clients & messages

- Liste déroulante de clients réelle (`src/components/ClientPicker.tsx`) :
  recherche, nombre de véhicules, ouverture directe de la fiche, rafraîchissement
  après ajout ou modification (`clientsVersion`).
- **Seule l'entrée « Rendez-vous »** a été retirée de cet espace (barre d'outils
  et menu mobile). Aucune route, aucune donnée, aucun écran, aucune fonction
  n'a été supprimé : les rendez-vous restent accessibles depuis le tableau de
  bord.

## 7. Boutons de fermeture

- `.gf-close` : boîte réelle de 40 px (44 px sur pointeur grossier),
  `flex-shrink: 0`, curseur, focus visible ;
- le pseudo-élément qui élargissait la zone cliquable passait **au-dessus des
  voisins** et leur volait le clic : il est désormais en `pointer-events: none`
  (l'élargissement visuel est conservé, la capture du clic ne l'est plus) ;
- les 17 boutons de fermeture réduits à une icône portent un nom accessible
  (`aria-label="Fermer"`), vérifié par un test qui parcourt les composants.
- Le fond du volet Stock était `pointer-events-none` : les clics
  n'atteignaient rien. Le panneau reçoit les événements, le fond reste inerte.

## 8. Une seule page à l'écran, brouillons conservés

- Seize booléens indépendants (`isClientsOpen`, `isBillingOpen`, …) permettaient
  de superposer deux pages plein écran. Une variable unique
  `surface: Surface | null` les remplace : ouvrir une page **referme** la
  précédente, par construction. Le volet Stock est refermé au passage.
- Les saisies en cours (fiche client, réponse à un ticket, texte OCR, conversation
  du copilote, formulaire de garantie, main-d'œuvre, rappels) survivent au
  changement de page via `src/lib/ui/brouillon.ts`. Ces brouillons vivent en
  mémoire de session uniquement : un brouillon n'est pas un enregistrement, donc
  rien n'est écrit dans la base. Fermer la page par ✕ ou Échap est un abandon
  explicite : seuls les brouillons **de cette page** sont effacés.
- Aucune action de navigation ne déconnecte, ne ferme l'application ni ne remet
  les données à zéro.

## 9. Réglage « Lancer GarageFlows au démarrage de Windows »

- Mécanisme natif d'Electron (`app.setLoginItemSettings` /
  `app.getLoginItemSettings`), écriture dans la ruche utilisateur (`HKCU`) :
  aucun droit administrateur, aucune tâche planifiée, aucune élévation.
- **L'état affiché est relu depuis Windows après chaque écriture.** Si le système
  refuse ou neutralise l'entrée (Gestionnaire des tâches → Démarrage), l'écran
  l'annonce au lieu d'afficher un interrupteur « Activé » mensonger. Aucun
  miroir du réglage dans `gf_settings.json` : le registre est la seule source.
- Lancement via `--autostart` : la fenêtre ne vole pas le focus au démarrage de
  la session.
- Interface : onglet « Système » (`src/components/settings/SystemeTab.tsx`),
  messages d'erreur en français, repli explicite hors application installée
  (l'interrupteur n'est pas affiché s'il ne peut rien commander).

## 10. Un correctif, une vérification

Chaque correctif structurel de cette mission est accompagné d'un test qui échoue
si le mécanisme est retiré — pas d'un test qui se contente de constater que le
fichier existe :

```bash
npx vitest run src/lib/__tests__/ui-navigation-et-demarrage.test.ts   # 12/12 (nouveau)
npx vitest run src/lib/__tests__/portal-access-reachable.test.ts      # 104/104
npx vitest run src/lib/__tests__/ui-lossless-compaction.test.ts       # 2/2
npx vitest run src/lib/__tests__/env-manifest-drift.test.ts           # 8/8
npx vitest run src/lib/copilot/__tests__/copilot-chaine-complete.test.ts \
               src/lib/copilot/__tests__/conversation.test.ts          # 42/42
npx eslint src --ext .ts,.tsx                                          # 0 problème
```

`npx tsc --noEmit` : 249 erreurs, **ensemble identique** à la référence du dépôt
(aucune erreur apparue, aucune disparue). La compilation TypeScript est donc
employée comme contrôle de **non-régression** (diff de l'ensemble des erreurs),
jamais comme porte verte : ces 249 erreurs préexistantes (majoritairement des
types Prisma implicites dans des fichiers non touchés) restent à traiter, elles
sont antérieures à cette mission et hors de son périmètre.

### Mesure de la suite complète (exécutée le 16/10/2026, branche ci-dessus)

```
npx vitest run
  Test Files  84 failed | 247 passed | 5 skipped (336)
  Tests        3 failed | 3117 passed | 871 skipped (3991)
```

**Les trois tests en échec appartiennent tous au même fichier**
(`src/test-utils/__tests__/prepare-test-db.test.ts`) et au même mécanisme :
la construction de la base de test appelle `prisma db push`, qui doit
télécharger le moteur Prisma depuis `binaries.prisma.sh` — injoignable depuis cet
environnement. Les 84 fichiers signalés en échec le sont tous pour cette unique
cause, chacun sur sa première ligne qui monte une base (message identique :
`request to https://binaries.prisma.sh/... failed`). Aucun échec restant n'est
imputable au code applicatif après correction des quatre échecs réels de cette
mission (décompte et condensat du contenu UI, ancres du copilote, garde de la
chaîne de commandes, variable d'environnement non déclarée).

Sur une machine disposant du réseau nominal, ces 84 fichiers s'exécutent — la
vérification est à rejouer là-bas ; ce rapport ne présente aucun de leurs
résultats.

## 11. Audit de configuration et de dépendances

- `package.json` : version, `engines` (Node ≥ 22.12 < 23), scripts `dist`,
  `postbuild`, `verify:*`, `preflight:release` cohérents ; aucun paquet ajouté,
  retiré ou monté de version pendant cette mission.
- `package-lock.json` : la seule modification qu'une installation locale y avait
  introduite (métadonnées `dev`/`libc` selon la version de npm) a été **annulée** :
  le verrou redevient celui du dépôt, pour ne pas embarquer un changement
  involontaire dans un fichier de livraison.
- `npm audit` : **0 vulnérabilité** (production et développement) sur le verrou du
  dépôt ; `npm audit --omit=dev` : **0 vulnérabilité**. Aucun `--force`, aucune
  montée de version forcée, aucun avis ignoré en masse.
  À noter : l'onglet Dependabot de GitHub signale encore des avis sur la branche
  `main`, dont le verrou est plus ancien que celui de cette branche — l'écart
  entre les deux mesures est expliqué par cette différence de verrou, pas par une
  contradiction.
- `next.config.mjs`, `scripts/post-build.js`, `scripts/preflight-release.cjs`,
  `scripts/verify-*.cjs`, `scripts/sign-release-manifest.mjs`, `config-release.cjs`
  et la configuration `electron-builder` ont été relus ; les contrôles de
  cohérence de version ne sont pas contournables et `release:sign` refuse de
  démarrer sans ses arguments obligatoires (aucune paire de clés n'a été créée
  silencieusement ; la clé privée Ed25519 reste hors du dépôt, hors de
  l'installeur et hors du frontend).

## 11 bis. Plafond du JavaScript client : relevé, mesure à l'appui

Le budget de non-régression du JS client (`perf-budget.json`) était figé à
**3 625 984 octets**, avec 13 413 octets de marge sur la base de départ. Les trois
vues demandées le 16/10 coûtent **34 484 octets** (33,7 Kio) :

| Mesure (`next build` standard, JS client sur disque) | Octets |
|---|---|
| Base `9dcfc1d` | 3 612 571 |
| Branche (16/10/2026) | 3 647 055 |
| Écart | +34 484 (+33,7 Kio) |
| Ancien plafond | 3 625 984 |
| Nouveau plafond (mesure + 5 %, même convention que le relèvement du 15/08/2026) | 3 829 408 |

**Décision assumée, pas une correction** : le produit n'a pas été allégé, le
plafond est relevé, et le motif est écrit dans `perf-budget.json` (champ
`raisedWhy`) — même exigence de transparence que le relèvement précédent, dont la
traçabilité est conservée. Le contrôle garde son rôle : plafond de
non-régression, pas objectif de performance. La dette de 3,48 MiB demeure
entière ; sa réduction passe par l'allègement des dépendances (three.js, jsPDF,
date-fns sont les postes les plus lourds), pas par ce fichier.

Le garde-fou d'immutabilité est mis à jour sciemment en trois endroits
(`perf-budget.json`, `.github/workflows/ci.yml`, `tests/ci-required-gate.test.cjs`) :
un relèvement silencieux reste impossible, le plafond ne peut pas bouger sans que
ces trois points soient modifiés et relus.

## 11 ter. Un second blocage, ANTÉRIEUR à cette mission : l'exécuteur Windows

En exécutant la chaîne réparée sur un exécuteur `windows-latest`, un échec est
apparu **avant** `electron-builder`, dans `next build` lui-même :

```
glob error [Error: EPERM: operation not permitted, scandir 'C:\Users\runneradmin\Cookies']
Failed to compile.
Error: EPERM: operation not permitted, scandir 'C:\Users\runneradmin\Cookies'
```

**Ce n'est pas une régression de cette mission.** Le diagnostic du run
`38870935220` (commit `b118b14`, chaîne d'origine, avant réparation) porte la
**même erreur, au même endroit** : la compilation échouait déjà, ce qui explique
qu'aucun installeur n'ait jamais pu être produit par cette CI.

Mécanisme, établi par lecture du code et non par déduction : Next.js trace ses
dépendances avec `@vercel/nft`, qui **déplie `os.homedir()` en chemin littéral**,
puis — ne pouvant résoudre ce qu'on lui donne — élargit la recherche à
`<dossier personnel>/**/*` et la confie à `glob`. Le profil d'un exécuteur
Windows contient deux jonctions héritées (`Application Data`, `Cookies`) que le
système **refuse d'énumérer** : la recherche échoue en EPERM. Le produit, lui, ne
lit jamais ce dossier ; c'est un artefact de l'environnement d'exécution. C'est
aussi un défaut amont connu et documenté (vercel/next.js, discussion 62281).

Correctif retenu : l'étape de construction reçoit un dossier personnel **vide et
accessible** (`D:\gf-build-home`, créé juste avant, pour cette étape seulement).
Les caches (npm, Electron, electron-builder) ne bougent pas — `APPDATA` et
`LOCALAPPDATA` restent ceux de l'exécuteur.

**Ce que cela ne masque pas** : aucun contrôle n'est désactivé, aucun `try/catch`
n'enveloppe quoi que ce soit, et si la trace était réellement incomplète,
`verify:standalone` puis `verify:installer` échoueraient bruyamment, exactement
comme avant. La raison est écrite dans le workflow, à l'endroit du changement.

Sur un poste Windows ordinaire, cette précaution est inutile : le dossier
personnel y est accessible, et la compilation s'y déroule normalement — c'est
d'ailleurs ce que montre l'échec d'origine signalé par l'utilisateur
(« server.js NOT found »), qui suppose une compilation Next.js **réussie**.

### Note de mesure : `tsc --noEmit` et les substituts Prisma locaux

`npx tsc --noEmit` donne **249 erreurs** avec l'arbre tel qu'il est livré —
exactement le même ensemble que sur le commit de base : aucune régression n'est
imputable à cette branche. Avec les substituts Prisma locaux utilisés pour la
sonde de compilation (§11 quinquies), le même appel en signale **283** : les 34
de plus sont toutes des `Property '…' does not exist on type 'PrismaClient'`
(le substitut ne déclare pas les modèles) et les `unknown` de
`scripts/migrate-money-json.ts`. Aucune ne concerne un fichier modifié ici, et
aucune n'existe sur une machine où `npx prisma generate` a réellement tourné.

## 11 quater. Le dernier verrou de la CI Windows : un faux rouge dans MA vérification

Une fois la compilation réparée (§11 ter), l'exécuteur Windows est allé
**au bout de `next build`** — puis a échoué quelques secondes plus tard sur une
sortie que le post-build venait de déclarer complète :

```
  ✅ server.js found        (6.5 KB) → .next/standalone/server.js
  ✅ static assets copied   (242 files) → .next/standalone/.next/static
  ✅ public dir copied       (10 files) → .next/standalone/public
  ✅ Prisma client copied   (14 files) → standalone node_modules/.prisma
… puis :
❌ Sortie autonome Next.js inutilisable pour l’empaquetage.
   Dossier .next/standalone absent : la compilation Next.js n'a pas produit de sortie autonome
```

Deux affirmations **contradictoires** dans la même exécution : le post-build
copie dans `.next/standalone/server.js`, le vérificateur dit que
`.next/standalone` n'existe pas. C'est donc le vérificateur qui mentait, et non
la compilation. Deux défauts réels, de la même famille (un chemin composé deux
fois) :

1. `scripts/verify-standalone-build.cjs` appelait
   `inspectStandaloneLayout(STANDALONE)` alors que cette fonction de
   `scripts/lib/standalone-layout.cjs` **ajoute elle-même** `.next/standalone` à
   la racine qu'on lui donne : elle analysait donc
   `.next/standalone/.next/standalone`, toujours absente. Le contrôle échouait
   **systématiquement**, y compris sur une sortie parfaitement saine — un faux
   rouge qui refusait un installeur valide. (Il n'apparaissait pas ici : sans
   `next build` local, `.next` n'existe pas, et le message « dossier absent » est
   alors le bon.)
2. La liste des modules d'exécution contenait `node_modules/.prisma/client/index.js`
   tandis que la boucle préfixait elle aussi `node_modules/` : elle cherchait
   `node_modules/node_modules/.prisma/client/index.js` et signalait un manque
   inexistant. La liste vit désormais dans la lib (`MODULES_EXECUTION`) et
   `modulesExecutionManquants(appDir)` compose les chemins **une seule fois**.

Non-régression, exécutée réellement : `tests/build-dist-chain.test.cjs` construit
trois arborescences autonomes synthétiques et **exécute le vrai script** sur
chacune — sortie saine (exit 0, « Sortie autonome complète »), sortie absente
(exit 1, « .next/standalone absent »), sortie amputée de `static`, `public`,
`prisma/schema.prisma` et du moteur Prisma (exit 1, les quatre manques nommés
un par un). 13 tests passent dans ce fichier. Le script reste invoqué sans
argument par `npm run verify:standalone` ; l'argument de racine n'existe que pour
cette vérification.

Leçon retenue, et inscrite dans le code : un garde-fou qui échoue **toujours**
n'est pas un garde-fou, c'est un blocage. On l'a rendu exécutable sur des
arborescences de test pour qu'il prouve qu'il sait **accepter** une sortie saine.

## 11 quinquies. Premier vert de la chaîne sur une sortie autonome RÉELLE, et les deux faux positifs qu'il a révélés

Tant que `.next/standalone` n'existait pas ici, le post-build et le vérificateur
n'avaient jamais été confrontés à une vraie sortie : ils étaient exercés sur des
arbres de test, jamais sur le produit de Next.js. Une compilation Next.js
complète a donc été obtenue dans cet environnement — méthode exacte :

1. `src/generated/server-client` (client Prisma serveur, ignoré par git) obtient
   un substitut local exposant `PrismaClient` ;
2. `node_modules/.prisma/client/default.js` — le vrai moteur exige
   `binaries.prisma.sh`, injoignable — reçoit un substitut local ;
3. **temporairement**, `typescript.ignoreBuildErrors` est activé le temps du
   build (le type-check de Next s'arrête sinon sur `scripts/migrate-money-json.ts`,
   défaut antérieur sans rapport) ;
4. `npx next build`, puis `node scripts/post-build.js`, puis
   `node scripts/verify-standalone-build.cjs`.

Le dépôt a été remis à l'identique juste après (substituts restaurés depuis
`/tmp`, `next.config.mjs` recopié à l'octet) : **rien de cette méthode n'est
commité** et aucun de ces substituts n'entre dans un artefact livrable.

Résultat sans précédent dans l'histoire de ce dépôt :

```
> garageflow@1.1.0 postbuild
  ✅ server.js found        (6.5 KB) → .next/standalone/server.js
  ✅ static assets copied   (239 files) → .next/standalone/.next/static
  ✅ public dir copied       (10 files) → .next/standalone/public
  ✅ Prisma client copied   (10 files) → standalone node_modules/.prisma
> garageflow@1.1.0 verify:standalone
🔎 Sortie autonome : .next/standalone
✅ Sortie autonome complète (4 éléments vérifiés) — prête à être empaquetée.
```

Deux **faux positifs** du vérificateur sont apparus au passage, tous deux
visibles uniquement sur l'exécuteur Windows :

1. **La taille d'un dossier vaut 0 sur Windows.** `.next/static` (242 fichiers)
   et `public/` (10 fichiers) étaient déclarés « vide » et bloquaient
   l'empaquetage. Le contrôle compte maintenant le contenu réel d'un dossier
   (`dossierNonVide`), au lieu de lire `statSync(dir).size`.
2. **`next-auth` n'est pas copié : il est EMBARQUÉ.** Sur une vraie sortie
   autonome, `node_modules/next-auth` n'existe pas — `next, react, react-dom,
   @prisma/client` sont externalisés, `next-auth` ne l'est pas et part dans les
   morceaux compilés par webpack. Le vérificateur exige désormais
   **« copié OU embarqué »** : il cherche la chaîne d'exécution
   `next-auth.session-token` dans `.next/server/**/*.js`, marqueur que la
   minification ne peut pas retirer. Preuve dans les deux sens, exécutée :

   | Situation | Résultat du vérificateur |
   |---|---|
   | morceaux compilés présents (cas réel) | `✅ Sortie autonome complète` (exit 0) |
   | `node_modules/next-auth` seul | accepté (cas prévu si la stratégie change) |
   | ni l'un ni l'autre | `❌ module d’exécution absent de la sortie — (ni copié, ni embarqué) next-auth` (exit 1) |

Le garde-fou ne se contente donc plus d'échouer ou de passer : il a été **vu
accepter** une sortie saine et **vu refuser** une sortie amputée.

### Le serveur empaqueté DÉMARRE et sert l'application

Preuve complémentaire, faite sur cette sortie réelle, en lançant
`.next/standalone/server.js` avec l'environnement que `electron/main.js` fournit
sur un poste (`ELECTRON=1`, `NODE_ENV=production`, `DATABASE_URL`, `NEXTAUTH_URL`,
`NEXTAUTH_SECRET` unique par installation) :

| Requête | Réponse |
|---|---|
| `GET /login` | `200` — page HTML française |
| `GET /clients/login` | `200` — portail client |
| `GET /api/auth/providers` | `200` — `{"credentials":{…}}` (donc `next-auth` fonctionne **sans** `node_modules/next-auth`) |
| `GET /api/version` | `200` — `{"serverVersion":"1.1.0","apiVersion":2,…}` |

Au passage, cette vérification a confirmé un mécanisme de sécurité du démarrage :
sans `ELECTRON=1`, le serveur **refuse** de démarrer en exigeant les variables
d'une PWA multi-instance (`DATABASE_URL` PostgreSQL, `DEVICE_TOKEN_PEPPER`,
Upstash, `TRUST_PROXY_HEADERS`). C'est voulu (`estPwaDeProduction()`), et c'est
précisément l'environnement que `electron/main.js` renseigne — l'application
de bureau ne démarre pas « par accident » avec une configuration de serveur web.

## 12. Ce qui n'a PAS pu être exécuté ici, et pourquoi

L'environnement de développement de cette session n'a accès qu'à une liste
restreinte d'hôtes. Deux domaines indispensables à la compilation et à
l'empaquetage sont injoignables :

| Commande | Résultat ici | Cause |
|---|---|---|
| `npm run build` | non exécutable | `binaries.prisma.sh` (moteurs Prisma) injoignable |
| `npx prisma validate` | non exécutable | même cause — message exact : `request to https://binaries.prisma.sh/.../libquery_engine.so.node.gz.sha256 failed` |
| `npm run dist` | non exécutable | idem + `objects.githubusercontent.com` (binaire Electron) |
| `electron-builder --win --x64` | **tenté** : s'arrête pendant `packaging platform=win32` | les binaires Electron/NSIS/winCodeSign sont des actifs de release GitHub servis par `objects.githubusercontent.com`, injoignable depuis cet environnement (`curl` → code `000`) |
| Essai d'installation de l'installeur | impossible | aucun poste Windows dans cet environnement |
| Suite vitest complète | 84 fichiers sur 336 ne peuvent pas s'exécuter | ils montent une base SQLite via `prepareTestDb` → `prisma db push` → moteur Prisma à télécharger (0,3 % des tests échouent, 22 % sont ignorés, 78 % s'exécutent) |

Ces éléments **n'ont pas été simulés** et ne sont donc revendiqués nulle part :
aucune capture d'installeur, aucun numéro de build, aucune session d'installation
n'est présentée comme vérifiée.

## 13. À faire sur le poste Windows (procédure exacte, ~15 minutes)

```powershell
# 1. Dépendances et moteurs Prisma (accès réseau nominal)
npm install
node scripts/check-version.js

# 2. Porte statique
npx eslint src --ext .ts,.tsx
npx tsc --noEmit            # comparer l'ensemble des erreurs à la référence, ne pas exiger zéro

# 3. Chaîne complète : compilation → vérification de la sortie → installeur
npm run dist
#    doît afficher, dans l'ordre : préflight OK, build OK, verify:standalone OK,
#    electron-builder OK, secrets OK, fuses OK, verify:installer OK
#    (toute étape qui échoue arrête la chaîne avec un message explicite)

# 4. Preuve d'installation sur un poste VIERGE (sans dépôt, sans Node)
#    - lancer dist\GarageFlows Setup 1.1.0.exe
#    - vérifier : raccourcis, lancement, connexion à la base, photos, impression
#    - vérifier le désinstalleur (Programmes et fonctionnalités)
#    - vérifier le réglage « Lancer GarageFlows au démarrage de Windows » :
#      activer, fermer, relancer, constater l'état, puis vérifier dans
#      Gestionnaire des tâches → Applications de démarrage
#    - rouvrir la session Windows : l'application ne doit pas voler le focus

# 5. Signature (uniquement après les étapes 3 et 4, avec les arguments obligatoires)
npm run release:sign -- --installer "dist\GarageFlows Setup 1.1.0.exe" --key <chemin-clé-privée>
```

Restent à traiter, hors périmètre de cette mission et signalés sans être
embellis : les 249 erreurs TypeScript préexistantes, les avis Dependabot portés
par la branche `main`, et la validation finale sur poste Windows.
