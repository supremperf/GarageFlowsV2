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
