# AUDIT_GLOBAL — GarageFlows (2026-10-21)

**Branche :** `claude/new-session-qkf0vj` · **Base :** `3dc2293`
**Statuts :** VALIDÉ / ÉCHEC / BLOQUÉ / NON TESTÉ. Aucun secret ni aucune valeur
de clé n'apparaît dans ce dossier.

Ce dossier complète les campagnes précédentes (`docs/audit/2026-10-17` à
`2026-10-20`, `AUDIT_PROGRESS.md`, `EXTERNAL_BLOCKERS.md`) sans les écraser. Il
porte sur ce qui a été **exécuté** dans cette session, en particulier ce qui
était resté BLOQUÉ jusqu'ici.

## 1. Ce qui change par rapport au rapport du 2026-10-20

| Point | 2026-10-20 | 2026-10-21 |
|---|---|---|
| Moteurs Prisma | téléchargement refusé | disponibles : `npm ci` et `prisma generate` réussis |
| Vitest complet | 81 suites bloquées, 3 échecs d'environnement | **4 376 réussis, 0 échec, 7 ignorés** |
| PostgreSQL réel | aucun | PostgreSQL 16 local : 22 migrations sur base vierge, tests de concurrence |
| Redis réel | aucun | Redis local : limiteur de débit multi-instances |
| OCR réel | Tesseract absent | Tesseract 5.3.4 : **défaut réel trouvé et corrigé** |
| Interface Tk du keygen | non rendue | rendue sous Xvfb, 14 tests de cycle de vie |
| E2E navigateur | non exécuté | Playwright + Chromium : 18 réussis, 30 ignorés (licence signée requise) |
| `npm run build` | bloqué | **réussi**, budget de performance respecté |

## 2. Environnement d'exécution

| Élément | Valeur |
|---|---|
| OS | Linux 6.18 (conteneur), pas de Windows, pas de Wine |
| Node / npm | 22.22.0 / 10.9.4 |
| Python | 3.13.16 (tests keygen), 3.12 + Tk 8.6 (interface) |
| Tesseract | 5.3.4, langue `eng` |
| PostgreSQL / Redis | 16 (local, base jetable) / serveur local |
| Navigateur | Chromium headless (build 1194, aligné sur Playwright 1.62.1) |
| Electron | binaire non téléchargeable (github.com refusé par le proxy) |

## 3. Architecture (constatée, non modifiée)

| Couche | Technologie | Emplacement |
|---|---|---|
| Application | Next.js 15.5.27, React 18.3.1, NextAuth 4.24.15 | `src/app` (17 pages, 169 routes API) |
| Poste | Electron 41.10.6, preload isolé, 30 gestionnaires IPC | `electron/` (28 fichiers) |
| Données poste | SQLite via Prisma 5.22.0 (43 modèles) | `prisma/schema.prisma` |
| Données serveur | PostgreSQL Neon via Prisma (47 modèles, 22 migrations) | `prisma/server/` |
| Cache / débit | Upstash Redis (repli mémoire hors production) | `src/lib/security` |
| Hébergement PWA | Vercel | `vercel.json` |
| Licences | ECDSA P-256, jetons GF2, HWID V1 | `src/lib/license`, `scripts/keygen*.py` |
| Mises à jour | Manifeste signé Ed25519 | `electron/update-verify.js`, `scripts/gf_sign_update.js` |
| Scan de captures | Tesseract + `patterns.toml` | `scripts/secret_scan.py` |
| Packaging | electron-builder 26.15.3, NSIS | `package.json#build`, `scripts/installer.nsh` |

Le client Prisma est choisi à l'exécution d'après `DATABASE_URL`
(`src/lib/db.ts`) : `file:` → SQLite poste, `postgres://` → PostgreSQL serveur.

Inventaire : 2 656 fichiers suivis par Git, dont 918 fichiers TS/TSX sous `src`.
L'inventaire fichier par fichier des campagnes précédentes reste valable
(`docs/audit/inventory-current.jsonl`, `docs/audit/module-map.jsonl`).

## 4. Problèmes détectés dans cette session

| ID | Gravité | Problème | Cause racine | Statut |
|---|---|---|---|---|
| GF-1021-01 | P1 | Validations concurrentes d'une facture sur le poste : 9 sur 10 échouent en erreur après 5 à 10 s | Transactions SQLite différées : deux transactions lisent puis s'attendent mutuellement pour écrire (interblocage résolu par le délai d'attente) | **CORRIGÉ, VALIDÉ** |
| GF-1021-02 | P1 (sécurité) | Une clé OpenAI ou Stripe visible sur une capture n'était pas détectée | Tesseract insère une espace parasite au milieu des longs jetons ; les règles s'appliquaient au texte brut | **CORRIGÉ, VALIDÉ** |
| GF-1021-05 | P2 (sécurité) | `*.pem`, `*.key`, `*.sig` ignorés seulement sous `keys/` | Règle limitée à un répertoire | **CORRIGÉ** |
| GF-1021-03 | P3 | Keygen : texte tronqué à droite dans le panneau « Liaison matérielle » à 1 280 px de large | Largeur fixe du panneau | NON CORRIGÉ (cosmétique) |
| GF-1021-04 | Info | Aucun modèle de paiement : « payée » est un statut de facture, sans paiement partiel ni rapprochement | Choix de conception existant | DOCUMENTÉ |

Le détail de chaque correction est dans `BUGFIX_CHANGELOG.md`.

## 5. Corrections effectuées

- `src/lib/sqlite-tx-queue.ts` (nouveau), `src/lib/db.ts` : file unique pour
  `$transaction` sur le client SQLite uniquement.
- `scripts/secret_scan.py` : seconde analyse des lignes OCR sans espaces, règles
  à préfixe fort uniquement, positions rapportées au texte d'origine.
- Tests : `src/lib/__tests__/sqlite-tx-queue.test.ts` (nouveau),
  `stock-double-deduction.int.test.ts` (exige zéro rejet),
  `scripts/test_secret_scan.py` (+4 tests, dont un OCR réel).
- `docs/SECRET_SCAN.md` : comportement et limites mis à jour.
- `.gitignore` : `*.pem`, `*.key`, `*.sig` ignorés partout.

### Fichiers

| Créés | Modifiés | Supprimés |
|---|---|---|
| `src/lib/sqlite-tx-queue.ts`, `src/lib/__tests__/sqlite-tx-queue.test.ts`, les 9 documents de `docs/audit/2026-10-21/` | `src/lib/db.ts`, `src/lib/__tests__/stock-double-deduction.int.test.ts`, `scripts/secret_scan.py`, `scripts/test_secret_scan.py`, `docs/SECRET_SCAN.md`, `.gitignore` | aucun |

## 6. Risques restants

Voir `PRODUCTION_READINESS.md` §5. Les principaux : aucun installateur Windows
produit ni installé ; aucune rotation de secret de production rejouée (aucun
accès Vercel, Neon ou Upstash) ; e-facturation réelle non interconnectée ;
licences signées par l'autorité de production non testées ici (clé privée
volontairement absente).
