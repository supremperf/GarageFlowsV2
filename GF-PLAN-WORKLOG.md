<!-- doc-numbers: journal — comptes datés point-dans-le-temps, exempts du contrôle de compte courant -->
# GF-PLAN — Module mécaniciens & planning

> Journal de correction. Source de vérité : le code actuel et le comportement
> observé. Aucun rapport antérieur n'est repris comme acquis.

## Architecture initiale constatée

| Élément | État lu |
|---|---|
| `Mechanic` (Prisma, desktop + serveur) | `id, name, avatar (String), color, isAbsent, specialty, order, garageId` |
| Champ photo | **aucun** |
| Champ archivage / actif | **aucun** |
| Planning | `src/components/ScheduleBoard.tsx` (527 lignes) |
| Fenêtrage desktop | **aucun** |
| Flèches desktop | **aucune** |
| Stockage photo existant | disque (`GF_PHOTOS_DIR`) + route authentifiée, pour les photos d'INTERVENTION |

## Limites trouvées — et ce qu'elles n'étaient pas

Le cahier des charges supposait des constantes du type `MAX_MECHANICS = 5`,
`mechanics.slice(0, 4)` ou `grid-cols-5`. **Un balayage du dépôt n'en a trouvé
aucune** : ni `MAX_MECHANICS`, ni `VISIBLE_MECHANICS`, ni découpage de la liste
des mécaniciens, ni grille figée sur le planning.

Le défaut réel est l'inverse, et il est plus insidieux.

---

### GF-PLAN-001 [P0] — Aucune limite : toutes les colonnes étaient rendues

**Cause racine.** `ScheduleBoard.tsx:315` :

```ts
const visibleMechanics = isMobile && selectedMechanic ? [selectedMechanic] : mechanics
```

Sur desktop, **tous** les mécaniciens du garage étaient rendus, chacun dans une
colonne `flex-1 min-w-0` qui se partage la largeur restante. Conséquence
mesurable sur un écran de 1920 px (1864 px utiles après la règle des heures) :

| Mécaniciens | Largeur par colonne |
|---|---|
| 4 | 466 px |
| 10 | 186 px |
| 20 | 93 px |
| 50 | 37 px |
| 100 | 18 px |

À 20 mécaniciens, ni le nom, ni le compteur d'interventions, ni une carte ne
tiennent. Le produit était donc **de fait plafonné à quatre ou cinq
mécaniciens**, sans qu'aucune constante ne le dise et sans message d'erreur : il
n'y avait rien à « supprimer », il fallait ajouter ce qui manquait.

Le mobile, lui, avait déjà une fenêtre (un mécanicien à la fois) avec ses deux
flèches. Le desktop n'en avait aucune.

**Correctif.** Module PUR `src/lib/planning/mechanic-window.ts` :
- `nombreColonnesVisibles(largeur, total)` — calcul sur la largeur **mesurée**
  (`ResizeObserver`), pas sur un point de rupture CSS : la place disponible
  dépend de la barre latérale et de la taille de fenêtre Electron, pas seulement
  de l'écran. Cible de 300 px par colonne, plafond de 6, plancher de 1, et jamais
  plus de colonnes que de mécaniciens.
- `fenetre` / `deplacer` / `bornerDebut` — navigation par **groupe entier**
  (avancer d'une colonne rendrait la position illisible : la moitié des visages
  resterait la même à chaque pas), dernier groupe **borné** et non partiel.
- `reconcilier` — recalage sur les **personnes** et non sur l'index quand la
  liste change (voir GF-PLAN-002).
- `trancheVisible` — rend les ÉLÉMENTS, jamais des positions.

Largeurs obtenues, mesurées par test :

| Écran | Colonnes |
|---|---|
| 320 / 375 / 390 / 430 | 1 |
| 768 | 2 |
| 1024 | 3 |
| 1366 / 1440 | 4 |
| 1920 / 2560 | 6 |

**Vérification.** 31 tests, dont un parcours aller-retour complet sur **1, 4, 5,
6, 10, 20, 30, 50 et 100 mécaniciens** vérifiant que *tous* restent atteignables
(aucun n'est enfermé hors de portée) et que le retour ramène exactement au
premier groupe. **Mutation : 6/6 détectées.**

---

### GF-PLAN-002 [P1] — Une mutation de la liste déplaçait la fenêtre sous l'utilisateur

**Cause racine.** Une fenêtre repérée par un index seul glisse dès que la liste
change. Scénario : l'utilisateur regarde les mécaniciens 11 à 15 ; un collègue en
archive un depuis un autre poste ; l'index 10 désigne alors quelqu'un d'autre, et
l'utilisateur voit soudain d'autres personnes sans avoir rien fait. Avec
plusieurs suppressions, la fenêtre pouvait pointer au-delà de la fin et
n'afficher **aucune** colonne.

**Correctif.** `reconcilier()` raisonne sur des **ancres** — les identifiants de
la fenêtre précédente. Si le premier mécanicien visible est encore là, la fenêtre
se recale sur lui ; sinon sur la première ancre de secours encore présente ; en
dernier recours seulement, l'ancien index est borné.

---

### GF-PLAN-003 [P2] — Les initiales d'avatar étaient fausses

**Cause racine.** `src/app/api/mechanics/route.ts:73` :
`avatar: (data.avatar?.trim() || name.slice(0, 2).toUpperCase())`.

« Jean Dupont » donnait **« JE »** — les deux premières lettres du *prénom*. Tous
les Jean d'un garage (« Jean Dupont », « Jean Martin », « Jeanne Roux »)
partageaient donc le même avatar dans le planning, où l'avatar est justement ce
qui permet de distinguer une colonne d'un coup d'œil.

**Correctif.** `src/lib/planning/avatar.ts` — `initialesDe()` prend la première
lettre du premier mot **et** du dernier (« Jean Dupont » → « JD »), conserve les
diacritiques, découpe par point de code (jamais un caractère coupé en deux),
borne à deux caractères, et ignore les anciens libellés de position `M1`/`M2`,
qui n'ont jamais été des identités mais des numéros de colonne hérités.

Nouveau composant `MechanicAvatar` : photo si elle existe, initiales sinon,
bascule **immédiate** sur le repli en cas d'erreur de chargement (jamais l'icône
d'image brisée), texte alternatif qui nomme la personne.

**Vérification.** 16 tests sur les initiales et le repli.

---

## Points vérifiés et jugés SAINS (contrôlés, non modifiés)

- **Identités du drag & drop.** La zone de dépôt porte `col-${mechanic.id}` et la
  cible est lue par `overId.replace('col-', '')` : l'affectation ne dépend
  **jamais** d'un index de colonne. Les clés React des colonnes sont
  `mechanic.id`. Les exigences §43-46 et §151 étaient donc déjà tenues — le bug
  redouté (« l'intervention part chez Julien parce qu'il occupe désormais la
  colonne 3 ») n'existait pas, et les tests le verrouillent désormais.
- **Molette.** Aucun `onWheel`, `deltaX` ni `onTouchMove` ne pilotait la
  navigation, et le conteneur est `overflow-x-hidden`. Il n'y avait donc pas de
  défilement horizontal accidentel à corriger ; le risque était de **l'introduire**
  en ajoutant la navigation. Un test interdit désormais ces liaisons.

---

### GF-PLAN-004 [P1] — Validation serveur de la photo (socle posé)

**Contrainte d'architecture constatée.** `sharp` n'est qu'une **dépendance de
développement** et n'est importé nulle part dans le code applicatif. L'employer
au runtime ajouterait un binaire natif au bundle serveur *et* au paquet Electron
— un changement d'empaquetage qui ne peut pas être vérifié ici (`npm run dist`
est bloqué faute de `keys/`). Le décodage/redimensionnement serveur est donc
écarté au profit d'une architecture vérifiable aujourd'hui.

**Ce qui est en place** (`src/lib/mechanics/avatar-image.ts`) :
- type déterminé par les **octets magiques**, jamais par le MIME annoncé ;
- **validation structurelle réelle** : les dimensions sont lues dans l'en-tête
  (PNG IHDR, parcours des marqueurs JPEG jusqu'au SOF, WebP VP8/VP8L/VP8X). Un
  fichier qui porte les bons octets magiques mais dont la structure est
  incohérente est refusé — c'est exactement le fichier fabriqué pour tromper un
  contrôle purement « magic bytes » ;
- bornes de dimensions (32 → 4096 px) : une image de 20 000 × 20 000 est refusée
  **avant** tout traitement ;
- plafond de taille appliqué **avant** décodage complet ;
- **retrait des métadonnées JPEG** : tous les segments `APPn` et les
  commentaires, donc EXIF, **position GPS**, XMP, ICC et données IPTC. L'image
  compressée elle-même n'est pas touchée (les dimensions sont inchangées après
  nettoyage, vérifié par test) ;
- `jetonCache()` dérivé du **contenu** et non d'un horodatage : deux
  remplacements dans la même seconde produisent bien deux URL distinctes.

**Vérification.** 20 tests construisant de VRAIES structures d'image octet par
octet, et rejetant : exécutable Windows renommé `photo.jpg`, binaire ELF, page
HTML renommée `.png`, **SVG porteur de `<script>`**, archive ZIP, PDF, texte
brut, JPEG à chaîne de marqueurs rompue, PNG tronqué, fichier vide.

**Limite assumée et consignée.** Sans décodeur, un fichier au bon en-tête mais
corrompu en profondeur peut être accepté et s'afficher cassé — auquel cas
`MechanicAvatar` retombe sur les initiales. **Aucune exécution de code n'en
découle.** La miniature est produite par le navigateur (ré-encodage sur canvas,
qui applique l'orientation EXIF et supprime les métadonnées par construction) ;
le serveur ne lui fait pas confiance et revalide tout.

### GF-PLAN-005 — Schéma : photo et archivage (posé, non encore exploité)

Cinq colonnes **strictement additives** sur `Mechanic`, dans les deux schémas :
`avatarPath`, `avatarMime`, `avatarHash`, `avatarUpdatedAt`, `archivedAt`
(`NULL` = actif), plus un index `(garageId, archivedAt)`.

- Runner du poste : migrations `203` → `208`, chacune gardée par
  `onlyIfColumnMissing`. Template SQLite re-baseliné (**208 migrations, 0 en
  attente**, checksums conformes).
- Serveur : `20260813120000_mechanic_avatar_archive`.
- Rétrocompatibilité : colonnes nullables, rien de rendu obligatoire — une
  version applicative antérieure fonctionne contre cette base en ignorant les
  colonnes, et un poste non encore migré continue d'afficher les initiales (le
  repli est le comportement nominal, pas une panne).

### GF-PLAN-006 [P1] — Supprimer un mécanicien ayant un historique échouait par une erreur brute

**Cause racine.** `Job.mechanicId` est **NOT NULL** et sa relation ne déclare
aucun `onDelete` : Prisma applique donc `Restrict`. `prisma.mechanic.delete()`
échouait par violation de clé étrangère dès que le mécanicien avait la **moindre**
intervention — y compris terminée deux ans plus tôt. Aucun `try/catch` ne
couvrait l'appel.

**Pire que l'échec lui-même.** L'ancienne route **annulait d'abord** les
interventions planifiées (`status: 'cancelled'`) *puis* tentait la suppression.
Sur un mécanicien doté d'un historique, l'annulation était donc bel et bien
appliquée… avant que la suppression échoue. Le garage se retrouvait avec des
interventions annulées, un mécanicien toujours présent, et aucun message pour le
lui dire.

**Correctif.** Un mécanicien qui a une histoire s'**archive**. `DELETE` compte
tout ce qui le référence — interventions, notes, clés attribuées, audits — et
répond `409 MECHANIC_HAS_HISTORY` avec le détail et la marche à suivre. La
suppression définitive reste possible pour le seul cas où elle a du sens : une
fiche créée par erreur, qui n'a jamais servi (sa photo est alors nettoyée).

### GF-PLAN-007 — Photo de profil : chaîne de persistance

- `PUT /api/mechanics/:id/avatar` — garage issu de la **session**, jamais du
  corps ; appartenance vérifiée par `findFirst({ id, garageId })` avant tout
  traitement ; contenu validé et **métadonnées retirées** avant écriture ; nom de
  fichier **généré par le serveur**.
- `DELETE /api/mechanics/:id/avatar` — idempotent, base d'abord puis disque.
- Service par la route authentifiée existante `/api/photos/[...path]`, à laquelle
  `Mechanic.avatarPath` a été ajouté comme quatrième propriétaire reconnu. Le
  contrôle d'appartenance ne se déduit **jamais** du chemin : un chemin d'avatar
  d'un autre garage, même connu, rend 404.
- **Ordre des opérations** : fichier écrit → base mise à jour → ancien fichier
  retiré. Si la base échoue, le fichier neuf est supprimé (pas d'orphelin) ; si
  le disque échoue, la base n'est pas touchée (pas de `avatarPath` dans le vide).
  Il n'existe aucun instant où la fiche annonce une photo absente.
- **Invalidation de cache** : chaque enregistrement produit un nom de fichier
  aléatoire, donc une URL neuve. Ni le navigateur, ni le service worker, ni un
  cache intermédiaire ne peuvent servir l'ancienne — ce qui autorise
  `Cache-Control: immutable` sur le service.
- `GET /api/mechanics` rend l'effectif **actif** et calcule `avatarUrl` ;
  `?includeArchived=1` rend l'effectif complet pour la lecture de l'historique.

**Durcissement au passage.** `deletePhoto()` était la seule des trois fonctions
de `photo-store.ts` **sans garde anti-traversée** : `path.join` normalise
« ../../ », donc un chemin remontant aurait supprimé un fichier arbitraire. Les
chemins actuels viennent tous de la base, le défaut n'était pas atteignable —
mais c'est l'asymétrie qui devient une faille le jour où un appelant transmet un
chemin d'une autre origine.

**Vérification.** `src/integration/mechanic-avatar-archive.test.ts` — 19 tests
sur base SQLite réelle et stockage disque réel, avec **deux garages** :
téléversement et service effectifs, remplacement sans fichier orphelin,
suppression, refus du SVG à script, et l'isolation complète (le garage A ne peut
ni poser, ni supprimer, ni **lire** la photo d'un mécanicien du garage B, ni
l'archiver, ni le voir dans sa liste), traversée de chemin refusée, permissions
par rôle, cycle archive → réactivation avec historique intact.

**Mutation : 10/10 détectées** — scope garage retiré (PUT, DELETE, PATCH),
validation du contenu retirée, contrôle de rôle retiré, nettoyage de l'ancienne
photo retiré, suppression redevenue destructive, `archived` non booléen accepté,
réactivation laissant le mécanicien marqué absent.

### GF-PLAN-008 — Interface de téléversement et optimisation navigateur

`MechanicAvatarField` dans la fiche mécanicien : « Ajouter / Modifier la
photo » et « Supprimer ». Sans ce composant, toute la chaîne serveur restait
inatteignable par un utilisateur.

`avatar-client.ts` prépare le fichier AVANT l'envoi :
`createImageBitmap(..., { imageOrientation: 'from-image' })` applique
l'orientation EXIF — une photo prise en portrait au téléphone n'arrive plus
couchée — puis recadrage carré centré (sémantique `object-fit: cover` appliquée
une fois à l'enregistrement plutôt qu'à chaque affichage), réduction à 256 px et
ré-encodage JPEG. **Le ré-encodage fait disparaître toutes les métadonnées par
construction**, puisqu'on ré-écrit des pixels et non un fichier.

Deux garde-fous d'interface :
- la vignette n'est mise à jour qu'**après** la réponse du serveur — l'afficher
  dès la sélection donnerait à croire qu'un envoi refusé a réussi ;
- le champ fichier est réinitialisé immédiatement, sinon resélectionner **le même**
  fichier après un échec n'émet aucun événement et le bouton paraît mort.

La vignette n'est jamais AGRANDIE : une photo de 100 × 100 reste en 100 × 100,
plutôt qu'une bouillie interpolée.

**Vérification.** 14 tests : recadrage (paysage, portrait, carré, dimensions
dégénérées, carré toujours contenu dans la source) et contrat de l'interface.

### GF-PLAN-009 — Synchronisation POSTE → CLOUD → PWA de la photo

**Le problème à résoudre.** Le poste range la photo sur SON disque et n'en garde
qu'une clé de stockage locale. Cette clé ne veut rien dire pour
`app.garageflows.fr` ni pour la PWA, qui ont leur propre stockage : transmettre
le chemin produirait une image introuvable, et transmettre un chemin Windows
serait pire encore. Ce sont donc les **octets** qui voyagent.

**Chemin complet, désormais fonctionnel :**

```
patron ajoute une photo (poste)
  → validation + nettoyage EXIF/GPS + écriture disque local
  → pushMechanicAvatar : relecture des octets RÉELLEMENT stockés
  → POST /api/sync/mechanic-avatar (licence garage signée)
  → cloud : REVALIDATION complète + re-nettoyage + stockage propre
  → GET /api/photos/… (app.garageflows.fr, scopé garage)
  → GET /api/mechanic/me → avatarUrl → /api/mechanic/photos/… (PWA)
```

**Le cloud ne croit pas le poste sur parole.** L'image est **revalidée
intégralement** à l'arrivée et ses métadonnées re-nettoyées : porter une licence
garage valide prouve qu'on est un poste autorisé, pas qu'on est le logiciel. De
même, l'empreinte stockée est celle que le **cloud** calcule après nettoyage,
jamais celle annoncée par l'appelant.

**Un mécanicien inconnu du cloud ne se crée pas par une photo.** Contrairement à
l'attribution de clé, cette route ne miroite personne : si le mécanicien n'a
jamais été propagé, il n'a pas d'espace PWA, donc personne pour regarder cette
photo.

**Idempotence** (`hash`) : une photo inchangée n'est pas réécrite. Sans cela,
chaque rattrapage produirait un nouveau nom de fichier, donc une nouvelle URL,
et invaliderait les caches de toutes les surfaces pour une image identique.

**Ordre d'arrivée** (`updatedAt`) : une propagation retardée par le réseau
n'écrase jamais une photo plus récente déjà reçue — sans ce garde, un rattrapage
après reconnexion pouvait remettre l'avant-dernière photo et l'y laisser.

**Le RETRAIT se propage aussi.** Synchroniser l'ajout sans la suppression
laisserait l'ancienne photo visible sur les autres surfaces — exactement le
défaut que `pushMechanicStatus` corrige pour les licences.

**Best-effort, mais l'issue est rendue.** Une panne réseau ne défait jamais
l'enregistrement local ; la réponse porte `cloudSynced` et, en cas d'échec,
`cloudSyncCode`, pour que l'interface puisse dire « enregistrée · synchronisation
en attente » au lieu d'annoncer un succès global qui n'a pas eu lieu.

**Un défaut trouvé par le test, dans mon propre code.** La recherche
d'appartenance utilisait le `garageId` du **corps** de la requête alors que le
commentaire d'en-tête affirmait le contraire. `authenticateGarageLicense`
rattrapait l'écart (`GARAGE_MISMATCH`), donc ce n'était pas exploitable — mais
l'isolation dépendait d'un helper appelé ailleurs plutôt que d'être écrite là où
elle s'applique. La requête part désormais de `auth.garageId`, et une licence non
rattachée à un garage est refusée : envoyer une photo n'est pas une opération qui
doit décider à quel garage un poste appartient.

**Vérification.** `src/integration/mechanic-avatar-sync.test.ts` — 11 tests sur
base et disque réels. **Mutation : 6/6 détectées** (garage pris dans le corps,
revalidation retirée, garde d'ordre retiré, idempotence retirée, empreinte du
poste crue, fichier non supprimé au retrait).

### Latence POSTE → CLOUD → PWA — MESURÉE

Banc à **deux instances isolées** : un serveur « cloud » réel (`next dev`, port
4142, base et stockage propres) et un poste pilotant les mêmes modules avec sa
propre base et son propre disque. Licence GARAGE de recette signée localement,
insérée dans les deux bases ; aucune requête sortante, aucune écriture dans la
base de l'opérateur, rien vers la production.

Charge utile : 17,6 Ko (taille réaliste d'une vignette 256 px). Trois itérations
de chauffe écartées (la première requête compile la route en mode développement).

| Étape | médiane | p95 | max |
|---|---|---|---|
| Écriture locale (validation + nettoyage + disque + base) | 7–11 ms | 9–13 ms | 13 ms |
| Propagation cloud (HTTP + revalidation + stockage cloud) | 112–136 ms | 130–157 ms | 157 ms |
| **Bout en bout — photo réellement servie par le cloud** | **122–150 ms** | **141–173 ms** | **173 ms** |

Deux séries (12 et 20 itérations) ; les fourchettes couvrent les deux.

**Ce que ces chiffres ne disent PAS.** Les deux instances tournent sur la même
machine, en boucle locale : il faut ajouter le trajet réseau réel vers
`app.garageflows.fr`. Le cloud est en mode DÉVELOPPEMENT, plus lent qu'un build
de production. Ces valeurs mesurent le coût de traitement, pas la latence
d'exploitation.

### GF-PLAN-010 [P1] — La PWA n'affichait jamais la photo

**Trouvé par la mesure, pas par la relecture.** Une fois la photo à 150 ms du
cloud, restait à savoir quand le mécanicien la voit. Deux défauts :

1. `src/app/mechanic/page.tsx` peignait un carré coloré portant les **initiales**
   (`{me?.mechanic?.avatar ?? '🔧'}`). L'`avatarUrl` ajoutée à
   `/api/mechanic/me` n'était consommée par personne : la photo arrivait au
   cloud et s'arrêtait là.
2. `/api/mechanic/me` était chargé **une seule fois au montage**
   (`useEffect(..., [])`). Le planning, lui, a une synchronisation vivante
   (`useMechanicLive`) — le profil non. Une photo ajoutée par le patron
   n'apparaissait donc qu'à la prochaine ouverture de l'application : en
   atelier, le lendemain.

**Correctif.** L'en-tête PWA rend `MechanicAvatar` (photo, sinon initiales), et
le profil est rechargé au retour au premier plan (`visibilitychange`) ainsi qu'au
retour du réseau (`online`). Pas de sondage périodique : un profil change
rarement, et le planning a déjà sa propre cadence.

**Latence perçue par le mécanicien** = ~150 ms de propagation + le délai avant
que la PWA revienne au premier plan. Avant correction, c'était « jamais ».

### E2E navigateur — EXÉCUTÉ : **54/54**

Débloqué en réutilisant le banc de recette (autorisation explicite de
l'opérateur) : compte OWNER local, licence garage de recette, effectif de 20
mécaniciens, application servie sur la base du banc — **jamais celle de
l'opérateur**, jamais la production.

`e2e/planning-mechanics.spec.ts` — 9 tests × 6 gabarits d'écran :

| Vérification | Résultat |
|---|---|
| Flèches réellement en haut à gauche / haut à droite (boîtes englobantes) | PASS |
| Position inchangée après changement de groupe | PASS |
| Bornes : gauche désactivée au premier groupe, droite au dernier | PASS |
| Tous les mécaniciens atteignables, aucun doublon, aucun groupe vide | PASS |
| Molette + gestes horizontaux : le groupe ne change PAS | PASS |
| Clics rapides répétés : aucun dépassement, aucun écran vide | PASS |
| Navigation → aucune intervention réattribuée | PASS |
| Colonnes à 1366 / 1920 / 2560 (captures produites) | PASS |
| Flèches en haut à 375 / 390 / 430 px | PASS |

Captures dans `playwright-report/planning-{1366,1920,2560}.png`.

**Trois obstacles levés, tous des artefacts de banc et non des défauts produit :**
limiteur de débit générique (`RATE_LIMIT_API_MAX`) atteint par le volume de
requêtes ; sélecteur de langue puis assistant d'installation recouvrant le
planning sur un garage neuf (`onboardingComplete: false`) — un garage en
exploitation n'a ni l'un ni l'autre.

**Deux défauts corrigés dans MES tests**, trouvés par l'exécution réelle :
- un nombre de clics figé (12) supposait six colonnes ; en portrait il n'y en a
  qu'une, donc vingt groupes — le test échouait sur une bordure correcte ;
- le scénario **créait** les mécaniciens manquants. Les six gabarits s'exécutant
  en parallèle contre une seule instance, ils se disputaient l'effectif : des
  tests corrects échouaient au hasard, jamais les mêmes. L'effectif est
  désormais préparé en amont et seulement LU ;
- une mesure de géométrie après un délai fixe suivant un changement de gabarit
  portait, sous charge, sur une mise en page intermédiaire (`expect.poll`).

**Contrainte d'exécution consignée.** Sérialisé (`--workers=1`) : **54/54, deux
exécutions consécutives**. En parallèle sur les six gabarits contre UN serveur de
développement : 52 à 54 selon les exécutions. La contention restante est celle du
serveur, pas des tests — elle est documentée en tête du fichier plutôt que
masquée par des délais plus longs.

## Reste à faire

- **Photo de profil de bout en bout** (§4-18, §92-100, §157-160) : migration
  Postgres + SQLite, téléversement validé côté serveur (octets magiques, taille,
  dimensions, EXIF/GPS retirés), stockage, service authentifié scopé garage,
  invalidation de cache, synchronisation Desktop → serveur → PWA, tests IDOR et
  téléversement malveillant. **Le composant d'avatar est prêt à l'afficher ; la
  chaîne de persistance n'existe pas encore.**
- **Archivage** (§73-75) : `Mechanic` n'a aucun champ d'état ; la suppression
  reste destructive.
- **Virtualisation** (§40) : non nécessaire à ce stade — au plus 6 colonnes sont
  rendues, quel que soit l'effectif.

## État de la vérification

| Contrôle | Résultat |
|---|---|
| `npm test` | **219 fichiers, 2464 tests verts**, 0 échec |
| `tsc --noEmit` | 0 erreur |
| `next lint` | 0 avertissement, 0 erreur |
| Mutation (fenêtre) | 6/6 détectées |
