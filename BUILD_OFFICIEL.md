---
doc-numbers: journal
---

# Build officiel et standalone — MASTER 2

**Verdict : BUILD OFFICIEL EN ÉCHEC ; STANDALONE NON LIVRABLE.**

## 1. Chaîne mesurée

| Étape | Code | Résultat |
|---|---:|---|
| `npm run build` | 1 | échec du téléchargement Prisma avant Next |
| `node scripts/next-build.cjs` | 0 | compilation Next isolée réussie, 18 pages statiques |
| `npm run postbuild` | 0 | 244 assets, 10 fichiers publics, 12 fichiers client Prisma copiés |
| `npm run verify:standalone` | 1 | moteur Prisma natif absent |
| `npm run check:perf-budget` | 0 | 3,49/3,65 MiB ; chunk 322,3/512 KiB |
| scan du standalone | 0 | 2 826 fichiers, aucune valeur locale traquée ni clé privée détectée |
| `npm run preflight:release` | 0 | contrôle statique Linux/x64, avertissement Windows explicite |
| `npm run verify:installer` | 1 | aucun dossier `dist/` |

La compilation directe utilise les clients historiques présents dans le checkout. Elle n’est pas un substitut au build officiel. Le manifeste `1.1.0+150654535.dirty` confirme aussi que cette sortie n’est pas une release propre.

## 2. Smoke HTTP du standalone

Avec la configuration locale existante chargée par `--env-file=.env`, sans afficher les valeurs, et `ELECTRON=1` :

| Requête | Résultat |
|---|---:|
| `/login`, `/offline.html`, `/manifest.webmanifest` | 200 |
| `/api/ping`, `/api/version` | 200 |
| chunk `/_next/static/...` | 200 |
| `/api/clients` sans session | 401 |
| `/api/admin/licenses` sans admin | 403 |
| `/api/health` | **503 — Prisma non fonctionnel** |

Un premier lancement sans configuration a été refusé par l’instrumentation pour `DATABASE_URL` et `NEXTAUTH_SECRET` absents. Ce refus fail-closed est conservé dans le journal ; aucune valeur factice n’a été injectée.

## 3. Sécurité et contenu

Le smoke observe CSP, `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `nosniff`, Referrer-Policy, Permissions-Policy et HSTS. Le scan porte sur 2 826 fichiers et une valeur secrète locale traquée. Ces contrôles ne prouvent ni les fuses Electron, ni le contenu NSIS, ni la couche DB.

## 4. Blocage de livraison

Le garde standalone renforcé refuse maintenant le faux vert « client JS présent sans moteur ». Il ne faut pas revenir à ce comportement. La sortie actuelle ne doit pas être empaquetée.

Pour clôturer : rétablir Prisma officiel, exécuter `npm run build` sans contournement, vérifier les moteurs et le health DB, puis produire le paquet Windows sur la cible. Preuves : `18-official-and-partial-build.txt`, `25-artifact-static-checks.txt`, `29-standalone-server.txt`, `30-standalone-server-local-config.txt`, `31-standalone-smoke.txt`.
