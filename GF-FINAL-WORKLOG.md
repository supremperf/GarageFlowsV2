<!-- doc-numbers: journal — comptes datés point-dans-le-temps, exempts du contrôle de compte courant -->
# GF-FINAL — Journal de correction

> Reprise du programme de finalisation, 2026-08-13, en mode autonome.
> Source de vérité : le code actuel et le comportement observé. Aucun ancien
> rapport n'est repris comme acquis.

## Baseline mesurée à la reprise

| Mesure | Valeur | Commande |
|---|---|---|
| Fichiers de test | 208 (202 verts, **1 en échec**, 5 ignorés) | `npm test` |
| Tests | 2298 (2270 verts, 28 ignorés) | `npm test` |
| `tsc --noEmit` | 0 erreur | `npx tsc --noEmit` |

L'unique suite en échec — `electron-device-activation.test.ts` — n'était pas un
défaut produit mais un défaut de test : voir GF-FINAL-011.

---

## LOT 1 — LICENCES

### GF-FINAL-011 [P1] — Six tests de sécurité ne s'exécutaient plus

**Cause racine.** `src/lib/__tests__/electron-device-activation.test.ts` isolait
la branche `deviceRequired` de `electron/main.js` en découpant la source entre
deux chaînes littérales. La borne de fin, `if (result.allowed === false)`, a
disparu lors de l'extraction de la décision de battement vers le module pur
`electron/heartbeat-policy.js`. `indexOf` a renvoyé -1, l'assertion de découpage
a levé au chargement du fichier, et **les six tests du fichier ont cessé de
s'exécuter** — dont ceux qui verrouillent l'absence de boucle d'activation
infinie et la non-contournabilité d'un refus distant par le repli local.

**Correctif.** Découpage par équilibrage d'accolades, indépendant du code voisin.
`src/lib/__tests__/electron-device-activation.test.ts:48`

**Vérification.** 7 tests réhabilités, verts.

---

### GF-FINAL-012 [P0] — L'invariant anti-réactivation n'avait aucun test

**Cause racine.** `electron/heartbeat-policy.js` porte la règle qui interdit
qu'une licence révoquée se réactive : *un blocage n'est levé que par un « active »
explicite de l'autorité DISTANTE*. Le module existait, était câblé, documentait
le bug qu'il corrige — et `grep -r heartbeatDecision` ne renvoyait que le module
lui-même et son unique appel. **Zéro test.** La règle la plus sensible du produit
reposait sur une relecture.

**Correctif.** `src/lib/__tests__/electron-heartbeat-policy.test.ts` — 22 tests,
dont le rejeu complet du scénario rapporté : révocation admin → serveur distant
injoignable → 200 battements de repli local répondant « active » → le blocage
tient → seule la réactivation vue par l'autorité distante rend l'accès.

**Mutation (4/4 détectées).**

| Mutation appliquée | Verdict |
|---|---|
| Le repli local peut lever un blocage (bug d'origine) | détectée (5 tests) |
| `allowed:false` n'est plus honoré | détectée (9 tests) |
| Un statut inattendu vaut réactivation | détectée (5 tests) |
| `unknown` traité comme `active` | détectée (1 test) |

---

### GF-FINAL-013 [P0] — `revoked → active` était une écriture de champ ordinaire

**Cause racine.** `PATCH /api/admin/licenses/[id]` faisait `data.status =
body.status`. Aucune table de transitions au niveau LICENCE n'existait (celle des
APPAREILS, `canTransitionDevice`, existait — mais n'est utilisée que par son
propre test, jamais en production). Réactiver une licence révoquée était donc
indiscernable d'un changement de libellé : ni confirmation, ni motif, ni acteur,
ni horodatage, ni trace.

**Reproduction.** `PATCH {status:'active'}` sur une licence `revoked` →
**HTTP 200**, statut écrit.

### GF-FINAL-014 [P0] — Un statut hors énumération accordait l'accès complet

**Cause racine.** `status` n'était typé qu'à la COMPILATION ; `req.json()` ne
valide rien à l'exécution. `{"status":"Revoked"}` était persisté tel quel **puis
scellé par un `recordMac` recalculé** — donc parfaitement « intègre » aux yeux du
contrôle d'intégrité. Or toute la chaîne de contrôle compare par égalité stricte
(`record.status === 'revoked'`). Une telle valeur ne déclenche ni la branche
`revoked`, ni `suspended`, et retombe sur la branche « still active » de
`/api/license/check`, qui répond `allowed:true, status:'active'`.

**Conséquence.** Une licence affichée « Revoked » dans l'écran d'administration
ouvrait l'accès complet, et son enregistrement était cryptographiquement scellé
dans cet état.

**Reproduction.** `PATCH {status:'Revoked'}` → **HTTP 200**, valeur persistée.

### GF-FINAL-015 [P0] — `DELETE` ressuscitait une licence révoquée

**Cause racine.** `DELETE /api/admin/licenses/[id]` supprimait la ligne. Or
`/api/license/activate` interprète l'**absence** d'enregistrement comme un premier
usage et recrée la licence avec `status:'active'`
(`src/app/api/license/activate/route.ts:448`). Supprimer une licence révoquée la
rendait donc ACTIVE au prochain démarrage du poste.

Les deux routes se contredisaient : `/api/admin/licenses/revoke-by-key` pose
justement une **pierre tombale** pour les licences pas encore enregistrées, parce
que « absente de la base » vaut « autorisée » — et le `DELETE` retirait cette
pierre tombale. Aucun attaquant n'est requis : le libellé de la route est
« remove key from registry », rien n'indiquait à l'exploitant que supprimer
équivaut à réactiver.

**Reproduction.** `DELETE` sur une licence `revoked` → **HTTP 200**, ligne
supprimée.

**Correctif commun (013 / 014 / 015).**
- Nouveau module pur `src/lib/license/state-machine.ts` : `LICENSE_STATES`,
  `SETTABLE_LICENSE_STATES`, garde d'exécution stricte (aucune normalisation
  silencieuse : `' Revoked '` est refusé, pas corrigé), `canTransitionLicense`,
  `effectiveLicenseStatus` (une valeur inconnue vaut `unknown`, **jamais**
  `active`), `licenseGrantsAccess`.
- `revoked` est terminal : en sortir exige `confirmReactivation: true` **et** un
  motif d'au moins 5 caractères. `revoked → suspended` est refusé.
- Un état COURANT non reconnu ne peut jamais mener à `active` (on ne « répare »
  pas une licence douteuse en l'activant).
- Journal du cycle de vie dans `LicenseDeviceEvent` (table existante, aucune
  migration) : `from`, `to`, acteur, motif, horodatage.
- **Régimes dissymétriques du journal** : une transition PERMISSIVE (vers
  `active`) écrit son événement DANS la transaction, avant la mise à jour — pas
  de trace, pas de réactivation. Une transition PROTECTRICE (`suspended` /
  `revoked`) journalise en best-effort après coup : une table d'audit
  indisponible ne doit jamais empêcher de couper un accès.
- `DELETE` réservé aux licences `active` ; 409 explicite sinon.
- `adminSessionActor()` ajouté à `src/lib/api-helpers.ts` pour nommer l'acteur.

**Vérification.** 17 tests de route + 23 tests de machine à états, verts.
Suites existantes `record-mac-admin-routes`, `licence-p3`, `revoke-by-key-route`
toujours vertes.

**Mutation (10/10 détectées).**

| Mutation | Verdict |
|---|---|
| `revoked` n'est plus terminal | détectée (6) |
| `confirmReactivation` accepte tout truthy | détectée (3) |
| `revoked → suspended` redevient possible | détectée (2) |
| La garde d'exécution accepte toute chaîne | détectée (4) |
| Un état courant inconnu peut mener à `active` | détectée (3) |
| Un statut inconnu est traité comme actif | détectée (3) |
| `DELETE` supprime à nouveau une licence bloquée | détectée (3) |
| La transition n'est plus validée | détectée (6) |
| La réactivation n'est plus journalisée | détectée (1) — *voir ci-dessous* |
| `DELETE` ne vérifie plus l'existence | détectée (1) |

> La mutation « la réactivation n'est plus journalisée » n'était **pas** détectée
> au premier passage : les tests vérifiaient la présence de l'événement, pas la
> propriété *fail-closed*. Déplacer l'écriture hors de la transaction gardait donc
> le compte d'événements correct tout en perdant la garantie. Trois tests ont été
> ajoutés (journal en panne → réactivation refusée, révocation et suspension
> maintenues). C'est le test de mutation qui a trouvé le trou, pas la relecture.

---

### GF-FINAL-016 [P2] — Faux succès dans l'écran d'administration des licences

**Cause racine.** `src/app/admin/licenses/page.tsx` : `patch()` n'appliquait la
mise à jour que si `res.ok`, mais l'appelant émettait `toast.success(...)`
**inconditionnellement**. Un refus du serveur s'affichait donc « Réactivée »
alors que rien n'avait changé — la ligne restait rouge sous un message vert.
Défaut cosmétique jusqu'ici ; il est devenu trompeur dès lors que le serveur
refuse légitimement certaines transitions (GF-FINAL-013).

**Correctif.** `patch()` rend le verdict du serveur et affiche son message
d'erreur ; `patchStatus`, `saveLabel` et `handleDelete` ne félicitent plus qu'en
cas de succès réel. Un panneau de réactivation dédié (motif obligatoire, 5
caractères minimum) remplace le bouton bascule pour les licences révoquées —
composant React inline, et non `window.prompt`, qui n'est pas implémenté sous
Electron.

---

### GF-FINAL-017 [P2] — Test de parité cryptographique instable

**Cause racine.** `src/lib/license/__tests__/hwid-v1.test.ts` lance un
interpréteur Python **par vecteur**. Isolé : ~0,7 s. En parallèle du reste de la
suite : 5,6 s, au-delà du délai par défaut de vitest (5 s). La suite complète
rapportait alors « parité Node ↔ Python en échec » — une divergence
cryptographique inexistante, selon la charge de la machine.

**Correctif.** Délai explicite de 120 s, avec la raison consignée. Un faux échec
sur ce test précis est pire qu'un test lent : il discrédite la seule preuve que
les générateurs Python et Node produisent la même empreinte.

---

### Points vérifiés et jugés SAINS (contrôlés, non corrigés)

- `src/lib/license/devices.ts` — cycle de vie des appareils : `revoked` terminal,
  plafond de sièges sous `SELECT … FOR UPDATE` (PostgreSQL) et re-comptage en
  transaction (SQLite), jetons hachés (HMAC), comparaisons à temps constant.
- `/api/license/activate` — refuse `revoked` / `suspended` / `expired` ; ne
  repasse jamais un enregistrement existant à `active`.
- `/api/sync/mechanic-status` — `revoked` déjà traité comme final (`REVOKED_IS_FINAL`).
- `electron/main.js` — l'écran d'activation précède bien le serveur Next et la
  fenêtre principale (`app.whenReady` → `checkStoredLicense()` → à défaut
  `createLicenseWindow()`, `app.quit()` si annulée).

### Réserve ouverte

- `canTransitionDevice` (`src/lib/license/devices.ts:161`) n'est appelée que par
  son propre test : la garde réellement appliquée en production est un `if`
  manuel dans `activateDevice`. La table de transitions et son application sont
  donc deux choses distinctes, et seule la première est testée. À unifier.
- `validateDeviceToken` ne vérifie **pas** `recordMac`, alors que tous les autres
  chemins le font. Un accès en écriture à la base permettrait donc de repasser
  `status` à `active` sans que le battement s'en aperçoive. Le poste reste
  protégé par le miroir local et `heartbeat-policy`, mais l'asymétrie mérite
  d'être levée.

---

## LOT 5 — PORTAIL CLIENT

### GF-FINAL-001 [P0] — Le portail n'était pas à l'URL officielle

**Spec.** `https://app.garageflows.fr/clients`.
**Code.** Pages sous `/portal/*`, préfixe réécrit **en dur dans onze fichiers**,
et **aucune** réécriture dans `next.config.mjs` : tout lien `…/clients/login`
communiqué à un client tombait sur un 404.

**Correctif.**
- Nouveau module `src/lib/portal/routes.ts` — `PORTAIL_BASE`, `cheminPortail()`,
  `cheminPortailToken()`. Le préfixe n'existe plus qu'à cet endroit.
- Pages **déplacées** de `src/app/portal/` vers `src/app/clients/`. Une simple
  réécriture aurait laissé la barre d'adresse repasser à `/portal` dès la
  première navigation interne — l'écart de spec serait resté visible.
- Redirection **permanente** `/portal/:path* → /clients/:path*` dans
  `next.config.mjs` : les QR codes déjà imprimés et les e-mails déjà envoyés
  restent valides, jeton compris.
- `middleware.ts` exclut les deux préfixes — il s'exécute AVANT les
  redirections de `next.config.mjs`, si bien qu'omettre `/portal` aurait envoyé
  les liens existants vers `/license`.
- `redact.ts` masque les jetons sous les deux préfixes.

**Vérification.** 21 tests dans `garage-slug.test.ts`, dont une garde qui
interdit à tout producteur de lien de réécrire le préfixe en dur.

### GF-FINAL-002 [P1] — Lien de portail construit depuis l'en-tête `Origin`

**Cause racine.** `src/app/api/portal/token/route.ts` :
`const url = ${req.headers.get('origin') ?? ''}/portal/${token}`.
`Origin` est fourni par le CLIENT. Une requête portant
`Origin: https://exemple-malveillant.test` faisait renvoyer un lien de portail —
**jeton d'accès inclus** — pointant vers ce domaine. Le garage n'avait aucun
moyen de le voir : il copiait le lien et l'envoyait à son client, qui remettait
le jeton au tiers en le suivant. Sans en-tête `Origin` (appel serveur à
serveur), la même expression produisait un lien relatif inutilisable en e-mail.

**Correctif.** `publicUrlFor(cheminPortailToken(token))` — base publique
officielle, jamais un en-tête de requête. Test de non-régression dédié.

---

## LOT 8 — FOURNISSEURS

### GF-FINAL-018 [P0] — Le module Fournisseurs était structurellement inerte

**Cause racine.** `Part.supplierName` / `Part.supplierRef` existent en base
(migrations 048/049) et sont **lus** partout : `/api/suppliers` groupe le
réapprovisionnement par `supplierName`, `/api/parts/search` et l'autocomplétion
des devis les affichent, la recherche de stock les indexe. **Aucune route ne les
écrivait** : absents de `CreatePartSchema`, du `create` de `POST /api/parts`, de
la liste blanche du `PATCH`, et du formulaire `StockPanel`.

Sur toute installation réelle, aucune pièce ne portait donc de fournisseur :
`connectorsFromParts` sortait de boucle à chaque pièce, le plan de
réapprovisionnement était toujours vide, le panneau « Fournisseurs » affichait
en permanence 0 fournisseur / 0 € et son bouton « Préparer les commandes »
restait désactivé. Une fonctionnalité présente dans la navigation principale
était inatteignable autrement qu'avec la base de démonstration.

**Pourquoi les tests ne le voyaient pas.** `src/integration/suppliers.test.ts`
sème ses pièces via `prisma.part.create(...)`, en écriture DIRECTE. Il prouvait
donc que le moteur fonctionne SI les données existent — jamais qu'un garage peut
les saisir. C'est le trou classique : le test contourne précisément le chemin
manquant.

**Correctif.** Champs ajoutés au schéma de validation (bornés, jamais tronqués
en silence), au `create`, à la liste blanche du `PATCH`, au type `Part` et au
formulaire de stock ; libellés i18n dans les 14 langues.

**Vérification.** `src/integration/supplier-linkage.test.ts` — 6 tests qui
suivent le chemin de l'UTILISATEUR de bout en bout (créer par l'API, modifier
par l'API, constater que le plan de réapprovisionnement voit le fournisseur),
**sans aucune écriture directe en base**. Mutation : 3/3 détectées.

---

## LOT 6 — FACTURATION ÉLECTRONIQUE

### GF-FINAL-019 [P1] — SSRF sur l'URL configurable de la plateforme

**Cause racine.** L'URL de la plateforme agréée est configurable par le garage ;
la seule vérification était `u.protocol === 'https:'`. Or `https://` ne dit rien
de la DESTINATION : `https://169.254.169.254/latest/meta-data/…`,
`https://10.0.0.5/…`, `https://127.0.0.1:8443/…` sont des URL HTTPS valides. Sur
le déploiement mutualisé, le serveur devenait un relais vers le réseau interne
de l'hébergeur et son service de métadonnées, identifiants joints.

Second volet, plus discret : **`fetch` suit les redirections par défaut**. La
garantie « HTTPS obligatoire » ne portait donc que sur le PREMIER saut. Une URL
légitime répondant `302 Location: http://169.254.169.254/…` emportait les
en-têtes personnalisés (`apiKeyHeader`, `extraHeaderName` — non retirés par
`undici` sur une redirection de même origine) et le corps, c'est-à-dire la
facture complète.

**Correctif.** Module `src/lib/einvoicing/ssrf-guard.ts` :
- refus des protocoles non-HTTPS, des noms réservés (`localhost`, `*.local`,
  `*.internal`, `*.home.arpa`, `*.lan`), des adresses littérales non routables
  (boucle locale, RFC 1918, lien-local **169.254.0.0/16**, CGNAT, multicast,
  IPv6 uniques-locales, **et les formes IPv4 mappées en IPv6** `::ffff:127.0.0.1`) ;
- écritures non canoniques (`010.0.0.1`, `0x7f.0.0.1`) non décodées mais non
  reconnues comme IPv4 — elles retombent donc sur le contrôle DNS ;
- résolution DNS : refus si **au moins une** adresse rendue est non routable (un
  enregistrement multiple ne doit pas permettre de tirer au sort la destination) ;
- `redirect: 'error'` sur l'appel sortant ;
- destination revérifiée à CHAQUE appel, pas seulement à l'enregistrement.

**Choix assumé.** Une résolution DNS qui échoue ne BLOQUE pas : on refuse sur la
preuve d'une mauvaise destination, jamais sur l'absence de preuve. La connexion
échouerait de toute façon, avec le même résolveur ; bloquer transformerait une
panne DNS passagère en « destination refusée » et enverrait l'exploitant
chercher un problème de configuration inexistant. Le blocage reste disponible
(`bloquerSiNonResolu: true`) pour la validation de configuration.

**Risque résiduel consigné.** Le « DNS rebinding » n'est pas entièrement
supprimé : entre le contrôle et la connexion, un enregistrement à durée de vie
très courte peut changer. L'éliminer demanderait d'épingler l'adresse contrôlée
jusqu'à l'établissement de la connexion (dispatcher `undici` sur mesure).

**Vérification.** 30 tests (21 synchrones + 9 sur le chemin DNS, résolveur
simulé). Suite e-invoicing complète : 125 verts.

---

## LOT 3 — CHAÎNE DE MISE À JOUR

### GF-FINAL-021 [P1] — Aucune mise à jour n'était installable sur le parc

**Cause racine.** `electron/update-verify.js:20` embarque une clé publique **en
dur**. `signingConfigured()` rend donc TOUJOURS vrai, et `electron/main.js:2789`
refuse toute installation dépourvue d'un manifeste signé Ed25519 valide.

Or **aucun outil du dépôt ne produisait un tel manifeste.** Le seul script au nom
évocateur, `npm run release:manifest`, écrit un fichier de **provenance de
build** — `{productName, packageVersion, appId, git, buildId, generatedAt,
environment, toolchain, tests}` — sans `manifest`, sans `signature`, sans
`sha256` ni `downloadUrl`. Un `grep -rn "ed25519\|keyId" scripts/` ne renvoyait
rien.

Et c'est précisément ce fichier que le produit demandait : l'étiquette de
l'écran de publication annonçait « Manifeste signé *(release-manifest.json)* »,
et le message d'erreur de l'API disait « un fichier JSON produit par
`npm run release:manifest` est attendu ». L'administrateur téléversait donc
exactement le fichier nommé et recevait « Ce fichier n'est pas un manifeste
signé ». S'il publiait sans manifeste, chaque poste affichait « Mise à jour non
signée : installation manuelle requise ».

**Conséquence.** Aucune mise à jour automatique n'était installable, quelle que
soit la source — alors que la documentation annonce des mises à jour « en un
clic ». Le manifeste d'environnement portait d'ailleurs la trace du défaut :
`GF_UPDATE_SIGNING_KEY` y était déclarée avec `"consumers": []` et la note
*« Documented but not consumed by this repository »*.

**Correctif.** `scripts/sign-release-manifest.mjs` (+ `npm run release:sign`) :
- calcule SHA-256 et taille sur le fichier réel, construit le manifeste complet,
  le sérialise **avec la même canonicalisation que le vérificateur** (tri
  récursif des clés — toute divergence produirait une signature rejetée sans
  explication) et le signe en Ed25519 ;
- clé privée lue dans `GF_UPDATE_SIGNING_KEY` / `…_FILE`, jamais dans le dépôt ;
- refuse **à la signature** ce que le parc refuserait à l'installation (domaine
  hors liste blanche, URL non HTTPS, version non SemVer) — sinon le refus
  n'apparaît que sur chaque poste, sans recours autre qu'une nouvelle signature ;
- mode `--gen-key` avec avertissement explicite sur la rotation (ajouter la
  nouvelle clé publique **sans retirer** l'ancienne : un poste ne connaît que les
  clés de la version qu'il exécute déjà).

Étiquette de l'écran et message d'API corrigés pour désigner `release:sign`.

**Vérification.** `src/lib/__tests__/release-signing-chain.test.ts` — 20 tests
qui exercent le **vrai** script contre le **vrai** vérificateur : manifeste
accepté, empreinte conforme au fichier, et refus sur empreinte modifiée, URL
détournée, version gonflée, signature tronquée, clé inconnue. Un test
anti-régression vérifie que `release-manifest.json` est bien rejeté.
**Mutation : 4/4 détectées.**

### GF-FINAL-022 [P1] — L'installeur publié en Zone Administrateur n'était jamais téléchargé

**Cause racine.** `fetchLatestUpdate()` construit
`http://127.0.0.1:<port><downloadPath>` pour l'installeur téléversé par
l'administrateur. Mais `app:install-update` remplaçait **inconditionnellement**
l'URL par celle du manifeste signé (`main.js:2806`), laquelle doit viser un
domaine de `ALLOWED_DOWNLOAD_HOSTS` — où la boucle locale ne figure pas.

Un garage sans accès Internet téléversait donc un fichier jamais lu : le
téléchargement partait vers `api.garageflows.fr`, échouait, et l'utilisateur
recevait « le téléchargement automatique a échoué ». La contradiction était
visible dans `update-verify.js` lui-même, où `checkDownloadUrl` admet
explicitement la boucle locale *« parce que c'est le serveur embarqué de
l'application qui sert les publications de la Zone Administrateur »* — branche
devenue inatteignable.

**Correctif.** Le manifeste signé reste l'autorité sur **ce qui** est installé
(version, SHA-256, taille) ; il ne l'est plus sur **d'où** viennent les octets
lorsque l'URL est une boucle locale. C'est sûr parce que l'autorisation
d'exécuter tient à l'empreinte signée, vérifiée avant tout lancement : des
octets servis en local qui ne correspondent pas à ce que l'éditeur a signé sont
refusés exactement comme des octets servis à distance.

### GF-FINAL-023 [P2] — Une version antérieure était proposée comme mise à jour

**Cause racine.** `main.js:338` comparait `localUpdate.latestVersion !==
currentVersion` — une inégalité de **chaînes**. Toute version différente était
donc annoncée comme une mise à jour, y compris une version **antérieure**
republiée par erreur : un retour en arrière présenté comme une nouveauté. Le
chemin central et le repli GitHub utilisaient déjà `semver.isNewer` ; seule la
publication locale ne le faisait pas.

**Correctif.** `semver.isNewer(localUpdate.latestVersion, currentVersion)`.

---

## LOT 9 — DONNÉES INVENTÉES

### GF-FINAL-020 [P1] — Le bouton « SIV » présentait des données inventées comme une consultation officielle

**Cause racine.** `src/app/api/plate-lookup/route.ts` : quand la consultation
réelle échouait, un « repli IA » demandait à un modèle de langue
*« French license plate: "AB-123-CD". Based on the plate format and any
encoding, provide the most likely vehicle info… »* et renvoyait sa réponse sous
`source: 'ai'`. `JobModal.handlePlateLookup` la traitait comme n'importe quel
autre résultat : remplissage du champ `vehicleModel` et message
« Véhicule détecté ». Marque, modèle et année partaient ensuite dans
l'intervention, l'ordre de réparation, le devis et la facture.

**Pourquoi c'est une fabrication, pas une approximation.** Depuis 2009, une
plaque du SIV est attribuée **séquentiellement au niveau national** : elle
n'encode ni la marque, ni le modèle, ni l'année, ni le département. Aucun modèle
ne peut l'en déduire. La consigne « most likely vehicle info » ne pouvait donc
produire qu'une invention plausible, présentée à l'utilisateur comme le
résultat d'une consultation.

**Correctif.** Repli supprimé. La route répond `source: 'unavailable'` avec des
champs nuls ; l'interface affiche déjà « véhicule non trouvé » dans ce cas. La
dépendance `@anthropic-ai/sdk` de cette route est retirée, et le manifeste
d'environnement mis à jour (`ANTHROPIC_API_KEY` ne compte plus ce consommateur).

### GF-FINAL-024 [P1] — Un rappel marqué « Envoyé » alors que rien n'était parti

**Cause racine.** `ReminderPanel.handleSendEmail` posait
`onStatusChange(id, 'sent')` sur **deux** chemins : celui où le serveur confirme
l'envoi, et celui où il n'y a **pas de SMTP configuré** — après un simple
`window.open('mailto:…')`, c'est-à-dire l'ouverture d'un *brouillon*. Personne ne
peut savoir à cet instant si l'utilisateur cliquera « Envoyer ».

Sous l'application packagée, c'était systématique :
`setWindowOpenHandler` (`main.js:2598`) n'autorisait que `https:` vers quatre
domaines. `mailto:` était donc refusé et seulement journalisé — **le brouillon ne
s'ouvrait jamais**, et le rappel passait quand même à « Envoyé ». Le garage
lisait « Envoyé » sur des rappels qu'aucun client n'avait reçus. Le bouton SMS
(`sms:`) était muet pour la même raison.

**Troisième défaut du même bloc.** Aucune branche `else` : un échec SMTP, une
adresse invalide ou une panne serveur ne produisaient **aucun retour** — le clic
ne faisait visiblement rien.

**Correctif.**
- `sent` n'est posé que sur confirmation d'envoi réelle ;
- le chemin « brouillon » informe explicitement que le rappel reste **en
  attente** tant qu'il n'est pas envoyé, et ne change aucun statut ;
- tout autre échec est affiché, y compris l'échec de la requête elle-même ;
- `mailto:` et `sms:` sont ajoutés aux protocoles autorisés du processus
  principal — les deux seuls que le produit utilise réellement — **sans** élargir
  la règle : tout le reste demeure refusé par défaut.

**Vérification.** `src/lib/__tests__/reminder-send-honesty.test.ts` — 6 tests
(un seul marquage `sent`, aucun sur le chemin brouillon, échecs signalés,
protocoles autorisés, refus par défaut conservé).

---

## État de la vérification

| Contrôle | Résultat |
|---|---|
| `npm test` | **216 fichiers, 2401 tests verts**, 0 échec, 28 ignorés |
| `tsc --noEmit` | 0 erreur |
| `next lint` | 0 avertissement, 0 erreur |
| `npm run check:consistency` | **12/12 gardes vertes** |
| Tests par mutation | **21 mutations appliquées, 21 détectées** |
