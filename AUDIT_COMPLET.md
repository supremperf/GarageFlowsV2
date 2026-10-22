---
doc-numbers: journal
---

# GarageFlows V2 — Audit complet

**Date d’exécution : 22 octobre 2026 (UTC)**  
**Base Git auditée : `150654535ca0b3b417e96be057ba674a119c512f`**  
**Branche de travail Arena : `arena/388085e0-garageflowsv2`**  
**État : base + corrections locales non commitées, sans push**

> Ce document est un journal de mesures reproductibles, pas une reprise des anciens rapports du dépôt. Les journaux essentiels et leurs empreintes SHA-256 sont dans `artifacts/verification/audit-2026-10-22/`. Le détail de l’inventaire dynamique est régénéré dans `docs/CONFIG_REPOSITORY_AUDIT.md`.

## Verdict

# NON PRÊT POUR LA PRODUCTION

La compilation Next isolée, les contrôles statiques et une grande partie des tests sont favorables. En revanche, la commande officielle `npm run build` échoue avant Next lors du téléchargement du moteur Prisma ; aucun moteur Prisma natif n’est présent dans les clients générés ou le standalone ; le runtime SQLite/PostgreSQL n’est donc pas validé ; aucun installateur Windows n’a été produit ou testé. Les notices tierces ne sont pas réconciliées avec l’arbre installé et devront être vérifiées sur l’artefact Windows réel.

Les symboles utilisés ci-dessous signifient : **✅ exécuté avec succès**, **⚠️ partiel ou conditionnel**, **❌ exécuté en échec**, **⏸️ non exécuté dans cet environnement**.

---

## A. Périmètre, méthode et limites

### A.1. Périmètre réellement inspecté

- inventaire Git initial : 2 817 fichiers suivis ; l’inventaire de travail inclut ensuite les nouveaux tests, documents et journaux ;
- 169 routes API App Router, toutes listées en annexe avec méthodes et marqueurs de garde ;
- 28 fichiers Electron, 30 fichiers Prisma, 6 fichiers E2E, dont 3 fichiers de specs Playwright ;
- schémas SQLite et PostgreSQL, sélecteur de client, migrations, template SQLite et scripts de préparation ;
- authentification, licences, HWID V1, portail, mécanicien, synchronisation, facturation électronique, sauvegardes, OCR, Copilot et mises à jour ;
- configuration, secrets, NPM, licences tierces, PWA, i18n, en-têtes HTTP, build et standalone ;
- tests unitaires, intégration disponible, tests Node/Python, smoke HTTP et contrôles de release.

### A.2. Méthode

1. inspection des fichiers et dépendances sans modifier les données existantes ;
2. reproduction d’un défaut avant correction lorsque cela était possible ;
3. correction minimale, tests ciblés puis suites plus larges ;
4. build et inspection de l’artefact réellement produit ;
5. distinction explicite entre succès, échec d’infrastructure et contrôle non exécuté.

### A.3. Limites qui changent le verdict

- l’hôte `binaries.prisma.sh` est inaccessible depuis le sandbox (`ECONNRESET`/TLS) ; les contournements `noEngine` ne sont pas un moteur SQLite/PostgreSQL ;
- PostgreSQL, Redis/Upstash, SMTP, services de facturation, service de mise à jour et autres comptes externes n’ont pas été contactés ;
- Chromium Playwright, Windows natif, NSIS, Wine, WebKit/Safari et la signature de code ne sont pas disponibles/validés ici ;
- Gitleaks n’a pas pu être téléchargé depuis l’hôte d’assets GitHub. `npm run scan:secrets` concerne l’OCR de captures d’écran, **pas** un scan Git complet ;
- l’inventaire statique des routes et les marqueurs d’authentification ne prouvent pas à eux seuls chaque décision d’autorisation.

---

## B. Cartographie technique et fonctionnelle

### B.1. Stack mesurée

| Composant | Version ou mesure | Observation |
|---|---:|---|
| Node | 22.22.3 | conforme à la plage `>=22.12.0 <23` |
| npm | 10.9.8 d’exécution ; `npm@11.16.0` épinglé par le projet | 47 dépendances directes installées, arbre `npm ls` sain |
| Next.js | 15.5.27 | App Router, standalone |
| React | 18.3.1 | interface web/PWA/Electron |
| Electron | 44.9.3 | cible Windows x64 |
| Prisma | 5.22.0 résolu | client `noEngine` seulement dans ce sandbox |
| TypeScript | 5.9.3 | typecheck vert après corrections |
| Vitest | 4.1.12 | suite finale partiellement bloquée par Prisma |
| Python / cryptography | environnement temporaire verrouillé | keygen réellement exécuté |

### B.2. Architecture

| Zone | Rôle | État de la revue |
|---|---|---|
| Next.js / UI | pages, formulaires, tableaux de bord, API | compilation isolée et tests disponibles ; parcours navigateur non exécuté |
| Electron | serveur local, SQLite, IPC, fenêtres, mises à jour | audit statique desktop 0 alerte ; runtime Windows non exécuté |
| SQLite desktop | 43 modèles ; template et migrations versionnées | contrôle `node:sqlite` vert ; Prisma runtime non validé |
| PostgreSQL serveur | 47 modèles ; 22 migrations SQL | inspection statique ; aucune connexion externe |
| PWA | manifeste, service worker, mode hors ligne | endpoints publics du smoke en 200 ; installation mobile non testée |
| Licences | P-256, jetons, appareils, états, MAC | suites keygen/licence vertes ; HWID V1 inchangé |
| Portail | comptes, 2FA, devis, tickets, signatures | tests disponibles ; SMTP et parcours réel non exécutés |
| Mécanicien | planning, interventions, photos, timers | wrappers et tests statiques/unitaires ; DB/E2E incomplets |
| Synchronisation | aller/retour, tombstones, conflits | plusieurs suites bloquées par la préparation Prisma |
| Facturation électronique | files, adapters, webhooks | tests locaux partiels ; fournisseurs non contactés |
| Sauvegarde | export, chiffrement, restauration | limitations de stockage Vercel maintenues ; pas de restauration sur données réelles |
| Copilot / OCR | séparation des providers | provider LLM Copilot non implémenté ; Anthropic ne doit pas être présenté comme une preuve Copilot |

### B.3. API

- 120 routes utilisent les wrappers standard repérés : 98 `withAuth`, 14 `withPortalAuth`, 8 wrappers mécanicien.
- Les 49 autres routes utilisent des mécanismes spécifiques ou sont volontairement publiques : licence garage, session administrateur, clé interne, `x-gf-key`, JWT de portail, webhooks, health/ping/version.
- Les marqueurs se recoupent sur certaines routes ; ils ne doivent pas être additionnés comme s’ils formaient des catégories exclusives.
- Smoke réel : `/api/clients` → 401 sans session ; `/api/admin/licenses` → 403 ; `/api/health` → 503 avec le client sans moteur.

L’annexe de ce document donne les 169 routes et leurs méthodes exportées. La colonne « marqueurs » est un outil de revue, pas une preuve formelle d’autorisation.

### B.4. UI, i18n et PWA

- les contrôles de cohérence, branding, documentation, PWA, monnaie et environnement sont verts dans le périmètre de leurs scripts ;
- les tests i18n/RTL sont inclus dans la partie Vitest exécutée, mais aucune validation visuelle multi-langue n’a été faite dans un navigateur ;
- les budgets obtenus après compilation sont de 3,49 MiB de JS client pour un budget de 3,65 MiB, plus gros chunk 322,3 KiB pour 512 KiB, sur 242 fichiers JS ;
- aucune affirmation de compatibilité Safari/WebKit ou mobile réel n’est faite.

---

## C. Sécurité, secrets et architecture de confiance

### C.1. Contrôles favorables observés

- Electron : `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webSecurity: true` sur les fenêtres inspectées ; audit desktop : 0 alerte ;
- réponses du smoke : CSP, `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `nosniff`, Referrer-Policy, Permissions-Policy et HSTS ;
- démarrage PWA de production refusé avec SQLite, secrets absents, Redis distribué absent et proxy non déclaré : la validation fail-closed se déclenche ;
- scan du standalone : 2 827 fichiers inspectés avec une valeur de secret local réellement traquée, aucune clé privée ni occurrence de cette valeur détectée ;
- clé publique existante matérialisée par le préflight ; deux consommateurs et trois ancrages alignés sur la même empreinte ; aucune clé privée créée ou régénérée ;
- HWID V1, algorithmes et formats de licence n’ont pas été modifiés ;
- audit NPM strict : 0 vulnérabilité LOW/MODERATE/HIGH/CRITICAL au 22 octobre 2026.

### C.2. Écarts et risques résiduels

| Priorité | Constat | Conséquence |
|---|---|---|
| P0 | moteur Prisma natif absent | build officiel et runtime DB non démontrés ; standalone structurel seulement |
| P0 | installateur Windows absent | fuses binaires, NSIS, signature, installation et mise à jour non vérifiés |
| P0 | notices/SBOM non réconciliées | conformité des attributions de l’artefact non démontrée |
| P1 | 80 fichiers Vitest en échec d’infrastructure | couverture DB et isolation tenant non validée de bout en bout |
| P1 | services externes non exécutés | aucune preuve PostgreSQL, Redis, SMTP, fournisseurs ou mise à jour réelle |
| P1 | E2E navigateur non exécutés | 144 tests seulement énumérés ; keygen E2E distant non exécuté |
| P2 | 32 dépendances directes `outdated` | dette à trier ; pas de mise à jour majeure forcée pendant cet audit |
| P2 | scan Git spécialisé indisponible | les contrôles ciblés ne remplacent pas Gitleaks sur l’historique |

### C.3. Secrets et données

- `.env` local est ignoré, en mode `600`, avec un `NEXTAUTH_SECRET` aléatoire fort de 44 caractères généré après correction ; sa valeur n’est reproduite dans aucun livrable ;
- les tests n’ont utilisé que des copies ou bases temporaires ; `prisma/dev.db` n’a pas été réinitialisée ;
- les preuves ont été inspectées par le contrôleur de clés privées et de valeur secrète locale : 26 journaux texte + `SHA256SUMS`, soit 27 fichiers réellement lus, aucune détection ;
- scan ciblé du working tree non ignoré : 2 750 fichiers texte réellement lus, 104 binaires exclus, aucune détection dans ce périmètre ;
- aucun scan de l’historique Git n’est revendiqué.

---

## D. NPM, licences tierces, configuration et services

### D.1. NPM

`npm audit --strict` est vert, mais cela ne signifie pas que les versions sont toutes récentes ni que le runtime est validé. Aucune commande `npm audit fix --force` n’a été exécutée. Le lockfile et les versions de dépendances n’ont pas été modifiés par les corrections.

### D.2. Licences et notices

L’inventaire `license-checker --production` de l’installation courante contient 132 entrées, racine comprise : 94 MIT, 15 Apache-2.0, 13 ISC, 2 LGPL-3.0-or-later, 1 CC-BY-4.0 et d’autres licences permissives. Les deux entrées LGPL sont les variantes Linux installées de `@img/sharp-libvips@1.3.4` ; CC-BY concerne `caniuse-lite`.

Cet inventaire ne doit pas être confondu avec la liste des paquets réellement embarqués dans Windows. La notice existante déclare 98 composants ; 33 noms de l’inventaire installé ne sont pas mentionnés. En parallèle, npm produit 96 composants depuis l’arbre courant et 102 depuis le lockfile, en omettant notamment des dépendances optionnelles natives. Une régénération aveugle aurait donc réduit la couverture. **La réconciliation doit être faite sur le paquet Windows et revue avant distribution.**

### D.3. Configuration

La matrice générée couvre 146 variables canoniques : 67 application, 11 platform, 24 manual, 39 unused, 2 runtime, 1 keygen et 2 publisher. Elle distingue les variables réellement consommées des entrées historiques sans effet. Voir `CONFIGURATION.md` et `docs/CONFIG_REPOSITORY_AUDIT.md`.

Aucune variable de production, aucun secret Vercel et aucun DNS n’ont été changés.

### D.4. Services externes

| Service | Validation dans cet audit |
|---|---|
| PostgreSQL / Neon | ⏸️ aucune connexion |
| Redis / Upstash | ⏸️ aucune connexion |
| SMTP | ⏸️ aucun envoi |
| Anthropic / OCR | ⏸️ pas d’appel externe ; 1 test OCR sauté faute de Tesseract |
| Facturation électronique | ⏸️ aucun fournisseur réel |
| Mise à jour / publication | ⏸️ aucun téléchargement ou déploiement réel |
| Vercel Blob / stockage durable | ⏸️ non configuré ; limitation fichier serveur conservée |

---

## E. Corrections effectuées

1. **Parsing des secrets** : après `=`, `scripts/secrets.js` ne consomme plus les retours à la ligne ; une valeur vide suivie d’un commentaire n’est plus prise pour le commentaire. Régression rouge avant, 9/9 après.
2. **Bootstrap local** : `scripts/setup-dev.js` réapplique des permissions restrictives et génère le secret local vide sans rotation d’un secret fort. Régression rouge avant, 2/2 après ; `.env` vérifié en `600`.
3. **Typage de test** : suppression de l’auto-référence de type dans `receive-guards.test.ts` ; 8/8 tests de réception et typecheck verts.
4. **Release-safety** : le test de permissions du setup est intégré à `test:release-safety` ; 172/172 après ajout du cas standalone sans moteur.
5. **Inventaire de configuration** : la version Next.js du rapport n’est plus codée en dur à 14 ; elle provient de `package.json` (15.5.27).
6. **Garde standalone** : le vérificateur exige un moteur de requête Prisma natif au lieu d’accepter le seul dossier du client. Sur fixture identique, `HEAD` sortait 0 et la version corrigée sort 1 ; l’artefact `noEngine` réel est maintenant refusé. Suite dédiée 16/16, release-safety 172/172.

Aucune modification de schéma, migration, HWID V1, clé privée, licence émise, dépendance ou donnée métier. Détail dans `CORRECTIONS_EFFECTUEES.md`.

---

## F. Tests et validations

### F.1. Résultats principaux

| Contrôle | Résultat daté | Interprétation |
|---|---:|---|
| suite Vitest complète | 280 fichiers réussis, 80 échoués, 5 ignorés ; 3 561 réussis, 3 échoués, 860 ignorés | **échec global d’infrastructure**, pas une suite verte |
| tests Node | 495/495 | plusieurs sous-suites se recoupent |
| configurateur | 245/245 | sous-ensemble partiel des contrôles Node |
| configurateur automatique | 119/119 | suite distincte |
| release-safety | 172/172 | inclut les nouveaux tests setup et moteur standalone |
| Python keygen/secret scan | 179 exécutés : 178 réussis, 1 OCR ignoré | pas d’appel OCR externe |
| 3 suites Vitest Python/keygen | 26/26 | incluses dans la suite Vitest globale |
| typecheck / ESLint | ✅ | après corrections |
| audit NPM strict | ✅ 0 vulnérabilité | instantané du 22 octobre 2026 |
| supply-chain / desktop | ✅ 23/23 ; 0 alerte | contrôles statiques du projet |
| template SQLite | ✅ 214 migrations enregistrées, 0 en attente via `node:sqlite` | ne valide pas Prisma runtime |

Les 79 premiers fichiers Vitest défaillants bloquent sur le téléchargement Prisma. Le dernier, `tenant-isolation.test.ts`, atteint directement le client `noEngine`, qui exige alors une URL `prisma://` au lieu du SQLite temporaire. Les trois tests comptés comme échoués appartiennent à `prepare-test-db.test.ts` ; ils ne démontrent pas une régression métier.

### F.2. Build et artefact

| Étape | Résultat |
|---|---|
| `npm run build` | ❌ téléchargement Prisma TLS avant compilation Next |
| `node scripts/next-build.cjs` avec clients `noEngine` | ✅ compilation Next, 18 pages statiques |
| `npm run postbuild` | ✅ 244 assets, 10 fichiers publics, clé publique copiée, `.env` absent |
| `npm run verify:standalone` | ❌ artefact refusé après renforcement : moteur Prisma natif absent |
| scan secrets standalone | ✅ 2 827 fichiers, 1 valeur locale traquée |
| `npm run preflight:release` | ✅ Linux/x64, cible Windows x64 ; avertissement Windows externe |
| moteurs `.so.node` / `.dll.node` | ❌ aucun trouvé dans les clients/standalone inspectés |
| `npm run dist` | ⏸️ non lancé après le blocage officiel ; aucun installateur produit |

### F.3. Smoke standalone

Avec `ELECTRON=1` et `NODE_ENV=production` : `/login`, `/offline.html`, `/manifest.webmanifest`, `/api/ping`, `/api/version` et le chunk `/_next/...` répondent 200 ; `/api/clients` 401 ; `/api/admin/licenses` 403 ; `/api/health` 503. Ce smoke valide le serveur Next et les gardes HTTP observées, **pas** la couche Prisma.

### F.4. Non exécuté

- 144 tests Playwright énumérés dans 3 fichiers, aucun navigateur lancé ;
- keygen E2E distant : la commande sans cible sort 0 en indiquant explicitement qu’aucun parcours n’est exécuté ;
- PostgreSQL/Redis réels, Windows, NSIS, signature, fuses du binaire final, installation/désinstallation et mise à jour.

Le détail et les chemins de journaux sont dans `TESTS_ET_VALIDATIONS.md`.

---

## G. Production et installateur Windows

Le post-build a copié la structure attendue, mais le standalone ne contient pas le moteur Prisma nécessaire au fonctionnement local. L’ancien vérificateur l’acceptait sur la seule présence du client JS ; le vérificateur corrigé refuse maintenant cette sortie. Son ancien message « prêt à être empaqueté » est conservé uniquement comme preuve du faux vert corrigé.

Pour produire une release candidate :

1. utiliser un hôte Windows x64 propre avec accès aux téléchargements Prisma et aux outils de signature ;
2. restaurer les dépendances depuis le lockfile, sans contourner la génération native ;
3. exécuter le build officiel, toutes les suites DB isolées et les E2E ;
4. produire NSIS, vérifier fuses, clés privées, notices tierces, signature et empreintes ;
5. installer sur un poste vierge puis sur un poste avec données de test existantes ;
6. tester activation, HWID V1, offline, sauvegarde/restauration, mise à jour et retour arrière applicatif ;
7. ne déployer qu’après validation staging des services externes et sauvegarde restaurable.

La procédure détaillée est dans `INSTALLATION_WINDOWS.md` ; les portes de décision sont dans `PRODUCTION_READINESS.md`.

---

## H. Verdict et plan de sortie

### H.1. Décision actuelle

**NON PRÊT POUR LA PRODUCTION.** Le code dispose de nombreux contrôles favorables, mais les preuves indispensables de build officiel, runtime DB, paquet Windows, notices de l’artefact et parcours externes sont absentes ou bloquées.

### H.2. Conditions minimales pour réexaminer le verdict

- [ ] `npm ci` et `npm run build` réussis avec les moteurs Prisma natifs attendus ;
- [ ] suite Vitest complète terminée sans échec, sur bases isolées ;
- [ ] PostgreSQL et Redis validés sur staging, migrations appliquées sans reset ;
- [ ] 144 scénarios Playwright exécutés sur les navigateurs retenus ;
- [ ] installateur Windows x64 produit depuis le build officiel ;
- [ ] fuses, NSIS, absence de secrets, signature et notices tierces vérifiés sur cet artefact ;
- [ ] installation, activation HWID V1, DB, offline, sauvegarde/restauration et mise à jour validées sur Windows ;
- [ ] configuration production et secrets réels validés sans les journaliser ;
- [ ] revue humaine des modifications locales, puis commit/push uniquement avec autorisation.

---

## Annexe — inventaire des 169 routes API

Les marqueurs sont extraits statiquement des fichiers `route.ts`. Plusieurs marqueurs peuvent se trouver sur une même route. « Revue spécifique/publique » signifie qu’aucun des marqueurs tabulés n’a été repéré ; cela ne signifie pas « sans protection ».

| Route | Méthodes exportées | Marqueurs de garde/confiance observés |
|---|---|---|
| `/api/admin/backups/[id]/download` | GET | `withAuth` |
| `/api/admin/backups/[id]/restore` | POST | `withAuth` |
| `/api/admin/backups/[id]/verify` | POST | `withAuth` |
| `/api/admin/backups` | GET, POST | `withAuth` |
| `/api/admin/diagnostics` | GET | `x-gf-key` |
| `/api/admin/licenses/[id]/devices/[deviceId]` | POST | `isAdminSession` |
| `/api/admin/licenses/[id]/devices` | GET | `isAdminSession` |
| `/api/admin/licenses/[id]` | PATCH, DELETE | `isAdminSession` |
| `/api/admin/licenses/create` | POST | `verifyLicenseToken`, `x-gf-key` |
| `/api/admin/licenses/generate` | POST | `isAdminSession` |
| `/api/admin/licenses/revoke-by-key` | POST | revue spécifique/publique |
| `/api/admin/licenses` | GET, POST | `verifyLicenseToken`, `isAdminSession` |
| `/api/admin/monitoring` | GET | `withAuth` |
| `/api/admin/updates/file/[name]` | GET | revue spécifique/publique |
| `/api/admin/updates` | GET, POST | `isAdminSession` |
| `/api/adresse/recherche` | GET | `withAuth` |
| `/api/analytics/health` | GET | `withAuth` |
| `/api/appointments/[id]` | POST, PATCH | `withAuth` |
| `/api/appointments` | GET | `withAuth` |
| `/api/auth/[...nextauth]` | POST | revue spécifique/publique |
| `/api/catalog` | GET | `withAuth` |
| `/api/clients/[id]/portal-access` | GET, POST, PUT, PATCH | `withAuth` |
| `/api/clients/[id]` | GET, PATCH | `withAuth` |
| `/api/clients` | GET, POST | `withAuth` |
| `/api/copilot/report` | GET | `withAuth` |
| `/api/copilot/reports/[id]/export` | GET | `withAuth` |
| `/api/copilot/reports` | GET, POST | `withAuth` |
| `/api/copilot` | GET, POST | `withAuth` |
| `/api/dashboard` | GET | `withAuth` |
| `/api/diagnostic` | POST | `withAuth` |
| `/api/einvoicing/connection` | GET, PUT, DELETE | `withAuth` |
| `/api/einvoicing/connection/test` | POST | `withAuth` |
| `/api/einvoicing/invoices/[id]/submit` | GET, POST | `withAuth` |
| `/api/einvoicing/status` | GET | `withAuth` |
| `/api/einvoicing/webhooks/[providerId]` | POST | revue spécifique/publique |
| `/api/email` | GET, POST, PATCH | `withAuth` |
| `/api/estimate` | POST | `withAuth` |
| `/api/export/fec` | GET | `withAuth` |
| `/api/finance` | GET | `withAuth` |
| `/api/forecast` | GET, POST | `withAuth` |
| `/api/forgotten-parts` | POST | `withAuth` |
| `/api/garages` | GET, POST, PATCH | `withAuth` |
| `/api/health` | GET | `x-gf-key` |
| `/api/inspections/[id]` | GET, PATCH, DELETE | `withAuth` |
| `/api/inspections/prefill` | GET | `withAuth` |
| `/api/inspections` | GET, POST | `withAuth` |
| `/api/internal/backup` | POST | `internalRequestAuthorized` |
| `/api/internal/einvoicing/queue` | POST | `EINVOICING_QUEUE_TOKEN` |
| `/api/internal/export` | GET | `internalRequestAuthorized` |
| `/api/internal/license-status` | POST | `internalRequestAuthorized` |
| `/api/internal/migrate` | POST | `internalRequestAuthorized` |
| `/api/invoices/[id]` | GET, PATCH, DELETE | `withAuth` |
| `/api/invoices` | GET, POST | `withAuth` |
| `/api/jobs/[id]/parts` | GET, POST, DELETE | `withAuth` |
| `/api/jobs/[id]/photos` | GET, POST, DELETE | `withAuth` |
| `/api/jobs/[id]` | GET, PUT, PATCH, DELETE | `withAuth` |
| `/api/jobs/[id]/timer` | POST | `withAuth` |
| `/api/jobs/pulse` | GET | `withAuth` |
| `/api/jobs` | GET, POST | `withAuth` |
| `/api/keygen/licenses/[lid]/hwid` | POST | `verifyLicenseToken`, `x-gf-key` |
| `/api/keygen/licenses/[lid]/status` | POST | `x-gf-key` |
| `/api/keygen/licenses` | GET | `x-gf-key` |
| `/api/labor-operations/[id]` | GET, PATCH, DELETE | `withAuth` |
| `/api/labor-operations/bulk-import` | POST | `withAuth` |
| `/api/labor-operations` | GET, POST | `withAuth` |
| `/api/license/activate` | POST | `verifyLicenseToken`, `licenseApiBoundary` |
| `/api/license/check` | POST | `licenseApiBoundary` |
| `/api/license/deactivate` | POST | `licenseApiBoundary` |
| `/api/license/devices` | GET | `jwtVerify`, `licenseApiBoundary` |
| `/api/license/status` | GET | `jwtVerify`, `licenseApiBoundary` |
| `/api/license/type` | GET | `licenseApiBoundary` |
| `/api/loaner-reservations/[id]` | PATCH, DELETE | `withAuth` |
| `/api/loaner-reservations` | GET, POST | `withAuth` |
| `/api/loaner-vehicles/[id]` | PATCH, DELETE | `withAuth` |
| `/api/loaner-vehicles` | GET, POST | `withAuth` |
| `/api/mechanic/jobs/[id]/checklist/[itemId]` | PATCH | `withMechanic*` |
| `/api/mechanic/jobs/[id]/notes` | POST | `withMechanic*` |
| `/api/mechanic/jobs/[id]/photos` | POST | `withMechanic*` |
| `/api/mechanic/jobs/[id]` | GET | `withMechanic*` |
| `/api/mechanic/jobs/[id]/timer` | POST | `withMechanic*` |
| `/api/mechanic/logout` | POST | revue spécifique/publique |
| `/api/mechanic/me` | GET | `withMechanic*` |
| `/api/mechanic/photos/[...path]` | GET | `withMechanic*` |
| `/api/mechanic/schedule` | GET | `withMechanic*` |
| `/api/mechanic-licenses/[lid]/assign` | POST | `withAuth` |
| `/api/mechanic-licenses/[lid]/disconnect` | POST | `withAuth` |
| `/api/mechanic-licenses/[lid]/status` | POST | `withAuth` |
| `/api/mechanic-licenses/[lid]/token` | POST | `withAuth` |
| `/api/mechanic-licenses` | GET, POST | `withAuth`, `verifyLicenseToken` |
| `/api/mechanics/[id]/avatar` | PUT, DELETE | `withAuth` |
| `/api/mechanics/[id]` | PATCH, DELETE | `withAuth` |
| `/api/mechanics` | GET, POST | `withAuth` |
| `/api/notifications/dispatch` | GET, POST | `withAuth` |
| `/api/ocr` | POST | `withAuth` |
| `/api/parts/[id]` | PATCH, DELETE | `withAuth` |
| `/api/parts/low-stock` | GET | `withAuth` |
| `/api/parts` | GET, POST | `withAuth` |
| `/api/parts/search` | GET | `withAuth` |
| `/api/photos/[...path]` | GET | `withAuth` |
| `/api/ping` | GET | revue spécifique/publique |
| `/api/plate-lookup` | GET | `withAuth` |
| `/api/plate-ocr` | POST | `withAuth` |
| `/api/portal/[token]` | GET | `jwtVerify` |
| `/api/portal/appointments/[id]` | PATCH, DELETE | `withPortalAuth` |
| `/api/portal/appointments` | GET, POST | `withPortalAuth` |
| `/api/portal/auth/2fa/disable` | POST | `withPortalAuth` |
| `/api/portal/auth/2fa/enable` | POST | `withPortalAuth` |
| `/api/portal/auth/2fa/setup` | POST | `withPortalAuth` |
| `/api/portal/auth/2fa/verify` | POST | revue spécifique/publique |
| `/api/portal/auth/devices` | GET, POST | `withPortalAuth` |
| `/api/portal/auth/email` | PUT | `withPortalAuth` |
| `/api/portal/auth/login` | POST | revue spécifique/publique |
| `/api/portal/auth/logout` | POST | `withPortalAuth` |
| `/api/portal/auth/me` | GET | `withPortalAuth` |
| `/api/portal/auth/password` | PUT | `withPortalAuth` |
| `/api/portal/auth/register` | POST | revue spécifique/publique |
| `/api/portal/auth/verify-email` | GET | revue spécifique/publique |
| `/api/portal/generate` | POST | `withAuth` |
| `/api/portal/me/dashboard` | GET | `withPortalAuth` |
| `/api/portal/quote/[token]` | GET, POST | `jwtVerify` |
| `/api/portal/tickets/[id]/close` | POST | `withPortalAuth` |
| `/api/portal/tickets/[id]` | GET, POST | `withPortalAuth` |
| `/api/portal/tickets` | GET, POST | `withPortalAuth` |
| `/api/profitability` | GET | `withAuth` |
| `/api/purchase-orders/[id]/receive` | POST | `withAuth` |
| `/api/purchase-orders/[id]` | GET, PATCH, DELETE | `withAuth` |
| `/api/purchase-orders` | GET, POST | `withAuth` |
| `/api/quotes/[id]/convert` | POST | `withAuth` |
| `/api/quotes/[id]` | GET, PATCH, DELETE | `withAuth` |
| `/api/quotes/[id]/signature-token` | POST | `withAuth` |
| `/api/quotes/generate` | POST | `withAuth` |
| `/api/quotes` | GET, POST | `withAuth` |
| `/api/reminders` | GET, POST, PATCH, DELETE | `withAuth` |
| `/api/reminders/send` | POST | `withAuth` |
| `/api/reminders/suggestions` | GET | `withAuth` |
| `/api/reports` | GET, POST | `withAuth` |
| `/api/signatures` | GET, POST | `withAuth` |
| `/api/stats` | GET | `withAuth` |
| `/api/stock-forecast` | GET | `withAuth` |
| `/api/suggestions` | GET | `withAuth` |
| `/api/suppliers` | GET, POST | `withAuth` |
| `/api/sync/appointments` | POST | `authenticateGarageLicense`, `licenseApiBoundary` |
| `/api/sync/einvoicing` | POST | `authenticateGarageLicense`, `licenseApiBoundary` |
| `/api/sync/invoice` | POST | `authenticateGarageLicense`, `licenseApiBoundary` |
| `/api/sync/job-photo` | POST | `authenticateGarageLicense`, `licenseApiBoundary` |
| `/api/sync/jobs` | POST | `authenticateGarageLicense`, `licenseApiBoundary` |
| `/api/sync/mechanic-assignment` | POST | `authenticateGarageLicense`, `verifyLicenseToken`, `licenseApiBoundary` |
| `/api/sync/mechanic-avatar` | POST | `authenticateGarageLicense`, `licenseApiBoundary` |
| `/api/sync/mechanic-status` | POST | `authenticateGarageLicense`, `verifyLicenseToken`, `licenseApiBoundary` |
| `/api/sync/portal` | POST | `authenticateGarageLicense`, `licenseApiBoundary` |
| `/api/sync/portal-account` | POST | `authenticateGarageLicense`, `licenseApiBoundary` |
| `/api/sync/quote` | POST | `authenticateGarageLicense`, `licenseApiBoundary` |
| `/api/sync/quote-return` | POST | `authenticateGarageLicense`, `licenseApiBoundary` |
| `/api/sync/tickets` | POST | `authenticateGarageLicense`, `licenseApiBoundary` |
| `/api/tickets/[id]` | GET, POST | `withAuth` |
| `/api/tickets` | GET | `withAuth` |
| `/api/users` | GET, POST | `withAuth` |
| `/api/vehicles/[id]` | GET, PATCH | `withAuth` |
| `/api/vehicles/[id]/timeline` | GET | `withAuth` |
| `/api/vehicles/ct-alerts` | GET | `withAuth` |
| `/api/vehicles` | GET, POST | `withAuth` |
| `/api/version` | GET | revue spécifique/publique |
| `/api/vin` | GET | `withAuth` |
| `/api/warranties/[id]` | GET, PATCH, DELETE | `withAuth` |
| `/api/warranties/alerts` | GET | `withAuth` |
| `/api/warranties` | GET, POST | `withAuth` |
| `/api/work-orders/[id]` | GET, PATCH, DELETE | `withAuth` |
| `/api/work-orders/[id]/sign` | POST | `withAuth` |
| `/api/work-orders` | GET, POST | `withAuth` |
