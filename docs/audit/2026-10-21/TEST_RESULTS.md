# TEST_RESULTS — 2026-10-21

Tous les résultats ci-dessous ont été **exécutés dans cette session**, sur le
commit `ad127cd` (correctifs inclus), sauf mention « avant correctif ». Les
journaux bruts sont restés dans le répertoire de travail de la session ; ils ne
contiennent aucun secret.

Statuts : **VALIDÉ** (exécuté, réussi) · **ÉCHEC** (exécuté, échoué) ·
**BLOQUÉ** (impossible ici, raison donnée) · **NON TESTÉ**.

## 1. Contrôles statiques et dépendances

| Test | Commande | Attendu | Obtenu | Statut |
|---|---|---|---|---|
| Installation propre | `npm ci` | 0 erreur | 758 paquets, `prisma generate` ×2 réussis | VALIDÉ |
| Audit npm | `npm audit` | 0 vulnérabilité | 0 (toutes sévérités) | VALIDÉ |
| TypeScript | `npx tsc --noEmit` | 0 erreur | 0 | VALIDÉ |
| ESLint | `npx eslint src --ext .ts,.tsx` | 0 | 0 erreur, 0 avertissement | VALIDÉ |
| Schéma poste | `npm run db:desktop:validate` | valide | valide | VALIDÉ |
| Schéma serveur | `npm run db:server:validate` | valide | valide | VALIDÉ |
| Cohérence (14 gardes) | `check:branding`, `check:docs`, `check:pwa`, `check:money` ×3, `check:env-consistency`, `check:migration-safety`, `check:sqlite-template`, `check:pg-migrations`, `check:converge-additive`, `check:critical-files`, `check:desktop-audit`, `keys:check` | exit 0 | exit 0 pour chacune | VALIDÉ |
| Clé publique | `npm run check:public-key` | 2 consommateurs alignés | alignés sur `b16d2e1b…` (après `preflight:release`) | VALIDÉ |
| Budget de performance | `npm run check:perf-budget` | ≤ 3,65 Mio, bloc ≤ 512 Kio | 3,49 Mio ; plus gros bloc 322,3 Kio | VALIDÉ |

## 2. Suites automatisées

| Suite | Commande | Résultat | Statut |
|---|---|---|---|
| Vitest complet, SQLite seul (avant correctif) | `npx vitest run` | 4 340 réussis, **2 échecs** (`stock-double-deduction`), 37 ignorés | ÉCHEC → corrigé (GF-1021-01) |
| Vitest complet, SQLite seul | `npx vitest run` | 4 346 réussis, 0 échec, 37 ignorés | VALIDÉ |
| Vitest complet + PostgreSQL 16 + Redis | `TEST_POSTGRES_URL=… TEST_REDIS_URL=… npx vitest run` | **4 376 réussis, 0 échec, 7 ignorés** (360 fichiers) | VALIDÉ |
| Chaîne de livraison (Node) | `npm run test:release-safety` | 165 réussis, 1 ignoré, 0 échec | VALIDÉ |
| Configuration / rotation | `npm run test:config` | 245/245 | VALIDÉ |
| Audit de sécurité | `npm run test:audit` | 21/21 | VALIDÉ |
| Tous les tests Node `tests/*.test.cjs` | `node --test tests/*.test.cjs` | 483 réussis, 1 ignoré, 0 échec | VALIDÉ |
| Keygen historique | `python3 scripts/test_keygen.py` | 20/20 (Python 3.13 et 3.12) | VALIDÉ |
| HWID V1 | `python3 scripts/test_keygen_hwid_binding.py` | 10/10 (3.13 et 3.12) | VALIDÉ |
| Keygen V2 | `python3 scripts/test_keygen_v2.py` | 88/88 (3.13 et 3.12) | VALIDÉ |
| Scan de secrets (avant correctif) | `python3 scripts/test_secret_scan.py` | 2 échecs sur les 4 nouveaux tests | ÉCHEC → corrigé (GF-1021-02) |
| Scan de secrets | `python3 scripts/test_secret_scan.py` | 36/36 (dont OCR réel) | VALIDÉ |
| Interface Tk du keygen | `xvfb-run python3.12 scripts/test_keygen_ui_lifecycle.py` | 14/14 | VALIDÉ |

### Les 7 tests vitest encore ignorés

| Test | Condition | Statut |
|---|---|---|
| `integrity-diagnostics` G — build `dist/win-unpacked` réel | installateur Windows produit | BLOQUÉ |
| `forgery-resistance` 1, 2, 5, 8 | clé privée d'émission (absente par conception) | BLOQUÉ |
| `public-key-consistency` — jeton GF2 réel, accepté / altéré | `GF_TEST_LICENSE` signé par l'autorité | BLOQUÉ |

## 3. Tests réels hors suites

| Test | Domaine | Attendu | Obtenu | Statut |
|---|---|---|---|---|
| 22 migrations serveur sur base vierge + smoke CRUD | PostgreSQL | toutes appliquées | appliquées, contraintes et cascade vérifiées (`node scripts/gate-fresh-postgres.mjs`) | VALIDÉ |
| 8 et 10 activations concurrentes, plafond `seats` | Licences / PG | exactement 1, puis 2 admises | conforme (`license-devices.postgres.int.test.ts`) | VALIDÉ |
| 50 numérotations de factures parallèles | Facturation / PG | 50 numéros distincts, contigus | conforme | VALIDÉ |
| Limiteur partagé entre instances | Redis | quota commun | conforme (`rate-limit-multi-instance.int.test.ts`) | VALIDÉ |
| Capture sans secret | OCR | non bloquée | non bloquée | VALIDÉ |
| Capture avec clé OpenAI factice (avant correctif) | OCR | bloquée | **non bloquée** | ÉCHEC → corrigé |
| Capture avec clé OpenAI factice | OCR | bloquée | bloquée, `sk-****` | VALIDÉ |
| Capture GitHub + AWS + Stripe factices | OCR | 3 secrets | 3 secrets (2 avant correctif) | VALIDÉ |
| Capture en thème sombre | OCR | bloquée | OpenAI et GitHub détectés | VALIDÉ |
| Service `/scan`, origine distante | OCR | 403 | 403 | VALIDÉ |
| Service `/health` | OCR | `ocrAvailable: true`, `persist: false` | conforme | VALIDÉ |
| Lancement du keygen sous affichage virtuel | Keygen | 10 sections, offres PREMIUM / ADMIN, pas de clé inventée | conforme ; bandeau « Aucune clé ECC : restaurez l'autorité » | VALIDÉ |
| Build production | Build | exit 0 | exit 0 | VALIDÉ |
| Build d'empaquetage + `verify:standalone` | Build | sortie complète | « 4 éléments vérifiés — prête à être empaquetée » | VALIDÉ |
| Recherche de secrets dans `.next/standalone` et `.next/static` | Sécurité | aucune clé privée, aucun `.env` | seulement `keys/public.pem` | VALIDÉ |
| Serveur autonome (NODE_ENV=production, SQLite) : démarrage | Poste | santé OK | 1 724 ms | VALIDÉ |
| Serveur autonome : `/api/internal/export` sans clé, puis avec | Poste | 401, puis 200 | 401, puis 200 avec le client de test | VALIDÉ |
| Serveur autonome : `/api/clients` sans session | Poste | 401 | 401 | VALIDÉ |
| Serveur autonome : persistance après redémarrage | Poste | client toujours présent | présent | VALIDÉ |
| Balayage des 169 routes sans session | API | aucune donnée sans authentification | 6 × 200 publics par conception, 196 × 401, 14 × 403, 20 × 400, 4 × 500 de configuration absente | VALIDÉ (voir AUDIT_API.md) |
| Playwright `desktop` + `mobile-portrait` | E2E | parcours publics verts | 18 réussis, 30 ignorés | VALIDÉ (publics) |
| Playwright parcours authentifiés | E2E | — | licence signée requise | BLOQUÉ |
| `electron-builder --win --x64` | Packaging | installateur | téléchargement d'Electron refusé (TLS, github.com) | BLOQUÉ |
| Installation / désinstallation / mise à jour Windows | Installation | — | aucun installateur, aucun Windows | BLOQUÉ |
| Signature d'un vrai installeur (Ed25519) | Mises à jour | — | clé privée de mise à jour absente | BLOQUÉ |
| Rotation de secrets sur Vercel / Neon / Upstash | Secrets | — | aucun accès (aucun jeton dans la session) | BLOQUÉ |
| Interconnexion e-facturation (PDP, Chorus Pro) | E-facturation | — | aucun compte de plateforme | BLOQUÉ |
