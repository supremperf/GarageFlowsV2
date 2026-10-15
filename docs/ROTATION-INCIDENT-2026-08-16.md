# Incident de rotation du 2026‑08‑16 — un caractère invisible met la production à terre

> **Statut : RÉSOLU.** Ce document est la référence de l'incident. Aucune valeur
> secrète n'y figure : uniquement des noms, des longueurs, des points de code et
> des empreintes SHA‑256 tronquées.

---

## 1. Symptôme

`scripts/reset-garageflow.ps1` (run `2026-08-16_15-27-17`) a mené une rotation
complète des secrets Vercel Production, créé un déploiement, puis échoué au
contrôle de santé :

```
/api/health → HTTP 500, corps = page HTML générique « 500: Internal Server Error »
```

Le rapport du run concluait :

```
Résultat : ÉCHEC - aucun rollback destructif effectué
DIVERGENCE DE CLÉ : Production porte la NOUVELLE paire,
                    le projet local a été restauré sur l'ANCIENNE.
```

Toutes les routes dynamiques — pas seulement `/api/health` — rendaient 500.

---

## 2. Chronologie (heure locale)

| Heure | Événement |
|---|---|
| 15:27:17 | Création du dossier de run |
| 15:27:41 | `vercel link` — écriture de `.vercel/project.json` et `.env.local` |
| 15:27:47 | `vercel env pull` de sauvegarde → **toutes les valeurs rendues `[SENSITIVE]`** |
| 15:28:53 | Génération de la nouvelle paire ECDSA P‑256, auto‑test cryptographique OK |
| 15:28:53 | Sauvegarde des 4 ancrages de clé publique (`.before-v171-20260816-152853`) |
| 15:28:54 | Écriture de `keys/public.pem` et `keys/private.pem` — **sans sauvegarde : le dossier `keys/` était vide** |
| 15:29:47 → 15:30:17 | Réparations de schéma Neon (`legacyIdV*` rendue nullable, convergence) |
| 15:30:18 | Écriture de `secrets.env` — les 13 valeurs destinées à Vercel |
| ~15:30 | **Écriture des 13 variables dans Vercel Production** |
| 15:30:31 → 15:33:27 | Build et déploiement Vercel — `status ● Ready` |
| 15:33:43 | `/api/health` → 500 |
| 15:33:59 | Rapport d'échec ; **restauration des 4 ancrages sur l'ANCIENNE clé** |

---

## 3. Cause racine

### 3.1 Le défaut

`RESET-GARAGEFLOW.cmd` commence par `chcp 65001`. Sur ce codepage,
`[Console]::InputEncoding` devient `Encoding.GetEncoding(65001)` — un
`UTF8Encoding` dont `GetPreamble()` vaut `EF BB BF`.

`Invoke-NativeCommand` (`scripts/configurer-api-garageflow.ps1`) transmet la
valeur à la CLI Vercel par un tube PowerShell :

```powershell
$raw = @($InputText | & $Executable @Arguments 2>&1)
```

Windows PowerShell 5.1 écrit alors ce **préambule avant la valeur**. Vercel a
enregistré `<U+FEFF>postgresql://…`.

Mesure directe, reproduite :

```
sans correctif : BYTES=efbbbf706f737467726573716c…  LEN=19   (14 attendus + 3 de préambule + 2 de CRLF)
avec correctif : BYTES=706f737467726573716c3a2f…    LEN=16   (14 attendus + 2 de CRLF)
```

Contrôle d'isolation : forcer `$OutputEncoding` sur un UTF‑8 sans préambule ne
change **rien** ; seul `[Console]::InputEncoding` gouverne le préambule.

Mesuré également : la CLI Vercel 58.4.4 retire les CR/LF de **fin** mais conserve
un préambule de **tête** — d'où une valeur stockée d'exactement +1 caractère.

### 3.2 La conséquence

`src/lib/env.ts` valide le schéma **sans `trim()`** :

```ts
const url = process.env.DATABASE_URL ?? ''
const isPostgres = /^postgres(ql)?:\/\//i.test(url)
```

`assertEnv()` lève, `src/instrumentation.ts` propage, Next.js ne prépare jamais
le serveur, et rend sa page HTML 500 sur **toutes** les routes.

### 3.3 Un second défaut, latent, découvert en corrigeant

En Windows PowerShell 5.1, `$OutputEncoding` vaut **ASCII** par défaut : tout
caractère non‑ASCII écrit sur l'entrée standard d'un programme natif devient
`?`. Aucune des 13 valeurs du 16/08 n'était concernée (URL, base64, hexadécimal),
mais le **premier secret accentué** aurait été corrompu en silence — accepté par
Vercel, refusé à l'usage, sans le moindre message.

Ce défaut n'a pas été trouvé par relecture : c'est l'auto‑test
`Test-StdinTransport`, ajouté pour verrouiller le premier, qui l'a signalé sur sa
sentinelle `clé-accentuée-é€` (`c3a9` reçu comme `3f`).

---

## 4. Pourquoi rien ne l'a détecté

1. **La sonde de vérification nettoyait ce qu'elle devait détecter.**
   `Assert-RemoteProductionDatabaseValues` calculait son empreinte et testait le
   schéma sur `clean(value)`, où `clean()` retire précisément `U+FEFF`. Elle
   validait une valeur que le runtime ne voit jamais.

2. **Cette sonde n'était appelée nulle part.** Le flux appelle
   `Assert-ProductionDatabaseVariables`, qui vérifie seulement la *présence* des
   noms dans `vercel env ls`. La seule fonction qui regardait les valeurs réelles
   était du code mort.

3. **Son canal de mesure aurait menti de toute façon.** `vercel env run` charge
   `.env.local` et `.env` du projet, qui **écrasent** les valeurs Production.
   Mesuré : `DATABASE_URL` y revient à 13 caractères commençant par `U+0066` —
   c'est `file:./dev.db`, la valeur SQLite locale, pas Neon.

4. **`String.prototype.trim()` retire `U+FEFF` en JavaScript** (il appartient à
   la production `WhiteSpace` d'ECMAScript). Toute vérification écrite
   « proprement » avec `.trim()` accepte donc une valeur corrompue. C'est
   pourquoi 15 variables sur 16 n'ont produit aucun symptôme, et pourquoi seule
   `DATABASE_URL` — validée sans `trim()` — a fait tomber le démarrage.

5. **Vercel masque les valeurs.** `vercel env pull` rend `[SENSITIVE]` pour
   chacune des 26 variables : il est impossible de relire une valeur pour la
   contrôler, et **aucun rollback de secret n'est possible**.

---

## 5. La divergence cryptographique

Le bloc `catch` restaurait **inconditionnellement** les fichiers source patchés,
alors que la nouvelle clé privée était déjà engagée dans Vercel.

Il en est résulté **trois** états, pas deux :

| Composant | Empreinte (SHA‑256 du DER SPKI) |
|---|---|
| Ancrages `_PK`, `_LINES`, `REFERENCE_FP` — poste **et** dépôt | `e6605999…` |
| `keys/public.pem` + `keys/private.pem` du poste | `2f3c1693…` |
| `GF_PRIVATE_KEY` de Vercel Production | `2f3c1693…` |
| Les 9 licences vivantes dans Neon | signées **9/9** par `e6605999…` |

Le poste était donc en désaccord **avec lui‑même** : `npm run check:public-key`
échouait, le keygen aurait signé avec `2f3c1693…` et le binaire vérifié avec
`e6605999…`.

Cause : les sauvegardes de `keys/*.pem` ne sont créées que si les fichiers
existent (`reset-garageflow.ps1`, test `Test-Path`). Aucun
`keys/private.pem.before-v171-*` n'a été produit ce jour‑là — le dossier `keys/`
était **vide avant le run**. La restauration a donc ramené les ancrages sans
ramener les clés.

> **La clé privée de `e6605999…` est définitivement perdue.** Recherche
> exhaustive de tous les `*.pem` du profil utilisateur, corbeille comprise : elle
> n'existe nulle part. Elle manquait **avant** le run du 16/08. Revenir à cette
> paire aurait figé le produit — les licences existantes auraient continué de
> fonctionner, mais plus aucune n'aurait jamais pu être émise.

La paire `2f3c1693…` était donc la seule option : c'est la seule dont la moitié
privée existe, et Production la portait déjà.

---

## 6. Impact réel

| Domaine | Impact |
|---|---|
| PWA / API | **Totale** — 500 sur toutes les routes dynamiques, de 15:33 à la réparation |
| Base Neon | **Aucun** — PostgreSQL 17.10, 65 tables, 0 migration en attente, données intactes |
| Redis / Upstash | Aucun — `cleanUpstashValue()` fait un `trim()`, le BOM y était neutralisé |
| Licences | 9 licences de **test** perdues (voir §7). Aucun client réel |
| Clés au repos | `GF_TOTP_ENC_KEY`, `GF_SMTP_CIPHER_KEY`, `GF_BACKUP_KEY` préservées ; leur BOM est inoffensif, tous leurs consommateurs font `.trim()` |
| Secrets exposés | Aucun. Aucune valeur n'a été affichée, journalisée ni commitée |

### Les licences perdues

Les 9 lignes `LicenseKey` étaient irrécupérables sur **deux** plans :

1. leurs jetons sont signés par `e6605999…`, dont la clé privée n'existe plus ;
2. la rotation a remplacé `GF_DB_MAC_SECRET`, donc leur `recordMac` — le sceau
   d'intégrité vérifié par `verifyRecordMac()` — ne correspondait plus. Une
   ligne au MAC invalide est traitée comme **altérée** et refusée.

Le re‑MAC de `scripts/repair-after-secret-rotation.js` aurait réparé le point 2,
mais pas le point 1.

Toutes portaient le texte d'exemple du formulaire du keygen en `customerId`
(`ex: CUST-042 — laisser vide =`), avaient été créées le 14/08 dans une fenêtre
de 23 minutes, 6 sur 9 n'avaient jamais été activées, aucune n'était liée à un
HWID, et les garages rattachés s'appelaient « Mathys », « Garage Test »,
« GF E2E SYNC », « azer », « aqa ». Sauvegardées en JSON avant purge dans
`GarageFlows-rotation-recovery-2026-08-16\licences-avant-purge\`.

---

## 7. Correctifs

### 7.1 Transport — `scripts/configurer-api-garageflow.ps1`

`Invoke-NativeCommand` force, autour du seul chemin qui écrit sur l'entrée
standard, **les deux** encodages sur un UTF‑8 sans préambule, puis les restaure :

- `$global:OutputEncoding` → encodage du contenu (corrige la mutilation en `?`) ;
- `[Console]::InputEncoding` → préambule (corrige le `U+FEFF`).

Si `[Console]::InputEncoding` est inaccessible (tâche planifiée, CI), le script
le **dit** au lieu de le supposer.

### 7.2 Auto‑test bloquant — `Test-StdinTransport`

Trois sentinelles (ASCII, base64, accentuée) traversent le transport réel ; les
octets reçus sont comparés aux octets envoyés. Exécuté **en préflight**, avant
toute mutation : l'échec ne coûte rien. Un préambule détecté produit un message
explicite et arrête le run.

Exécutable seul, sans rien toucher :

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\reset-garageflow.ps1 -SelfTest
```

### 7.3 Sonde de vérification

- ne nettoie **plus** la valeur : elle observe ce que le runtime observe ;
- rapporte `firstCodePoint` et la liste des caractères invisibles trouvés ;
- accepte `-ExpectedValues` pour vérifier **toutes** les variables poussées,
  empreinte contre empreinte, et plus seulement `DATABASE_URL`/`DIRECT_URL`.

### 7.4 Plus de rollback local après mutation distante

Une fois `$remoteMutationStarted` vrai, le bloc `catch` :

- **ne restaure aucun fichier cryptographique local** — les deux côtés restent
  sur la même paire ;
- affiche `REMOTE_STATE_MUTATED` / `RECOVERY_REQUIRED` / `DO_NOT_RERUN_ROTATION` ;
- écrit `rotation.lock`, qui fait **refuser** tout nouveau lancement ;
- sort en **50** au lieu de 1.

La restauration locale intégrale ne subsiste que lorsque rien n'a été muté à
distance — le seul cas où elle a du sens.

### 7.5 Diagnostic déployé — `GET /api/admin/diagnostics`

Authentifié par `x-gf-key` (== `GARAGEFLOW_API_KEY`, comparaison à temps
constant). Renvoie, pour chaque variable : présence, longueur, **premier point de
code**, caractères invisibles, et une empreinte
`SHA-256("GF-ENV-FP-v1|<nom>|<valeur>")` tronquée à 12 hexadécimaux — salée par
le nom, donc ni comparable à une table arc‑en‑ciel générique, ni rejouable d'une
variable à l'autre. Renvoie aussi
`licenseKey.converged` : la clé publique embarquée et `GF_PRIVATE_KEY`
désignent‑elles la même paire ?

C'est le **seul** canal fiable : il mesure ce que le déploiement reçoit
réellement, là où `vercel env pull` masque et `vercel env run` est pollué par les
`.env` locaux.

### 7.6 `/api/health` structuré

La réponse anonyme est **inchangée** (`{"status":"ok"}`) — c'est une décision de
sécurité délibérée du service. Un appelant authentifié obtient la ventilation :

```json
{ "status":"ok",
  "checks":{ "process":"pass","environment":"pass","database":"pass","redis":"pass","migrations":"pass" },
  "envIssues":[] }
```

### 7.7 Test de non‑régression

`src/lib/__tests__/rotation-caractere-invisible.test.ts` fige : le refus de
démarrage sur préfixe invisible, la présence du point de code dans le message,
l'absence de tout secret dans ce message, et — explicitement — le piège du
`trim()` qui masque `U+FEFF`.

---

## 8. Ce qui reste vrai après l'incident

- **Aucune valeur de secret Vercel n'est récupérable.** Ne jamais annoncer un
  « rollback complet » : les seules valeurs restaurables sont celles que
  l'opérateur détient hors de Vercel.
- Une variable qui « semble correcte » et échoue quand même porte probablement un
  caractère invisible. **L'éditer ne suffit pas : il faut la supprimer et la
  recréer.**
- `chcp 65001` n'est pas anodin : il change l'encodage de l'entrée standard des
  processus enfants.

## Voir aussi

- `docs/POST_ROTATION_RECOVERY.md` — procédure de récupération
- `docs/ROTATION_SECRETS.md` — impact par clé
- `ROTATION-RECOVERY-FINAL.md` — rapport de la récupération du 16/08
