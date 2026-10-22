---
doc-numbers: journal
---

# Tests et validations — journal du 22 octobre 2026

## 1. Règle de lecture

Un code de sortie 0 ne suffit pas : le périmètre réellement exécuté est indiqué. Les suites se recoupent ; leurs totaux ne doivent pas être additionnés pour fabriquer un nombre global de tests. Les anciens rapports du dépôt ne sont pas utilisés comme preuves de cette exécution.

Les journaux sont dans `artifacts/verification/audit-2026-10-22/`. Les séquences ANSI ont été retirées pour la lisibilité, sans retirer les lignes de résultat. `SHA256SUMS` permet de vérifier les fichiers copiés :

```bash
cd artifacts/verification/audit-2026-10-22
sha256sum -c SHA256SUMS
```

## 2. Suite Vitest complète

Commande : suite Vitest complète du projet, journal `09-vitest-final.txt`.

| Mesure | Résultat |
|---|---:|
| fichiers réussis | 280 |
| fichiers échoués | 80 |
| fichiers ignorés | 5 |
| total fichiers | 365 |
| tests réussis | 3 561 |
| tests échoués | 3 |
| tests ignorés | 860 |
| total tests dénombrés | 4 424 |

**Verdict de la commande : échec.**

Analyse des 80 fichiers :

- 79 échouent lors de la préparation Prisma, avec téléchargement TLS vers `binaries.prisma.sh` impossible ;
- `src/lib/__tests__/tenant-isolation.test.ts` copie bien une base SQLite temporaire, mais le client `noEngine` utilisé dans le sandbox exige ensuite une URL `prisma://` et ne peut pas exécuter la requête SQLite ;
- les trois tests comptabilisés en échec sont ceux de `prepare-test-db.test.ts`. Beaucoup d’autres fichiers échouent dans leurs hooks avant de compter leurs tests.

Cette répartition ne prouve pas l’absence de défauts métier dans les parties non exécutées ; elle évite seulement d’attribuer à tort ces échecs à une régression démontrée.

## 3. Autres suites exécutées

| Contrôle | Résultat | Journal/preuve |
|---|---:|---|
| tests Node (`tests/*.test.cjs`) | 495/495 | `10-node-tests.txt` |
| configurateur | 245/245 | exécution consignée ; sous-périmètre partiel des tests Node |
| configurateur automatique | 119/119 | `14-config-auto-tests.txt` |
| release-safety | 172/172 | `13-release-safety.txt` |
| keygen Python + secret scan | 179 exécutés : 178 réussis, 1 ignoré | `11-keygen-python.txt` |
| trois suites Vitest Python/keygen | 26/26 | `12-python-vitest.txt` |
| régressions secrets | 9/9 après correction | échec reproductible avant dans `18-secrets-regression-before.txt` |
| régressions setup | 2/2 après correction | échec reproductible avant dans `19-setup-regression-before.txt` |
| réception commandes fournisseurs | 8/8 | typecheck/ESLint également verts |
| bootstrap/DB ciblés | 6/6 | base temporaire/copie seulement |

Le test Python ignoré est un OCR réel qui nécessite Tesseract. Il ne faut pas le compter comme une réussite OCR.

## 4. Contrôles statiques et qualité

| Contrôle | Résultat | Limite |
|---|---|---|
| TypeScript | ✅ | après suppression de l’auto-référence de type |
| ESLint | ✅ | périmètre configuré du projet |
| cohérence/branding/docs/PWA/monnaie/env/migrations | ✅ lors des contrôles initiaux ; à rejouer après livrables | scripts statiques |
| supply-chain | ✅ 23/23 | ne remplace pas le runtime |
| desktop audit | ✅ 0 alerte | `16-desktop-audit.txt` |
| audit NPM strict | ✅ 0 vulnérabilité | `15-audit-strict.txt`, instantané daté |
| template SQLite | ✅ 214 migrations enregistrées, 0 en attente via `node:sqlite` | ne fait pas de requête Prisma |
| budgets JS | ✅ 3,49/3,65 MiB ; chunk 322,3/512 KiB | `17-perf-budget.txt`, 242 fichiers JS |
| scan ciblé working tree | ✅ 2 750 textes lus, aucune détection | `24-source-working-tree-secret-scan.txt` ; clés privées/valeur locale seulement, pas Gitleaks |

## 5. Build, post-build et standalone

| Commande/contrôle | État | Preuve et conclusion |
|---|---|---|
| `npm run build` | ❌ | `01-official-build-prisma-failure.txt` : échec avant Next sur le téléchargement du moteur Prisma |
| `node scripts/next-build.cjs` | ✅ | `02-next-build-no-engine.txt` : compilation Next avec les clients de contournement `noEngine`, 18 pages statiques |
| `npm run postbuild` | ✅ | `03-postbuild.txt` : 244 assets, 10 fichiers publics, Prisma/schema/template, clé publique, manifeste |
| `npm run verify:standalone` | ❌ artefact refusé après correction | `04` conserve l’ancien faux vert ; `25` prouve le avant/après ; `26` contient les tests et le refus courant |
| scan secrets standalone | ✅ | `05-standalone-secret-scan.txt` : 2 827 fichiers, 1 valeur locale traquée, aucune détection |
| `npm run preflight:release` | ✅ | `06-preflight-release.txt` : contrôle Linux/x64 et avertissement explicite pour Windows |
| recherche de moteurs natifs | ❌ | aucun `.so.node`, `.dll.node`, `query-engine-*` ou `schema-engine-*` dans les emplacements inspectés |
| `npm run dist` | ⏸️ | non lancé après l’échec de la chaîne officielle ; aucun installateur produit |

Le post-build confirme la copie de la structure. L’ancien `verify:standalone` l’acceptait sans vérifier le binaire de requête ; après renforcement, il refuse l’artefact réel parce que le moteur Prisma natif est absent. Ce refus est le résultat attendu du garde corrigé, pas une régression du build.

La preuve `25-standalone-engine-before-after.txt` exécute la version `HEAD` puis la version corrigée sur la même fixture : exits 0 puis 1. `26-standalone-engine-validation.txt` contient la suite dédiée 16/16, release-safety 172/172 et le refus de l’artefact réel.

## 6. Smoke HTTP réel

Journaux : `07-standalone-smoke.txt` et `08-standalone-server.txt`.  
Contexte : serveur standalone local, `ELECTRON=1`, `NODE_ENV=production`, aucune exposition comme production.

| Requête | Résultat |
|---|---:|
| `/login` | 200 |
| `/offline.html` | 200 |
| `/manifest.webmanifest` | 200 |
| `/api/ping` | 200 |
| `/api/version` | 200 |
| chunk `/_next/static/...js` | 200 après correction de l’URL de test |
| `/api/clients` sans session | 401 |
| `/api/admin/licenses` sans admin | 403 |
| `/api/health` | 503, Prisma `noEngine` incompatible avec SQLite |

Les en-têtes de sécurité listés dans `SECURITE.md` ont été relevés sur `/login`. Le journal conserve une première requête de chunk au mauvais chemin `/.next/` qui a répondu 404, puis la requête corrigée `/_next/` en 200.

Un lancement hors contexte Electron a également refusé la configuration PWA de production incomplète. Ce test confirme la validation de démarrage, pas une connexion à des services externes.

## 7. Tests non exécutés ou non concluants

| Domaine | État exact |
|---|---|
| Playwright | 144 tests énumérés dans 3 fichiers ; Chromium absent ; 0 scénario navigateur exécuté |
| keygen E2E distant | `22-keygen-e2e-no-target.txt` : sortie 0 sans cible, mais aucun parcours exécuté |
| Prisma SQLite runtime | non validé ; client `noEngine` seulement |
| PostgreSQL | aucune connexion |
| Redis/Upstash | aucune connexion |
| SMTP | aucun message envoyé |
| fournisseurs de facturation | aucun appel réel |
| Windows / NSIS / fuses / signature | non exécutés |
| WebKit/Safari et mobile réel | non exécutés |
| Gitleaks working tree + historique | binaire indisponible ; non exécuté |

## 8. Conditions de passage à une validation release candidate

1. réussir `npm ci` et `npm run build` avec moteurs Prisma natifs ;
2. rejouer la suite complète sur copies/bases temporaires et obtenir zéro échec ;
3. exécuter les tests PostgreSQL/Redis sur staging isolé ;
4. installer Playwright et exécuter les 144 scénarios sur les cibles retenues ;
5. produire l’installateur Windows et exécuter les contrôles d’artefact ;
6. tester les parcours métier sur Windows, y compris licence HWID V1, offline et reprise de données ;
7. archiver les nouveaux journaux avec date, commit, commande, code de sortie et empreintes.
