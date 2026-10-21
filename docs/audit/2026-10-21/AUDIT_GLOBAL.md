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
| Vitest complet | 81 suites bloquées, 3 échecs d'environnement | **4 378 réussis, 0 échec, 7 ignorés** (361 fichiers) |
| PostgreSQL réel | aucun | PostgreSQL 16 local : 22 migrations sur base vierge, tests de concurrence |
| Redis réel | aucun | Redis local : limiteur de débit multi-instances |
| OCR réel | Tesseract absent | Tesseract 5.3.4 : **défaut réel trouvé et corrigé** |
| Interface Tk du keygen | non rendue | rendue sous Xvfb ; 19 tests sur le vrai keygen affiché ; **deux défauts réels trouvés par les captures et corrigés** (GF-1021-08, GF-1021-09) |
| E2E navigateur | non exécuté | Playwright + Chromium, 6 gabarits : 54 réussis, 90 ignorés (licence signée requise) ; parcours de licence complet joué dans Chromium avec une autorité de **test** (GF-1021-10 trouvé et corrigé) |
| `npm run build` | bloqué | **réussi**, budget de performance respecté |
| Installateur Windows | jamais produit | **produit, installé, lancé, réinstallé et désinstallé** par la CI de la PR #34 (`windows-latest`) |
| Preuves | rapports textuels | 91 captures d'écran réelles et `preuves/RAPPORT_VALIDATION.md` |

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

Inventaire : 2 656 fichiers suivis par Git au début de la campagne, dont 918
fichiers TS/TSX sous `src` (2 667 lors des captures : les fichiers ajoutés par
cette campagne, voir capture 03).
L'inventaire fichier par fichier des campagnes précédentes reste valable
(`docs/audit/inventory-current.jsonl`, `docs/audit/module-map.jsonl`).

## 4. Problèmes détectés dans cette session

| ID | Gravité | Problème | Cause racine | Statut |
|---|---|---|---|---|
| GF-1021-01 | P1 | Validations concurrentes d'une facture sur le poste : 9 sur 10 échouent en erreur après 5 à 10 s | Transactions SQLite différées : deux transactions lisent puis s'attendent mutuellement pour écrire (interblocage résolu par le délai d'attente) | **CORRIGÉ, VALIDÉ** |
| GF-1021-02 | P1 (sécurité) | Une clé OpenAI ou Stripe visible sur une capture n'était pas détectée | Tesseract insère une espace parasite au milieu des longs jetons ; les règles s'appliquaient au texte brut | **CORRIGÉ, VALIDÉ** |
| GF-1021-05 | P2 (sécurité) | `*.pem`, `*.key`, `*.sig` ignorés seulement sous `keys/` | Règle limitée à un répertoire | **CORRIGÉ** |
| GF-1021-06 | P2 (CI) | Le scan Gitleaks de la CI aurait échoué : fixture `GF2.fixture.signature` non autorisée | Correctif existant sur la PR #33 (2a50a18), absent de cette branche | **PORTÉ** (contenu identique) |
| GF-1021-07 | P2 (sécurité) | Sans Pillow (CI, poste nu), une image falsifiée passait la validation et aucune limite de pixels ne protégeait Tesseract | Contrôles d'en-tête confiés à Pillow seul | **CORRIGÉ, VALIDÉ** (révélé par la CI de la PR #34) |
| GF-1021-08 | P1 | Keygen : cinq pages (licences, clients, appareils, secrets, journaux) n'affichaient que leur titre | Cartes créées dans un cadre de marge que personne ne plaçait | **CORRIGÉ, VALIDÉ** (trouvé par les captures) |
| GF-1021-09 | P1 | Keygen : licence sans HWID impossible, identifiant client « ex. CUST-042 » signé, listes vides, contrôle des champs de mise à jour contourné | Le texte indicatif était écrit dans le champ, donc dans sa variable | **CORRIGÉ, VALIDÉ** (trouvé par les captures) |
| GF-1021-10 | P2 | Licence suspendue ou révoquée : après un rechargement, « Chargement du planning… » sans fin et sans message | L'overlay de licence n'était monté qu'après un chargement initial qui échoue en 403 | **CORRIGÉ, VALIDÉ** (trouvé par les captures) |
| GF-1021-11 | P2 | Appareil libéré par le SAV : le poste web reste bloqué sur le chargement (jusqu'à 30 jours) | Aucun point d'accès ne retire `gf_session` côté garage | NON CORRIGÉ, action proposée |
| GF-1021-12 | P3 | Keygen : la molette ne fait pas défiler les formulaires | Molette liée au seul canevas | NON CORRIGÉ |
| GF-1021-13 | P3 | Keygen : panneau de synthèse rogné, notifications superposées en 1 280 × 860 | Hauteurs et largeurs fixes | NON CORRIGÉ (cosmétique) |
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
- `scripts/keygen_ui.py` : `_gutter()` place le cadre de chaque carte
  (GF-1021-08) ; texte indicatif posé par-dessus le champ, jamais écrit dedans
  (GF-1021-09).
- `src/app/page.tsx`, `src/components/LicenseRevokedOverlay.tsx` : overlay de
  licence monté dès l'écran de chargement, rechargement après réactivation
  (GF-1021-10).
- Tests : `scripts/test_keygen_ui_lifecycle.py` (vrai keygen affiché),
  `scripts/test_keygen_v2.py` (sonde reliant champ et variable, garde
  statique), `src/lib/__tests__/licence-bloquee-au-chargement.test.ts`.

### Fichiers

| Créés | Modifiés | Supprimés |
|---|---|---|
| `src/lib/sqlite-tx-queue.ts`, `src/lib/__tests__/sqlite-tx-queue.test.ts`, `src/lib/__tests__/licence-bloquee-au-chargement.test.ts`, les 9 documents de `docs/audit/2026-10-21/`, le dossier `docs/audit/2026-10-21/preuves/` | `src/lib/db.ts`, `src/lib/__tests__/stock-double-deduction.int.test.ts`, `scripts/secret_scan.py`, `scripts/test_secret_scan.py`, `scripts/keygen_ui.py`, `scripts/test_keygen_ui_lifecycle.py`, `scripts/test_keygen_v2.py`, `src/app/page.tsx`, `src/components/LicenseRevokedOverlay.tsx`, `docs/SECRET_SCAN.md`, `.gitignore`, `.gitleaks.toml` | aucun |

## 6. Risques restants

Voir `PRODUCTION_READINESS.md` §5. Les principaux : l'installateur Windows est
construit et installé par la CI (`windows-latest`), mais ni la mise à jour
Vn → Vn+1 sur un vrai poste ni le parcours licencié ne sont prouvés, et il
n'est pas signé (Authenticode) ; aucune rotation de secret de production
rejouée (aucun accès Vercel, Neon ou Upstash) ; e-facturation réelle non interconnectée ;
licences signées par l'autorité de production non testées ici (clé privée
volontairement absente).
