# GarageFlows — durcissement du 14/08/2026

Branche `claude/garageflow-final-unified-merge-ub0l67`, de `32bf76c` à `525f2bf`.

Ce rapport ne dit que ce qui a été **exécuté**. Chaque chiffre vient d'une mesure
ou d'une lecture de source ; ce qui n'a pas pu l'être est nommé en §Limites.

---

## A. Résumé

Neuf défauts corrigés, dont deux qui empêchaient toute mise en production et un
qui pouvait couper l'accès API d'un atelier entier. Deux tests qui passaient pour
la mauvaise raison ont été démasqués. Un garde de ma propre fabrication a été
**retiré** parce qu'il accusait à tort.

Le LOT 5 est fermé : `PRODUCT_REQUIRED = 0`, `DEPRECATED = 0`, `UNKNOWN = 0`.

---

## B. Défauts découverts et corrigés

| Réf | Défaut | Comment il a été trouvé |
|---|---|---|
| GF-DUR-025 | Un code de secours 2FA consommable **deux fois**, et deux codes différents faisant **ressusciter** le premier | test de concurrence écrit puis reproduit |
| GF-DUR-026 | Second facteur complet, chiffré, testé — **aucun écran pour l'activer** | inventaire des routes sans appelant |
| GF-DUR-027 | **`next build` cassé** : export interdit dans une route + `useSearchParams` sans Suspense | montage du serveur de recette |
| GF-DUR-028 | Le client ne pouvait pas changer son adresse de connexion | inventaire |
| GF-DUR-029 | Un véhicule de prêt ne pouvait ni sortir de la flotte ni être supprimé | inventaire |
| GF-DUR-030 | Devis refusés et garanties jamais affichés sur la fiche véhicule | inventaire |
| GF-DUR-031 | Génération assistée de devis sans bouton | inventaire |
| GF-DUR-032 | « Historiser » écrivait dans un tiroir sans poignée | inventaire, angle mort par verbe |
| GF-DUR-033 | `/api/portal/token` émettait des jetons **sans `garageId`** | audit de dépréciation |
| GF-DUR-034 | Une **sauvegarde embarquée dans l'installateur livré** | ouverture de `app.asar` |
| GF-DUR-035 | **Boucle de redirection infinie** : 737 req/min, quota du garage épuisé | instrumentation de la PWA |

---

## C. Causes racines notables

**GF-DUR-035** — deux comportements corrects, composés. `mechFetch` renvoie vers
`/license` sur 401 ; `confineMechanic` renvoyait tout, y compris `/license`, vers
`/mechanic`. Le 401 survient dès qu'une clé mécanicien est révoquée, suspendue,
expirée, réattribuée, ou que la licence garage parente expire — des gestes
d'exploitation normaux. La limite `api` étant indexée sur l'**IP**, un seul
téléphone en boucle épuisait les 120 req/min partagés par tout l'atelier.

**GF-DUR-034** — `files: ["electron/**/*"]`, joker sans filtre d'extension. Une
sauvegarde `main.js.before-v171-…` déposée dans `electron/` est partie dans
`app.asar`. Le risque n'était pas ce fichier (aucun secret dedans) mais la règle.

**GF-DUR-027** — aucun test n'exerce l'étape de build ; le contrôle n'existe que
là. 2 800 tests verts ne pouvaient pas le voir.

---

## D. Mesures

### Poste garage → PWA mécanicien

Sondage à 3 s (`lib/live-sync`), aucun transport push. Cadence nominale relevée
sur 20 s : **3111, 3064, 3058, 3066, 3072, 3060 ms**.

| Scénario | Δ mesuré |
|---|---|
| création → visible chez A | 438 ms |
| modification → visible chez A | 2989 ms |
| réaffectation → disparaît de A | 2960 ms |
| réaffectation → apparaît chez B | 2962 ms |
| suppression → aucune tâche fantôme | 791 ms |

Médiane **2960 ms**, pire cas **2989 ms**, n = 5. Réseau local.
**Le mot « instantané » n'est justifié par aucune de ces valeurs.**

### PWA mécanicien → poste garage

**Aucune propagation.** Le poste ne sonde pas ; il ne recharge qu'au retour de
focus, au plus une fois par 30 s. Mesuré : un mécanicien démarre son intervention
(base : `status=in_progress`, `timerStartedAt` posé) et l'écran du poste reste
inchangé **20 s**. Le retour de focus lui-même n'a rien rafraîchi.

### Débit

| Client | req/min mesurées |
|---|---|
| PWA mécanicien au premier plan | 42 |
| PWA en boucle (avant GF-DUR-035) | 737 |
| PWA après correction | 33 |
| Quota `api` | 120 **par IP**, partagé par tout le garage |

Conséquence chiffrée : brancher un sondage à 3 s sur le poste (~40 req/min)
mettrait un poste + deux mécaniciens à ~124 req/min, au-dessus du quota. La
correction évidente du sens manquant **fabriquerait** les 429 que GF-DUR-035
vient d'éliminer. Ce choix est laissé ouvert, avec le calcul écrit.

### Artefact livré

`GarageFlows Setup 1.1.0.exe` (13/08/2026 16:54), `app.asar` 23 637 entrées.

| Recherche | Résultat |
|---|---|
| sauvegardes hors `node_modules` | **1** — `electron/main.js.before-v171-…` |
| `.env` | 0 |
| `.pem` / `.key` hors `node_modules` | 0 |
| source maps hors `node_modules` | 0 |
| `BEGIN PRIVATE KEY` | 1 — contrôle de format de `jose/importPKCS8`, vérifié fichier par fichier |
| `private.pem` | **absent** ; seul `public.pem` (178 o, en-tête `BEGIN PUBLIC KEY`) |

---

## E. Tests qui passaient pour la mauvaise raison

1. **Codes de secours (GF-DUR-025)** — le test « deux codes différents »
   passait *même sans la protection* : `Promise.all` ne garantit pas
   l'entrelacement. Conservé comme preuve de bout en bout, sa portée réelle est
   écrite dedans ; la détection de course est désormais déterministe.
2. **Stock (GF-DUR-037)** — « stock 1, deux factures de 1 » réussit aussi en
   exécution *séquentielle* : le test ne peut pas départager ce qu'il annonce.
   Un test à entrelacement **imposé** l'accompagne maintenant, avec des mutations
   qui se discriminent (prédicat retiré → seul « dernière unité » tombe ; verrou
   d'idempotence retiré → seul « même facture deux fois » tombe).

---

## F. Un garde retiré

Une détection des **verbes morts** dans une route vivante a été écrite, exécutée,
puis **supprimée** : elle accusait à tort. Deux motifs courants la mettent en
échec — le verbe en variable (`method: methode`) et l'URL en variable
(`${apiBase}/${id}`). Sur 23 verbes signalés, des faux positifs subsistaient
jusque dans la version la plus prudente. La limite est **écrite** dans
`routes-sans-appelant.test.ts` plutôt que gardée par un test qui ferait supprimer
du code vivant.

---

## G. LOT 5 — compteurs dérivés de l'inventaire

```
PRODUCT_REQUIRED  0     (les 8 ont reçu leur interface)
DEPRECATED        0     (/api/portal/token supprimée)
INTERNAL_ONLY     0
ORPHANED          5     (décision écrite : conservées)
UNKNOWN           0
```

Quatre routes étaient **mal classées** : `forecast`, `profitability`,
`suggestions` et `analytics/health` sont atteignables par une autre route qui a,
elle, un écran — ce sont des `double`, pas une dette produit.

Les 5 conservées (`pricing`, `scheduling`, `memory`, `gamification`,
`proactive`) : la seule chose établie à leur sujet est « aucun fetch trouvé »,
motif que la consigne §30 interdit d'invoquer pour supprimer. Contrairement à
`/api/portal/token`, aucune remplaçante nommée, aucun argument de sécurité.

---

## H. Multi-tenant

Le garde de complétude existant est sain : il énumère les routes à identifiant,
exige que chacune soit dans la matrice ou dans un inventaire d'exemptions avec
motif ET fichier de preuve **existant**, et porte un contrôle d'anti-vacuité.

Vérifié en plus (GF-DUR-038) : les cinq listes paginées construisent un `where`
ancré sur `session.user.garageId` et passent **le même objet** à `findMany` et à
`count`. Le total ne peut donc pas révéler le volume d'un autre garage. Constat
figé par un test, mutation vérifiée.

---

## I. Limites — rien n'est caché

| Élément | Pourquoi non vérifié | Ce qui l'a été | Risque |
|---|---|---|---|
| Activation de licence (`/api/license/activate`) | exige un jeton signé par la clé privée | tout l'aval : sessions garage et mécanicien, validation, révocation | moyen |
| Installation Windows réelle | non exécutée | l'artefact déjà construit a été ouvert et scanné | moyen |
| PWA de production (`app.garageflows.fr`) | non testée | build de production, service worker non audité | moyen |
| Responsive / PDF / update PWA | non testés | — | moyen |
| Offline / retry / file d'attente | non testés | idempotence stock et 2FA prouvées | moyen |
| Cache du service worker | non audité | — | moyen |
| Écran garage → mutation par clic | mutations passées par l'API | l'écran garage s'ouvre et rend le planning | faible |
| 2ᵉ et 3ᵉ passes complètes | non exécutées | — | à évaluer |

**Décision de licence en suspens** : poste sur `835c1e90…`, dépôt sur
`fe5b7807…`. L'écart porte **uniquement** sur la clé (vérifié fichier par
fichier). Rien n'a été copié, généré ni tourné.

---

## J. Verdict

**PRODUCTION READY WITH RESERVATIONS.**

Ce qui a été exercé l'est réellement : build de production vert, 2873 tests,
`tsc` et ESLint propres, artefact scanné, isolation multi-tenant gardée,
propagation mesurée et chiffrée.

Ce qui ne l'a pas été est listé en §I sans exception. Les réserves qui pèsent le
plus : **installation Windows réelle** et **PWA de production**, aucune des deux
substituable par ce qui a été fait ici.

Le sens PWA → poste **ne fonctionne pas** et la correction demande d'abord une
décision sur l'indexation du quota. Ce n'est pas un défaut caché : c'est un choix
ouvert, chiffré, et gardé par un test qui préviendra si quelqu'un l'ignore.
