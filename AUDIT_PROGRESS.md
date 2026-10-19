# AUDIT_PROGRESS — GarageFlows

Journal de preuves de la campagne d'audit ouverte le **2026-08-14**.
Chaque entrée porte : reproduction *avant* correction, cause racine, fichiers,
correction, test, résultat, et ce qui reste **non vérifié**.

Statuts autorisés : `VERIFIED`, `FIXED_NOT_FULLY_VERIFIED`, `MITIGATED`,
`BLOCKED`, `FAILED`. Aucun autre mot ne doit masquer un résultat incomplet.

---

## 0 — Baseline (état AVANT toute modification)

Relevé le 2026-08-14 à 19:06, sur le dossier d'exécution
`C:\Users\Mathys\Desktop\GarageFlowsV2-claude-garageflow-final-unified-merge-ub0l67`.

| Élément | Valeur |
|---|---|
| OS | Windows 10 Famille (10.0.19045), AMD64 |
| Node / npm | v22.23.2 / 10.9.8 |
| Git | 2.55.0.windows.3 — **le dossier d'exécution n'est pas un dépôt** |
| Dépôt réel | `C:\Users\Mathys\.claude\jobs\2a11bc5b\tmp\repo`, branche `claude/garageflow-final-unified-merge-ub0l67`, HEAD `0c9d468` (2026-08-14 17:16), arbre propre |
| Écart dépôt ↔ dossier d'exécution | uniquement les fins de ligne (CRLF/LF) et les 2 ancrages de clé de licence — contenu identique par ailleurs (758 fichiers `.ts`/`.tsx` comparés par empreinte) |
| Version produit | `package.json` 1.1.0 — productName `GarageFlows` |
| Next / React / Electron / Prisma | 14.2.35 / 18.3.1 / 31.7.7 / 5.16.1 |
| Base poste | SQLite (`prisma/schema.prisma`) · Base cloud : PostgreSQL Neon (`prisma/server/schema.prisma`) |
| Déploiement PWA | Vercel, projet `garagesite5`, `app.garageflows.fr` — **non connecté à Git**, publié depuis le CLI |
| Surfaces | 17 pages, 154 routes API, 758 fichiers source |

### Contrôles automatiques — AVANT

| Contrôle | Résultat |
|---|---|
| `tsc --noEmit` | **0 erreur** |
| `next lint` (ESLint) | **0 erreur / 0 avertissement** |
| `prisma validate` (schéma poste) | **valide** |
| `vitest run` | **4 échecs / 2960** · 254 fichiers, 28 ignorés |
| `check:branding` | OK (876 fichiers) |
| `check:docs` | **3 incohérences** (`docs/audit/2026-08-14-DURCISSEMENT/RAPPORT.md`) |
| `check:pwa`, `check:money` ×3, `check:migration-safety`, `check:sqlite-template`, `check:pg-migrations`, `check:converge-additive`, `check:public-key`, `check:desktop-audit` | OK |
| `check:critical-files` | **ÉCHEC** — `REFERENCE_FP` désalignée |
| `keys:check` | **ÉCHEC** — 1 ancrage divergent |
| `check:perf-budget` | **ÉCHEC** — JS client 3,22 Mio > 3,00 ; plus gros bloc 546 Kio > 512 |

Les 4 tests rouges et les 2 contrôles de clé rouges avaient **une seule et même
cause** : la rotation de clé du 2026-08-14 à 17:23:57 (§ GF-001).

---

## GF-001 — Une rotation de clé ne déplaçait que deux des quatre ancrages

**Priorité** P1 (bloque la chaîne de contrôle ; le risque P0 est le suivant :
une garde qui crie à chaque rotation légitime n'est plus lue le jour où elle a
raison — et ce jour-là tout le parc refuse silencieusement les licences).

**Reproduction (avant)**
`vitest` : 4 rouges. `node scripts/check-critical-files.js` → *« REFERENCE_FP
(835c1e90…) ne correspond pas à la clé embarquée (e6605999…) »*. Deux fichiers
`*.before-v171-20260814-172357` traînaient dans `electron/` et `src/`.

**Cause racine**
`scripts/reset-garageflow.ps1` → `Set-LicensePublicKeyInProject` ne réécrivait
que `_LINES` (public-key.ts) et `_PK` (electron/main.js). Les deux autres
ancrages — `REFERENCE_FP` du test de cohérence et `RETIRED_FINGERPRINTS` de
`check-critical-files.js` — restaient sur la clé précédente. `npm run keys:sync`
savait réparer, mais rien ne l'appelait. De plus, les sauvegardes `.before-*`
créées pour le rollback n'étaient jamais sorties de l'arbre de build en cas de
succès — or `electron/**/*` les embarque (une l'a déjà été dans un `app.asar`
livré, GF-DUR-034).

**Quelle clé est la bonne ?** Vérifié, pas supposé : `keys/public.pem`, la clé
dérivée de `keys/private.pem`, `_PK` et `_LINES` donnent tous `e6605999…`, qui
valide **4/4** licences réelles de `keys/licenses_db.json` ; `835c1e90…` en
valide **0/4**. La rotation était donc légitime.

**Correction**
- `scripts/reset-garageflow.ps1` : ajout de `Get-PublicKeyFingerprint` et
  `Get-PemFromJsLiteral` ; l'empreinte SORTANTE est lue **avant** tout patch
  (après, la clé précédente n'existe plus nulle part) ; `REFERENCE_FP` et
  `RETIRED_FINGERPRINTS` sont désormais réécrits dans la même passe et inscrits
  au même rollback ; sur succès, les `.before-*` sont **déplacées** (jamais
  supprimées) vers le dossier du run.
- Arbre réaligné : `REFERENCE_FP` → `e6605999…`, `835c1e90…` inscrite comme
  retirée, sauvegardes déplacées vers
  `Bureau\API générées\2026-08-14_17-22-29\sources-avant-rotation\`.

**Test** `src/lib/__tests__/rotation-cle-ancrages.test.ts` (6 cas) + preuve
d'exécution des deux fonctions PowerShell extraites du script réel par AST :
elles rendent `e6605999…` sur les fichiers courants, `835c1e90…` sur la
sauvegarde d'avant rotation, et `null` sur entrée invalide.

**Résultat** 4 tests rouges → verts ; `check:critical-files` et `keys:check`
sortent 0.

**Statut** — arbre : `VERIFIED`. Script de rotation :
`FIXED_NOT_FULLY_VERIFIED` — un run réel effectue une rotation cryptographique
de PRODUCTION (Vercel + Neon + purge des licences) ; il n'a pas été rejoué.

**Réserve** Le cloud embarque-t-il bien `e6605999…` ? Le run du 14/08 a
redéployé `garagesite5` à 17:28 (`dpl_7EvNQLWH68o3RXgGjKw5U12rP1zK`, rapport
« SUCCÈS — déploiement et tests validés »). **Non revérifié indépendamment** :
aucune surface publique n'expose la clé.

---

## GF-002 — Le lien portail était mort à l'instant même où il s'affichait

**Priorité** P0. C'est le défaut signalé : *« un lien créé immédiatement retourne
Lien invalide ou expiré »*.

**Reproduction (avant)** `src/integration/portail-lien-revoque-a-la-republication.test.ts`,
base SQLite réelle, vrais handlers, signature JWT réelle :
- deux publications concurrentes → le premier jeton répond **404** ;
- republication séquentielle → le lien déjà distribué répond **404**.

**Cause racine — deux moitiés**
1. `PortalLinkSection` (JobModalFooter) montait `<JobQRCode>` **et** appelait
   `usePortalUrl` : **deux** `POST /api/portal/generate` concurrents à chaque
   ouverture de fiche. Or, sur un poste, publier révoquait la publication
   précédente (`deleteMany … id: { not: jti }`). Des deux liens affichés côte à
   côte, un seul pouvait donc vivre — le QR code à l'écran pointait déjà vers un
   lien mort.
2. Rouvrir la fiche une semaine plus tard republiait et tuait le lien que le
   client avait reçu, sans que personne n'agisse.

**Un test vert protégeait le défaut** `src/app/api/sync/__tests__/portal-snapshot.test.ts`
affirmait *« republier reste exploitable »* et attendait 200 sur l'ancien jeton.
Il passait parce que son simulacre déclarait `portalSnapshot.deleteMany: async
() => ({ count: 0 })` — un **no-op**. Le test validait une base qui ne se
comporte pas comme la vraie.

**Correction**
- `src/app/api/sync/portal/route.ts` : la publication **réemploie l'instantané
  vivant** de l'intervention au lieu d'en créer un autre. L'URL ne change plus.
  L'intention d'origine — pouvoir se rétracter — reste satisfaite : le contenu
  est remplacé, donc ce qui est retiré disparaît aussi de l'ancien lien. Un
  instantané périmé n'est pas remployé.
- `src/components/JobQRCode.tsx` : réécrit. Un hook unique `usePortalLink`
  génère le lien **une fois** et rend son état (`chargement` / `pret` /
  `nonPublie` / `echec`) ; `JobQRCode` devient un composant d'affichage sans
  requête.
- `src/components/job-modal/JobModalFooter.tsx` : QR code et lien « copier »
  partagent la même URL ; ni l'un ni l'autre n'est proposé tant que la
  publication n'est pas confirmée ; un avertissement explicite remplace le
  silence quand `cloudPublished` vaut `false` (champ que **personne** ne lisait).
- `src/app/api/sync/__tests__/portal-snapshot.test.ts` : simulacre rendu fidèle
  (`findFirst`, `count`, `deleteMany` réels, filtre Prisma minimal qui **échoue
  bruyamment** sur une clause non simulée).

**Test** 21 cas verts sur 3 fichiers (`portail-lien-revoque-a-la-republication`,
`portal-snapshot`, `portal-token-isolation`) + `src/lib/__tests__/portail-lien-unique.test.ts`
(5 cas) qui fige la forme corrigée côté interface.

**Statut** `VERIFIED` au niveau des handlers et du contrat d'interface.
**Réserve** : la moitié cloud n'entre en vigueur qu'après un **redéploiement de
`app.garageflows.fr`** — non effectué (aucune publication en production sans
demande explicite).

---

## GF-003 — Signature de devis depuis un poste : lien mort, e-mail parti, devis marqué « envoyé »

**Priorité** P0 (même famille que GF-002, sur un autre canal ; découvert pendant
l'audit, non signalé).

**Cause racine** `/api/quotes/[id]/signature-token` signe avec `portalSecret()`,
qui vaut sur un poste packagé le **secret d'installation** (256 bits tirés au
hasard, `electron/secret.js` ; le `.env` est retiré du paquet). L'URL remise au
client pointe sur `app.garageflows.fr`, qui ne connaît ni ce secret ni ce devis :
la passerelle `/api/sync/*` porte les interventions, leurs photos, les
mécaniciens et l'instantané portail — **aucun devis**. Le client ouvrait donc
« Token invalide ou expiré » pendant que l'écran affichait « Devis envoyé à … »,
que le devis basculait en `sent` et que l'e-mail était parti.

**Correction** Refus explicite (`409 SIGNATURE_DISTANTE_INDISPONIBLE`) sur une
instance poste, **avant** toute mutation et tout envoi. Le chemin cloud est
inchangé.

**Test** `src/integration/devis-signature-depuis-un-poste.test.ts` (5 cas) :
refus explicite, statut inchangé, aucun courriel ; et, sur instance cloud, lien
produit + devis `sent` + courriel portant l'URL + jeton réellement accepté par
`/api/portal/quote/[token]`.

**Statut** `MITIGATED`. Le faux succès, l'e-mail dans le vide et la mutation
d'état sont supprimés. **La fonctionnalité manquante demeure** : faire signer un
devis à distance depuis un poste exige une voie de retour poste ⇄ cloud
(publication du devis puis remontée de l'accord signé) — c'est une
fonctionnalité à part entière, signalée plutôt que simulée.

---

## GF-004 — La photo du mécanicien ne s'affichait nulle part

**Priorité** P0. C'est le défaut signalé : *« Paramètres → Équipe, changement de
photo : message de succès mais rien ne change »*.

**Cause racine** `MechanicAvatar` affichait la photo si `mechanic.photoUrl`
existait. `photoUrl` n'apparaissait **nulle part ailleurs dans le dépôt** :
`GET /api/mechanics`, `PUT /api/mechanics/:id/avatar`, `GET /api/mechanic/me` et
le type `MechanicRecord` renvoient tous `avatarUrl`. Le composant retombait donc
**toujours** sur les initiales — sur les cinq surfaces qui l'utilisent : liste de
l'équipe, fiche en édition, en-tête de colonne du planning, sélecteur de
mécanicien, en-tête de la PWA mécanicien.

L'envoi, lui, fonctionnait de bout en bout : image validée (octets magiques,
dimensions, EXIF retiré), fichier écrit, base à jour, propagation cloud
effectuée. **Seul l'affichage regardait ailleurs.**

**Pourquoi rien ne l'a vu** `mechanic={m}` passe une variable : le contrôle des
propriétés excédentaires de TypeScript ne s'applique qu'aux littéraux, et
`photoUrl` était optionnel. Les gardes existants vérifiaient la présence de
`<MechanicAvatar` dans les écrans, jamais que le champ lu existait.

**Correction**
- `src/components/MechanicAvatar.tsx` : le champ lu devient `avatarUrl`.
- `src/lib/types.ts` : `Mechanic.avatarUrl` déclaré (le planning le recevait
  déjà de l'API sans pouvoir le lire sans cast).
- `src/components/settings/MechanicsTab.tsx` + `SettingsModal.tsx` : la liste se
  recharge quand la photo change (la vignette de ligne gardait l'ancienne image
  alors que la fiche montrait la neuve).
- `src/components/settings/MechanicAvatarField.tsx` : `cloudSynced === false` ne
  s'annonce plus comme un succès complet — la photo est sur ce poste, pas encore
  chez le mécanicien.

**Test** `src/lib/mechanics/__tests__/avatar-contrat-affichage.test.ts` (7 cas).
Le garde principal est **générique** : tout champ que le composant lit sur son
mécanicien doit être produit par au moins une API de mécanicien. Un futur
renommage d'un seul côté échouera ici.

**Statut** `FIXED_NOT_FULLY_VERIFIED` — chaîne prouvée par les tests et les
contrats ; le rendu réel dans l'application (§21, 15 points d'acceptation) reste
à exercer dans un navigateur.

---

## GF-005 — L'autocomplétion de plaque proposait cinq véhicules au hasard

**Priorité** P0 (mauvaise voiture, mauvais client, en silence).

**Cause racine** `JobModal.tsx` appelait `/api/vehicles?query=…`. La route ne lit
que `plate`, `clientId` et `q` : la requête partait donc **sans aucun critère**
et renvoyait les quinze véhicules les plus récemment touchés du garage. Le
réceptionniste tapait « AB-123 », se voyait proposer la Clio de Mme Durand,
cliquait — et `selectVehicle` écrasait d'un coup plaque, modèle, `vehicleId`
**et** nom du client. Rien à l'écran ne le signalait.

**Correction** Le paramètre devient `q`, celui que la route lit réellement.

**Test** `src/lib/__tests__/contrats-parametres-api.test.ts` (3 cas). Le garde
principal est **générique** : pour chaque appel client dont l'URL porte une
chaîne de requête littérale, la route visée doit lire chacun des paramètres
nommés. 27 couples vérifiés, 0 orphelin. **Statut** `VERIFIED`.

---

## GF-006 — Le logo du garage était détruit à chaque enregistrement des réglages

**Priorité** P0.

**Cause racine** Dès que le logo est stocké en fichier (cas normal sous
Electron), `GET /api/garages` renvoie `logoBase64: null` + `logoPath: 'logos/…'`.
L'écran charge `logoBase64: data.logoBase64 ?? ''` puis renvoie **tout** son état
à chaque enregistrement ; le serveur lisait `logoBase64: ''` comme « supprime le
logo ». Corriger un numéro de téléphone effaçait donc le logo de toutes les
factures, de tous les devis et du portail client. Le fichier restait sur le
disque, orphelin, irrécupérable depuis l'application.

**Correction** Un champ vide ne dit pas « supprime » : il dit « je n'apporte pas
d'image ». La suppression reste explicite — l'écran vide les **deux** champs.
`raw.logoPath` sert de simple signal de présence et n'est **jamais** écrit (zod
le retire) : il ne peut désigner ni un chemin arbitraire ni le fichier d'un autre
garage. L'ancien fichier est désormais retiré du disque lors d'un vrai
remplacement ou d'une vraie suppression.

**Test** `src/integration/reglages-logo-et-cout-achat.test.ts`. **Statut** `VERIFIED`.

---

## GF-007 — Le coût d'achat servi à des rôles qui n'y ont pas droit

**Priorité** P0 (fuite de la marge du garage).

**Cause racine** `GET /api/jobs/:id/parts` renvoyait `unitCost` — sur la ligne
**et** sur la pièce imbriquée — à tout utilisateur authentifié. Les mêmes
chiffres sont refusés à un RECEPTIONIST par `/api/finance`, `/api/profitability`
et `/api/export/fec` : le contrôle posé sur une porte se contournait par celle
d'à côté, exactement ce que `redactLineCosts` avait été écrit pour empêcher.

**Correction** `redactLineCosts` appliqué à la ligne **et** à la pièce imbriquée
— c'est par elle que le coût revenait, la fonction ne travaillant qu'au premier
niveau. **Test** 3 cas (OWNER voit, RECEPTIONIST ne voit rien nulle part, MANAGER
voit). **Statut** `VERIFIED`.

---

## GF-008 / GF-009 — « Changer de licence » mentait des deux côtés

**Priorité** P0.

**GF-008 (navigateur/PWA)** `LicenseChangeModal` envoyait `{ token }` quand la
route lit `body.license` : le serveur recevait une licence **vide** et refusait
toute clé, même parfaitement valide. S'y ajoutaient l'absence d'`installId`
(exigé hors Electron) et un message lu dans `data.error`, champ que cette route
n'émet jamais — le motif réel était remplacé par « Licence invalide ». Le garage
concluait que sa clé achetée était cassée. La branche Electron fonctionnant, le
défaut ne se voyait pas en recette sur poste.

**GF-009 (poste)** `ipcMain.handle('app:update-license')` appelait
`activateOnServer()` **sans lire son retour**, puis renvoyait inconditionnellement
`{ ok: true }`. Or cette fonction rend `null` sur refus explicite de l'autorité —
siège consommé, licence révoquée, empreinte d'une autre machine. Le poste
affichait « Licence activée (premium) » et se rechargeait, la clé étant déjà
écrite sur le disque et ses cookies posés.

**Correction** Les deux `null` sont désormais distingués : autorité
**injoignable** (hors ligne — le produit doit continuer) et **refus explicite**
(réponse définitive → état précédent restauré, motif renvoyé).

**Test** `src/lib/__tests__/licence-changement-contrat.test.ts` (8 cas).
**Statut** GF-008 `VERIFIED` (contrat de champs prouvé) ; GF-009
`FIXED_NOT_FULLY_VERIFIED` — le processus principal d'Electron n'est pas
exécutable en test ; le garde porte sur la forme.

---

## GF-010 — Un garage sans site web ne pouvait enregistrer AUCUN réglage

**Priorité** P0 — découvert en écrivant le test de GF-006.

**Cause racine** `website: z.string().url()` refuse la chaîne vide. L'écran
renvoie `website: ''` tant que le garage n'a pas de site : `PATCH /api/garages`
répondait 400 « Réglages invalides », sans dire quel champ. Ni l'adresse, ni le
taux de TVA, ni les coordonnées bancaires ne pouvaient être enregistrés. La même
leçon avait pourtant été tirée pour l'e-mail — le schéma le prétraite déjà.

**Correction** `urlFacultative` : « vide » devient `null` avant validation ; une
adresse réellement saisie reste vérifiée. **Statut** `VERIFIED`.

---

## GF-011 — Le planning tronquait la journée à 20 interventions

**Priorité** P0. `GET /api/jobs` paginait par défaut à 20 ; le magasin du
planning et le tableau de réception appellent `?date=…` sans `limit` et ne lisent
que `data`. Au-delà de vingt, les interventions de fin de journée n'existaient
pour aucun écran du poste — alors que le mécanicien affecté les voyait dans sa
PWA (limite 200). **Correction** : une requête `?date=` n'est pas une liste qu'on
feuillette ; son défaut est un plafond de sécurité (500), pas une page.
**Test** 5 cas. **Statut** `VERIFIED`.

---

## GF-012 — La boucle de rafraîchissement du poste était fermée sur elle-même

**Priorité** P0 — c'est le LOT P0-B (synchronisation Poste ⇄ PWA).

**Cause racine** `/api/jobs/pulse` calcule son empreinte sur la base **locale**.
L'action du mécanicien vit dans la base du **cloud**. Or la voie de retour
cloud → poste n'était déclenchée que par `pollJobSync`, appelée uniquement depuis
`GET /api/jobs` — que le poste n'émet **que si l'empreinte a changé** :

> empreinte inchangée → pas de `GET /api/jobs` → pas de `pollJobSync` → pas de
> synchronisation → base locale inchangée → empreinte inchangée

Le mécanicien appuyait sur « Terminer » et l'écran du comptoir affichait
« Prévu » indéfiniment. La route qui prétendait corriger ce défaut en était
structurellement incapable. Second défaut : commentaires et photos du mécanicien
vivent dans leurs propres tables et ne touchent pas `Job.updatedAt` — même une
synchronisation réussie ne faisait donc pas bouger l'empreinte.

**Correction** Le battement **déclenche** la voie de retour (`pollJobSync`, déjà
limité à une remontée / 10 s, non bloquant) ; commentaires et photos entrent dans
l'empreinte. **Latence résultante : ~10 à 20 s**, contre « jamais ».

**Test** `src/integration/pulse-boucle-de-synchronisation.test.ts` (6 cas).
**Statut** `FIXED_NOT_FULLY_VERIFIED` — la latence réelle poste ⇄ cloud n'a pas
été chronométrée sur deux instances (cf. réserves finales).

---

## GF-013 — Le signeur de release acceptait trois identités contradictoires

**Priorité** P0. `sign-release-manifest.mjs` contrôlait l'existence du fichier,
le format SemVer et le domaine de l'URL — **jamais leur concordance**, et ne
lisait pas `package.json`. Signer l'installeur 1.1.0 encore présent dans `dist/`
avec `--version 1.2.0` produisait un manifeste cryptographiquement valide dont
l'empreinte correspondait aux octets servis : chaque poste l'acceptait,
téléchargeait, installait, redémarrait sur 1.1.0 — et recommençait. Boucle sans
fin sur tout le parc, sans recours logiciel.

**Correction** Contrôles de cohérence (version ↔ `package.json`, ↔ nom du
fichier, ↔ URL, extension ↔ plateforme, fichier non vide), `--help` complet, et
`--allow-mismatch` explicite et bruyant pour les cas légitimes.

**Test** `src/lib/__tests__/signature-release-coherence.test.ts` (9 cas, script
réel exécuté en sous-processus, signature vérifiée cryptographiquement).
**Statut** `VERIFIED`.

---

## GF-014 — Huit fonds sombres échappaient à tous les thèmes

**Priorité** P0 (écrans de connexion et d'activation de licence illisibles).

**Cause racine** Le thème clair rattrapait les fonds sombres par une **liste
littérale** de classes. Huit fonds employés dans vingt-trois fichiers n'y
figuraient pas — dont `bg-[#111827]/95`, la carte des écrans de connexion,
d'activation de licence et de tout le portail client. Là,
`[data-theme="light"] .text-white` et `--input-text` passaient bien en encre
foncée… sur un fond resté quasi noir : le texte saisi devenait invisible. Les
thèmes « Night Shift » et « True Tone » n'avaient aucune liste : ils ne
changeaient quasiment rien.

**Correction** Neuf **jetons de surface** déclinés dans les quatre thèmes, et un
rattachement par sélecteur d'attribut portant sur la **base** de la classe : les
variantes d'opacité présentes et à venir sont couvertes. En thème sombre chaque
jeton vaut exactement la couleur d'origine — aucun changement d'apparence.

**Test** `src/lib/__tests__/themes-surfaces-couvertes.test.ts` (4 cas, dont un
auto-contrôle du détecteur). Présence vérifiée dans le CSS **réellement produit**
par `next build`. **Statut** `FIXED_NOT_FULLY_VERIFIED` — le rendu visuel n'a pas
encore été capturé dans un navigateur.

---

## GF-015 / GF-016 / GF-017 — Clients et véhicules n'existaient jamais

**Priorité** P0.

**GF-015** `POST /api/clients` et `POST /api/vehicles` existaient, corrects, mais
**aucun écran ne les appelait**. La seule voie de saisie — la modale
d'intervention — écrivait un annuaire parallèle dans le `localStorage`
(`gf_clients`) puis créait une intervention en texte libre. Conséquences :
annuaire Clients vide, table `Vehicle` vide, fiche véhicule introuvable, alertes
de contrôle technique jamais remontées, aucun accès portail ouvrable, factures
sans `clientId`.
→ Le rattachement se fait désormais **côté serveur** à l'écriture de
l'intervention (création **et** modification) : plaque normalisée, client
retrouvé sans doublon d'accent ou de casse, et un véhicule connu ne change
**jamais** de propriétaire sur une saisie différente.

**GF-016** L'autocomplétion lisait le `localStorage` : un téléphone corrigé dans
l'écran Clients ressortait avec l'ancienne valeur et était recopié dans la
facture. → Hook partagé `useRechercheClient` (serveur, débattu, réponses périmées
ignorées) ; `client-memory.ts` supprimé — `tsc` confirme qu'il n'avait plus
d'appelant.

**GF-017** La liste de suggestions de véhicules n'affichait **jamais** le nom du
client : l'API renvoie `client.name`, le composant lit `clientName`. La marque
était perdue de même (« Clio » au lieu de « Renault Clio »). → Conversion
explicite vers la forme attendue.

**Tests** `src/integration/intervention-rattache-client-vehicule.test.ts` (8 cas)
et `src/lib/recherche/__tests__/normalisation.test.ts` (11 cas). **Statut**
`VERIFIED` côté API et contrats ; le parcours à l'écran reste à exercer.

---

## GF-019 — Le bouton de connexion était illisible dans les QUATRE thèmes

**Priorité** P1, découvert pendant la recette visuelle.

Les quatre écrans d'entrée — connexion, activation de licence, connexion et
inscription du portail — habillaient leur bouton inactif en
`bg-blue-600/20 text-blue-400/40` : du bleu à 40 % d'opacité sur du bleu à 20 %.
**Mesuré dans un vrai navigateur** : 1,25:1 en clair, 2,11 à 2,16:1 ailleurs. Or
c'est le premier état que voit l'utilisateur — le bouton n'est actif qu'une fois
le formulaire rempli.

**Correction** Classe partagée `.gf-btn-inactif`, grisée avec les jetons du
thème plutôt qu'avec de la transparence empilée. **Après : 5,15 à 9,90:1.**

**Statut** `VERIFIED` — mesure dans Chromium, 48 mesures après correction,
aucune sous 4,5:1.

---

## Recette visuelle des thèmes — preuve avant / après

Playwright + Chromium, serveur local `ELECTRON=1 next start` sur une base
jetable. Commande : `npm run recette:themes`.
Preuves : `artifacts/recette-visuelle/{avant,apres}/` (26 fichiers).

| Écran (thème clair) | Avant | Après |
|---|---|---|
| Connexion — texte saisi | **1,12:1** | 14,77:1 |
| Activation de licence — texte saisi | **1,54:1** | 8,56:1 |
| Portail — texte saisi | **1,12:1** | 14,77:1 |

**Un piège de méthode, signalé parce qu'il a failli valider un écran cassé.** La
première mesure « avant » a rendu 21:1 partout — parfait. En réalité le serveur
n'avait pas redémarré (port occupé) et servait un chemin de CSS périmé : la page
s'affichait **sans aucune feuille de style**, noir sur blanc. Le script refuse
désormais de mesurer une page portant moins de 50 règles CSS. Une mesure fausse
est pire qu'une mesure absente.

---

## GF-021 — Horaires : ni demi-heures, ni prise en compte par le planning

**Priorité** P1 (étape 13 de la mission, §14-15).

**Deux défauts imbriqués**
1. Les bornes n'existaient qu'en **heures pleines** (`workshopStartHour`,
   `workshopEndHour`, entiers). Les listes de l'écran n'offraient même que
   6 h – 18 h pour l'ouverture et 12 h – 24 h pour la fermeture.
2. **Le planning ne les lisait pas.** `ScheduleBoard` calculait `BOARD_START` /
   `BOARD_END` depuis les constantes `WORKSHOP_START_HOUR` / `WORKSHOP_END_HOUR`,
   évaluées au chargement du module : la grille était figée de 8 h à 18 h. Un
   garage ouvrant à 7 h enregistrait bien son horaire — et ne le voyait jamais.

**Correction**
- Deux colonnes **additives** `workshopStartMinute` / `workshopEndMinute`
  (0 ou 30, défaut 0 → les garages existants gardent exactement leurs horaires),
  dans les deux schémas Prisma, la migration serveur, la migration SQLite du
  poste et le DDL de convergence du reset.
- `src/lib/planning/horaires.ts` : le seul module qui convertit les bornes
  d'atelier — 48 créneaux de
  00h00 à 23h30, conversions, et des bornes qui **retombent sur 8 h – 18 h**
  plutôt que d'afficher une grille vide ou inversée.
- La validation compare désormais les bornes **complètes** : « 8 h 30 → 8 h 00 »
  passait, puisque 8 n'est pas supérieur à 8. Amplitude minimale : une heure.
- Le planning lit les réglages (magasin + contexte React) ; l'échelle horaire
  part de la première heure pleine contenue dans les bornes.

**Test** `src/lib/planning/__tests__/horaires.test.ts` (14 cas) +
`src/integration/reglages-logo-et-cout-achat.test.ts` (5 cas d'horaires).
Gardes de migration : `check:migration-safety`, `check:converge-additive`,
`validate-server-schema` — tous verts.

**Statut** `FIXED_NOT_FULLY_VERIFIED` — logique, contrats et persistance
prouvés ; le rendu de la grille avec des bornes non entières n'a pas encore été
capturé à l'écran.

---

## GF-022 — Aucune adresse n'était assistée, et celle du client n'était pas saisissable

**Priorité** P1 (étape 11, §9-13).

Chaque adresse — garage, client, devis, facture, ordre de réparation — était un
champ de texte libre. « 10 rue de la Poste », « 10 r. de la poste » et « 10 Rue
De La Poste » désignaient trois adresses différentes pour le logiciel, et une
coquille de code postal ne se voyait qu'au retour du courrier. Pire :
`Client.address` existait en base, la route `PATCH /api/clients/[id]` l'acceptait
— et **aucun écran ne l'envoyait**.

**Choix du service (§13)** `api-adresse.data.gouv.fr` — Base Adresse Nationale,
service public (Etalab). Retenu contre les alternatives commerciales pour quatre
raisons vérifiables : **aucune clé d'API** (donc aucun secret à distribuer dans
un installateur, aucune rotation), **gratuit**, seule limite documentée 50 req/s
par IP ; données **officielles et hébergées en France** ; réponse **structurée**
(numéro, voie, code postal, commune, département, coordonnées).

**Ce qui ne traverse pas** Seul le texte tapé. L'appel part du **serveur**, pas
du navigateur du garage : le service ne voit ni les postes individuels, ni la
moindre donnée métier.

**Composant unique** `AddressAutocomplete` — débat de 300 ms, réponses périmées
ignorées (sans quoi une frappe rapide affiche le résultat d'une saisie
précédente), clavier/souris/tactile, états explicites (recherche, aucun résultat,
service indisponible), `role="combobox"` + `aria-activedescendant`, et **saisie
libre toujours possible** : un lieu-dit ou une adresse hors de France doit rester
saisissable. Branché sur : réglages du garage, création du garage, fiche client
(champ **ajouté**), devis/facture, ordre de réparation.

**Statut** `FIXED_NOT_FULLY_VERIFIED` — la chaîne est en place et typée ; les
propositions réelles du service n'ont pas été exercées depuis l'application.

---

## GF-023 — IBAN et BIC acceptés sans le moindre contrôle, puis imprimés

**Priorité** P1 (§18).

`iban: z.string().max(34)`, `bic: z.string().max(11)`. Un IBAN amputé d'un
chiffre, un BIC de six lettres, un copier-coller avec retour à la ligne : tout
était accepté, enregistré, puis **imprimé au pied de chaque facture**. Le garage
l'apprenait quand le virement du client était rejeté.

**Correction** `src/lib/banque/iban.ts` : normalisation, formatage par groupes de
quatre, et **clé de contrôle ISO 13616 (modulo 97)** — vérifiable hors ligne,
elle détecte une faute de frappe avec une probabilité de 1/97. Plus la longueur
attendue par pays, le format du BIC (ISO 9362) et la cohérence des pays entre
IBAN et BIC. Le module dit ce qu'il vérifie : la saisie est **bien formée**, il
ne prétend pas que le compte existe.

**Recherche de banque (§16-17)** `src/lib/banque/etablissements.ts` : recherche
par nom, sigle ou groupe. **Règle absolue : ne jamais inventer un BIC.** Dans les
réseaux fédérés — Crédit Agricole, Caisse d'Épargne, Banque Populaire, Crédit
Mutuel — le BIC varie d'une caisse à l'autre ; proposer celui « de la marque » y
serait faux la plupart du temps, et un virement partirait chez quelqu'un d'autre.
Chaque entrée porte donc l'un de **deux états, jamais un entre-deux** : BIC
unique pour tout le réseau (proposé, modifiable) ou `bicVariable` (rien n'est
proposé, l'écran demande de le recopier depuis le RIB).

**Statut** `FIXED_NOT_FULLY_VERIFIED` — logique et données en place, branchement
sur l'écran des coordonnées bancaires **non terminé** (voir réserves).

---

## GF-024 — Dix écrans annonçaient un succès que le serveur n'avait pas accordé

**Priorité** P1 ×10 (§82). Le défaut est toujours le même — le message de
réussite est écrit à côté de l'appel, pas après sa réponse — et c'est ce qui le
rend dangereux : aucun de ces cas n'échoue bruyamment.

| Écran | Ce qui était annoncé | Ce qui se passait |
|---|---|---|
| Activation de licence (admin) | « ✓ Licence activée » | cinq refus de cette route répondent **en HTTP 200** avec `{ok:false}` ; les refus en 4xx n'affichaient **rien** |
| Mises à jour | « Vous utilisez la dernière version » | **aucune source n'avait répondu** — le retour était identique aux deux cas |
| Mises à jour | « Version actuelle v1.0.0 » | codée en dur, fausse à chaque release hors Electron |
| Export bureau | « Export terminé — vérifiez votre bureau » | dossier vide ; le retour valait `{ok:true}` en toutes circonstances |
| Notification obligatoire | la surimpression se lève | l'accusé de réception n'était pas parti ; le verdict n'était pas lu |
| Modale d'intervention | « Intervention mise à jour » | avant la réponse ; la modale se fermait, un refus ramenait la ligne sans explication |
| Planning (glisser-déposer) | déplacement confirmé | avant l'accord du serveur |
| Planning (redimensionnement) | « Durée modifiée » | idem |
| Redistribution | « Interventions redistribuées ! » | écritures tirées à l'aveugle, échecs jetés par `.catch(() => null)`, **aucun rechargement** |
| Barème main-d'œuvre | formulaire refermé | la fermeture ÉTAIT le signal de succès ; une durée à 0 renvoie 400, la saisie était perdue |
| E-facturation | « Plateforme déconnectée. » | sans lire le refus ; le champ `disconnected` n'était jamais lu |

**Correction** Le magasin du planning rend désormais le **verdict** (`boolean`)
au lieu de l'avaler ; chaque écran attend la réponse ; les refus affichent le
motif du serveur.

**Un piège évité de justesse** Rendre `handleSubmit` asynchrone sans `try/catch`
aurait transformé l'échec de création en rejet non géré — que le processus
principal affiche en surimpression plein écran indélébile.

**Test** `src/lib/__tests__/faux-succes.test.ts` (12 cas). **Statut** `VERIFIED`
au niveau des contrats ; les trois cas Electron restent
`FIXED_NOT_FULLY_VERIFIED`.

---

## GF-025 — E-facturation : 135 liens morts, un 404 compté comme un succès

**Priorité** P1.

**Liens morts** Les 135 liens « Site de la plateforme » du catalogue — publiés
par impots.gouv.fr, donc par construction hors de la liste blanche d'ouverture
externe — ne faisaient **rien** dans l'application packagée. Le lien vers la
liste officielle et ceux des notifications de l'éditeur non plus.
→ Pont `app:open-external` **plus étroit qu'une liste blanche d'hôtes** : HTTPS
uniquement, motif de refus rendu, liste blanche inchangée. Un lien en http n'est
pas ouvert : le refus est expliqué et l'adresse copiée dans le presse-papiers.

**Un 404 compté comme un succès** `testConnection` acceptait 404/405 comme
preuve d'authentification. Vrai en OAuth2, où l'échange `client_credentials` a
réellement eu lieu et lève sur refus. **Faux en mode clé d'API**, où l'en-tête
est simplement recopié : un site vitrine suffisait à obtenir `lastTestOk: true`,
`status: 'connected'` et une pastille verte « Testée » sur une plateforme qui
n'a jamais vu passer la moindre facture.

**« Déjà transmise »** Sans identifiant externe, l'issue de l'envoi précédent est
**inconnue** — le fourre-tout affirmait pourtant « déjà transmise à la
plateforme ». L'exploitant classait l'affaire, et une facture jamais reçue
restait invisible jusqu'à la relance du client.

**Une régression que j'ai introduite, attrapée par un garde du dépôt.** En
réécrivant le gestionnaire d'ouverture externe, j'ai supprimé la branche
`mailto:` / `sms:` — soit les deux boutons de rappel client. Le test
`reminder-send-honesty` l'a signalé immédiatement. Sa fenêtre d'analyse (700
caractères) était en revanche une supposition sur la longueur du code : elle est
désormais bornée par la **fermeture** du gestionnaire.

**Statut** `VERIFIED` pour l'adaptateur et le message d'envoi (43 tests) ;
`FIXED_NOT_FULLY_VERIFIED` pour le pont Electron.

---

## GF-026 / GF-027 — Réglages ignorés, publication de mise à jour sans garde

**GF-026 — taux de TVA et tarif horaire.** La modale devis/facture initialisait
`taxRate: prefill?.taxRate ?? 20`, et **aucun appelant** ne fournit
`prefill.taxRate` : le corps envoyé portait toujours 20, si bien que le repli
serveur `body.taxRate ?? garage.taxRate` ne se déclenchait **jamais**. Un garage
en franchise de TVA, en outre-mer ou à taux réduit facturait 20 % à son insu, sur
CHAQUE document. Même schéma pour la ligne de main-d'œuvre, codée en dur à 60 €/h
alors que le réglage existait et était persisté.

**GF-026 — photo d'inspection.** Retirer une photo posait `photoBase64 = null` et
laissait `photoPath` intact. Or la lecture donne la **priorité au fichier** : la
photo réapparaissait au rechargement, et le fichier restait sur le disque.

**GF-027 — publication d'une mise à jour.** Deux gardes manquaient :
`version` n'était que « non vide » — « Version 1.2.0 » était accepté et publié
avec un message de succès, alors que `semver.parseVersion` rend `null` sur cette
chaîne : **tout le parc** affichait « Vous utilisez la dernière version » sur une
mise à jour pourtant publiée. Et ni la version ni l'empreinte du fichier
n'étaient confrontées au manifeste **signé**, qui fait pourtant autorité côté
poste.

**Tests** `src/integration/publication-mise-a-jour.test.ts` (11 cas) et
`src/integration/reglages-appliques.test.ts` (5 cas). **Statut** `VERIFIED`.

---

## GF-028 / GF-029 — Stock non journalisé, pièces perdues, facture émise effacée

**GF-028 — le seul mouvement de stock qui n'était pas journalisé.**
`prisma/schema.prisma` pose l'invariant : le stock d'une pièce est toujours
reconstituable à partir de `StockMovement`. C'était vrai pour la validation
d'une facture, son annulation, une correction manuelle — mais **pas** pour le
chemin le plus fréquent : poser une pièce sur une intervention
(`POST /api/jobs/[id]/parts`). La quantité baissait, aucune ligne n'était
écrite ; un écart d'inventaire y devenait littéralement inexplicable.

**GF-028 — la cascade emportait les pièces.** `JobPart` est en
`onDelete: Cascade` sur `Job` : supprimer une intervention effaçait ses lignes
de pièces **sans** repasser par la route qui restitue le stock. Mesuré : une
intervention portant 6 filtres supprimée laisse le stock à **4 au lieu de 10**.
Les pièces étaient comptées sorties, sans facture ni intervention pour
l'expliquer — et le garage en recommandait.

**GF-029 — suppression de facture, contrôle hors transaction.**
`DELETE /api/invoices/:id` lisait le statut **avant** d'ouvrir la transaction
puis supprimait inconditionnellement. Une émission concurrente arrivée dans
l'intervalle — second onglet, seconde moitié d'un double-clic — et une facture
**émise** partait physiquement avec son numéro de la série séquentielle : aucun
avoir possible, un trou dans la numérotation au contrôle FEC. Mesuré avant
correction : **200 « success »** là où la réponse doit être 409.

**Reproduction avant correction** (code d'avant remis en place, 6 échecs / 10) :
`expected [] to have a length of 1` (journal vide au décrément),
`expected [] to deeply equal [ -4, 4 ]` (pas de mouvements symétriques),
`expected 4 to be 10` et `expected 8 to be 10` (pièces perdues à la
suppression), `expected 200 to be 409` (facture émise effacée, deux cas). Les
4 cas restants passaient déjà — ce sont les témoins : refus sur stock
insuffisant, brouillon supprimable, facture déjà émise refusée, garage étranger.

**Correction.** Trois fichiers, aucun changement de comportement nominal :
`src/app/api/jobs/[id]/parts/route.ts` journalise le décrément et la
restitution ; `src/app/api/jobs/[id]/route.ts` restitue les pièces **avant** la
cascade, avec leur mouvement, et répond `404` au lieu de laisser fuiter une
exception Prisma en 500 ; `src/app/api/invoices/[id]/route.ts` remplace
`delete` par un `deleteMany` conditionné à `status: 'draft'`, converti en 409
« La facture a été émise entre-temps ». La transaction annulée remet aussi le
devis source à `converted` — vérifié.

**Tests** `src/integration/stock-tracabilite-et-suppression.test.ts` (10 cas) ;
`src/lib/__tests__/stock-parts.test.ts` étendu au journal (4 assertions
ajoutées, dont deux témoins « un refus ne journalise rien »).
`job-tombstones.test.ts` attendait un rejet : il attend désormais le 404 —
l'invariant vérifié (ni suppression, ni pierre tombale orpheline) est inchangé.

**Statut** `VERIFIED`.

---

## GF-030 / GF-031 / GF-032 — La voie de retour CLOUD → POSTE (§7, §139)

**GF-030 — un curseur unique, aucun bon réglage.** Trois flux redescendent
ensemble (exécution, commentaires, photos) et n'avancent pas au même rythme. Le
curseur était COMMUN, calé sur le flux le plus en retard. Un garage dont la
dernière photo de mécanicien datait de trois mois redemandait donc, à chaque
passage, tout ce qui s'était écrit depuis — et le serveur n'en renvoyait que les
**200 plus anciens**. Passé ce volume, la réponse ne contenait plus que du
déjà-appliqué : **les nouveaux commentaires ne redescendaient jamais**. Blocage
définitif et silencieux. Le réglage inverse (le plus récent) avait été essayé
avant : il sautait les photos (GF31-AUD-017). Il n'y a pas de bon choix — il
fallait séparer les curseurs.

**GF-030 — la photo du mécanicien n'atteignait pas le garage.**
`POST /api/mechanic/jobs/[id]/photos` écrit `base64: ''` dès que le stockage
fichier est actif ; `/api/sync/job-photo` répondait alors `NO_INLINE_DATA` (409).
La photo existait, s'affichait dans la PWA, et n'avait **aucun** moyen de
redescendre. Redemandée toutes les 10 secondes, jamais obtenue — et elle
bloquait au passage le curseur commun. La passerelle relit désormais le fichier
(borne 8 Mo, celle du dépôt ; le défaut de 2 Mo de `readPhotoAsDataUrl`, taillé
pour un logo, aurait rejeté la plupart des photos d'atelier). Le chemin serveur
n'est jamais renvoyé au poste.

**GF-031 — la compensation d'horloge ne valait que dans un sens.**
`resolveMirrorWrite` neutralise le décalage poste ↔ serveur à la MONTÉE
(GF31-AUD-016). La DESCENTE comparait `local.updatedAt` (horloge du poste) à
`cloudAt` (horloge du serveur) sans rien corriger : un poste en avance ne
réappliquait plus jamais le travail du mécanicien, un poste en retard
réappliquait à chaque passage un miroir périmé par-dessus les saisies du garage.
Le serveur date déjà sa réponse (`syncedAt`) : l'écart avec l'heure du poste
donne le décalage, borné comme à la montée. Sans `syncedAt` — serveur pas encore
à jour — la compensation vaut 0 et le comportement est **exactement** l'ancien.

**GF-032 — la fenêtre entière redemandée toutes les 10 secondes.** Le flux
« exécution » n'a pas de curseur local exploitable (`Job.updatedAt` bouge à
chaque écriture du garage). Le repère est donc l'heure que le SERVEUR a lui-même
datée au dernier passage : deux horodatages de la même horloge. Au passage, les
états locaux sont lus en **une** requête au lieu d'un `findFirst` par
intervention — cinq cents allers-retours SQLite par passage sur une fenêtre
pleine, pour n'en écrire le plus souvent aucune.

**Reproduction avant correction** (code d'avant remis, deux campagnes) :
`expected 1778925540000 to be > …` (curseur des commentaires collé sur la photo
vieille de trois mois), `le reste doit être annoncé: expected false to be true`,
`la passerelle répondait 409 « NO_INLINE_DATA »: expected 409 to be 200`, puis
`le travail du mécanicien doit redescendre: expected +0 to be 1`, `la saisie du
garage est plus récente : expected 1 to be +0`, `le repère est l'heure que le
SERVEUR a datée: expected null to be truthy`.

**Fichiers** `src/lib/sync/return-path.ts` (nouveau module partagé, §136),
`src/lib/sync/job-sync.ts`, `src/lib/sync/job-fields.ts`,
`src/app/api/sync/jobs/route.ts`, `src/app/api/sync/job-photo/route.ts`.

**Compatibilité.** Le poste continue d'envoyer `since` (le plus ancien des
curseurs commentaires/photos, soit exactement ce qu'un serveur antérieur
recevait) ; le serveur continue d'accepter `since` seul comme repli pour les
trois flux. Aucune des deux moitiés ne régresse si l'autre n'est pas à jour.

**Tests** `src/integration/synchro-voie-de-retour.test.ts` (24 cas).
`clock-and-truncation.test.ts` vérifiait le curseur en lisant le TEXTE du source
(`Math.min(...stamps.map`) : remplacé par deux cas portant sur le comportement.

**Statut** `VERIFIED` côté poste. **`FIXED_NOT_FULLY_VERIFIED` côté cloud** : la
moitié serveur (curseurs par flux, `truncated`, relecture des photos sur disque)
n'entre en vigueur qu'après **redéploiement du cloud**. Tant qu'il n'est pas
fait, le poste retombe sur le repli `since` et le défaut GF-030 subsiste en
production.

---

## GF-033 — Les horaires du garage n'étaient lus QUE par la grille (§14-15)

**Le défaut.** GF-021 avait branché la grille du planning sur les horaires
enregistrés. Tout le reste du raisonnement horaire continuait de retomber sur
les constantes 8 h – 18 h :

| Appelant | Effet mesuré |
|---|---|
| `JobModal` → « créneau auto » | 08:00 proposé à un garage ouvrant à 7 h ; créneau APRÈS la fermeture pour un garage fermant à 16 h — que la grille refusait ensuite d'afficher |
| `DashboardSections` → taux d'occupation | garage ouvert 8 h – 12 h, **complet**, affiché à **40 %** |
| `store.runAI` et `GET /api/suggestions` | créneaux libres inexistants annoncés, surcharge manquée |
| `store.redistributeAbsentMechanic` | interventions replacées hors de la grille affichée |

Et surtout, les bornes s'exprimaient en **heures entières** : 8 h 30 était
inexprimable, alors que la saisie l'exige.

**Correction (§136 — le composant partagé, pas dix rustines).** Les quatre
fonctions de `src/lib/utils.ts` (`findAvailableSlots`, `findBestSlot`,
`detectEmptySlots`, `calculateUtilizationRate`), `runAIEngine` et
`redistributeAfterAbsence` prennent désormais des **bornes en minutes**
(`{ debut, fin }`) au lieu de deux entiers d'heures. Les cinq appelants réels
passent `bornesAtelier(...)`. Le changement de signature est **détecté par le
compilateur**, jamais silencieux.

**Garde générique** `src/lib/planning/__tests__/bornes-partout.test.ts` : il
parcourt les sources, compte les arguments de chaque appel et échoue en nommant
le fichier fautif si un appelant omet les bornes. Vérifié en le mettant en
défaut volontairement → `components\JobModal.tsx → findBestSlot(4 arg.)`.

**Statut** `VERIFIED` (134 tests sur le lot planning).

---

## GF-034 / GF-035 — Portail refusé en bloc, ordre de réparation muet

**GF-034 — l'instantané portail dépassait le plafond de son propre récepteur.**
`buildPortalSnapshot` autorisait 24 photos de 400 Kio ; `POST /api/sync/portal`
refuse au-delà de **4 Mio sérialisés**. La borne par photo était de surcroît
**contournée** dès que la photo venait de la colonne `base64` — le cas NORMAL,
toute photo de mécanicien arrivant sur le poste avec `photoPath: null`.
Mesuré avant correction : **une seule** photo de mécanicien de 3 Mo →
`4 194 807` octets pour un plafond de `4 194 304` → 413 systématique ; 24 photos
« moyennes » → `12 456 009` octets. Le portail devenait définitivement
indisponible pour l'intervention, sous un message imputant le blocage au réseau.
Correction : borne par photo appliquée aux **deux** origines (mesurée sur les
octets décodés des deux côtés) + **budget global** de 3,5 Mio aligné sur le
récepteur, les photos écartées étant comptées dans `photosOmitted`.

**GF-035 — `finally` sans `catch`.** `WorkOrderModal.save()` et `handleSign()`
laissaient partir le rejet. Dans la PWA : rien ne se passe, l'utilisateur ferme
la modale, la saisie est perdue. Dans l'application packagée : le gestionnaire
`unhandledrejection` injecté par Electron pose un **bandeau plein écran sans
bouton de fermeture**, affichant le texte brut de la réponse serveur jusqu'au
redémarrage. Les deux disparaissent avec le `catch`.

Le message affiché passe par `src/lib/erreur-affichable.ts` : `messageErreur`
ne rend le texte du serveur que s'il en a la forme (court, sans balisage, sans
marqueur technique) et retombe sinon sur un texte neutre. `e.message.slice(0,
300)` aurait recollé trois cents caractères de pile d'appels dans un bandeau —
interdit par §83. Sont explicitement écartés : traces, pages HTML, URL
`postgres://`, codes Prisma, JWT, jetons `GF2.`, clés PEM.

**Tests** `src/integration/portail-instantane-borne.test.ts` (5 cas),
`src/lib/__tests__/erreur-affichable.test.ts` (22 cas, dont un garde
« aucun `finally` sans `catch` » dans WorkOrderModal).
**Statut** `VERIFIED`.

**Au passage.** Deux dépendances de hooks manquantes, signalées par ESLint et
non cosmétiques : `ScheduleBoard` bornait le glisser-déposer sur 8 h – 18 h même
après le chargement des vrais horaires (fermeture périmée) ; `page.tsx` omettait
`fetchHoraires`.

---

## GF-036 — Les chiffres du tableau de bord dérivaient et se contredisaient

| Défaut | Mesure AVANT | Après |
|---|---|---|
| Arrondi journalier à l'euro puis cumul | 7 j × 1 h 30 × 65 €/h → **686 €** | 682,50 € |
| Une journée isolée | **98 €** | 97,50 € |
| Marge pièces < 1 € (100,40 / 99,60) | **0 €** | 0,80 € |
| `confirmedRevenue` : ternaire, TTC contre HT | 1 300 € d'activité → **12 €** | 1 300 € |
| `confirmedRevenue` sur facture seule | **2 400 €** (TTC) | 2 000 € (HT) |
| Classement clients sur le nom libre | 3 graphies → **3 clients** | 1 |
| Deux graphies sans plaque | **2** | 1 |

**Ce que ça changeait.** Sur la fenêtre maximale de 90 jours, la dérive de
l'arrondi journalier atteint ±45 €. `lib/money` pose pourtant la règle inverse :
entiers de centimes, arrondi **en dernier**. Le classement des meilleurs clients,
lui, agrégeait sur `customerName` — du texte libre ressaisi à chaque
intervention : renommer une fiche client ne changeait rien, et un habitué
n'atteignait jamais le podium. L'identité fiable existe depuis GF-015
(intervention → véhicule → client) ; le repli sur le nom, insensible à la casse,
couvre l'historique et les interventions sans plaque.

**Formules divergentes** (02.2 / 02.3). `multiplyCents(toCents(prix), qté)`
arrondit le prix AVANT de multiplier — le motif que `lib/money` documente comme
fautif. Coût d'achat et taux horaire admettant quatre décimales, la carte de
rentabilité contredisait les rapports (297,00 € contre 299,97 €) et, sur la
facture imprimée, **la ligne de main-d'œuvre ne s'additionnait pas au
sous-total** (109,39 € affiché, 109,38 € compté). Une facture dont les lignes ne
tombent pas juste est une facture qu'un client conteste.

**Libellés qui promettaient l'impossible** (02.4 / 02.5 / 03.6). « Profit net »
et « BÉNÉFICE NET » désignaient (CA − coût des pièces) : une **marge brute**.
Aucun coût de main-d'œuvre n'entre dedans, et pour cause — le modèle n'en porte
aucun (`Mechanic` n'a ni salaire ni taux de revient ; `hourlyRate` est un tarif
de vente). Les seuils suivaient le même malentendu (20 % est un plancher de
marge nette). Renommés en marge brute, seuils recalibrés (45 % / 30 %). Et deux
indicateurs portaient tous deux « CA » sans qu'aucun écran les distingue : ils
s'appellent désormais **« CA potentiel atelier »** (valorisé depuis le planning)
et **« CA facturé encaissé »** (factures payées). Aucun calcul touché.

**Tests** `src/integration/statistiques-au-centime.test.ts` (9 cas).
**Statut** `VERIFIED`.

---

## GF-037 — Supprimer une pièce, et journaliser ce qui ENTRE en stock

**Une 500 au lieu d'un refus.** `JobPart.partId` est en `RESTRICT`. Supprimer
une pièce posée sur une intervention violait la clé étrangère ; le filet
générique de `withAuth` traduisait en « Une erreur interne est survenue ».
Reproduit : `Foreign key constraint violated`. La garde existante ne comptait
que les `StockMovement` — et poser une pièce n'en écrivait aucun jusqu'à GF-028,
donc le compteur valait zéro. Refus 409 explicite, nommant la pièce et le
nombre d'interventions.

**Le `partId` orphelin du poste.** Le schéma déclare `onDelete: SetNull` sur
`InvoiceLine.partId` et `QuoteLine.partId`, et la migration du CLOUD crée la
contrainte ; celle du POSTE n'a ajouté que des colonnes TEXT nues — SQLite ne
sait pas poser une contrainte sur une table existante. Sur un poste, la
suppression laissait un lien orphelin, et la facture devenait invalidable
(409 « Pièce introuvable ») sans rien pour guider. Le même geste passait côté
cloud. La route **fait désormais elle-même le détachement** avant de supprimer :
même état final des deux côtés, et aucune suppression aujourd'hui légitime n'est
refusée. Recréer les tables SQLite pour poser la contrainte aurait été tout sauf
minimal.

**Le journal ne voyait que des sorties.** Réception de bon de commande et retour
fournisseur — les entrées/sorties fournisseur du garage — n'écrivaient aucun
`StockMovement`. Un inventaire qui ne tombe pas juste n'avait donc aucune entrée
à confronter. Les deux chemins sont journalisés ; sur un plafonnement à 0 (stock
incohérent), le mouvement écrit est celui **réellement appliqué**, pas celui
demandé — le journal décrit le stock, pas l'intention.

**Quantité fractionnaire sur une ligne liée** (04.10). Le refus n'arrivait qu'à
la validation de la facture, sans dire quelle ligne ni que délier la pièce
suffisait. Le contrôle est remonté dans la modale, là où l'on sait désigner la
ligne. La règle du moteur de stock reste intacte.

**Tests** `src/integration/stock-suppression-et-entrees.test.ts` (8 cas).
**Réserve honnête** : le test s'exécute sur une base construite depuis le schéma
Prisma, donc **avec** la clé étrangère. Il prouve que le détachement a lieu ; il
ne peut pas reproduire l'orphelin, qui n'existe que sur un poste réel migré par
`src/lib/migrations.ts`. Statut du détachement : `FIXED_NOT_FULLY_VERIFIED`.
Le reste : `VERIFIED`.

---

## GF-038 — PWA mécanicien : fenêtre tenue à jour, photos réduites, droit explicite

**La PWA laissait naviguer hors du miroir.** Le poste ne remonte que
[J−7, J+30] (`syncWindow`), et le cloud ne purge que dans cette même fenêtre.
Au-delà, le miroir reste **figé** : une intervention de plus de sept jours, puis
réaffectée sur le poste, gardait éternellement son ancien état — et les flèches
de la PWA y menaient sans rien signaler. Le mécanicien lisait une affectation
qui n'existe plus, et pouvait y pointer son chrono. La lecture est bornée à la
fenêtre effectivement synchronisée (liste **et** ouverture de fiche), la réponse
annonce la fenêtre servie, les flèches s'arrêtent aux bornes, et une date hors
fenêtre est dite explicitement au lieu d'un écran vide.

**La photo partait brute.** Trois écrans réduisaient déjà l'image avant l'envoi,
chacun avec sa propre copie du même passage canvas. Le quatrième — celui qui
prend le plus de photos — envoyait le fichier de l'appareil tel quel. Trois
conséquences : refus « Photo trop volumineuse » sur un smartphone récent ;
photos entières recopiées jusque sur le poste ; instantané portail obèse refusé
en bloc (GF-034). Un seul module, `src/lib/photo-client.ts`, sert désormais les
quatre écrans (§136). Le ré-encodage JPEG règle au passage le **HEIC** des
sélecteurs Android, que la validation reconnaît mais que le stockage fichier
ignore — vignette cassée hors Safari.

**Droit explicite sur les pièces d'intervention.** `POST`/`DELETE
/api/jobs/[id]/parts` n'exigeaient aucune permission, alors que toutes les
autres routes touchant au stock exigent `stock:manage`. Y poser `stock:manage`
aurait cassé un usage nominal — l'écran ouvre explicitement l'ajout de pièces au
comptoir, qui détient `job:manage`. C'est donc `job:manage` qui est exigé :
la porte se ferme pour tout rôle sans droit sur les interventions, le comptoir
garde son accès (vérifié dans les deux sens).

**Reproduction avant correction** : 5 échecs / 13 — interventions à J−30 et J+60
servies, date hors fenêtre non signalée, fiche périmée ouvrable, et
`readAsDataURL` toujours présent dans l'écran mécanicien.

**Tests** `src/integration/pwa-fenetre-et-photos.test.ts` (13 cas),
`src/lib/__tests__/stock-parts.test.ts` étendu aux rôles (3 cas).
**Statut** `VERIFIED`.

---

## GF-039 — Réglages sans lecteur, écran muet, état de synchro invisible

**Deux réglages validés, persistés, jamais lus.** `warrantyMonthsDefault` était
accepté par le schéma, écrit en base, et affiché sous la mention « Appliquée
automatiquement à chaque nouvelle garantie » — mais aucun code ne le lisait :
toute garantie partait à 12 mois (mesuré : `expected 12 to be 24`). Le mensonge
était explicite. Même chose pour `loanerEnabled`, dont l'entrée de menu
s'affichait quoi qu'ait décidé le garage. Le panneau lui-même n'est **pas**
démonté : une réservation en cours resterait sinon inaccessible du jour où la
case est décochée. Repli sur l'activation — un réglage indisponible ne doit
jamais faire disparaître un module.

**Le même champ dans deux onglets du même modal.** Le taux horaire était
éditable dans « Entreprise » **et** « Fonctionnalités », chacun avec son propre
instantané chargé à son montage, chacun renvoyant l'objet complet. Enregistrer
l'un écrasait la saisie de l'autre — dans les deux sens, sans le moindre signe.
Le champ dupliqué est retiré ; le réglage reste éditable au seul endroit qui le
décrit correctement.

**Le bouton « Mettre à jour » sortait en silence.** Hors Electron, il lisait
`downloadUrl`/`releaseUrl`, deux noms que **seul** le processus principal
fabrique. Dans un navigateur, l'API renvoie `downloadPath` : les deux lectures
échouaient, `return` muet, un clic sans rien. Le champ est lu, et l'absence de
lien est dite.

**L'état de la remontée cloud est enfin visible.** Une remontée non confirmée
n'était que journalisée : le comptoir ne distinguait pas « le mécanicien a reçu
l'affectation » de « le cloud ne répond plus depuis dix minutes ». Le rattrapage
existe — la fenêtre entière repart au passage suivant — mais tant qu'il n'a pas
abouti, personne ne le savait. `/api/jobs/pulse` porte désormais `cloud: 'ok' |
'attente'` (deux valeurs fermées, aucune donnée d'activité), et le planning
affiche un bandeau non bloquant.

**Tests** `src/integration/reglages-enfin-lus.test.ts` (8 cas).
`taux-horaire-main-doeuvre.test.ts` verrouillait la PRÉSENCE du champ dupliqué :
réécrit pour verrouiller l'inverse — un seul éditeur.
`synchronisation-asymetrie.test.ts` exigeait `NextResponse.json({ v })` au
caractère près : rebasé sur le nouveau contrat, avec deux assertions **de plus**
sur l'absence d'agrégat brut. **Statut** `VERIFIED`.

---

## GF-040 — Modules complets, injoignables ; blocs sans écrivain

**L'ordre de réparation n'avait aucune porte.** `WorkOrderModal` existait
entièrement — routes serveur, signature du client, impression, préfixe de
numérotation réglable dans les paramètres — et il était l'unique appelant de
`/api/work-orders*`. Mais il n'était **importé nulle part** : aucun écran ne
pouvait l'ouvrir. Le catalogue de main-d'œuvre, dont il est le seul
consommateur, devenait par ricochet une saisie sans débouché. Un bouton dans la
fiche d'intervention referme les deux constats d'un geste.

**La garde existante ne pouvait pas le voir.** `routes-sans-appelant` cherche la
chaîne d'une route dans n'importe quel fichier source non-test : un composant
jamais monté satisfaisait la garde **en se citant lui-même**. Le nouveau garde
`composants-atteignables.test.ts` regarde qui IMPORTE le composant. Vérifié en
le mettant en défaut : `WorkOrderModal n'est monté par aucun écran`.

**Pièces de l'ordre de réparation : saisie 100 % libre.** Nom et référence
étaient deux champs nus — aucun rattachement au catalogue, aucun prix repris,
aucune disponibilité affichée. Le magasinier recopiait une référence à la main
pendant que la pièce existait à deux mètres. `PartAutocomplete` est branché. Le
verdict annonçait `partsJson` comme « un blob libre » : **c'est faux** — il
traverse `PartLineV1` (qui strippe en silence) ou `PartLineV2` (`.strict()`, qui
refuse). Sans ajouter `partId` aux deux schémas, le rattachement aurait disparu
au rechargement. Le champ est omis quand il est absent, pour que le JSON
canonique d'un document déjà **signé** ne bouge pas d'un caractère.

**Le devis généré perdait le lien vers la pièce.** Seul `InvoiceLine.partId`
engage le stock, et la conversion recopie fidèlement `QuoteLine.partId` — qui
n'était jamais renseigné. La facture issue d'un devis généré ne décrémentait
donc **rien** : les pièces sortaient de l'atelier sans quitter l'inventaire.
L'identifiant traverse désormais toute la chaîne (catalogue → proposition →
lignes persistées), suggestions comprises via un index nom/référence → id.

**`RepairTypePart` : un bloc d'interface sans écrivain.** Aucune route, aucun
écran, aucun jeu de démonstration, aucune sauvegarde n'écrit cette table. Le
bloc « pièces habituelles » était donc vide sur **toute** installation, et
relançait une requête à chaque changement de type d'intervention. Bloc et
composant retirés ; la route reste, sa lecture est correcte — c'est le côté
écriture qui n'existe pas. Un garde échoue si un écrivain apparaît un jour.

**Archiver un mécanicien était une impasse.** `DELETE /api/mechanics/:id` refuse
en 409 avec « Archivez-le : il sortira du planning en conservant ses données » —
vers un bouton qui n'existait nulle part, alors que la route `PATCH { archived }`
était écrite et fonctionnelle. Boutons Archiver / Réactiver ajoutés, motif du
refus enfin affiché. Le planning charge maintenant **aussi** les archivés : il
répartit les interventions par mécanicien connu, et celles d'un archivé ne
trouvaient plus de colonne — archiver quelqu'un effaçait visuellement son
travail. Un archivé n'occupe une colonne que s'il lui reste des interventions.

**Rendez-vous confirmé sur une journée pleine.** Rendez-vous et interventions
vivent dans deux tables sans lien : le comptoir confirmait au client une journée
déjà saturée, et personne ne s'en apercevait avant le matin même. La
confirmation refuse désormais en 409 quand les interventions du jour égalent ou
dépassent le nombre de mécaniciens disponibles. **Volontairement borné** : un
garage sans mécanicien enregistré n'a pas de capacité modélisée — le bloquer
casserait une fonction qui marchait. La création automatique de l'intervention
reste un chantier séparé (`Job.mechanicId` est obligatoire).

**Tests** `src/lib/__tests__/composants-atteignables.test.ts` (12 cas),
`src/lib/__tests__/or-pieces-rattachees.test.ts` (10 cas),
`quotes-generate.test.ts` étendu (2 cas). **Statut** `VERIFIED`.

---

## GF-041 — La suite de tests écrivait dans le Redis de PRODUCTION

**Découvert en cours de campagne**, pas dans la liste des constats. Le poste
porte un `.env` avec des identifiants Upstash **réels** ; `resolveBackend()` les
prenait sous vitest comme ailleurs. Deux conséquences, l'une mesurée :

- les tests dépendaient de leur **ordre d'exécution** — un fichier consommait le
  quota d'inscription portail, et `portal-account-takeover-v15` recevait un
  `429` qu'aucune de ses lignes n'expliquait (`expected 429 to be 201`) ; seul,
  le même fichier passait ;
- chaque `npm test` laissait des clés dans un service de production.

Sous test, le backend est désormais la mémoire locale. Le seul fichier qui
vérifie la SÉLECTION du backend ouvre explicitement la porte
(`GF_TEST_ALLOW_UPSTASH`) et fournit ses propres valeurs — jamais celles de
l'environnement. Deux cas verrouillent l'invariant, dont un qui piège `fetch`
pour prouver qu'**aucune requête ne part**.

**Statut** `VERIFIED`.

---

## Étape 14 — Audit PWA en navigateur réel (§14)

Mesures faites dans un **vrai Chromium** (Playwright), sur `ELECTRON=1 next
start -p 4111` pointant une base SQLite jetable, sur le build courant.

### Largeurs 320 → 1024 : 30 mesures

`scripts/recette-responsive-pwa.mjs` — 5 écrans × 6 largeurs (320, 360, 390,
414, 768, 1024). Captures et `rapport.json` dans `artifacts/recette-responsive/`.

| Critère | Avant | Après |
|---|---|---|
| Débordement horizontal de la page | **0/30** | 0/30 |
| Cibles tactiles < 44 px | **30/30** | 0/30 |

**Deux vraies trouvailles**, le reste étant du bruit de mon propre outil :

- **Bouton afficher/masquer le mot de passe : 16 × 16 px** sur `/login`,
  `/register` et l'onglet e-mail des réglages. Un doigt le rate et tape dans le
  champ, dont il déplace le curseur. Surface portée à 44 px sans bouger l'icône
  ni la mise en page (l'espace est celui du `pr-10` déjà réservé) ; libellé
  accessible ajouté.
- **Champs et boutons principaux à 42 px** (`py-2.5`) sur les trois écrans de
  connexion/inscription → `py-3`, soit 44 px.

**Deux faux positifs corrigés dans l'outil, pas dans le produit** : les halos
décoratifs en fond débordent géométriquement mais sont rognés par un ancêtre
`overflow: hidden` — ils ne font rien défiler ; et les liens EN LIGNE dans une
phrase sont explicitement exclus par WCAG 2.5.5.

**Une erreur de méthode, corrigée** : `/mechanic` redirige vers `/login` sans
session. Le rapport annonçait donc « mécanicien : OK » en ayant mesuré la page
de connexion. Le script relève désormais l'URL **réellement** atteinte et refuse
de conclure sur un écran redirigé. L'espace mécanicien authentifié reste donc
`NON TESTÉ` par cette recette.

### Service worker — mesuré, pas déclaré

| Constat | Valeur relevée |
|---|---|
| Enregistrement | `sw.js?v=1.1.0`, portée `/`, état **`activated`** |
| Page contrôlée par le SW | **oui** |
| `/login` **hors ligne** | **HTTP 200**, page complète rendue |

Erreurs de console hors ligne : `ERR_INTERNET_DISCONNECTED` sur
`/api/auth/session` — attendu, la coquille est servie et l'application se
dégrade sans écran blanc.

### PDF — GF-043 : un document que le garage ne pouvait pas envoyer

Chaîne complète exercée en navigateur (html2canvas + jsPDF, même règle de
découpage que le produit) : document A4 de largeur fixe, 4 pages, en-tête
`%PDF-1.3` valide, 4 objets `/Type /Page`, bande la plus haute **276,99 mm** ≤
277 mm utiles — le découpage ne déborde jamais.

Mais chaque page était ajoutée en **PNG** :

| Document | PNG | JPEG q=0,85 |
|---|---|---|
| Facture 1 page | **4,61 Mo** | 0,13 Mo (×35) |
| Facture 4 pages | **35,83 Mo** | 1,13 Mo (×32) |

Une facture d'une page à 4,6 Mo passe déjà mal en pièce jointe ; à quatre pages,
35,8 Mo dépassent la limite de **toutes** les messageries courantes (Gmail :
25 Mo). Le garage produisait un document qu'il ne pouvait pas transmettre, et
l'échec survenait chez son fournisseur de messagerie — loin de l'application,
sans le moindre message. Fichier réel après correction : **1,18 Mo**.

Le JPEG n'a pas de couche alpha : sans conséquence, la bande est remplie en
blanc opaque avant le dessin (invariant verrouillé par test).

**Tests** `src/lib/pdf/__tests__/poids-pdf.test.ts` (4 cas). **Statut**
`VERIFIED` pour les écrans publics, le service worker et le PDF ;
**`NON TESTÉ`** pour les écrans exigeant une session (mécanicien, portail
connecté, poste).

---

## Étape 15 — Copilote : le dernier maillon (§15)

Le moteur, ses résolveurs, le cloisonnement multi-garage, le contrôle d'accès
financier et l'ancrage des reformulations LLM étaient **déjà couverts** (37
tests unitaires + 13 d'intégration, tous verts). Ce qui ne l'était pas : la
sortie du parcours.

Le copilote n'écrit jamais lui-même — il propose, l'utilisateur confirme, et le
panneau **passe la main** à l'écran réel. Si une intention d'action n'a pas de
destination dans `handleCopilotAction`, la confirmation ferme le panneau et
**rien ne se passe** : le garagiste a validé une action qui n'existe pas. Les
cinq intentions actuelles sont bien câblées ; rien n'empêchait la sixième de ne
pas l'être.

`src/lib/copilot/__tests__/copilot-chaine-complete.test.ts` (10 cas) verrouille
la chaîne : chaque intention d'action a un `case`, chaque `case` ouvre
réellement un écran, le panneau relaie la confirmation, et il ne parle qu'à
`/api/copilot` (toute autre écriture court-circuiterait le verrou).

Vérifié en le mettant en défaut : une intention ajoutée sans destination fait
échouer le garde en la nommant. **Statut** `VERIFIED`.

---

## Étape 19 — Scénario maître (§96)

`src/integration/scenario-maitre.test.ts` — une journée d'atelier enchaînée sur
une base SQLite réelle, à travers les **vrais** gestionnaires de route, chaque
étape contrôlée en base et non sur un code 200 :

1. planifier une intervention **crée** le client et le véhicule (GF-015) ;
2. poser une pièce décrémente le stock **et** journalise (GF-028) ;
3. le devis est rattaché au client, pas à son nom ;
4. la conversion produit une facture cohérente, le devis passe `converted`, et
   les lignes reprises d'une intervention restent **non rattachées** au stock —
   les pièces en sont déjà sorties (pas de double décrément) ;
5. émettre puis encaisser n'entame pas une seconde fois le stock ;
6. les statistiques rendent 130 € de main-d'œuvre, 36 € de pièces, 166 € au
   total et 18 € de marge — **au centime** (GF-036) ;
7. supprimer l'intervention **rend** les pièces, solde du journal nul, pierre
   tombale posée, et la facture émise **survit** ;
8. le garage voisin n'a rien reçu, sur six tables.

**Ce que ce test ne couvre pas, et qui doit être dit** : le parcours dans un
NAVIGATEUR (clics, modales, rendu). La suite `e2e/` existe et démarre, mais son
`global-setup` exige `E2E_EMAIL`, `E2E_PASSWORD` et `E2E_LICENSE` — aucun n'est
configuré ici, et en fabriquer une licence consommerait un siège d'appareil sur
le parc réel. **Statut** `VERIFIED` pour la chaîne API ; **`BLOCKED`** pour le
parcours navigateur authentifié, motif : identifiants E2E absents.

---

## Budget de performance — moitié réparée, moitié assumée

`check:perf-budget` était **rouge avant la campagne** et l'est resté ; j'y avais
moi-même ajouté du poids en montant l'ordre de réparation.

| Mesure | Avant | Après |
|---|---|---|
| Plus gros bloc JS | **596,9 Kio** (budget 512) | **322,5 Kio** ✅ |
| Total JS client | 3,28 Mio (budget 3,00) | **3,29 Mio** ❌ |

Vingt-deux panneaux ouverts à la demande (tableau de bord, stock, réglages,
facturation, copilote, fournisseurs…) passent en chargement différé : le bloc
d'entrée — celui que **tout** garagiste paie à chaque ouverture — tombe sous le
budget avec 37 % de marge. Le TOTAL, lui, ne bouge pas : le code est découpé,
pas supprimé. Le réduire suppose d'alléger les dépendances, ce qui déborde de
cette campagne.

**Le budget n'a PAS été relevé** : le faire passerait le contrôle au vert sans
rien changer au produit. Statut du total : `FAILED`, assumé et chiffré.

Deux gardes ont dû apprendre l'import différé (`composants-atteignables`,
`portal-access-reachable`) : ils exigeaient la forme `import X from`, et
auraient échoué sur du code plus sain que celui qu'ils protègent.

---

## 15/08/2026 — Déblocage des migrations serveur Neon

`npm run db:server:deploy` échouait sur `20260804000000_mechanic_licenses`
(P3018 / 42701 « column "parentLicenseId" already exists »). Deux constats ont
levé le blocage sans rien reconstruire.

**1. Prisma ne lit pas `prisma/migrations/`.** Le schéma serveur pointe sur
`prisma/server/migrations/` (20 dossiers). `prisma/migrations/` est le dossier du
POSTE (2 dossiers, SQLite) — d'où le « chemin d'accès introuvable » en inspectant
la migration incriminée.

**2. La base a été construite hors lignée.** `_prisma_migrations` portait 13
enregistrements dont 7 à `applied_steps_count = 0` : marqués appliqués sans
jamais avoir été exécutés par Prisma. Cinq migrations enregistrées en base
n'existent nulle part dans le dépôt (`0_init`, `add_app_release`,
`control_plane_extensions`, `add_einvoice_persistence`,
`accounts_and_subscription`) — lignée « control plane » consolidée lors de
l'introduction de `20260730120000_init_server`.

Un audit lecture seule (`scripts/audit-neon-mechanic-licenses.mjs`) a confronté
les **162 lignes** de la migration à la base, opération par opération : 7
colonnes, 3 tables, 17 index, 20 contraintes — **toutes présentes**. Le
`resolve --applied` antérieur était donc cohérent : aucune réparation nécessaire.

### Le vrai danger était ailleurs

`20260805000000_job_timer_accumulated` a été marquée appliquée sur comparaison
**exhaustive** (fichier d'une seule instruction ; `Job.timerAccumulatedSec`
présent en `integer NOT NULL DEFAULT 0`, à l'identique). Le déploiement a ensuite
appliqué 4 migrations puis buté sur `20260807000000_money_scaled_units` —
**son propre garde-fou** : `1 LoanerReservation divergent(s)`.

L'enquête a révélé un défaut bien plus grave que le blocage :

> `money_scaled_units` recalcule les colonnes monétaires entières depuis les
> anciennes colonnes Float **sans condition**. Or le schéma serveur ne déclare
> plus ces Float : Prisma Client ne peut plus les écrire. Toute ligne créée
> depuis porte le montant **uniquement** dans la colonne entière.

**37 lignes** étaient dans ce cas, et la migration les aurait remises à zéro —
sans alerte, son contrôle trouvant le résultat cohérent avec sa source :
`LaborOperation.unitPrice` ×32 (2 668,00 €), `InvoiceLine.unitPrice` ×2
(94,00 €), `InvoiceLine.quantity` ×1, `LoanerReservation.dailyRate` ×1
(50,00 €/j), `LoanerReservation.depositAmount` ×1 (199,00 €).

Le prétendu « conflit » sur la quantité de facture s'est dissous : la ligne porte
`quantity = 1` et `unitPrice = 0`, soit exactement les **valeurs par défaut** des
colonnes, sur une facture du 13/08 créée par le code actuel. Une ligne dont le
prix n'a jamais été écrit dans le Float n'a pas pu y voir écrire sa quantité.

### Correction

Nouvelle migration `20260806300000_money_reconcile_float_sources`, insérée entre
`money_cents` (dernière appliquée) et `money_scaled_units`. Elle écrit
**uniquement** dans les anciennes colonnes Float, et seulement là où elles ne
portent aucune information, en les alimentant depuis l'entier. Aucune colonne
entière n'est touchée. Contrôle bloquant final : s'il reste une ligne « Float
vide / entier renseigné », la transaction est annulée.

Sans effet sur une base neuve (les colonnes entières n'existent pas encore à ce
stade : chaque couple est ignoré si l'une des deux colonnes manque). Les colonnes
remplies sont transitoires — `money_drop_floats` les supprime deux migrations
plus loin.

**11 migrations appliquées**, jusqu'à `20260814200000_workshop_half_hours`.
`migrate status` : *Database schema is up to date!*

Preuve d'absence de perte — aucune somme entière n'a diminué :

| Colonne | Avant | Après |
|---|---|---|
| `InvoiceLine.unitPriceTenThousandths` | 940 000 | 6 690 000 |
| `InvoiceLine.quantityTenThousandths` | 140 000 | 140 000 |
| `LaborOperation.unitPriceTenThousandths` | 26 680 000 | 80 040 000 |
| `LoanerReservation.dailyRateTenThousandths` | 500 000 (1 ligne) | 1 000 000 (2) |
| `LoanerReservation.depositAmountCents` | 34 900 (2 lignes) | 34 900 (2) |

Les hausses sont le backfill légitime des 75 lignes anciennes où seul le Float
portait la valeur — 64 opérations de main-d'œuvre affichaient 0,00 € en base.

### Deux gardes réparées au passage

`check:money-json` et `check:branding` échouaient **depuis la veille au soir**
(horodatages : gardes 17:16, fichiers fautifs 20:07 / 20:53 / 21:47 / 22:19) :
des fichiers ajoutés par la campagne, jamais déclarés dans les listes
d'exemption prévues par ces gardes. Aucune règle n'a été modifiée — quatre
enregistrements précis (fichier + fragment + justification) via les mécanismes
existants `ALLOWED` et `V1_FIXTURE_FILES`. `check:consistency` : 12 gardes ✅.

---

## 15/08/2026 — Déploiement cloud : incident, repli, cause racine

Après la migration Neon, `vercel deploy --prod` a été lancé. Le déploiement est
passé `READY` et a été aliasé — puis **toutes les routes dynamiques ont répondu
500** : `/api/health` et `/api/auth/providers`, qui répondaient 200 deux minutes
plus tôt. Repli sur le déploiement précédent en ~3 minutes, vérifié
(`{"status":"ok"}` 200, `/api/auth/providers` 200, `/login` 200).

### Cause racine

`src/lib/env.ts` (validateur exécuté au démarrage via `src/instrumentation.ts`,
tous deux datés du 14/08 17:16, donc **absents du déploiement alors en ligne**)
refusait de démarrer : `DATABASE_URL` ne satisfaisait pas
`/^postgres(ql)?:\/\//`. Le serveur Next.js ne se préparait pas — d'où le 500
généralisé.

La valeur côté Vercel commence par **un caractère parasite suivi de
`postgresql`** : le guillemet double des lignes de `.env`, recopié tel quel.
dotenv retire ces guillemets à la lecture, ce qui explique que toutes les
commandes locales — dont les migrations du jour — fonctionnent parfaitement.
Vercel conserve la valeur littérale.

Le déploiement en ligne, lui, atteint bien PostgreSQL (cinq
`POST /api/license/check` en `info`, sans erreur, sur une route qui lit
`LicenseKey`) : il détient donc une valeur antérieure et propre. L'hypothèse
d'une base SQLite éphémère en production est écartée.

### Deux défauts corrigés

**1. Le message de diagnostic mentait.** `isSqlite || !isPostgres` produisait
« SQLite/stockage local interdit » même quand la vraie condition était « schéma
non reconnu » — ce qui envoie chercher une base locale là où le défaut est un URL
malformé. Les deux cas sont désormais distingués, et le message expose le
**schéma seul** via `schemeOf()` : un guillemet parasite apparaît en
`?postgresql`, sans jamais divulguer hôte ni identifiants. 3 tests ajoutés, dont
un qui vérifie explicitement l'absence de fuite.

C'est ce message corrigé qui a livré la réponse : `schéma non reconnu
(« ?postgresql »)`.

**2. `/api/health` ne peut pas détecter ce qu'il devrait.** Il conclut sur
`SELECT 1`, qui réussit aussi sur un SQLite vide. En production PWA, il
répondrait donc `ok` sur une base locale éphémère sans aucune donnée —
exactement le scénario que `env.ts` existe pour empêcher. Constaté, **non
corrigé** dans cette passe : `NON TESTÉ`.

### Diagnostic sans indisponibilité

La seconde tentative n'a **pas** fait tomber la production : le repli l'avait
épinglée sur l'ancien déploiement, si bien que le nouveau a été construit sans
être promu. Sondé via `vercel curl` (protection de déploiement active), il a
reproduit le 500 en isolation. À retenir : après un `vercel rollback`, un
`vercel deploy --prod` **ne se promeut plus automatiquement**.

### Reste à faire

Retirer les guillemets de `DATABASE_URL` et `DIRECT_URL` côté Vercel Production,
lever l'épinglage, redéployer, vérifier. `PWA_DATABASE_URL` et `PWA_DIRECT_URL`
existent mais ne sont lues par aucun fichier du dépôt : inertes.

---

## 15/08/2026 — Audit total des variables d'environnement, normalisation canonique

L'incident `PWA_DATABASE_URL` n'était pas un accident isolé mais le symptôme d'un
défaut d'architecture : **rien n'empêchait deux noms de désigner la même
configuration**. Cet audit établit la règle inverse — une configuration, un nom
canonique, le même partout — et la fait tenir par une garde automatique.

### Inventaire

1 082 fichiers balayés, toutes formes d'accès confondues (`process.env.X`,
`process.env['X']`, `env("X")` Prisma, `$env:X` PowerShell, `${{ secrets.X }}`,
`os.environ`, déclarations `.env`). 300 noms bruts, dont 204 n'étaient que des
mentions de documentation (statuts, titres de rapports) : **96 noms retenus**,
84 réellement lus par du code.

Un registre existait déjà : `scripts/garageflow-env-manifest.json`, 120 variables
avec rôle, portée, sensibilité et consommateurs, verrouillé par
`env-manifest-drift.test.ts`. Il a été **étendu**, jamais dupliqué — le §13 de la
mission interdit les validateurs concurrents.

### Le mécanisme d'alias, en détail

`RESET-GARAGEFLOW` écrivait `PWA_DATABASE_URL`/`PWA_DIRECT_URL` chez Vercel avec
la MÊME valeur que `DATABASE_URL`/`DIRECT_URL`, puis injectait dans une **copie
de préparation** de `src/instrumentation.ts` un bloc recopiant les premières vers
les secondes au démarrage. Ce patch ne vivait pas dans le dépôt : tout
déploiement fait autrement — `vercel deploy --prod` — démarrait sans la recopie.
D'où la production en 500 quelques heures plus tôt.

Supprimés : la fonction `Ensure-PwaRuntimeDatabaseOverride` (51 lignes) et son
appel, l'écriture des deux variables, leur présence dans les listes de secrets.
Ajouté : une boucle qui **supprime** de Vercel les alias historiques, sur le
modèle du nettoyage déjà en place pour `DESKTOP_DATABASE_URL`.

### Huit alias interdits

| Alias | Canonique | Statut |
|---|---|---|
| `PWA_DATABASE_URL` | `DATABASE_URL` | supprimé du code et du manifeste |
| `PWA_DIRECT_URL` | `DIRECT_URL` | supprimé du code et du manifeste |
| `NEXT_PUBLIC_APP_URL` | `GF_APP_URL` | retiré de la chaîne de replis |
| `DESKTOP_DATABASE_URL` | `DATABASE_URL` | déjà nettoyé, désormais banni |
| `DATABASE_URL_UNPOOLED` | `DIRECT_URL` | nom Neon, désormais banni |
| `SERVER_DATABASE_URL`, `NEXT_DATABASE_URL`, `DB_URL` | `DATABASE_URL` | préventif |

**`NEXTAUTH_URL` a été CONSERVÉE comme réellement distincte** : elle appartient à
next-auth (§22) et n'est lue par `publicAppUrl()` qu'en dernier recours, validée
— sous Electron elle vaut `http://localhost:4028` et se fait écarter. Ce n'est
pas un alias, c'est un emprunt documenté.

`NEXT_PUBLIC_APP_URL`, elle, était un troisième nom sans justification :
`public-url.ts` n'est importé que par des routes d'API, la valeur n'atteignait
donc jamais le navigateur et le préfixe annonçait une exposition inexistante
(§48). Aucun outillage ne la provisionnait.

### Quatre défauts trouvés par la garde en s'écrivant

1. **`GF_APP_URL`** : marquée `status="absent-consumer"` avec un consommateur
   `src/lib/app-url.ts` **inexistant**, alors qu'elle est lue par
   `src/lib/public-url.ts`. Statut et consommateurs corrigés.
2. **`GF_SMTP_CIPHER_KEY`** : même mensonge — marquée absente, lue par
   `secret-cipher.ts` et `electron/main.js`. Corrigée.
3. **`UPSTASH_REDIS_TIMEOUT_MS`** : provisionnée à `8000` en production, **lue
   par personne** — le délai Upstash est codé en dur à 1500 ms dans
   `rate-limit.ts:123`. Le tableau de bord Vercel annonçait 8 s pour un
   comportement réel de 1,5 s. Provisionnement retiré ; la recâbler ferait
   passer le délai à 8 s en production, décision produit laissée ouverte.
4. **Onze variables faussement « inertes »** : `RATE_LIMIT_*` et
   `EINVOICING_*_ENABLED` sont lues **indirectement** par `envInt()` et
   `boolEnv()`. Ni ma garde ni le test de dérive historique ne voyaient ces
   appels. Motif ajouté — angle mort corrigé pour les deux.

### Ce qui protège désormais

`npm run check:env-consistency` (dans `check:consistency`, donc dans
`release:gate`) échoue sur : alias réapparu, variable lue non déclarée, variable
devenue inerte sans être marquée, **statut périmé dans l'autre sens**, typo à
moins de deux caractères d'un nom canonique, nom non canonique dans un
`.env.example`, secret exposé au navigateur, documentation désynchronisée.

`npm run check:env-vercel` compare les NOMS du contrat à ceux de Vercel — jamais
les valeurs. `ENVIRONMENT-VARIABLES.md` est **généré** depuis le manifeste.

Les exemptions suivent la convention du dépôt : fichier + fragment + motif, avec
échec sur exception morte. Un seul fichier bénéficie d'une exemption entière —
`env-contract.test.ts`, dont l'objet est précisément d'employer les formes
interdites pour prouver leur rejet.

### Résolution : le caractère était `U+FEFF`

Le diagnostic amélioré, en affichant le POINT DE CODE plutôt qu'un « ? », a
nommé le coupable : **`U+FEFF`**, marque d'ordre d'octets, en tête de
`DATABASE_URL` chez Vercel. Strictement **invisible** — aucune correction
visuelle dans l'interface ne pouvait l'atteindre, ce qui explique qu'une première
tentative de correction manuelle ait échoué sans que rien ne le laisse voir.

Origine : une saisie manuelle dans le tableau de bord. `Clean-InputValue` du
script de reset retire précisément `[char]0xFEFF` — une variable posée par le
script n'aurait jamais eu le problème.

Corollaire enfin compris : la production tenait parce qu'elle tournait sur un
déploiement produit par RESET-GARAGEFLOW, dont l'override lisait
`PWA_DATABASE_URL` — provisionnée par le script, donc nettoyée. Le `DATABASE_URL`
corrompu n'était jamais lu. L'alias masquait le défaut : exactement ce que cet
audit avait pour objet de supprimer.

**Séquence appliquée** — `DATABASE_URL` et `DIRECT_URL` supprimées puis recréées
depuis les valeurs de `.env` nettoyées (BOM, espace de largeur nulle, NUL,
guillemets), sans jamais afficher de valeur ; déploiement construit **sans
promotion** grâce à l'épinglage ; sondé en isolation (`/api/health` 200 avec
`SELECT 1` réel, `/api/auth/providers`, `/login`) ; **promu** ; production
vérifiée ; puis seulement, suppression des alias `PWA_*` devenus inertes.

Production : `/api/health`, `/api/auth/providers`, `/login`, `/clients/login`
répondent 200. `check:env-vercel` : 9 requises présentes sous leur nom canonique,
**zéro alias interdit**.

### Suite : `UPSTASH_REDIS_TIMEOUT_MS` supprimée, puis rendue réelle

La variable inerte a d'abord été supprimée de Vercel — après vérification qu'aucun
fichier exécutable ne la lisait. Le délai est ensuite devenu **réellement
configurable** : résolution et bornes dans `src/lib/env.ts` (le validateur
central ; `rate-limit.ts` l'importe déjà, l'inverse créerait un cycle), défaut
**1500 ms** — exactement la valeur qui était codée en dur, donc production
inchangée sans variable définie.

Bornes `[100, 10000]` ms, et **refus de démarrer** hors bornes en production PWA
plutôt qu'un rognage silencieux : le limiteur est fail-closed, un « 15000 » saisi
pour « 1500 » ferait patienter chaque requête critique dix fois trop longtemps
avant le même refus. Hors production PWA, repli sur le défaut sans blocage.
7 tests ajoutés, dont la non-régression du défaut.

---

## 15/08/2026 — Mise en production de la version auditée (instantané figé)

Objectif : que le code portant **3 296 tests verts** soit exactement celui qui
tourne en production — pas un code rebâti après coup.

### Avant déploiement

| Contrôle | Résultat |
|---|---|
| `UPSTASH_REDIS_TIMEOUT_MS` chez Vercel | **absente** (défaut 1500 ms conservé) |
| `DATABASE_URL` / `DIRECT_URL` | présentes |
| `PWA_DATABASE_URL` / `PWA_DIRECT_URL` | **absentes** |
| `check:env-vercel` | ✅ |
| `check:consistency` | ✅ 13/13 |
| `type-check` | 0 |
| Suite | 3296 ✅ / 0 ❌ / 28 ignorés (3324) |

### Déploiement sans aliasage

La production n'étant plus épinglée depuis la promotion précédente, un
`vercel deploy --prod` aurait aliasé immédiatement. D'où **`--skip-domain`**,
qui construit une version de production sans lui attribuer le domaine. Vérifiée
en isolation via `vercel curl`, puis **promue sans reconstruction** : le binaire
vérifié est celui qui sert.

```
dpl_CRsSnWNwZG7cwgtwueniuMgM1nN7 · garagesite5-qqk6mrnv7 · app.garageflows.fr
```

### La dernière réserve est levée

Il restait à prouver l'accès à une vraie **table** PostgreSQL, et non au seul
`SELECT 1` de `/api/health`.

Constat en chemin : aucune page serveur ni route `GET` non authentifiée ne lit
de table — toutes les lectures métier sont en `POST` ou derrière une session.
Sur un déploiement protégé, `vercel curl` ne transmet ni en-tête ni corps, et la
création d'un lien de contournement a échoué. **L'étape n'était donc pas
réalisable avant promotion** : elle a été faite juste après, repli armé.

```
POST /api/license/check  { deviceToken: <inexistant>, installId, version, platform }
→ 200 en 0,5 s   {"allowed":true,"status":"unknown","deviceRequired":true}
```

Chaîne vérifiée dans le code : chemin 1 → `validateDeviceToken()` →
`prisma.licenseDevice.findUnique({ where: { tokenHash } })` sur PostgreSQL →
introuvable → `deviceFailureResponse('device_unknown')` retourne exactement ce
JSON. Une panne d'infrastructure aurait produit `infraFailure()`, soit un 503.

Sonde **strictement en lecture** : sur ce chemin `validateDeviceToken` exécute un
seul `findUnique` et retourne avant tout `update`, `create` ou journal d'audit —
vérifié à `src/lib/license/devices.ts:339-340`. Aucune donnée de production
touchée.

### Après promotion

`/api/health`, `/api/auth/providers`, `/login`, `/api/license/status`,
`/clients/login` : **200**. Journaux : aucune erreur, ni environnement, ni
Upstash/Redis, ni instrumentation. Aucun repli n'a été nécessaire.

`/api/license/status` mérite d'être noté : elle appelle `enforceRateLimit()`
avant toute autre chose, donc son 200 prouve qu'Upstash a répondu dans le délai
effectif de 1500 ms.

---

*Journal tenu au fil de la campagne. Les entrées suivantes s'ajoutent ici.*

---

## 15/08/2026 — Le travail entre sous contrôle de version

Demande : régénérer la baseline depuis le dépôt Git, pour qu'elle porte enfin une
identité de build.

**La demande reposait sur une prémisse fausse.** Le dépôt
(`claude/garageflow-final-unified-merge-ub0l67`, commit `0c9d468` du 14/08) était
en retard de **180 fichiers** : 110 différents, 70 absents. Il lui manquait non
seulement l'audit d'environnement du 15/08, mais l'essentiel de la campagne
elle-même — `erreur-affichable.ts`, `return-path.ts` et le reste n'existaient sur
**aucune branche**, locale ou distante. Lancer `baseline:generate` là aurait
mesuré un autre code et l'aurait estampillé d'un commit : précisément l'artefact
« vert mais mensonger » que cette campagne combat.

Le vrai risque révélé n'était donc pas la baseline, mais que 180 fichiers de
travail audité vivent hors contrôle de version.

### Report, et ce qu'il a fait apparaître

228 fichiers reportés, avec exclusion de `.env`, `keys/` et des artefacts. Deux
pièges évités : `keys/licenses_db.json` et `keys/server_config.json` seraient
devenus **suivis** (`.gitignore` ne couvre que `keys/*.pem`) ; et
`electron/main.js` porte la clé publique en dur — le porter aligne le dépôt sur
la clé réellement en service, sens déjà retenu par un commit antérieur.

La première suite dans le dépôt a **échoué** : 3 rouges, 40 ignorés. Trois causes,
aucune de code :

1. Mon report copiait sans **supprimer**. Deux fichiers effacés pendant la
   campagne survivaient (`client-memory.ts`,
   `JobDefaultPartsSuggestion.tsx`) et faisaient échouer les tests d'ABSENCE qui
   les traquent — ils faisaient exactement leur travail.
2. `prisma/garageflow-template.db` est **suivi** par git mais mon exclusion
   `*.db` l'écartait : le modèle livré datait d'avant les dernières colonnes, le
   contrôle de parité échouait et l'interférence faisait tomber
   `tenant-isolation` au passage.
3. Cinq tests de signature de licence s'ignoraient faute de `keys/private.pem`
   dans le dépôt — écart d'environnement, pas de code. Clé copiée localement
   (ignorée par git, jamais commitée).

Après correction : **3296 verts / 0 rouge / 28 ignorés (3324)**, parité exacte
avec le dossier de build.

### Résultat

```
2793633  feat(env): un nom canonique par configuration, et la campagne d'audit au complet
5228dca  chore(baseline): régénérée DEPUIS le dépôt — elle porte enfin une identité de build
```

Baseline : `commit 27936330…`, `gitIdentity: true`. Aucun `git push` — le travail
s'arrête au commit local, comme convenu.

---

## 15/08/2026 — Clé de signature des mises à jour : recherche, puis rotation

`release:publish` butait notamment sur l'absence de clé de signature. Recherche
exhaustive avant toute génération, car une rotation mal menée coupe le canal de
mise à jour du parc **sans recours logiciel** — l'en-tête du script le dit
lui-même.

### La clé `gf-update-2026` n'est pas sur cette machine

Balayage du profil (`Desktop`, `Downloads`, `Documents`, `.claude`,
`AppData\Roaming`), des dossiers de rotation, des autres volumes (il n'y a que
`C:`) et de tout dossier GarageFlows hors profil.

- **7 fichiers `private.pem` trouvés — tous EC**, ce sont les paires de
  *licences*. Aucune ne dérive vers l'ancre Ed25519.
- L'unique occurrence du préfixe PKCS#8 Ed25519 sur le disque est une phrase de
  la conversation d'audit elle-même. Aucune matière.
- `keys/server_config.json` ne contient que `url, api_key` ;
  `keygen_audit.log` ne trace que des licences ; aucun workflow CI ne référence
  de secret.

**Explication** : `sign-release-manifest.mjs --gen-key` n'écrit AUCUN fichier, il
affiche la clé avec la consigne « à conserver HORS du dépôt (coffre / secret
CI) ». La clé n'a donc jamais été écrite ici — ce n'est pas une perte par
négligence, c'est le comportement voulu de l'outil.

### Rotation

Nouvelle paire Ed25519 `gf-update-2026-2`, générée avec redirection vers un
fichier **hors du dépôt** : la clé privée n'a transité par aucun message.
Vérifiée : type ed25519, paire cohérente, distincte de l'ancienne, signature
d'essai validée.

`gf-update-2026` est **CONSERVÉE** dans `PUBLIC_KEYS`. La retirer couperait le
canal des postes qui ne connaissent qu'elle, et l'ancre reste le seul chemin qui
rétablirait leur mise à jour si la clé ressortait d'un coffre.

Défaut de `--key-id` porté à `gf-update-2026-2` : signer sous l'ancien
identifiant échouerait, faute de clé.

### Ce que cette rotation ne fait PAS

Elle **ne répare pas le parc existant**. Un poste installé avant aujourd'hui
exécute un code qui ne connaît que `gf-update-2026` et rejettera tout manifeste
signé par la nouvelle clé. Pour l'atteindre, il faudrait lui livrer une version
portant les deux ancres — livraison qui devrait elle-même être signée avec
`gf-update-2026`. Une nouvelle clé n'ouvre que l'avenir.

Vérification : 3296 verts / 0 rouge / 28 ignorés (3324) · tsc 0 · 13 gardes.

---

## 15/08/2026 — Budget de performance relevé, sur décision de l'exploitant

La campagne avait **refusé** de relever ce budget, au motif qu'il mettrait le
contrôle au vert sans alléger le produit. L'exploitant a tranché autrement pour
débloquer `release:publish`. La décision lui appartient ; elle est consignée ici
et dans `perf-budget.json` telle qu'elle est — un relèvement, pas une correction.

| | Avant | Après |
|---|---|---|
| Mesure réelle | 3 452 669 o (3,293 MiB) | **inchangée** |
| Budget | 3 145 728 o (3,00 MiB) | 3 625 984 o (3,46 MiB) |
| Marge | dépassement de +9,8 % | +5,0 % de marge |

Marge de 5 % retenue plutôt que les ~16 % de la référence d'origine : assez pour
absorber une variation mineure entre deux builds, assez serrée pour qu'une vraie
régression déclenche encore. Un budget large aurait transformé le contrôle en
décoration.

Le plus gros bloc reste à 322,5 KiB pour 512 de budget — 37 % de marge, acquis
par le découpage dynamique de la campagne. C'est le **total** qui n'a pas bougé,
et le réduire suppose d'alléger les dépendances, pas de redécouper.

`perf-budget.json` porte désormais les champs `raisedOn`, `raisedFrom` et
`raisedWhy` : quiconque relira ce budget saura qu'il a été déplacé, quand, et que
le produit n'a pas changé. Statut au rapport final : **BUDGET RELEVÉ**, jamais
« corrigé ».

---

## 15/08/2026 — LOT 3 : la facturation électronique cesse de refuser les postes

### Le défaut

Quatre routes répondaient `501 SERVER_ONLY` dès que l'installation tournait sur
un poste : configuration de la plateforme agréée, test de connexion, envoi d'une
facture, suivi du statut. Le motif technique était **exact** — les quatre
modèles d'e-facturation (`GarageEInvoiceConnection`, `EInvoiceTransmission`,
`EInvoiceEvent`, `EInvoiceAuditEvent`) n'existent que dans le schéma PostgreSQL,
dérogation documentée — mais la conséquence l'était tout autant : la
facturation électronique était **annoncée et inaccessible à tous les garages
travaillant sur poste**, c'est-à-dire à tous.

Retirer la garde `isPostgresDatabase()` aurait fait disparaître le 501 en le
remplaçant par un 500 opaque (`serverPrisma()` lève sur SQLite). Ce n'était pas
la garde qu'il fallait corriger, c'était l'architecture.

### La correction

```
Poste ──[licence GF2]──▶ /api/sync/einvoicing ──▶ PostgreSQL ──▶ adaptateur ──▶ plateforme
```

| Fichier | Rôle |
|---|---|
| `src/app/api/sync/einvoicing/route.ts` *(nouveau)* | Tunnel authentifié par licence GARAGE, 8 actions |
| `src/lib/einvoicing/desktop-bridge.ts` *(nouveau)* | Transport côté poste, aucune logique métier |
| `src/lib/einvoicing/test-connection.ts` *(nouveau)* | Test de connexion extrait, partagé par les deux chemins |
| `src/lib/einvoicing/submit.ts` | `motifNonTransmissible()` exporté et partagé |
| `connection/route.ts`, `connection/test/route.ts`, `invoices/[id]/submit/route.ts` | Délèguent au lieu de refuser |

La garde `isPostgresDatabase()` est **conservée** partout : seul ce qu'elle
déclenche a changé. Les identifiants de plateforme restent chiffrés au repos
côté cloud et ne redescendent jamais en clair.

### Trois divergences trouvées en chemin

Le tunnel est un canal ouvert à des postes : un poste est donc un client comme
un autre, et une garantie qui repose sur le contrôle qu'il veut bien faire avant
d'appeler n'est pas une garantie. Trois verrous de la route de session
manquaient côté tunnel et ont été ajoutés :

- `outgoingEnabled` sur `invoice.submit` — sans lui, un poste émettait malgré
  l'interrupteur fermé ;
- `connectionsEnabled` sur `connection.delete` — on pouvait **détruire** des
  identifiants sans pouvoir les ressaisir, le PUT étant fermé ;
- refus des factures en brouillon et annulées — transmettre une facture annulée
  créerait à la plateforme agréée une créance que le garage a précisément
  retirée.

Les drapeaux consultés sont ceux du **service**, jamais ceux du poste : un poste
n'a pas les variables `EINVOICING_*` (le reset ne les provisionne jamais), et
les lire localement aurait rendu la délégation inatteignable.

### Vérification

| Élément | Mesure |
|---|---|
| `status: 501` dans `src/app/api/einvoicing/**` | **0** (garde de corpus dédiée) |
| Tests ajoutés | 30 — `einvoicing-tunnel` (13), `desktop-bridge` (17) |
| Suite complète | 3 368 verts / 0 rouge / 28 ignorés (3 396) |
| `tsc --noEmit` | 0 erreur |
| Gardes `check:consistency` | 13 vertes |

**Épreuve par mutation** — quatre verrous retirés un à un, tests rejoués, code
restauré à l'identique (comparaison octet à octet) :

| Verrou retiré | Résultat |
|---|---|
| `outgoingEnabled` | 1 échec |
| refus brouillon/annulée | 2 échecs |
| `connectionsEnabled` | 1 échec |
| portée garage des transmissions | 1 échec |

### Statut

`FIXED_AND_VERIFIED` pour la chaîne poste → cloud : refus, portée garage,
identité par licence, verrous et relais sont exercés par des tests qui échouent
quand le code cesse de les honorer.

`BLOCKED_EXTERNAL_REQUIREMENT` pour le dernier maillon : l'émission **réelle**
vers une plateforme de dématérialisation partenaire exige un compte sur une
telle plateforme. Aucun n'est disponible. Ce maillon reste `NOT_VERIFIED` et
n'est pas présenté autrement.

### Hors périmètre, constaté et non corrigé

Trois `501` subsistent dans l'application, tous de cause différente — le
stockage photo (`GF_PHOTOS_DIR`) : `mechanics/[id]/avatar`, `photos/[...path]`,
`sync/mechanic-avatar`. Sur un poste packagé, Electron fixe toujours cette
variable et crée le dossier (`electron/main.js`) : ces gardes ne se déclenchent
jamais, elles sont légitimement fail-closed. Côté cloud, la variable n'est pas
provisionnée et un stockage sur disque y serait vain (système de fichiers
éphémère) : les avatars poussés par un poste reçoivent un 501, journalisé, sans
boucle de relance. Corriger cela suppose un stockage objet (Vercel Blob, S3),
c'est-à-dire un service externe à provisionner —
`BLOCKED_EXTERNAL_REQUIREMENT`, pas un défaut de code.

---

## 15/08/2026 — LOT 4 : le Copilot, audité puis corrigé

### La découverte qui commande tout le reste

`resolveLlmProvider()` rend `null` **en dur** (`src/lib/copilot-llm/provider.ts`).
Aucune variable d'environnement n'est lue — zéro `process.env` dans tout
`src/lib/copilot-llm/`. Le Copilot livré est un **routeur déterministe par
mots-clés** ; `phrasing === message`, toujours.

Ce n'est pas un défaut : c'est un point d'extension documenté, et le repli sert
au garagiste une vraie réponse chiffrée. Mais il classe tout le reste : les
faiblesses du prompt et du garde-fou d'ancrage sont **latentes**, pas
exploitables. Les présenter comme des failles ouvertes aurait été faux.

Statut du fournisseur LLM réel : **`BLOCKED_EXTERNAL_REQUIREMENT`** — aucune clé
`ANTHROPIC_API_KEY` n'est configurée, et le manifeste rattache cette variable au
seul `plate-ocr`.

### Méthode

Cinq lecteurs indépendants (fournisseur, isolation, injection, écritures,
couverture), puis un **réfutateur par dimension** chargé de démolir chaque
constat en relisant le code lui-même. Sur **43 défauts allégués, 12 ont
survécu** — les 31 autres décrivaient du code exact mais des conséquences
inatteignables. Le tri comptait autant que la recherche.

### Corrigé et vérifié

| Défaut | Correction | Épreuve par mutation |
|---|---|---|
| **P2 — Le coût d'achat fuyait** : « quelles pièces sont en rupture ? » livrait `estimatedCost` et « coût estimé 450 € » à tout rôle authentifié ; `/api/stock-forecast` faisait de même, sans aucun contrôle | `redactReorderCosts` (authz.ts), appliqué au copilote **et** à la route jumelle — on retire le champ, pas la réponse (GF31-AUD-009) | 3 mutations → 3 échecs |
| **P3 — L'écusson « vérifié » ne signalait rien** : affiché dès que `phrasing` existait, donc aussi sous une erreur de base | Le serveur rend son verdict (`ancrage.verifie`) et la provenance (`source`) ; le panneau le lit | 5 mutations → 3 détectées, 2 clauses défensives assumées |
| **P3 — Montant calculé hors couche monétaire** : `round2` maison sur `estimatedCost` et `totalOrderCost` (1,005 € → 1,00 € au lieu de 1,01 €) | `lineCents`/`toCents`, somme en centimes entiers ; `round2` conservé pour les grandeurs NON monétaires | 3 tests dédiés |
| **P1 — Un test qui ne testait pas** : la fenêtre de 120 caractères de `copilot-chaine-complete` débordait sur la branche suivante ; vider 4 des 5 actions du copilote ne rougissait rien | Découpage du corps réel de chaque branche + refus de se rabattre en silence quand la borne disparaît | branche du milieu vidée → 2 échecs (0 avant) |
| **P2 — Porte financière prouvée sur 1 résolveur sur 4** | Les quatre sont éprouvés contre RECEPTIONIST et MECHANIC | retrait d'un résolveur de la liste → 2 échecs |
| **P1 — Isolation garage prouvée sur 2 résolveurs sur 11** | Devis, meilleurs clients, marge, mécaniciens, retards — croisés avec un second garage, plus le contrôle symétrique | `garageId` retiré d'un `where` → échec |
| **P3 — Le type promettait l'inverse du code** : `PhraseInput.query` documenté comme « allowed number source » alors que l'ancrage porte sur les faits seuls | Commentaire corrigé — il invitait à « réparer » le code en supprimant la garantie | — |

### Consigné, non corrigé : les limites du garde-fou d'ancrage

Mesurées en exécutant `isGrounded`, pas supposées, et inscrites dans
`ground.ts` : il ne vérifie ni la **polarité** (« Aucun devis en attente » face à
« 12 devis en attente » → fondé), ni l'**unité** (250 % pour 250 €), ni
l'**appariement** chiffre ↔ grandeur, et sa tolérance est **relative** (999 €
d'écart acceptés sur un million).

Ce garde protège d'un montant **inventé** — ce pour quoi il a été écrit — pas
d'un mensonge construit avec les bons chiffres. Rien de tout cela n'est
atteignable sans fournisseur câblé. **Ces quatre points sont à traiter AVANT
d'en câbler un**, sans quoi l'écusson « vérifié » couvrirait des réponses
fausses. Ils ne sont pas « corrigés » ici : les corriger à l'aveugle, sans
fournisseur pour éprouver les faux positifs, aurait produit une garantie de
façade.

### Vérification

Suite : **3 435 verts / 0 rouge / 28 ignorés (3 463)** · `tsc` 0 · ESLint 0 ·
13 gardes vertes. **+67 tests** sur ce lot.

### Reste dû

`GET /api/parts` expose `unitCost` (prix d'achat) à tout rôle authentifié, comme
le faisaient les deux surfaces corrigées ici. Ce n'est pas traité : le champ
irrigue la construction des devis et le tableau de bord, et l'en retirer est une
**décision de produit**, pas un correctif évident. Signalé, mesuré, en attente
d'arbitrage.

---

## 15/08/2026 — LOT 2 : ce qui change entre le cloud et un poste installé

### Une garantie qu'on croyait perdue, et qui ne l'est pas

Cinq routes posent un verrou de ligne (`FOR UPDATE`, `pg_advisory_xact_lock`)
UNIQUEMENT `if (isPostgresDatabase())`. Sur un poste, ces verrous sont absents :
la garantie semblait s'évaporer selon le déploiement.

Elle a été **mesurée**, pas déduite. Deux transactions concurrentes lisant puis
écrivant la même facture, dans les deux configurations possibles :

```
journal_mode = delete   busy_timeout = 5000
un seul client, deux transactions  → la seconde lit APRÈS le commit → renonce
deux connexions distinctes         → la seconde lit APRÈS le commit → renonce
```

Prisma ouvre ses transactions SQLite en `BEGIN IMMEDIATE` ; la seconde attend au
lieu de lire une valeur périmée. PostgreSQL exige un verrou explicite parce qu'il
est MVCC — les lecteurs n'y bloquent pas les écrivains. **Le code est correct tel
qu'il est écrit** ; les cinq gardes ne sont pas un oubli. Ce résultat vaut tant
que le lire-puis-écrire reste DANS la transaction.

### Méthode

Quatre lecteurs (verrous, hors ligne, promesses d'écran, routes internes) puis un
réfutateur par dimension. **24 défauts allégués, 20 confirmés, 4 réfutés.**

### Corrigé et vérifié

**1. Régression que j'avais introduite au LOT 3.** `PUT /api/einvoicing/connection`
testait `connectionsEnabled` AVANT de déléguer au tunnel. Un poste n'a jamais les
variables `EINVOICING_*` : le drapeau y vaut toujours faux, donc **aucun garage
installé ne pouvait enregistrer sa plateforme** — alors que `DELETE`, lui,
déléguait avant le contrôle, si bien qu'on pouvait détruire une connexion sans
pouvoir la ressaisir. J'avais écrit ce raisonnement dans la route `submit` sans
l'appliquer ici. Corrigé, plus l'action `flags.get` : l'onglet affiche désormais
les drapeaux du SERVICE, et dit « service injoignable » au lieu de
« fonctionnalité désactivée ». *Mutation : l'ordre remis comme avant → 1 échec.*

**2. La sauvegarde n'était pas restaurable.** `runBackup()` copiait le fichier de
base avec `fs.copyFileSync`, toutes les heures, depuis le processus Electron,
pendant que le serveur écrivait. Le mode de journalisation mesuré est `delete` :
les pages modifiées vont dans le fichier PRINCIPAL pendant un commit, l'état
antérieur dans `-journal`. Une copie prise à cet instant est déchirée — elle a
l'air d'une sauvegarde et ne se restaure pas.

Remplacée par `POST /api/internal/backup`, qui exécute `VACUUM INTO` depuis le
processus qui DÉTIENT la connexion. **Aucun repli par copie d'octets** : une
sauvegarde manquante et signalée vaut mieux qu'une sauvegarde présente et
illisible. Deux faux succès corrigés au passage — le bouton « Sauvegarder »
répondait `success: true` sans attendre, et la sauvegarde pré-mise à jour ne
faisait que démarrer avant que l'installation ne commence.

`pre-migration-backup.js` copiait `-wal` et `-shm`, qui n'existent jamais en mode
`delete`, et **pas** `-journal`, qui existe. Corrigé. *Mutations : 4 échecs.*

**3. Une clé mécanicien révoquée hors ligne gardait son accès.** Deux défauts
enchaînés : une RÉATTRIBUTION ne remettait pas `cloudSyncedAt` à null — l'écran
affichait « Synchronisée » alors que le cloud associait encore la clé à l'ancien
mécanicien — et le rattrapage ne rejouait QUE les attributions, jamais les
révocations. Un mécanicien licencié pendant une panne ADSL conservait sa PWA
indéfiniment. `cloudSyncedAt` signifie désormais « le cloud connaît l'état ACTUEL
de cette clé » ; le rattrapage traite les deux canaux, et **retirer un accès
passe avant en accorder un**. *Mutations : 3 sur 3 détectées.*

### Vérification

Suite : **3 457 verts / 0 rouge / 28 ignorés (3 485)** · `tsc` 0 · ESLint 0 ·
13 gardes vertes. **+22 tests** sur ce lot.

### Reste dû — 17 constats confirmés, non traités

Les plus sérieux, dans l'ordre où je les traiterais :

- **« Ouvrir un accès » à l'espace client, sur un poste**, crée un `PortalUser`
  dans le SQLite local et dicte au garagiste un mot de passe à communiquer — pour
  un service qui ne le connaîtra jamais : aucune route `/api/sync/*` ne réplique
  ce modèle, et le serveur du poste n'écoute que sur `127.0.0.1`. P1.
- **Le lien de connexion envoyé au client ne porte pas `?garage=<slug>`.**
- **Les boutons « Messages » et « Rendez-vous »** ouvrent, sur un poste, des
  panneaux qui ne peuvent pas fonctionner.
- **Un poste installé pendant une coupure réseau se verrouille 30 s après
  l'ouverture** — `last_online.json` n'est écrit que dans la branche « en ligne ».
- **Le démarrage tient pour « prêt » n'importe quel serveur répondant sur le port
  4028**, sans vérifier que c'est le sien.
- **Le champ `recoverable` d'un échec de migration** est calculé par la route puis
  jeté par le poste : un échec rattrapable est présenté comme définitif.
- **Le panneau e-facturation d'une facture disparaît en silence** dès qu'une
  réponse n'est pas 200.
- **Sauvegarde et restauration logiques** prennent le verrou d'écriture même en
  lecture seule.

Ces constats sont vérifiés et localisés (fichier:ligne dans le journal de
l'audit) ; ils ne sont **pas** corrigés, et le lot n'est donc pas clos.

---

## 15/08/2026 — Accès client au portail : un mot de passe dicté pour rien

### Le défaut

Sur un poste, « Ouvrir un accès » créait un `PortalUser` dans le SQLite **local**,
répondait 201, et l'écran affichait « Accès prêt — communiquez le mot de passe
maintenant ». Un e-mail partait vers le client avec un lien
`app.garageflows.fr`.

Or le portail interroge la base du **cloud** (`/api/portal/auth/login`), aucune
route ne répliquait ce compte, et le serveur du poste n'écoute que sur
`127.0.0.1`. Le garagiste lisait donc à voix haute un identifiant et un mot de
passe pour un service qui ne les connaîtrait jamais — et se heurtait au refus de
connexion de son client sans aucun moyen de comprendre.

Second défaut, indépendant et suffisant à lui seul : le lien de connexion ne
portait pas `?garage=<slug>`. La route de connexion l'exige et répond « Garage
introuvable ou ambigu ». Même avec les bons identifiants, le client ne pouvait
pas entrer.

### La correction

`POST /api/sync/portal-account` — publication authentifiée par licence GARAGE,
même patron que les devis, les factures et le tunnel d'e-facturation.

| Décision | Motif |
|---|---|
| Le **haché bcrypt** transite, jamais le mot de passe | Le clair ne quitte pas la réponse rendue une seule fois au garage |
| `garageId` vient de la **licence** | Un `garageId` du corps ne doit jamais servir d'identité (GF31-AUD-003) |
| `clientId` forcé à `null` | La fiche client n'est pas publiée ; pointer vers un identifiant absent créerait une clé étrangère pendante |
| Adresse déjà prise dans ce garage par un **autre** compte → 409 | L'écraser volerait l'accès d'un client inscrit par lui-même, et le lui couperait sans explication |
| `revoquerAppareils` sur réinitialisation et désactivation | Couper un accès sans couper les sessions ne coupe rien tant qu'un cookie reste valide |
| Verrouillage par échecs remis à zéro à la republication | Un mot de passe remis doit rouvrir un compte bloqué |

Côté poste, les trois verbes publient et **rendent l'issue** (`publieEnLigne`,
`motifPublication`). Conséquences directes :

- l'e-mail au client n'est **pas** envoyé si la publication a échoué — il
  porterait un lien vers un refus ;
- l'écran affiche « Accès créé mais PAS ENCORE en ligne : *motif*. Ne
  communiquez pas encore le mot de passe. » au lieu de « Accès prêt » ;
- « Réinitialiser » est le geste de rattrapage : il republie, et l'écran le dit.

### Vérification

23 tests ajoutés (14 côté poste, 9 côté cloud). **Épreuve par mutation : 6 sur 6
détectées** — refus d'une adresse déjà prise, `garageId` de la licence,
révocation des appareils, publication à l'ouverture, e-mail retenu quand non
publié, slug dans le lien.

Suite : **3 481 verts / 0 rouge / 28 ignorés (3 509)** · `tsc` 0 · ESLint 0 ·
13 gardes vertes.

Au passage : mon test de sauvegarde écrivait ses `.db` transitoires sous la
racine du dépôt, ce qui faisait rougir la garde « aucun secret distribué »
lorsqu'elle balayait en parallèle. Déplacé dans le dossier temporaire du système.

### Réserve assumée

Il n'y a **pas** de rattrapage automatique : une ouverture faite hors ligne reste
non publiée jusqu'à ce que le garage clique « Réinitialiser ». Une reprise
automatique demanderait une colonne `cloudSyncedAt` sur `PortalUser` — donc une
migration sur le poste ET une divergence de schéma que la garde de parité
refuserait. Le choix est assumé et dit à l'écran, plutôt que masqué par un
silence.

---

## 15/08/2026 — LOT 2 (suite) : verrouillage au premier lancement, et rendez-vous invisibles

### 1. Un garage qui installe pendant une panne était verrouillé en 30 secondes

```js
const lastOnlineTs = rec?.ts ?? 0
const offlineMs    = Date.now() - lastOnlineTs
```

Sans état « dernière connexion » signé — le cas d'une installation NEUVE qui n'a
jamais joint l'autorité de licence —, l'origine valait **1970**. La durée hors
ligne dépassait cinquante ans, donc le seuil de 72 h : le logiciel se fermait
trente secondes après le premier lancement, sur « hors ligne depuis plus de
72 heures ». Un garage qui vient d'installer ne pouvait ni comprendre ni agir.

**Ce qu'il ne fallait pas faire** : écrire l'état au premier lancement. Effacer
`last_online.json` suffirait alors à rester hors ligne indéfiniment — le `?? 0`
était fail-closed à dessein.

**Ancrage retenu** : la date de création du fichier de base. Un repère que
personne ne remet à zéro sans perdre toutes ses données.

| Situation | Avant | Après |
|---|---|---|
| Installation neuve hors ligne | **verrou immédiat** | fonctionne |
| Installée depuis 50 h, jamais en ligne | verrou | avertissement |
| Installée depuis 4 jours, jamais en ligne | verrou | verrou (la grâce reste une tolérance) |
| `last_online.json` effacé, base ancienne | verrou | **verrou** (contournement refermé) |
| Horloge reculée | verrou | verrou |

La décision est extraite dans `electron/grace-hors-ligne.js` — un correctif
enfoui dans `main.js` n'aurait pas été éprouvable. 12 tests ; **3 mutations sur
3 détectées**, dont « grâce remise à zéro à chaque absence d'état », qui prouve
que l'anti-contournement est verrouillé lui aussi.

### 2. Le panneau « Rendez-vous » était vide pour toujours

Une demande n'est créée que par `/api/portal/appointments`, depuis l'espace
client — servi par le **cloud**. La voie de retour ne rapatriait que les
interventions, les notes et les photos : sur un poste, la table `Appointment`
restait vide indéfiniment. Le garagiste en concluait qu'aucun client ne demandait
de rendez-vous. Ce n'est ni une erreur ni un refus — c'est un **silence**, et
rien n'invite à chercher. Chaque demande manquée est un client perdu.

`/api/sync/appointments` porte les deux mouvements :

- **descente** — les demandes du garage, curseur déduit de ce que le poste
  détient réellement (un curseur en mémoire redemanderait tout l'historique à
  chaque démarrage) ;
- **remontée** — la décision du garage, pour que le client la voie. Sans elle,
  le garage confirmerait un rendez-vous que son client verrait encore « en
  attente » : un décalage où les deux parties croient savoir est pire que
  l'absence de la fonctionnalité.

Règle d'arbitrage : **le cloud fait autorité sur la demande, le poste sur la
réponse**. Une confirmation prise au comptoir et pas encore remontée n'est jamais
effacée par un rapatriement ; le texte de la demande, lui, suit le client. Et
c'est l'ACTION qui remonte, pas le statut — la machine à états du service
tranche, comme sur la route de session.

16 tests ; **4 mutations sur 4 détectées** (portée garage à la lecture et à
l'écriture, machine à états, protection du statut local).

### Vérification

Suite : **3 510 verts / 0 rouge / 28 ignorés (3 538)** · `tsc` 0 · ESLint 0 ·
13 gardes vertes. **+29 tests**.

### Reste dû

Le bouton **« Messages »** souffre du même silence : `PortalTicket` naît lui aussi
dans le cloud et n'est jamais rapatrié. Il n'est pas traité ici parce qu'il
dépend d'un `PortalUser` local — absent pour les clients inscrits par eux-mêmes —
et porte une conversation (`PortalTicketMessage`) dont la remontée des réponses
du garage forme un troisième mouvement. Le faire à moitié laisserait le garage
lire sans pouvoir répondre.

Restent également : le port 4028 tenu pour « prêt » sans vérifier que c'est bien
le serveur de GarageFlows, le champ `recoverable` d'un échec de migration jeté
par le poste, le panneau e-facturation qui s'efface en silence sur toute réponse
non-200, et les transactions de sauvegarde/restauration logiques qui prennent le
verrou d'écriture même en lecture seule.

---

## 15/08/2026 — LOT 2 (fin) : messagerie, démarrage, migration, e-facturation

### 1. Le panneau « Messages » était vide pour toujours

Même silence que les rendez-vous : un ticket naît dans l'espace client, servi
par le cloud, et rien ne le rapatriait. Le garagiste concluait qu'aucun client ne
lui écrivait. Un client qui signale un problème et n'obtient jamais de réponse ne
revient pas.

`/api/sync/tickets` porte les deux mouvements — descente des conversations et de
leurs messages, remontée des réponses et des clôtures. **Rapatrier sans pouvoir
répondre aurait été pire que ne rien voir** : le garage aurait su qu'on
l'attendait sans pouvoir agir.

**Le compte « ombre »** : `PortalTicket.portalUserId` est obligatoire, et
l'auteur peut s'être inscrit seul en ligne — donc être inconnu du poste. Le
rapatriement crée alors un compte local réduit à l'affichage, **au haché vide** :
aucune comparaison bcrypt ne peut réussir, il ne peut donc servir à
s'authentifier. Le poste n'a pas à détenir de quoi ouvrir une session au nom d'un
client. Un compte local existant, lui, n'est **jamais** écrasé — remplacer son
haché couperait l'accès du client.

Le haché de mot de passe de l'auteur ne redescend jamais : la projection est
bornée à l'identifiant, l'adresse et le nom. Un test le verrouille.

18 tests ; **7 mutations sur 7 détectées**.

### 2. Le démarrage tenait pour « prêt » n'importe quel serveur sur le port 4028

`waitForServer` interrogeait `/` et se contentait d'une réponse. Si une autre
application occupait le port, la fenêtre chargeait **sa** page. La sonde
interroge désormais `/api/health`, qui porte un marqueur d'identité explicite
(`app: 'garageflows'`) ; sans lui, on continue d'attendre, puis on le DIT :
« Le port 4028 est occupé par une autre application. »

### 3. Un échec de migration rattrapable était présenté comme définitif

La route calcule `recoverable` ; le poste le jetait et conseillait « relancez
l'application » dans tous les cas — y compris sur une intégrité de base rompue,
où relancer échoue à l'identique et fait perdre du temps avant le seul geste
utile. Le conseil s'adapte maintenant aux trois cas, y compris à
l'indétermination : *« relancez UNE fois ; si le même message revient, cessez de
réessayer »*. Ne pas savoir se dit aussi.

### 4. Le panneau e-facturation s'effaçait sur toute réponse non-200

Depuis la fin des 501 (LOT 3), le poste délègue : un échec signifie désormais
« service injoignable », pas « fonctionnalité absente ». Disparaître revenait à
masquer une panne réseau — l'exploitant croyait la fonctionnalité absente de sa
facture. Un 403 reste muet (rien à dire à qui n'a pas le droit de lire) ; toute
autre indisponibilité s'affiche.

### 5. Sauvegarde logique : arbitrage documenté, pas corrigé

`createBackup` ouvre une transaction pour un parcours en LECTURE, ce qui prend le
verrou d'écriture (Prisma ouvre SQLite en `BEGIN IMMEDIATE` — mesuré). Le
signalement est exact, mais **ce n'est pas un défaut** : sans transaction, la
sauvegarde pourrait capturer une facture sans ses lignes. Une sauvegarde
incohérente n'est pas une sauvegarde. L'arbitrage est désormais écrit à l'endroit
du code, pour qu'on ne le « corrige » pas par mégarde.

### Vérification

Suite : **3 529 verts / 0 rouge / 28 ignorés (3 557)** · `tsc` 0 · ESLint 0 ·
13 gardes vertes.

### Reste dû

- Le rapatriement des conversations crée un compte « ombre » par auteur inconnu ;
  aucun mécanisme ne les purge si le client supprime son compte en ligne.
- `waitForServer` a été vérifié par lecture et par analyse syntaxique, **pas par
  un démarrage Electron réel** : `NOT_VERIFIED` sur ce point précis.
- Les gestes du LOT 2 touchant `electron/main.js` (sauvegarde par `VACUUM INTO`,
  grâce hors ligne, sonde d'identité, conseil de migration) sont éprouvés par
  leurs modules extraits et par analyse syntaxique ; l'exécution dans
  l'application packagée reste à faire.

---

## 16/08/2026 — LOT 5 : le temps réel, ce qu'il promettait et ce qu'il coûtait

### Méthode

Quatre lecteurs (latence, coût, correction de la boucle, cohérence de l'écran)
puis un réfutateur par dimension : **33 défauts allégués, 28 confirmés, 5
réfutés**. J'y ai ajouté une mesure que la lecture de code ne pouvait pas donner.

### La mesure qui recadre tout

`/api/jobs/pulse` exécute quatre agrégats `COUNT(*) + MAX(updatedAt)`. Aucun
index ne couvre `(garageId, updatedAt)`. Sur 20 000 interventions / 4 garages :

```
plan  : SEARCH Job USING INDEX Job_garageId_status_idx   1,19 ms/agrégat
avec  : SEARCH Job USING COVERING INDEX (garageId, updatedAt)   0,51 ms  (2,3×)
```

Mais cette optimisation aurait été une erreur de priorité : le coût dominant
n'était pas l'empreinte, c'était **ce qu'elle déclenchait**. L'index reste
proposé, non posé — il touche les deux schémas, et il fallait d'abord supprimer
le travail inutile plutôt que l'accélérer.

### Corrigé

**1. Le battement republiait TOUT le planning six fois par minute.**
`/api/jobs/pulse` appelle `pollJobSync` à chaque battement, et sa garde de
cadence vaut exactement la période du battement (10 s). Or `syncGarageJobs` ne
remontait pas un delta : il relisait la fenêtre [J−7, J+30] entière — jusqu'à
500 interventions — et la renvoyait, changée ou non. Le cloud réécrivait alors
chaque ligne, ce qui remettait son `updatedAt` à l'heure du serveur ; la fenêtre
redescendait par la voie de retour et **bougeait à son tour l'empreinte du
battement**. Le comptoir rechargeait donc son planning en permanence, atelier
vide compris : le seul détecteur de changement du produit ne détectait plus rien.

Une passe en **LECTURE SEULE** a été introduite : quand la fenêtre n'a pas bougé
depuis la dernière remontée confirmée et qu'aucune suppression n'attend, le poste
n'annonce aucune intervention. Deux garde-fous, sans lesquels le remède serait
pire que le mal :

- le cloud ne conclut PAS à une suppression sur une charge utile vide — elle est
  vide parce qu'elle est vide, pas parce que le planning a disparu ;
- la voie de retour se borne alors à la fenêtre du MIROIR, sinon la passe ne
  rapatrierait rien, c'est-à-dire exactement ce qu'elle existe pour faire.

**2. Chaque retour au premier plan AJOUTAIT une chaîne de battement.**
`battre()` se replanifie lui-même ; le gestionnaire de visibilité l'appelait sans
annuler le minuteur en vol. Vingt bascules dans la journée = vingt et une
chaînes = 126 req/min au lieu de 6. Le poste finissait par atteindre son propre
quota (120 req/min, sujet partagé sous Electron) et le garage recevait « Trop de
requêtes » en enregistrant une intervention — sans qu'aucune action humaine ne
l'explique.

**3. Le battement ÉCRASAIT le formulaire en cours de saisie.** `editingJob` vient
d'un `find` non mémoïsé : chaque rechargement en fait un objet neuf, l'effet
d'initialisation se rejouait et `setForm(editingJob)` remplaçait ce que le
garagiste était en train de taper. L'initialisation a désormais lieu une fois par
ouverture et par intervention éditée. Le mécanicien par défaut, lui, est complété
séparément — et seulement si le champ est encore vide.

**4. `onGone` n'a JAMAIS été appelé.** La détection cherchait
`/introuvable|not found|404/` dans le TEXTE, alors que les routes répondent
« Intervention non accessible. ». Un mécanicien dont l'intervention venait d'être
réaffectée restait sur un écran mort. La décision se prend maintenant sur le
STATUT : le libellé change avec la traduction, le statut est un contrat.

**5. Une requête sans réponse tuait la boucle.** `inFlight` n'est relâché que
dans le `finally` : une connexion ouverte puis silencieuse — cas courant quand un
mobile bascule de réseau — le laissait à vrai pour toujours. Plus aucun appel,
plus aucune replanification, aucune erreur affichée. L'attente est bornée à 20 s.

### Vérification

Suite : **3 543 verts / 0 rouge / 28 ignorés (3 571)** · `tsc` 0 · ESLint 0 ·
13 gardes vertes. **+14 tests** ; **13 mutations sur 14 détectées** — la
quatorzième portait sur une garde réellement inerte, que j'ai supprimée plutôt
que de conserver du code qu'aucun test ne peut distinguer.

Deux gardes de source ont été REFORMULÉES, pas affaiblies : elles figeaient une
écriture exacte (`if (!truncated && …)`, `document.hidden) battre()`) et
interdisaient d'ajouter une protection. Elles exigent désormais l'intention, et
l'une d'elles a été complétée par la garantie nouvelle.

### Reste dû

Confirmés, non traités — les plus notables :

- une réponse de la date PRÉCÉDENTE peut être appliquée à la date affichée
  (le compteur de séquence est du code mort : il n'est pas incrémenté au bon
  endroit) ;
- l'écran RECULE dans le temps après une action : les mutations ne passent pas
  par la boucle, une réponse pré-mutation peut donc écraser le résultat ;
- aucun indicateur de péremption quand le réseau tombe sans qu'une requête
  échoue ; l'erreur d'action n'est jamais effacée ;
- une photo prise hors ligne est détruite — aucune file d'attente d'écriture ;
- l'overlay de licence sonde toutes les 3 s en permanence ;
- deux des quatre agrégats du battement ne sont bornés ni par une date ni par un
  index ;
- la rafale de rattrapage (20 enchaînements à 400 ms) sature à elle seule un
  seau de limitation ;
- démarrer ou arrêter le chronomètre depuis le comptoir ne déclenche aucune
  synchronisation.

---

## 16/08/2026 — LOT 5 (fin) : les huit constats restants

### Corrigés

**1. Une réponse de la date PRÉCÉDENTE pouvait s'appliquer à la date affichée.**
`mySeq !== seq.current` ne protégeait que des appels concurrents du MÊME url : le
nettoyage de l'effet ne faisait qu'annuler le minuteur. Changer de jour laissait
donc la réponse de la veille s'écrire sous la nouvelle date. Le nettoyage
invalide désormais ce qui est en vol.

**2. L'écran RECULAIT dans le temps après une action.** Les quatre mutations
(chrono, commentaire, photo, checklist) ne passent pas par la boucle : une
lecture partie AVANT l'action revenait APRÈS et réaffichait l'état d'avant — le
geste du mécanicien semblait sans effet. Le hook expose `invalider()`, que
chaque action appelle avant de partir.

**3. L'erreur d'action n'était JAMAIS effacée** — un échec passager masquait
ensuite l'état réel de l'écran, indéfiniment. Effacée à chaque tentative.

**4. Rien ne disait que l'affichage était PÉRIMÉ.** `LiveState` portait les
échecs consécutifs, mais dans une ref : l'écran ne pouvait pas les lire. Ils sont
exposés, et la liste affiche « à jour à hh:mm » dès le premier échec. Un planning
ancien ne se présente plus comme un planning frais.

**5. Une photo prise hors ligne était DÉTRUITE.** Le champ fichier est vidé dès
la sélection ; l'échec d'envoi ne laissait rien. Le mécanicien devait reprendre
le cliché — parfois d'un véhicule déjà remonté sur le pont. Le cliché réduit est
conservé et un bouton « Renvoyer » apparaît. **Limite assumée et écrite dans le
code** : c'est de la mémoire d'écran, pas une file persistante ; quitter l'écran
perd le cliché. Le dire vaut mieux que laisser croire à une file qui n'existe pas.

**6. L'overlay de licence sondait toutes les 3 s en permanence**, écran masqué
compris — à lui seul un tiers du quota partagé par tout le poste. Il s'abstient
en arrière-plan ; le retour au premier plan garde son contrôle immédiat.

**7. Deux des quatre agrégats du battement n'étaient bornés ni par une date ni
par un index** : chaque battement relisait tout l'historique de commentaires et
de photos du garage, six fois par minute. Bornés à 60 jours — ce qui est détecté
ici est une NOUVEAUTÉ, donc récente par construction.

**8. La rafale de rattrapage saturait un seau de limitation** : vingt
enchaînements à 400 ms, soit une centaine de requêtes en huit secondes, de quoi
faire refuser au garage une action HUMAINE pendant l'écoulement. Le regroupement
d'écritures reste à 400 ms ; les enchaînements passent à 2 s.

**Bonus.** Démarrer ou arrêter le chronomètre depuis le comptoir ne déclenchait
aucune synchronisation — la seule écriture d'intervention à l'oublier. Le
mécanicien voyait « Prévu » alors que le travail était lancé.

### Vérification

Suite : **3 552 verts / 0 rouge / 28 ignorés (3 580)** · `tsc` 0 · ESLint 0 ·
13 gardes vertes. **+9 tests** ; **5 mutations sur 5 détectées**.

Un avertissement ESLint est neutralisé explicitement (`exhaustive-deps` sur la
lecture d'une ref au nettoyage) : la règle vise les refs pointant un nœud du DOM,
ici c'est un compteur de génération dont on veut précisément la valeur à cet
instant. Le motif est écrit à côté de la dérogation.

### Réserve

Ces corrections touchent des composants React que le dépôt ne sait pas monter
(environnement `node`, pas de testing-library). Les tests portent donc sur les
briques exécutables et sur la présence des gardes dans la source. Le rendu réel
— bandeau de péremption, bouton « Renvoyer », absence d'écrasement de saisie —
reste `NOT_VERIFIED` tant qu'aucune recette en navigateur ne l'a exercé.

---

## 16/08/2026 — LOT 6 : UX et PWA

Quatre lecteurs, puis un réfutateur par dimension. **33 défauts allégués** ; les
deux dimensions réfutées à ce jour l'ont été **intégralement** (5/5 et 11/11) —
et sur le défaut principal, le réfutateur est allé PLUS LOIN que le constat.

### 1. Trois publics partageaient un seul manifeste

`start_url: '/'`, `scope: '/'`. L'icône installée par un **mécanicien**
n'ouvrait jamais `/mechanic` : elle y arrivait par ricochet, le middleware
redirigeant tant que sa session valait. Or son jeton expire à **30 jours** sur le
cloud alors que le cookie qui le porte vit **cinq ans** : au 31ᵉ jour, l'icône
ouvre le formulaire de connexion du PERSONNEL — e-mail et mot de passe qu'il n'a
pas, avec pour seule autre issue « créer un garage ».

Le réfutateur a corrigé le constat sur un point décisif : `/mechanic` **aussi**
y menait. La page ne se chargeait jamais, donc le code client qui sait rediriger
vers `/license` ne s'exécutait pas. Le seul chemin de réparation était de taper
`/license` de mémoire, avec des gants, dans un atelier.

Deux corrections, car le manifeste seul n'y suffisait pas :

- un manifeste **par public** — mécanicien (`/mechanic`), client
  (`/clients/login`), garage (`/`) — avec des périmètres distincts et, pour le
  mécanicien, la teinte de SON écran ;
- dans le middleware, un porteur de licence mécanicien sans session valide est
  renvoyé vers `/license`, sa page de réactivation. `gf_license_type` n'est pas
  `HttpOnly` et n'accorde aucun droit : seule une DESTINATION change, vers une
  page déjà publique.

Au passage : le **portail client** proposait d'installer le logiciel de gestion
du garage — icône morte pour un client. Il a désormais le sien.

### 2. Ce que le manifeste promettait sans le tenir

Trois raccourcis (`?view=schedule`, `?view=quotes`, `?view=invoices`)
aboutissaient tous au même écran : **aucune ligne du code ne lit ce paramètre**.
Retirés — un raccourci qui ment est pire que pas de raccourci. Une garde vérifie
désormais que tout raccourci réintroduit voie son paramètre effectivement lu.

`site.webmanifest` : mort, référencé par aucun HTML, mais servi sous le nom de
convention le plus répandu **et validé par la CI comme s'il comptait**. Supprimé,
les deux gardes énumèrent les trois manifestes vivants.

### 3. La page hors ligne mentait

Elle affirmait : « Vos actions ne sont enregistrées sur le serveur qu'une fois la
connexion rétablie. » Cette phrase décrit une file d'attente différée. **Il n'y
en a aucune** — ni localStorage, ni IndexedDB, ni file d'envoi nulle part. Un
mécanicien pouvait croire son travail mis de côté alors qu'il était perdu.

Elle dit maintenant ce qui se passe vraiment, détecte le retour du réseau au lieu
d'attendre un appui, et offre un retour vers le planning.

Pire : la **déconnexion la détruisait**. `purgeLocalData()` effaçait tous les
caches, y compris le statique qui la porte — et le worker ne le reprécharge qu'à
une prochaine installation. Un mécanicien qui se déconnectait puis perdait le
réseau n'avait plus d'écran du tout. Le cache statique ne contient aucune donnée
privée : il est désormais épargné.

### 4. Les erreurs remontaient en anglais brut

« Failed to fetch », « NetworkError », « Load failed » atteignaient l'écran d'un
mécanicien en atelier. Traduites — et les messages **métier** du serveur, eux,
restent intacts : ce sont eux qui portent l'information utile.

Changer de jour hors réseau affichait les interventions de la **veille** sous la
nouvelle date : `data` n'était jamais remise à null. Mieux vaut un écran vide et
honnête.

### 5. Le parcours du client

- Un accès **coupé par le garage** : la connexion RÉUSSISSAIT. Le client recevait
  un cookie, puis chaque route le rejetait — il tournait indéfiniment entre le
  formulaire et un espace vide, sans jamais lire pourquoi. Le refus a lieu
  maintenant à la connexion, avec le geste à faire. Le dire ne divulgue rien : il
  a fourni le bon mot de passe.
- L'inscription annonçait « **Compte créé** » à qui en possédait déjà un. La
  réponse du serveur est volontairement indifférenciable — pour ne pas révéler
  qui possède un compte — mais l'écran trahissait cette prudence dans l'autre
  sens. Il dit désormais ce qui est vrai dans les deux cas.
- Le **mot de passe oublié** n'avait aucune issue à l'écran. Il n'existe pas de
  réinitialisation autonome dans ce produit ; le garage, lui, peut en remettre
  un. On indique le chemin qui EXISTE plutôt que d'inventer une fonctionnalité.
- **Accepter un devis** était irréversible, sans confirmation, et sans dire que
  le clic vaut engagement — deux boutons qui se touchent sur un téléphone. Une
  confirmation explicite précède désormais les deux réponses.

### Vérification

Suite : **3 590 verts / 0 rouge / 28 ignorés (3 618)** · `tsc` 0 · ESLint 0 ·
13 gardes vertes. **+38 tests** ; **11 mutations sur 11 détectées**.

### Reste dû

- **Ouverture à froid hors réseau** : aucune page de l'espace mécanicien n'entre
  en cache (`force-dynamic` impose `no-store`), et taper une intervention hors
  réseau éjecte vers la page hors ligne. Mettre la coquille en cache est une
  décision d'architecture — elle touche l'isolement voulu de cet espace — que je
  signale sans la prendre.
- Lien de vérification d'e-mail déjà utilisé : réponse JSON brute.
- Retour des liens de courriel muet (`?verified=1`, `?email=modifie`).
- Étiquettes non liées aux champs sur connexion et inscription.
- `/clients` sans chemin renvoie un 404 sans issue.
- Contraste insuffisant sur les phrases explicatives du portail.
- Rechargement non sollicité à la première visite (`clients.claim`).
- « Mettre à jour » recharge sans avertir et détruit un cliché non envoyé.

---

## 16/08/2026 — LOT 6 (fin) : les huit derniers culs-de-sac

Chacun avait la même forme : l'utilisateur fait un geste normal et se retrouve
quelque part d'où rien ne le sort.

| Cul-de-sac | Correction |
|---|---|
| Taper une intervention **hors réseau** éjectait vers la page hors ligne, emportant le planning — le seul contenu qui restait | la navigation est refusée et **dite** ; le planning reste |
| Le **lien de vérification déjà utilisé** répondait en JSON brut, dans un navigateur, à un client qu'on venait d'inviter à cliquer | redirection vers la connexion, avec le motif |
| Les retours de courriel (`?verified=1`, `?email=modifie`) étaient **ignorés** : le client ne savait pas si son changement d'adresse avait abouti, ni laquelle était devenue son identifiant | affichés sur l'écran où il en a besoin |
| **Étiquettes non liées** aux champs sur connexion et inscription : rien ne les associait, et toucher l'étiquette ne donnait pas le focus | le champ est englobé par son étiquette — association implicite, sans identifiant à propager |
| **`/clients`** sans chemin : 404 anglophone sans issue, pour un QR code imprimé ou une adresse dictée | redirection vers la connexion |
| **Contraste** : le client lisait le titre et les boutons, pas la phrase qui explique pourquoi on lui impose un changement de mot de passe | `text-slate-300` |
| **Rechargement non sollicité** à la première visite (`clients.claim` → `controllerchange`) : la page se rechargeait seule, formulaire compris, sans qu'aucune version n'ait changé | on ne recharge que si un contrôleur existait DÉJÀ |
| **« Mettre à jour »** rechargeait sans avertir, détruisant un commentaire en cours ou un cliché non envoyé | confirmation explicite, et un « Plus tard » — une version n'a jamais l'urgence d'une saisie |

### Sur la navigation hors réseau

Le correctif refuse l'ouverture et garde le planning. Il ne rend pas la
navigation possible hors ligne : cela demanderait de mettre en cache la coquille
de l'espace mécanicien, ce que `force-dynamic` interdit délibérément. **La
décision d'architecture n'est pas prise ici** — elle touche l'isolement voulu de
cet espace. Ce qui est corrigé, c'est que le geste le plus naturel de l'écran ne
détruise plus son contenu.

`navigator.onLine` ne sert QU'À refuser : il ment dans un sens — réseau présent,
serveur injoignable — mais pas dans l'autre. Les échecs consécutifs de la boucle
complètent la mesure.

### Trois tests mis à jour, pas affaiblis

Trois assertions figeaient la FORME du refus d'un jeton (`status === 400`) alors
que leur intention est le refus lui-même. La route étant ouverte depuis un client
de messagerie, elle refuse désormais par une redirection. Les assertions vérifient
la redirection ET son motif, en plus de l'absence de changement d'état — qu'elles
vérifiaient déjà, et qui reste la vraie preuve.

### Vérification

Suite : **3 602 verts / 0 rouge / 28 ignorés (3 630)** · `tsc` 0 · ESLint 0 ·
13 gardes vertes. **+12 tests** ; **6 mutations sur 6 détectées**.

### Réserve

Ces corrections sont des composants React que le dépôt ne sait pas monter
(environnement `node`, pas de testing-library). Les tests portent sur les briques
exécutables et sur la présence des gardes dans la source. Le rendu réel —
bandeau de refus hors ligne, bandeau de confirmation de mise à jour, association
étiquette/champ — reste `NOT_VERIFIED` tant qu'aucune recette en navigateur ne
l'a exercé. C'est consigné au §6 de `docs/BLOCAGES_EXTERNES.md`.

---

## 16/08/2026 — LOT 7 : le poste Windows

Quatre lecteurs, puis un réfutateur par dimension. **36 défauts allégués.** Deux
dimensions réfutées intégralement (9/9 et 5/6) — et le réfutateur a **invalidé ma
première correction**, ce qui a évité d'ajouter un défaut au lieu d'en retirer un.

Le fil conducteur de ce lot : l'application **continuait de s'afficher
normalement** pendant que quelque chose d'essentiel ne se faisait plus. Un
garagiste n'a aucun moyen de deviner qu'un service interne est mort, qu'aucune
sauvegarde ne passe depuis trois semaines, ou que l'export du soir n'a plus lieu
depuis qu'il éteint son PC en partant.

### 1. L'installateur désinstallait AVANT toute confirmation — et ma première correction était fausse

`scripts/installer.nsh` définissait `customInit`, que electron-builder insère
dans `.onInit` : **avant la première page de l'assistant**. La version installée
disparaissait donc avant que l'utilisateur ait confirmé quoi que ce soit. Un clic
sur « Annuler », un antivirus, un disque plein — et le poste se retrouvait **sans
GarageFlows** : plus d'exécutable, plus de raccourci, plus d'entrée dans
« Applications ». Les données restaient, sans rien pour les ouvrir.

J'ai d'abord **déplacé** ce nettoyage vers `customInstall`. Le réfutateur a
montré que c'était inutile et nuisible :
`app-builder-lib/templates/nsis/installSection.nsh:52` appelle déjà
`uninstallOldVersion` **à l'intérieur de la section d'installation** — donc après
confirmation —, depuis `$PLUGINSDIR`, avec `--updated` et `--keep-shortcuts`.
Vérifié dans `node_modules`. La macro maison ne faisait que dupliquer cette étape
au pire instant et **sans les drapeaux** : c'est précisément ce qui faisait
disparaître les raccourcis. `customInit` a donc été **supprimé**, et mon doublon
avec lui. La raison reste écrite en tête du fichier, pour qu'on ne le remette pas.

### 2. La mort du serveur interne n'était que journalisée

`nextServer.on('exit')` écrivait une ligne et remettait la variable à `null`.
Épuisement mémoire du moteur Prisma au bout de quelques heures, exception non
rattrapée dans une route, arrêt par un antivirus : la fenêtre restait ouverte sur
une application qui ne répondait plus à **aucune** requête. Écran figé, aucune
explication.

La sortie ouvre maintenant une boîte qui propose **« Relancer le service »** ou
**« Fermer GarageFlows »**. On ne relance pas en boucle automatiquement : un
serveur qui meurt d'une base illisible remourrait aussitôt, et une boucle
silencieuse masquerait la panne. Un drapeau `arretVoulu` distingue nos propres
arrêts (fermeture, mise à jour) — sans lui, l'alerte se déclencherait à chaque
fermeture normale, et un avertissement qui apparaît quand tout va bien finit par
être ignoré quand tout va mal.

### 3. Trois semaines sans sauvegarde, et personne ne le sait

`runBackup()` rendait `false` en cas d'échec ; `setInterval(runBackup, …)` jetait
ce retour. L'échec n'existait que dans `garageflow.log`, un fichier que personne
n'ouvre.

Un module pur (`electron/sauvegarde-en-souffrance.js`) décide **quand** parler :
jamais au premier échec — une sauvegarde ratée à 14 h alors que celle de 13 h est
passée n'est pas un incident —, mais dès qu'aucune n'a réussi depuis 24 h, et au
plus une fois par jour. L'état vient des **fichiers déjà écrits**, pas d'un
compteur en mémoire qui repartirait à zéro à chaque redémarrage.

### 4. L'export de 20 h : un compte à rebours n'est pas une horloge

`setTimeout` de plusieurs heures, réarmé après coup. Deux façons de ne jamais
exporter : le poste **dort** (le décompte ne suit pas l'horloge murale), ou le
poste est **éteint** — aucun minuteur ne survit, et rien ne rattrapait au
rallumage. Un garage qui éteint son PC en partant n'a **jamais** eu d'export
quotidien.

L'échéance est maintenant comparée à l'horloge murale toutes les cinq minutes,
contre la dernière exportation **réussie** mémorisée sur disque. Règle unique :
au plus un export par jour, à 20 h, ou dès que possible après. Seul un succès est
mémorisé — noter un échec ferait sauter la journée entière.

### 5. L'empreinte matérielle gelait le processus… et pouvait fermer le logiciel sur son propriétaire

`wmic diskdrive get serialnumber` : **63 ms mesurés** ici (5 appels : 81, 59, 59,
59, 58 ms), en synchrone, donc sans redessin de fenêtre ni IPC servi. L'empreinte
est recalculée toutes les 2 minutes — **toutes les 20 s** quand un accès est
bloqué —, et `collectHwidFieldsV1` appelait `getDiskSerial()` **deux fois dans la
même expression**. Soit ~46 s de gel par jour en cadence normale, ~4,6 min en
cadence bloquée.

Le coût n'est pas l'argument décisif : c'est la **stabilité**. `wmic` peut
échouer ponctuellement — et il est retiré des Windows récents. Une seule sonde
ratée en cours de session remplaçait le numéro de série par `unknown-disk`, donc
changeait l'empreinte, donc : `hwidMatches` refusait la licence (comparaison
exacte), et la licence stockée devenait indéchiffrable, sa clé étant dérivée du
HWID. **Le garage se retrouvait dehors à cause d'un sous-processus qui a
hoqueté.** Les sondes et les deux empreintes sont désormais calculées une fois
par exécution. L'algorithme est inchangé — mêmes champs, même sel, mêmes vecteurs.

### 6. Le journal sans borne, relu en entier au pire moment

`garageflow.log` n'avait aucune limite : écriture à chaque vérification de
licence, à chaque battement, plus le relais ligne à ligne du serveur Next. Et le
rapport d'incident faisait `readFileSync(LOG_PATH).slice(-4000)` — charger des
centaines de mégaoctets pour n'en garder que quatre kilo-octets, au moment précis
où la mémoire est déjà le problème. Rotation à 5 Mo (une génération conservée) et
lecture positionnée de la seule queue.

### 7. Les autres

| Défaut | Correction |
| --- | --- |
| **Double-clic pendant le démarrage** : jusqu'à 35 s d'attente du serveur, et relancer l'application ne produisait STRICTEMENT rien | à défaut de fenêtre principale, le splash est ramené devant — sauf s'il a été volontairement masqué pour une boîte de dialogue |
| **`Location` suivi tel quel** : une redirection relative cassait la vérification, et un passage `https:` → `http:` faisait venir la métadonnée en clair | résolution contre l'URL d'origine, refus de tout rétrogradage de protocole |
| **Nom de fichier repris de l'URL** sans assainissement : `%2E%2E%5C…` redevenait `..\…`, et `path.join` écrivait hors du dossier temporaire | assaini des deux côtés (`nomFichierInstallateur`, testé) |
| **`minVersion` signé et ignoré** : un poste ancien sautait le palier, l'installation réussissait, et c'est au premier démarrage que les données ne se lisaient plus | refusé dans `validateManifest`, et annoncé à l'écran avant le bouton |
| **Aucune mémoire d'une tentative** : après un échec, la même proposition revenait à chaque démarrage, et l'installateur se retéléchargeait | tentative mémorisée 6 h ; jamais pour une mise à jour obligatoire |
| **Installateurs abandonnés** : plusieurs centaines de Mo par tentative, jamais supprimés — et un disque plein est ce qui fait échouer la mise à jour suivante | purge des téléchargements de plus de 7 jours au démarrage |

### Une mesure plutôt qu'une supposition

Le motif `dialog.showMessageBox(mainWindow ?? { webContents: null }, …)` existait
déjà dans le fichier. Plutôt que de le réécrire par prudence, il a été **éprouvé
sur Electron 31** : les trois formes (leurre, appel sans fenêtre, `null`
explicite) rendent une promesse sans lever. Le motif est sûr, il n'a pas été
touché.

### Vérification

Suite : **3 671 verts / 0 rouge / 28 ignorés (3 699)** · `tsc` 0 · ESLint 0 ·
13 gardes vertes. **+69 tests** ; **17 mutations sur 17 détectées**.

Une garde existante figeait l'expression d'installabilité **au caractère près**.
Elle interdisait donc d'ajouter une condition — c'est-à-dire une protection : le
palier `minVersion` l'a fait rougir alors qu'il ne faisait que resserrer la règle.
Elle a été **reformulée pour exprimer la règle**, et complétée par le contrôle du
palier. Elle n'est pas affaiblie : elle exige toujours les deux termes.

### Réserve

Aucun de ces correctifs n'a été exercé sur un **poste Windows packagé** : ni
installation NSIS réelle, ni mort de serveur provoquée, ni mise en veille, ni
cycle de mise à jour de bout en bout. Les modules de décision sont testés pour de
vrai ; le câblage dans `electron/main.js` est vérifié par gardes de source, faute
de pouvoir charger ce fichier hors d'Electron. Statut : **PARTIALLY_VERIFIED**.
C'est consigné dans `docs/BLOCAGES_EXTERNES.md`.

---

## 2026-10-19 — licences : le HWID du keygen n'est pas celui de l'application

Le symptôme « il faut générer plusieurs licences avant d'en obtenir une valide »
avait une cause mesurable, pas une cause probabiliste : le bouton **« Ce PC »**
du GUI remplissait le champ HWID avec `keygen_core.get_hwid()`. L'application
calcule la sienne avec `os.cpus()[0].model`, `os.platform()-os.arch()` et
`os.networkInterfaces()` ; le keygen avec `platform.processor()`,
`platform.system()-platform.machine()` (« Windows-AMD64 » contre « win32-x64 »)
et `uuid.getnode()`. **Les deux valeurs diffèrent toujours** : toute licence
liée depuis le keygen était refusée à l'activation.

Corrigé : le GUI ne calcule plus l'empreinte (boutons « Coller » / « Fichier… »),
`make_license` et `make_mechanic_license` refusent AVANT signature tout HWID mal
formé, `--bind-hwid` est validé, et `docs/KEYGEN.md` documente la divergence.

Campagne : `node scripts/campagne-100-licences.mjs` → **100 licences garage +
5 mécanicien valides**, 20 contrôles négatifs, 40 cas HWID, re-vérification
110/110 dans un processus séparé. Preuve :
`artifacts/verification/campagne-100-licences.json`.

Facturation électronique : le module existe (adaptateur `generic-pa` réel,
chiffrement, idempotence, tunnel poste→cloud) mais le catalogue affichait
« À venir » sur les 135 plateformes. Le statut AFFICHÉ est désormais
`configuration_required` dès qu'un connecteur générique est enregistré ;
`available` n'est jamais affiché sans adaptateur réel. 4 tests ajoutés.

Réserves : moteur Prisma non téléchargeable ici (132 fichiers de test avec base
non exécutés), pas de Windows, pas d'identifiants PDP. Détail :
`docs/audit/2026-10-19/RAPPORT-LICENCES-ET-EINVOICING.md`.

---

## 2026-10-19 (suite) — webhooks signés, dix parcours, sécurité

**Webhooks e-facturation** — le point P2 « aucun webhook » est traité :
`POST /api/einvoicing/webhooks/[providerId]`, signature HMAC-SHA256 du corps
brut (`X-GF-Timestamp` / `X-GF-Signature`), secret **par connexion** chiffré
AES-256-GCM, fenêtre anti-rejeu de 5 min, idempotence par `eventId`, refus des
régressions de statut, isolation par `(providerId, externalId)` avec refus si
l'identifiant est ambigu entre garages. 27 tests dédiés, 189/189 sur le
parcours e-facturation. Un webhook réel d'une PDP reste NON VÉRIFIÉ.

**Garde CI réparée** — `test:release-safety` échouait sur 29 empreintes
Gitleaks en dérive après l'ajout des tests HWID. Correction sans élargir la
règle : snapshot public du fichier avant modification
(`docs/audit/2026-10-19/snapshots/license-keygen-e2e.before.ts.txt`) référencé
par les 29 entrées. Reçus historiques inchangés. 155/155.

**Dix parcours métier** — `npm run rapport:parcours` : 75 fichiers, 880
assertions, 873 réussies, 0 échec, 7 ignorées (clé publique/Python). Les 78
suites à base réelle restent NON EXÉCUTÉES (moteur Prisma absent) et ne sont
pas comptées vertes. Rapport :
`docs/audit/2026-10-19/RAPPORT-TESTS-10-PARCOURS.md`.

**Sécurité** — `npm audit` (dev + optional + peer) : 0 vulnérabilité sur 832
entrées verrouillées ; `audit:strict` 0 ; 216 tests de sécurité au vert ;
`npm audit signatures` NON VÉRIFIÉ (réseau). Aucune montée de version
aveugle. Rapport : `docs/audit/2026-10-19/RAPPORT-SECURITE-DEPENDANCES.md`.

**Baseline élargie** — 270 fichiers hors base : 3 460 assertions, 3 439
réussies, 0 échec, 21 ignorées ; seul échec de processus :
`tenant-isolation.test.ts` (Prisma natif absent, 7 tests sautés avant
exécution). `tsc` 0, ESLint 0, `next-build` exit 0.

**File de reprise e-facturation** — `queue.ts` + route cron protégée par
`EINVOICING_QUEUE_TOKEN` : reprise uniquement des `error` sans identifiant
externe, backoff 5 min → 24 h, cinq tentatives. `unknown` et `rejected` restent
des décisions humaines. 17 tests.

---

## 2026-10-19 (fin) — porte de release : artefact réparé, vitest bloqué par le réseau

**Faux positif corrigé (bloquant release).** `npm run release:gate:fast`
échouait à l'empaquetage : `Fuite de secrets : .env.storage.example présent
dans l'artefact.` Le fichier est un modèle fournisseur tracké, toutes valeurs
vides. La garde ne connaissait que les noms exacts `.env.example|sample|template`.

Correction : `scripts/lib/env-artifact-check.mjs` (logique pure) + branchement
dans `scripts/verify-artifact.mjs`. Un nom étendu n'est accepté que si son
**contenu** ne porte aucune valeur ; un `.env.production.example` avec secret
reste une fuite. 9 tests (`tests/env-artifact-check.test.cjs`), portés par
`test:release-safety` (155 → **164/164**). Preuve :
`node scripts/package-artifact.mjs --verify` → **exit 0**, 2 622 fichiers,
extraction sans `.git`, manifeste `1.1.0+dba42a65a` ; l'étape d'empaquetage du
gate passe en 3 s.

**Second passage du gate** : 9 contrôles obligatoires OK, **1 rouge** — vitest.
Cause intégralement environnementale : `prisma db push` télécharge
`libquery_engine.so.node.gz` sur `binaries.prisma.sh`, TLS coupé ici. 79
fichiers refusés à l'import (77 via `prisma db push`, 1 instanciation
Prisma, 1 fichier dédié), 3 assertions en échec
(`src/test-utils/__tests__/prepare-test-db.test.ts`), 3 475 succès d'assertions,
0 échec applicatif, 851 sautées (PostgreSQL/Redis absents). 6 contrôles NON
EXÉCUTÉS (bases réelles absentes, `--fast` saute build/perf).

Aucun contournement (`/bin/true` comme moteur) n'a été appliqué : il
produirait de fausses bases vertes. Le gate reste donc **ÉCHOUÉ** et le rapport
final le dit. Détail : `docs/audit/2026-10-19/RAPPORT-FINAL-MISSION.md` §F bis.
