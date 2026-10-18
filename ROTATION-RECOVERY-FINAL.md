# ROTATION‑RECOVERY‑FINAL — incident du 2026‑08‑16

> Aucune valeur de secret ne figure dans ce rapport. Les clés y sont désignées
> par leur nom, leur longueur, leur premier point de code et une empreinte
> SHA‑256 tronquée. Les empreintes de clé publique sont le SHA‑256 du DER SPKI —
> la convention de `scripts/check-public-key.mjs`.

---

## SECTION A — État initial

| | |
|---|---|
| Dépôt Git | `C:\Users\Mathys\.claude\jobs\2a11bc5b\tmp\repo` |
| Branche | `claude/garageflow-final-unified-merge-ub0l67` |
| Commit au démarrage | `29c89c3` — arbre propre |
| Dossier de build / déploiement | `C:\Users\Mathys\Desktop\GarageFlowsV2-claude-garageflow-final-unified-merge-ub0l67` (**n'est pas un dépôt Git**) |
| Projet Vercel | `garagesite5` — `prj_D6TzGiDffWVBjXscUSSgk5re9ymP`, équipe `garage-flows` |
| Alias production | `app.garageflows.fr` |
| Déploiement en panne | `dpl_6Mq1jMEkXAZKn2FGnDy3jDcdFs8t` — `garagesite5-nw3kjwoq1` |
| Santé initiale | **HTTP 500 sur toutes les routes dynamiques** (page HTML générique Next.js) |
| OS | Windows 10 Home 10.0.19045, x64 |
| Node / npm | v22.23.2 / 10.9.8 |
| Vercel CLI | 58.4.4 |
| Next.js / Prisma / PostgreSQL | 14.2.35 / 5.22.0 / 17.10 (Neon) |

**Empreintes au démarrage**

| Composant | Empreinte |
|---|---|
| Ancrages locaux `_PK`, `_LINES`, `REFERENCE_FP` (poste **et** dépôt) | `e6605999e336c28e…` |
| `keys/public.pem` et `keys/private.pem` du poste | `2f3c1693a70d99ea…` |
| Paire candidate du run échoué | `2f3c1693a70d99ea…` |
| `GF_PRIVATE_KEY` de Vercel Production | `2f3c1693a70d99ea…` |
| Les 9 licences de Neon | signées **9/9** par `e6605999…` |

---

## SECTION B — Cause racine

### Incident 1 — `/api/health` HTTP 500

**Chaîne complète, reproduite en laboratoire :**

1. `RESET-GARAGEFLOW.cmd` exécute `chcp 65001`.
2. Sur ce codepage, `[Console]::InputEncoding` devient un `UTF8Encoding` dont
   `GetPreamble()` vaut `EF BB BF`.
3. `Invoke-NativeCommand` transmet chaque valeur par un tube PowerShell
   (`$InputText | & vercel env add …`). PowerShell 5.1 écrit ce **préambule avant
   la valeur**.
4. Vercel enregistre `<U+FEFF>postgresql://…`.
5. `src/lib/env.ts:85` teste `/^postgres(ql)?:\/\//i` **sans `trim()`** →
   `assertEnv()` lève → `src/instrumentation.ts` propage → Next.js ne prépare
   jamais le serveur → page HTML 500 sur **toutes** les routes.

**Mesure directe :**

```
sans correctif : BYTES=efbbbf706f737467726573716c…  LEN=19   (14 attendus + 3 préambule + 2 CRLF)
avec correctif : BYTES=706f737467726573716c3a2f…    LEN=16   (14 attendus + 2 CRLF)
```

Isolement : forcer `$OutputEncoding` sur un UTF‑8 sans préambule ne change
**rien** ; seul `[Console]::InputEncoding` gouverne le préambule.

**Pourquoi aucun contrôle ne l'a vu :**

| # | Défaut | Fichier |
|---|---|---|
| 1 | La sonde appelait `clean()` — qui retire `U+FEFF` — **avant** de valider le schéma et de calculer l'empreinte. Elle validait une valeur que le runtime ne voit jamais. | `reset-garageflow.ps1:2228` (avant correctif) |
| 2 | Cette sonde n'était **appelée nulle part** : le flux appelle `Assert-ProductionDatabaseVariables`, qui ne vérifie que la *présence* des noms. Code mort. | `reset-garageflow.ps1` |
| 3 | Son canal de mesure aurait menti : `vercel env run` charge `.env.local` et `.env`, qui écrasent Production. **Mesuré : `DATABASE_URL` y revient à 13 caractères, `U+0066` — c'est `file:./dev.db`.** | — |
| 4 | `String.prototype.trim()` retire `U+FEFF` en JavaScript : toute vérification écrite avec `.trim()` accepte une valeur corrompue. 15 variables sur 16 n'ont produit aucun symptôme. | — |
| 5 | `vercel env pull` rend `[SENSITIVE]` pour les 26 variables : impossible de relire une valeur pour la contrôler. | — |

### Incident 1‑bis — un second défaut, latent, trouvé en corrigeant

`$OutputEncoding` vaut **ASCII** par défaut en Windows PowerShell 5.1 : tout
caractère non‑ASCII écrit sur l'entrée standard d'un programme natif devient
`?`. Aucune des 13 valeurs du 16/08 n'était concernée (URL, base64, hexadécimal),
mais le **premier secret accentué** aurait été corrompu en silence.

Trouvé par l'auto‑test ajouté pour verrouiller le premier défaut, sur sa
sentinelle `clé-accentuée-é€` : `c3a9` reçu comme `3f`. **Corrigé.**

### Incident 2 — divergence Production ↔ local

Le bloc `catch` restaurait **inconditionnellement** les fichiers source patchés,
alors que la nouvelle clé privée était déjà engagée dans Vercel. Trois états ont
coexisté (cf. Section A) : le poste était en désaccord **avec lui‑même**,
`npm run check:public-key` échouait.

Les sauvegardes de `keys/*.pem` ne sont créées que si les fichiers existent.
Aucun `keys/private.pem.before-v171-*` n'a été produit → le dossier `keys/` était
**vide avant le run**. La restauration a ramené les ancrages sans ramener les
clés.

> **La clé privée de `e6605999…` est définitivement perdue** — recherche
> exhaustive de tous les `*.pem` du profil utilisateur et de la corbeille. Elle
> manquait **avant** le run du 16/08 ; le script ne l'a pas détruite. Revenir à
> cette paire aurait figé le produit : les licences existantes auraient survécu,
> mais plus aucune n'aurait jamais pu être signée. La paire `2f3c1693…` était
> donc la **seule** option viable, et Production la portait déjà.

---

## SECTION C — Réparations

| ID | Cause | Fichier | Correction | Preuve |
|---|---|---|---|---|
| R‑1 | `[Console]::InputEncoding` à préambule | `scripts/configurer-api-garageflow.ps1` → `Invoke-NativeCommand` | Force `[Console]::InputEncoding` **et** `$OutputEncoding` sur UTF‑8 sans préambule autour du seul chemin qui écrit sur stdin, puis restaure | `-SelfTest` vert, y compris sous `chcp 65001` |
| R‑2 | Aucun contrôle du transport | idem → `Test-StdinTransport` | 3 sentinelles (ASCII, base64, accentuée) comparées octet pour octet ; exécuté **en préflight**, avant toute mutation | a détecté le défaut R‑1‑bis dès sa première exécution |
| R‑3 | Sonde aveugle au BOM | `scripts/reset-garageflow.ps1` | Ne nettoie plus ; rapporte `firstCodePoint` et les caractères invisibles ; accepte `-ExpectedValues` pour vérifier **toutes** les variables | syntaxe validée par le parseur PowerShell |
| R‑4 | Rollback local après mutation distante | idem, bloc `catch` | Plus aucune restauration cryptographique locale ; `REMOTE_STATE_MUTATED` / `RECOVERY_REQUIRED` / `DO_NOT_RERUN_ROTATION` ; `rotation.lock` ; sortie **50** | code revu, parseur OK |
| R‑5 | Aucun canal fiable de vérification | `src/app/api/admin/diagnostics/route.ts` **(nouveau)** | Empreintes, premier point de code, caractères invisibles, `licenseKey.converged` — jamais une valeur | interrogé sur 2 candidats et sur la production |
| R‑6 | Sonde jamais branchée | `reset-garageflow.ps1` → `Assert-DeployedConvergence` | Porte de vérification post‑déploiement, **avant** promotion | appelant réel déclaré à `routes-sans-appelant` |
| R‑7 | `/api/health` sans ventilation | `src/app/api/health/route.ts` | `checks` process/environment/database/redis/migrations pour l'exploitant authentifié ; **réponse anonyme inchangée** | mesuré sur la production |
| R‑8 | Aucun test de l'incident | `src/lib/__tests__/rotation-caractere-invisible.test.ts` **(nouveau)** | Refus de démarrage, point de code nommé, absence de secret, piège du `trim()` | suite verte |
| R‑9 | `VERCEL_DEPLOYMENT_ID` non déclarée | `scripts/garageflow-env-manifest.json` | Ajoutée à `platformProvided` | `env-manifest-drift` vert |

### Réparations sur l'infrastructure

| Action | Détail |
|---|---|
| Sauvegarde forensique | `Desktop\GarageFlows-rotation-recovery-2026-08-16\` — run d'origine, état local, paire candidate (intégrité vérifiée par SHA‑256) |
| `DATABASE_URL` | supprimée puis recréée **sans BOM**, transport binaire vérifié |
| 12 autres variables | réécrites une à une avec les valeurs propres de `secrets.env` |
| `GF_TOTP_ENC_KEY`, `GF_SMTP_CIPHER_KEY`, `GF_BACKUP_KEY` | **non touchées** — valeurs non disponibles (Vercel les masque) et BOM inoffensif : tous leurs consommateurs font `.trim()` |
| Ancrages de clé publique | réalignés sur `2f3c1693…` (`keys:sync`), poste **et** dépôt |
| Licences | 9 `LicenseKey` + 3 `LicenseDevice` + 3 `LicenseDeviceEvent` sauvegardées en JSON puis purgées ; 1 licence premium fraîche émise (`lid 3ec22276…`) |

**Pourquoi les 9 licences étaient irrécupérables** — sur **deux** plans :
leurs jetons sont signés par `e6605999…` (clé privée perdue), **et** leur
`recordMac` a été invalidé par la rotation de `GF_DB_MAC_SECRET`. Le re‑MAC de
`scripts/repair-after-secret-rotation.js` aurait réparé le second point, pas le
premier. Toutes portaient le texte d'exemple du keygen en `customerId`
(`ex: CUST-042 — laisser vide =`), 6 sur 9 n'avaient jamais été activées, aucune
n'était liée à un HWID : **aucun client réel n'est concerné**.

---

## SECTION D — État cryptographique final

| Composant | Empreinte | Statut |
|---|---|---|
| `keys/public.pem` (poste) | `2f3c1693a70d99ea…` | ✅ |
| `keys/private.pem` → dérivée | `2f3c1693a70d99ea…` | ✅ |
| `electron/main.js` (`_PK`) | `2f3c1693a70d99ea…` | ✅ |
| `src/lib/license/public-key.ts` (`_LINES`) | `2f3c1693a70d99ea…` | ✅ |
| `REFERENCE_FP` du test de cohérence | `2f3c1693a70d99ea…` | ✅ |
| Dépôt Git (mêmes ancrages) | `2f3c1693a70d99ea…` | ✅ |
| Build déployé — clé publique embarquée | `2f3c1693a70d99ea…` | ✅ mesurée sur `app.garageflows.fr` |
| `GF_PRIVATE_KEY` Production → clé publique dérivée | `2f3c1693a70d99ea…` | ✅ mesurée |
| `licenseKey.converged` | `true` | ✅ |

`e6605999e336c28e…` est désormais inscrite dans `RETIRED_FINGERPRINTS` : un
retour en arrière est refusé par la garde `check:critical-files`.

---

## SECTION E — Production

Mesures sur `https://app.garageflows.fr`, déploiement
`dpl_4AbNTeXst43ZMsUB9hibLhSXX4n5` (`garagesite5-i9l3gcslo`), région `iad1`,
Node v22.23.1.

| Test | Résultat |
|---|---|
| `/api/health` (anonyme) | **HTTP 200** `application/json` `{"status":"ok"}` — 271 ms |
| `/api/health` (exploitant) | **HTTP 200** — `process`/`environment`/`database`/`redis`/`migrations` = `pass`, `envIssues: []` |
| `/api/ping` | **HTTP 200** `{"ok":true}` |
| `/api/version` | **HTTP 200** `serverVersion 1.1.0`, `apiVersion 2`, `schemaVersion 214` |
| `/login` | **HTTP 200** `text/html`, 8 541 octets |
| Neon | PostgreSQL 17.10, 65 tables, **0 migration en attente**, `legacyIdV33` nullable |
| Redis / Upstash | `pass` |
| Variables — conformité d'empreinte | **13 conformes / 0 divergente** |
| Convergence de la paire | `true` |

**Aller‑retour licence** (candidat, avant promotion) — **6 cas sur 6** :

| Cas | Attendu | Obtenu |
|---|---|---|
| Enregistrement d'un jeton signé localement | 201 | **201** puis 409 (idempotent) |
| Jeton altéré (`seats` 2→99) | 400 | **400** « Licence invalide ou modifiée » |
| Jeton signé par une **autre** paire P‑256 | 400 | **400** |
| Sans clé API | 403 | **403** |
| Activation du jeton légitime | 200 + `deviceToken` | **200**, `deviceToken` émis |
| Activation d'un jeton étranger | refus | **`ok:false`, `LICENSE_INVALID`, aucun `deviceToken`** |

> Le dernier cas répond **HTTP 200** avec `ok:false` : c'est le contrat documenté
> de `/api/license/activate` (le refus métier se lit dans le corps, le statut est
> réservé aux pannes). La preuve d'un refus réel est l'**absence de
> `deviceToken`**, vérifiée.

**Variables portant encore un caractère invisible** — décision explicite :

| Variable | Longueur | 1er point de code | Décision |
|---|---|---|---|
| `GF_TOTP_ENC_KEY` | 45 | `U+FEFF` | conservée telle quelle |
| `GF_SMTP_CIPHER_KEY` | 45 | `U+FEFF` | conservée telle quelle |
| `GF_BACKUP_KEY` | 45 | `U+FEFF` | conservée telle quelle |

Ce sont des clés de chiffrement **au repos**, préservées par la rotation. Leur
valeur est masquée par Vercel et absente de `secrets.env` : **impossible de les
réécrire sans que l'exploitant les fournisse**. Le BOM y est sans effet — tous
leurs consommateurs (`totp-crypto.ts`, `secret-cipher.ts`, `env.ts:backupKey()`)
font `.trim()`, qui retire `U+FEFF` en JavaScript. Les nettoyer n'apporterait
rien et risquerait une ressaisie fautive d'une clé irremplaçable.

---

## SECTION F — Script de rotation v2

| Exigence | État | Détail |
|---|---|---|
| Auto‑test du transport | ✅ | `Test-StdinTransport`, 3 sentinelles, en préflight |
| Mode auto‑test isolé | ✅ | `-SelfTest` — aucune connexion, aucune mutation, sortie 10 si échec |
| Sonde qui n'édulcore pas | ✅ | valeurs brutes, points de code, caractères invisibles |
| Vérification de **toutes** les variables | ✅ | `-ExpectedValues`, empreinte contre empreinte |
| Porte de convergence post‑déploiement | ✅ | `Assert-DeployedConvergence` avant promotion |
| Aucun rollback local après mutation distante | ✅ | `RECOVERY_REQUIRED`, sortie 50 |
| Verrou de récupération | ✅ | `rotation.lock` — refuse tout nouveau lancement, sortie 50 |
| Messages exacts | ✅ | `LOCAL_RESTORE_ONLY` / `REMOTE_STATE_MUTATED` / `RECOVERY_REQUIRED` / `DO_NOT_RERUN_ROTATION` |
| Codes de sortie distincts | ✅ | 0 succès · 10 préflight · 40 échec avant mutation · 50 récupération requise |
| Dry‑run | ✅ | `-DryRun`, préexistant |
| Séquence déployer → vérifier → promouvoir | ✅ | documentée dans `POST_ROTATION_RECOVERY.md`, appliquée pour cette récupération |

### NON_VERIFIED — ce qui reste à faire et pourquoi

| Élément | Statut | Motif |
|---|---|---|
| Scénarios de crash simulé (PHASE 46) | `NOT_VERIFIED` | Exigent un harnais Vercel factice ; les mutations réelles ne sont pas rejouables sans consommer de vrais secrets |
| `Assert-DeployedConvergence` exécutée **par le script** | `PARTIALLY_VERIFIED` | La logique et la route ont été exercées à la main sur deux candidats et sur la production ; la fonction PowerShell elle‑même n'a pas encore tourné dans un run complet — le prochain le fera |
| Rotation complète de bout en bout | `NOT_VERIFIED` | Relancer une rotation totale pour tester l'outil recréerait le risque qu'on vient d'éteindre |
| Reprise après crash (PHASE 39) | `NOT_VERIFIED` | `rotation.lock` bloque le second lancement, mais la reprise par phase n'est pas implémentée |

---

## SECTION G — Limitations

- **Aucune valeur de secret Vercel n'est récupérable.** Les valeurs antérieures
  au 16/08 sont définitivement perdues. Ne jamais annoncer un « rollback
  complet ».
- **La clé privée de `e6605999…` est perdue** : les 9 licences signées par elle
  ne pouvaient qu'être purgées, pas migrées.
- Les 3 clés au repos conservent leur `U+FEFF` (voir Section E) — état connu,
  documenté, sans effet.
- Le dossier `node_modules` du dossier Desktop est **vide** (élagué par un
  `npm run dist` antérieur) : tests et typecheck s'exécutent dans le clone Git.
- La vitrine **garagesite3** vit dans un autre dépôt et doit recevoir la clé
  publique `2f3c1693…` à la main. `NOT_VERIFIED` ici.
- `/api/license/activate` répond **HTTP 200** pour un refus métier. Conforme à
  son contrat, mais un client qui ne lirait que le statut HTTP conclurait à tort
  au succès. Signalé comme **P3** — non traité, hors périmètre de cet incident.

---

## VERDICT

```
RECOVERED_AND_VERIFIED
```

Conditions remplies :

```
Production health PASS                     — /api/health 200, checks tous « pass »
Neon PASS                                  — 65 tables, 0 migration en attente
Redis PASS                                 — ping OK depuis le runtime
convergence cryptographique PASS           — converged: true, mesurée en production
clé publique serveur PASS                  — 2f3c1693… mesurée dans le build déployé
clé publique Electron PASS                 — 2f3c1693… (check:public-key vert)
paire keygen PASS                          — jeton signé localement accepté (201)
activation de licence PASS                 — 200 + deviceToken ; cas négatifs refusés
aucune fuite de secret                     — aucune valeur affichée, journalisée ni commitée
test de non-régression PASS                — rotation-caractere-invisible.test.ts
une rotation future ne peut plus reproduire la divergence
                                           — auto-test bloquant en préflight,
                                             porte de convergence avant promotion,
                                             aucun rollback local après mutation distante,
                                             rotation.lock
```

Réserves explicites : voir SECTION F (`NOT_VERIFIED`) et SECTION G.

---

## Reproduire les preuves

```bash
# 1. Auto-tests du script (aucune mutation, aucune connexion)
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\reset-garageflow.ps1 -SelfTest

# 2. Cohérence des clés
node scripts/check-public-key.mjs
node scripts/check-critical-files.js
node scripts/sync-public-key.mjs --check

# 3. Test de non-régression de l'incident
npx vitest run src/lib/__tests__/rotation-caractere-invisible.test.ts

# 4. Santé et convergence de la production (clé = GARAGEFLOW_API_KEY)
curl -s https://app.garageflows.fr/api/health
curl -s -H "x-gf-key: <GARAGEFLOW_API_KEY>" https://app.garageflows.fr/api/health
curl -s -H "x-gf-key: <GARAGEFLOW_API_KEY>" https://app.garageflows.fr/api/admin/diagnostics
```

Voir `docs/ROTATION-INCIDENT-2026-08-16.md` pour l'analyse détaillée.
