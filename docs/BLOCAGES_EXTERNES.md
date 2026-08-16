# Ce qui ne peut pas être vérifié ici — et pourquoi

<!-- doc-numbers: journal -->

Recensement exigé par le §82 de la mission V34 : lorsqu'une ressource est
réellement indisponible, on écrit `BLOCKED_EXTERNAL_REQUIREMENT` et **on
n'invente rien**. Ce document liste ce qui manque, ce que cela empêche
exactement de prouver, et ce qu'il faudrait pour lever le blocage.

Il ne recense **pas** les défauts connus — ceux-là sont dans `AUDIT_PROGRESS.md`.
Il recense les vérifications qu'aucun effort de code ne peut produire depuis ce
poste de travail.

Chaque entrée distingue deux choses que l'on confond souvent : ce qui est
**construit et testé** (le code, ses garde-fous, ses refus) et ce qui reste
**non vérifié** (le comportement face au service réel).

---

## 1. Plateforme de dématérialisation agréée — facturation électronique

**Manque** : un compte sur une plateforme agréée (PDP) ou sur son bac à sable.

**Ce qui est construit et testé** : la chaîne complète poste → cloud →
adaptateur, le tunnel authentifié par licence, l'idempotence de l'envoi, les
refus (brouillon, facture annulée, connexion absente, identifiants illisibles),
la portée garage, la révocation des sessions. Le seul adaptateur enregistré est
`generic-pa`, un connecteur générique paramétrable.

**Ce qui reste `NOT_VERIFIED`** : qu'une facture soit **réellement acceptée** par
une plateforme agréée. Aucun échange réseau avec un service réel n'a eu lieu, et
aucun format n'a été validé par un destinataire.

**Pour lever** : ouvrir un compte bac à sable chez une PDP, renseigner la
connexion, et rejouer un envoi de bout en bout.

---

## 2. Clé `ANTHROPIC_API_KEY` — reconnaissance de plaque

**Manque** : une clé d'API Anthropic.

**Ce qui est construit et testé** : la route `/api/plate-ocr` borne la taille de
l'image, limite le débit par garage, refuse proprement en 503 sans clé, ne laisse
pas fuir l'erreur du fournisseur, et — depuis le LOT 4 — **refuse toute sortie de
modèle qui n'a pas la forme d'une immatriculation française**.

**Ce qui reste `NOT_VERIFIED`** : la qualité de lecture sur de vraies photos de
plaques (taux de reconnaissance, robustesse à la lumière, aux plaques sales).

**Pour lever** : une clé et une campagne de photos réelles.

> Le Copilot, lui, n'a **pas** besoin de cette clé : `resolveLlmProvider()` rend
> `null` en dur et le Copilot livré est un routeur déterministe. Ce n'est pas un
> blocage mais un choix — voir le LOT 4.

---

## 3. Stockage objet pour le cloud — photos et avatars

**Manque** : un service de stockage persistant (Vercel Blob, S3 ou équivalent).

**Ce qui est construit et testé** : le stockage fichier du POSTE fonctionne —
Electron fixe toujours `GF_PHOTOS_DIR` et crée le dossier.

**Ce qui est bloqué** : sur le cloud, `GF_PHOTOS_DIR` n'est pas provisionnée, et
y écrire sur disque serait vain (système de fichiers éphémère et par instance).
Les avatars de mécaniciens poussés par un poste reçoivent donc un 501, journalisé
et sans boucle de relance. Trois routes portent ce refus.

**Pour lever** : provisionner un stockage objet et remplacer l'écriture fichier
par un dépôt vers ce service.

---

## 4. Certificat de signature de code Windows

**Manque** : un certificat Authenticode (OV ou EV).

**Constat** : `package.json` ne déclare ni `win.certificateFile` ni `win.sign`.
L'installateur produit est donc **non signé**.

**Conséquence réelle** : chaque garage qui installe GarageFlows voit un
avertissement SmartScreen « Éditeur inconnu ». Ce n'est pas un défaut de code —
c'est une dépense et une identité d'éditeur à établir.

**Pour lever** : acquérir un certificat, le fournir à electron-builder
(`CSC_LINK` / `CSC_KEY_PASSWORD`), et rejouer un `npm run dist`.

> À ne pas confondre avec la signature du **manifeste de mise à jour**
> (`GF_UPDATE_SIGNING_KEY`), qui est en place : la paire `gf-update-2026-2` a été
> générée le 15/08/2026 et l'ancre embarquée accepte les deux clés le temps de la
> transition. La clé privée vit hors du dépôt.

---

## 5. Base PostgreSQL de test (`TEST_POSTGRES_URL`)

**Manque** : une instance PostgreSQL joignable pendant les tests.

**Ce qui est construit et testé** : toute la suite s'exécute sur une base SQLite
réelle, construite depuis le schéma. Quatre fichiers de test savent s'exécuter
contre PostgreSQL si l'URL est fournie, et se contentent de SQLite sinon.

**Ce qui reste `NOT_VERIFIED`** : les sémantiques propres à PostgreSQL —
verrouillage de ligne `FOR UPDATE`, `pg_advisory_xact_lock`, numérotation
concurrente de documents, isolation MVCC.

**Nuance mesurée le 15/08/2026** : l'absence de ces verrous sur le poste n'est
**pas** une perte de garantie. Deux transactions concurrentes y ont été mesurées
dans les deux configurations possibles — sérialisation complète, Prisma ouvrant
SQLite en `BEGIN IMMEDIATE`. PostgreSQL exige un verrou explicite parce qu'il est
MVCC ; SQLite sérialise nativement.

**Pour lever** : une instance PostgreSQL jetable et `TEST_POSTGRES_URL`.

---

## 6. Outillage de rendu React

**Manque** : `@testing-library/react` et un environnement `jsdom`.

**Constat** : `vitest.config.ts` fixe `environment: 'node'` et n'inclut que
`.test.ts` — jamais `.tsx`. Aucun composant n'est monté par la suite.

**Ce qui reste `NOT_VERIFIED`** : tout ce qui se voit. Notamment, depuis les
LOTs 4 à 6 : l'écusson « vérifié » du Copilot, le bandeau de péremption du
mécanicien, le bouton « Renvoyer » d'une photo non partie, l'absence
d'écrasement d'une saisie en cours.

**Contournement en place** : ces garanties sont éprouvées par des **gardes de
source** — le dépôt en use déjà pour d'autres invariants. C'est une preuve plus
faible qu'un rendu, et c'est dit à chaque fois.

**Pour lever** : ajouter l'outillage, ou monter une recette en navigateur réel
(serveur local `ELECTRON=1` + Playwright, procédé déjà employé sur ce projet).

---

## 7. Exécution de l'application packagée

**Manque** : un démarrage de GarageFlows lui-même — fenêtre, serveur Next
embarqué, base du poste.

**Ce qui EST possible, et a servi** : lancer le binaire Electron du dépôt sur une
application d'essai. Cela a permis de **mesurer** le comportement de
`dialog.showMessageBox` sur Electron 31 (LOT 7) au lieu de le supposer. La limite
n'est donc pas « Electron ne démarre pas » : c'est que `electron/main.js` exige
une installation réelle — licence, base, serveur `standalone` construit — que
cette session n'a pas.

**Ce qui reste `NOT_VERIFIED`** : les corrections touchant `electron/main.js` —
sauvegarde par `VACUUM INTO`, période de grâce hors ligne ancrée sur la création
de la base, sonde d'identité du serveur au démarrage, conseil adapté à un échec
de migration. S'y ajoutent, depuis le LOT 7 : la **boîte de relance** après mort
du serveur enfant, l'**avertissement de sauvegarde en souffrance**, le
**rattrapage de l'export de 20 h** après veille ou extinction, la **rotation du
journal**, et le comportement de `second-instance` pendant le démarrage. Toutes
sont éprouvées par leurs **modules extraits** (testables) et par gardes de
source, jamais par un démarrage réel.

**Ce qui reste hors de portée même avec un démarrage** : une **installation NSIS
réelle** (voir §4 — l'installateur ne peut pas être signé), une **mise en veille**
de la machine, et un **cycle de mise à jour de bout en bout** vers un serveur de
publication.

**Pour lever** : `node scripts/post-build.js` puis `ELECTRON_DEV=1 npx electron .`,
et relire `%APPDATA%/GarageFlow/garageflow.log`.

---

## Ce que ce document n'autorise pas

Aucune de ces entrées ne justifie d'écrire `VERIFIED` sur la foi d'un
raisonnement. Un blocage externe se **déclare** ; il ne se contourne pas par une
formulation prudente. Quand la ressource arrivera, la vérification devra être
refaite — pas relue.
