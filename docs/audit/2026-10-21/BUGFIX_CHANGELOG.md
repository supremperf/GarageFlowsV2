# BUGFIX_CHANGELOG — 2026-10-21

## GF-1021-01 — Interblocage des transactions SQLite concurrentes (P1)

**Problème.** Sur le poste, dix validations simultanées de la même facture
(double-clic, rejeu réseau) produisaient **une réussite et neuf erreurs**
(`P1008` « Operations timed out », `P2028`) après 5 puis 10 secondes. Le stock
restait juste (un seul débit), mais l'utilisateur voyait le poste se figer puis
une erreur, au lieu de la réponse idempotente « déjà validée ».

**Reproduction (avant).**
`npx vitest run src/lib/__tests__/stock-double-deduction.int.test.ts` →
2 échecs « Test timed out in 5000ms ». Une sonde chronométrée a relevé :
4 erreurs à 5 011 ms, 5 à 10 022 ms, une seule réussite à 10 040 ms.

**Cause.** Prisma ouvre les transactions SQLite en mode différé (`BEGIN`).
Chaque transaction prend un verrou de lecture (`findMany`), puis veut écrire :
toutes attendent que les autres relâchent leur lecture. SQLite ne sort de
l'interblocage qu'à l'expiration du délai d'attente.

**Fichiers.** `src/lib/sqlite-tx-queue.ts` (nouveau), `src/lib/db.ts`.

**Correction.** SQLite n'admet qu'un écrivain et le serveur Next du poste est un
processus unique. `$transaction` (formes interactive et tableau) passe donc par
une file d'attente, dans l'ordre d'arrivée. Une transaction ouverte depuis une
autre, dans le même contexte asynchrone (`AsyncLocalStorage`), ne passe pas par
la file : elle s'y attendrait elle-même. Le client PostgreSQL n'est pas modifié.

**Tests.**
- `src/lib/__tests__/sqlite-tx-queue.test.ts` (4 cas) : ordre, une tâche à la
  fois, propagation d'erreur sans blocage de la file, transaction imbriquée,
  formes interactive et tableau.
- `stock-double-deduction.int.test.ts` exige maintenant **zéro rejet**.
  Sans le correctif : échec (9 rejets). Avec : 6/6 en 0,45 s.

**Résultat.** Suite complète : 4 376 réussis, 0 échec. VALIDÉ.

**Effet de bord examiné.** Le commentaire de `src/lib/license/devices.ts`
annonçait déjà « SQLite : écrivain unique » pour le plafond de sièges ; c'est
désormais vrai par construction. Une transaction longue retarde les suivantes,
ce qu'elle faisait déjà en tenant le verrou d'écriture.

## GF-1021-02 — Jetons coupés par l'OCR non détectés (P1, sécurité)

**Problème.** Une capture contenant une clé OpenAI ou une clé Stripe n'était pas
bloquée. Le même texte saisi au clavier l'était.

**Reproduction (avant).** Trois captures PNG produites avec Pillow, lues par
Tesseract 5.3.4 :

| Capture | Attendu | Obtenu avant |
|---|---|---|
| texte d'atelier sans secret | non bloquée | non bloquée |
| `OPENAI_API_KEY=sk-proj-…` | bloquée | **non bloquée** |
| jeton GitHub, clé AWS, clé Stripe | 3 secrets | **2 secrets** (Stripe manquée) |

Forme du texte OCR réel (valeurs factices tronquées) : `sk- proj -AbCd…` et
`sk_live_51H… lmno…` — une espace au milieu du jeton.

**Cause.** Les expressions de `patterns.toml` s'appliquaient au texte brut ; une
espace parasite au milieu d'un jeton casse la correspondance.

**Fichier.** `scripts/secret_scan.py` (`_compact_lines`, `_scan_ocr_text`).

**Correction.** Pour une **capture** uniquement, chaque ligne est analysée une
seconde fois sans ses espaces, avec les règles à préfixe fort. La famille
`generic` est exclue pour ne pas créer de faux positifs en recollant des mots
ordinaires. Un résultat qui chevauche une détection existante est ignoré. Les
positions sont rapportées au texte OCR d'origine. La saisie de texte
(`scan_text`) n'est pas modifiée.

**Tests** (`scripts/test_secret_scan.py`, 32 → 36) :
- `test_ocr_imprecis_espace_parasite_dans_le_jeton` : échoue sans le
  correctif, réussit avec ;
- `test_ocr_compactage_sans_faux_positif_generique` ;
- `test_ocr_compactage_ne_dedouble_pas` ;
- `test_ocr_reel_tesseract` : vraies captures lues par Tesseract (ignoré, et non
  réussi, si Tesseract ou Pillow est absent). Échoue sans le correctif.

**Résultat.** 36/36. Service HTTP local rejoué avec Tesseract réel : capture
propre → non bloquée ; OpenAI → bloquée (`sk-****`) ; GitHub + AWS + Stripe →
3 secrets ; origine distante → 403. Capture en thème sombre (texte clair,
police proportionnelle 18 px) : OpenAI et GitHub détectés. VALIDÉ.

## GF-1021-05 — Clés hors de `keys/` non ignorées par Git (P2, sécurité)

**Problème.** `.gitignore` ignorait `keys/*.pem` mais pas un fichier `.pem`,
`.key` ou `.sig` placé ailleurs (racine, `scripts/`, copie d'un dossier
`%APPDATA%/GarageFlows/keys`). Un `git add -A` l'aurait versionné.

**Correction.** Règles globales `*.pem`, `*.key`, `*.sig`. Aucun fichier suivi
n'est concerné (`git ls-files -ci --exclude-standard` : 0 fichier de ce type).

**Test.** Fichiers témoins `scripts/zz.pem`, `zz.key`, `release-x.sig` créés
puis supprimés : absents de `git status`. Gardes `secret-scan-policy` et
`private-key-material` : 7/7.

## GF-1021-06 — Scan Gitleaks de la CI (P2, CI)

**Problème.** Rejoué localement avec gitleaks 8.24.3 sur l'arbre suivi (même
périmètre que la CI), le scan relevait deux occurrences : le jeton factice
`GF2.fixture.signature` de `src/app/api/keygen/__tests__/admin-scope.test.ts`,
et l'exemple de sortie OCR de ce dossier, reconnu comme jeton Stripe.

**Correction.** Ajout d'allowlist exact, contenu identique au commit 2a50a18
de la PR #33 (mêmes empreintes de blob, donc aucun conflit entre les deux
PR) ; exemple OCR tronqué.

**Résultat.** `node scripts/gitleaks-ci.cjs` → 0 occurrence, exit 0 ;
`secret-scan-policy` et `gitleaks-ci` : 20/20.

## GF-1021-07 — Image falsifiée acceptée sans Pillow (P2, sécurité)

**Problème.** Premier passage de la PR #34 en CI : `test_image_corrompue`
échoue (« ScanError not raised »). `validate_image` ne détectait une image
corrompue, et n'appliquait la limite de 40 millions de pixels, **que si Pillow
était installé**. La CI installe uniquement les dépendances verrouillées (sans
Pillow), comme un poste nu : une image au contenu falsifié passait alors sur sa
seule signature, et rien ne protégeait Tesseract d'une bombe de pixels. Mes
exécutions locales ne l'avaient pas vu, car Pillow y était installé. Le défaut
date de `3dc2293`, qui fait partie de cette PR et n'était jamais passé en CI.

**Reproduction.** Environnement virtuel Python 3.12 sans Pillow :
`test_secret_scan.py` → 1 échec, à l'identique de la CI.

**Correction.** `scripts/secret_scan.py` : `_dimensions` lit l'en-tête avec la
bibliothèque standard (PNG : longueur, type et CRC de l'IHDR ; JPEG : segments
jusqu'au SOF ; GIF ; BMP 12 ou 40+ octets). En-tête invalide → 415
`INVALID_IMAGE` ; plus de 40 millions de pixels → 413 `IMAGE_TOO_LARGE`, avant
tout décodage. Pillow, s'il est présent, vérifie en plus.

**Tests** (36 → 39) : quatre images 3×2 réelles (PNG, JPEG, GIF, BMP produites
par Pillow et intégrées en base64) acceptées avec les bonnes dimensions ;
en-tête PNG annonçant 50 000 × 50 000 pixels refusé ; PNG au CRC faux, JPEG
sans SOF, GIF 0×0 et BMP tronqué refusés. Sans le correctif et sans Pillow :
10 échecs ou erreurs.

**Résultat.** 39/39 sans Pillow (dépendances verrouillées de la CI, Python
3.12.3), sous Python 3.13 et sous 3.12 avec Pillow. OCR réel rejoué sur des
captures PNG, JPEG, BMP et GIF, avec et sans Pillow : résultats identiques.

## GF-1021-08 — Keygen : cinq pages n'affichaient que leur titre (P1)

Trouvé par la vérification par captures d'écran (dossier `preuves/`), pas par
les tests : les 88 tests Python passaient.

**Problème.** Sur le keygen livré, « Gérer les licences », « Clients »,
« Appareils et HWID », « Détection des secrets » et « Journaux et
diagnostics » n'affichaient que leur titre (captures 38, 39, 40, 43, 44) :
impossible de consulter, suspendre ou révoquer une licence depuis le keygen.
La fenêtre récapitulative des clés mécanicien cachait de même les clés
générées.

**Cause.** Chaque carte était créée dans un cadre de marge anonyme,
`Card(_frame(self, padx=26))`, que personne ne plaçait. Tk ne dessine pas un
widget dont le parent n'est pas placé. La sonde Tk des tests ne modélise pas
la géométrie.

**Correction** (`b4a291c`). `_gutter()` crée **et** place ce cadre ; les 12
emplacements l'utilisent, avec les mêmes marges.

**Tests.** `test_keygen_ui_lifecycle.py` : le vrai keygen, affiché, doit
montrer pour chaque section au moins une carte et son tableau (échoue sur les
5 pages avant correction). `test_keygen_v2.py` : garde statique, exécutée en
CI, qui interdit `Card(_frame(`.

**Résultat.** Captures 46 à 50 : les cinq pages affichent leur contenu.

## GF-1021-09 — Keygen : texte indicatif lu comme une saisie (P1)

Trouvé par les captures, sur le keygen réel (captures 53 à 56).

**Problème.**
- Licence sans liaison matérielle impossible à générer : « HWID invalide »
  alors que le champ HWID, facultatif, était vide (capture 53).
- Identifiant client laissé vide : la licence portait « ex. CUST-042 », signé
  dans le jeton (capture 58).
- « Gérer les licences » : « 0 licence(s) affichée(s) sur 1 » ; « Clients » :
  « 0 client(s) » ; même filtre dans « Appareils et HWID » (captures 54 à 56).
- « Mises à jour » : la version « ex. 1.2.0 », l'URL d'exemple et la version
  minimale « facultatif » valaient saisie ; le contrôle « La version et l'URL
  de téléchargement sont obligatoires » ne se déclenchait plus. Aucune
  signature n'a été tentée (pas de clé de mise à jour dans la session).

**Cause.** `Entry` insérait son texte indicatif **dans** le widget, donc dans
la `StringVar` liée. Défaut présent depuis la refonte `4bfe1c0` (19/10).

**Correction** (`5993010`). Le texte indicatif est un libellé posé par-dessus
le champ, masqué dès que la variable a une valeur ou que le champ a le focus.
La variable est lue directement : Tcl appelle la trace la plus récente en
premier, avant que le champ n'ait recopié la nouvelle valeur.

**Tests.** La sonde Tk de `test_keygen_v2.py` ne reliait pas un champ à sa
variable : elle ne pouvait pas voir le défaut. Elle le fait désormais comme le
vrai Tk. Nouvelle classe `TestTexteIndicatif` (exécutée en CI) : 4 tests,
6 vérifications, qui échouent sur l'ancien code et passent avec le correctif
(capture 90). Tests réels sous affichage (`PlaceholderTests`, 4 tests) : aucun
champ ne contient son texte indicatif ; affichage et masquage selon la valeur
et le focus ; licence générée puis listée ; trace retirée à la destruction.

**Résultat.** 93/93 (sonde, CI), 19/19 (Tk réel). Captures 57 à 60 : la
licence générée avant le correctif apparaît, une licence PREMIUM sans HWID se
génère, l'identifiant client est calculé.

**Action restante (hors dépôt).** Les licences émises depuis le 19/10 avec
le champ « Identifiant client » vide portent `cid = "ex. CUST-042"`. Elles
restent valides, mais leur rattachement client est faux et la page
« Clients » les regroupe. À rechercher dans la base locale du keygen de
production (`keys/licenses_db.json`), puis à réémettre si nécessaire.

## GF-1021-10 — Licence bloquée : chargement infini après un rechargement (P2)

Trouvé par les captures, dans un vrai navigateur, avec une autorité de test.

**Problème.** Application ouverte, une suspension ou une révocation affiche
bien « Compte suspendu » ou « Compte révoqué » (captures 71, 78). Mais après
un rechargement de la page, l'application restait sur « Chargement du
planning… » (20 s observées, sans fin), sans aucun message (captures 72, 79).
L'accès était correctement refusé (403).

**Cause.** `src/app/page.tsx` : le chargement initial (`/api/garages`) échoue
en 403 et l'état « chargement » n'en sortait jamais ; `LicenseRevokedOverlay`,
qui sait afficher ces états, n'était monté qu'après ce chargement.

**Correction** (`aeddc95`). L'overlay est monté dès l'écran de chargement.
Une réactivation recharge la page : rien n'avait été chargé derrière lui.

**Tests.** `licence-bloquee-au-chargement.test.ts` : 2 gardes sur le source
(l'environnement de test est `node`, sans testing-library), qui échouent sur
l'ancien code et passent avec le correctif (capture 90). Vérification dans le
navigateur : licence révoquée, la page rechargée affiche « Compte révoqué » en
5 s (capture 80) ; réactivée avec motif, « Compte réactivé » puis planning
rechargé seul (captures 82, 83). Suite complète : 4 378 réussis, 0 échec.

## GF-1021-11 — Appareil libéré par le SAV : poste web bloqué (P2, NON CORRIGÉ)

**Problème.** Après « Réinitialiser le matériel » dans le keygen, le
navigateur dont l'appareil a été libéré reste sur « Chargement du
planning… » (captures 73, 85). Les API répondent 401 `DEVICE_UNKNOWN`
« Appareil inconnu. Réactivez votre licence. », mais la page ne l'affiche pas
et ne propose pas l'activation. Le middleware renvoie `/license` vers `/` tant
que le cookie `gf_session` (30 jours en web) reste valide.

**Cause.** Aucun point d'accès ne retire `gf_session` côté garage. L'espace
mécanicien a résolu le même problème (GF-DUR-035) avec
`/api/mechanic/logout`.

**Action corrective proposée.** Un point d'accès serveur qui expire
`gf_session`, `gf_license_validated` et `gf_license_type`, appelé par la page
d'accueil sur un 401 de licence ou d'appareil (`LICENSE_SESSION_MISSING`,
`LICENSE_UNKNOWN`, `DEVICE_REQUIRED`, `DEVICE_UNKNOWN`), suivi d'un renvoi
vers `/license`. Non fait ici : c'est une nouvelle route API (inventaire,
limitation de débit, revue de sécurité), à décider par le responsable.
Contournement : effacer les cookies du site, puis réactiver.

## GF-1021-12 — Keygen : la molette ne fait pas défiler les formulaires (P3, NON CORRIGÉ)

**Problème.** Sur « Générer une licence », la molette reste sans effet, que le
pointeur soit sur un champ ou entre deux cartes ; seule la barre de
défilement fonctionne (constaté pendant les captures).

**Cause.** `ScrollFrame._bind_wheel` lie la molette au canevas et au cadre
intérieur seulement. Tk remet l'événement au widget sous le pointeur et à ses
balises (classe, fenêtre racine), pas à ses parents : le commentaire « Les
enfants créés plus tard héritent du binding par propagation Tk » est inexact.

**Action proposée.** Lier la molette sur la fenêtre racine et garder le
filtrage existant par `winfo_containing`.

## GF-1021-13 — Keygen : affichages rognés ou superposés en 1 280 × 860 (P3, NON CORRIGÉ)

- « Gérer les licences » : la première ligne du panneau de synthèse est
  masquée sous la barre de boutons (captures 64, 67, 76). La « Fiche
  complète » affiche tout (capture 65).
- Deux notifications simultanées se superposent (libération d'appareil puis
  synchronisation, capture 91).
- La colonne « Client / Entreprise » tronque les noms longs.

Même famille que GF-1021-03 (largeurs fixes).
