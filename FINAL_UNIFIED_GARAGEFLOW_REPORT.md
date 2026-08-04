# GarageFlow — Rapport final de la version unifiée

> Version unique consolidée : **base durcissement (hardening v4)** + **licences
> mécanicien portées et corrigées**. Aucune régression connue. Chaque protection
> et chaque correction critique est couverte par des tests vérifiables.
>
> Branche : `claude/garageflow-final-unified-merge-ub0l67` — HEAD `289f4bd`.
> **Aucune fusion dans `main`, aucun déploiement en production.**

---

## 1. Version de base

**Confirmé** : la base est **hardening v4**
(`origin/claude/garageflow-hardening-production-0acqfe`, `f9b91f9`).

Topologie Git vérifiée : `hardening = main + 39 commits`, `mechanic = main + 2 commits`,
les deux dérivant du **même** ancêtre `main` (`e3ac5f5`). La branche de travail a été
**avancée en fast-forward sur hardening** (base exacte), puis `mechanic-licenses` y a
été **fusionnée en 3-way** — jamais copiée par-dessus. Les 8 fichiers modifiés dans les
deux branches ont été fusionnés ligne à ligne (voir `docs/FINAL_MERGE_DECISION_MATRIX.md`).

## 2. Fonctionnalités mécanicien intégrées

- **Type de licence `mechanic`** signé, subordonné à une licence garage parente valide ;
  `recordMac` couvre `mechanicId`/`parentLicenseId` (anti-usurpation en base).
- **Keygen** : génération garage + 0..N clés mécanicien, rattachement/attribution,
  suspension/révocation/déconnexion, état sans secrets ; utilise `GARAGEFLOW_API_KEY`
  (jamais `NEXTAUTH_SECRET`) ; point d'entrée GUI `App().mainloop()` conservé (superset durci).
- **Session mécanicien deny-by-default** (`validateMechanicSession`) : revalide à CHAQUE
  requête signature + type + licence en base + statut + recordMac + garage + mécanicien +
  appareil + licence parente + révocation/suspension. Active **même sous Electron**.
- **Permissions mécanicien** (`authz`, deny-by-default) : voit uniquement SES travaux,
  ajoute photos/commentaires/notes/inspection, chrono ; **jamais** finances, prix, marges,
  autres clients/mécaniciens, administration ni paramètres.
- **Photos** : taille/nombre max, MIME + octets magiques, noms sûrs, chemins sans `..`,
  isolation garage+mécanicien, append-only.
- **Notes/commentaires** append-only ; **réattribution** avec historique complet +
  invalidation immédiate de l'ancien titulaire (appareils révoqués).
- **Middleware** : confinement `typ=mechanic` à l'espace `/mechanic` (greffé sur l'ordre
  NextAuth-first du durcissement — **sans** régresser vers « licence avant NextAuth »).

## 3. Régressions supprimées / neutralisées

| Régression | Statut dans la version finale |
|---|---|
| Ancienne clé publique `c48e6b3e…` | **Absente de tout le dépôt** ; clé canonique `7bed3cb7…478` dans les 2 consommateurs |
| Ancien middleware (licence avant NextAuth) | Écarté — ordre NextAuth-first conservé |
| Ancien `IS_DEV` (env-only) | Écarté — `!app.isPackaged && ELECTRON_DEV==='1'` conservé |
| Serveur de licence local / fallback silencieux | Non introduit — `license-endpoint.js` durci conservé |
| État local non signé | Non introduit — `signed-state.js` conservé |
| Doublon `httpGetJson` | Absent |
| Absence des Electron Fuses | Fuses présents (`fuse-config.js`) |
| SMTP en clair | Chiffrement AES-256-GCM conservé ; `/api/garages` exclut `smtpPass` |
| Relations Prisma mécanicien manquantes | **Ajoutées** (FK + onDelete, §5) |
| Réactivation d'une licence révoquée | **Interdite** (§2) |
| Fausse déconnexion (= révocation) | **Séparée** : déconnexion = appareils coupés, licence active (§3) |
| Plafond de clés non atomique | **Atomique** (transaction + verrou consultatif PG) + validation Zod (§4) |
| Chrono non atomique | **Atomique** (updateMany re-scopé + garde optimiste, §7) |
| Clôture automatique du travail | **Supprimée** : statut intermédiaire `awaiting_validation`, `completed` opt-in (§8) |
| Token récupéré par GET | **POST + réauthentification + no-store** (§9) |
| Audit `mechanicId: ''` (chaîne vide) | **Corrigé** : `actorUserId`/`actorRole`/`targetMechanicId` nullables (§6) |

## 4. Tests — commandes et résultats EXACTS

Exécutés sur cet environnement (Node 22, Prisma 5.22 local, Vitest) :

| Commande | Résultat |
|---|---|
| `prisma validate` (desktop SQLite) | **valide** ✅ |
| `prisma validate --schema prisma/server/schema.prisma` (PostgreSQL) | **valide** ✅ |
| `prisma generate` (desktop + serveur) | **OK** (deux clients générés) ✅ |
| `tsc --noEmit` | **0 erreur** ✅ |
| `next lint` (ESLint) | **0 warning / 0 erreur** ✅ |
| `vitest run` | **87 fichiers OK / 3 ignorés ; 912 tests OK / 26 ignorés ; 0 échec** ✅ |
| `next build` | **✓ Compiled successfully ; 16/16 pages statiques** ✅ |
| `node scripts/audit-ci.js` (gate prod high/critical) | **0 non-dérogée** (3 dérogations pré-existantes documentées : next, nodemailer, postcss) ✅ |
| `node scripts/check-critical-files.js` (garde anti-disparition) | **PASS** ✅ |

Baseline avant corrections : `tsc 0` / `vitest 869 OK / 0 échec` → après corrections+tests :
`vitest 912 OK / 0 échec` (**+43 tests**, aucune régression).

**Non exécutables dans cet environnement** (indiqués honnêtement — jamais inventés) :
- **Gitleaks** : binaire non installé ici ; s'exécute en CI (`gitleaks dir . --config
  .gitleaks.toml`). Analyse manuelle du diff : aucun secret réel ajouté (seule occurrence :
  un mot de passe **de test** dans `token-route.test.ts`, faible entropie, non secret).
- **Migrations PostgreSQL sur base vide + smoke test** : aucun serveur PostgreSQL dans cet
  environnement ; s'exécute en CI (`prisma migrate deploy` sur base neuve). Les deux schémas
  valident ; la migration mechanic est additive.
- **Build Electron packagé + Fuses sur l'exécutable** : nécessite Windows + `electron-builder`
  + certificat Authenticode → validation humaine (§7).

## 5. Fichiers conservés / fusionnés / supprimés

- **Conservés (hardening)** : toutes les protections durcies, vérifiées **non-régressées**
  et byte-identiques ou additives (`license-endpoint.js`, `signed-state.js`, `nav-guard.js`,
  `integrity.js`, `fuse-config.js`, `secret-cipher.ts`, `public-key.ts`, `auth.ts`,
  `rate-limit.ts`, `/api/garages`). Détail : §5 ci-dessous + `docs/FINAL_MERGE_DECISION_MATRIX.md`.
- **Fusionnés (8 fichiers communs)** : `middleware.ts`, `electron/main.js`, les 2 schémas
  Prisma, `migrations.ts`, `keygen.py`/`keygen_db.py`/`keygen_ui.py` — résumé des choix
  dans la matrice de décision.
- **Portés (mechanic)** puis corrigés : voir §C de la matrice.
- **Supprimés** : **AUCUN** fichier. Les implémentations régressives de mechanic étaient des
  *versions de contenu* des fichiers communs, écartées à la résolution de fusion — pas des
  fichiers à supprimer. Voir `docs/REMOVED_REGRESSIVE_FILES.md`.
- **Garde-fou** : `scripts/check-critical-files.js` échoue si un fichier critique disparaît,
  si l'ancienne clé publique réapparaît, ou si l'empreinte canonique manque.

### Preuve de non-rétrogradation (audit indépendant)
Vérification des 12 items durcissement contre la baseline : **aucune régression**.
Clé publique `7bed3cb7…478` confirmée par `openssl` dans les 2 consommateurs ; ancienne clé
absente. `IS_DEV` packagé, intégrité en mode enforce (refus au démarrage, pas de repli
silencieux), endpoint HTTPS officiel, état signé (rejet MAC absent/invalide), nav-guard par
origine stricte, chiffrement SMTP + exclusion `smtpPass`, sanitisation Upstash + `TRUST_PROXY`,
anti-énumération NextAuth, migrations défensives — tous **présents**.

## 6. Risques restants (classés)

- **Bloquant** : aucun identifié dans le périmètre code.
- **Critique** : aucun.
- **Élevé** :
  - `EnableEmbeddedAsarIntegrityValidation = false` dans les Fuses. **Non introduit par la
    fusion** — identique à la baseline hardening, documenté, compensé par le manifeste HMAC
    d'intégrité runtime en mode enforce. À réévaluer avant release Windows.
- **Moyen** :
  - Réauthentification token (§9) par **mot de passe** ; **TOTP staff non disponible** (le
    modèle n'expose la 2FA que pour `PortalUser`). À compléter si une 2FA staff est ajoutée.
  - Plafond atomique PG via `pg_advisory_xact_lock` (par garage) : robuste ; sous SQLite
    mono-poste la sérialisation d'écriture suffit.
- **Faible** :
  - `awaiting_validation` intégré dans tous les consommateurs de statut connus ; un nouveau
    tableau de bord futur devra le prendre en compte (garde-fou : `getStatusColor/Label` sont
    `Record<Job['status']>` → erreur de compilation si oublié).
- **Externe** : voir §7.

## 7. Éléments nécessitant une validation humaine (hors périmètre de cette session)

- Certificat **Authenticode** et **signature Windows** de l'exécutable.
- **Installation réelle** sur Windows 10 et Windows 11 (build packagé, Fuses sur l'exe,
  intégrité ASAR, mise à jour signée / rollback).
- Validation **FEC** (fichier des écritures comptables) et conformité **juridique**.
- Tests avec de **vrais garages** (données de production).
- **Services fournisseurs externes** (SMTP réel, Upstash, base PostgreSQL managée).
- **Gitleaks** et **migrations PostgreSQL sur base vide** : exécutés par la **CI** (`ci.yml`).
- **Déploiement de production** (non effectué, non demandé).

## 8. Pull Request

- **Branche** : `claude/garageflow-final-unified-merge-ub0l67` (poussée sur `origin`).
- **Commits** (base hardening → HEAD) : 1 merge + 8 corrections + 1 docs + 1 tests :
  `944dd64` merge · `2c34000` audit · `1774f17` révocation · `add3763` plafond ·
  `dc1c096` chrono/validation · `b04439e` notes/checklist · `ba6d4cc` token ·
  `ed4a1b6` docs · `f342063` relations · `289f4bd` tests.
- **CI** : `ci.yml` rejoue Gitleaks, prisma validate/generate, TypeScript, ESLint,
  migrations PostgreSQL base vide + smoke, tests unit+intégration, build, gate d'audit deps.
- **Instructions de test** : `npm ci` puis `npm run type-check`, `npm run lint`, `npm test`,
  `npm run build`, `node scripts/check-critical-files.js`. Tests ciblés des corrections :
  `npx vitest run src/lib/__tests__/mechanic-admin.test.ts src/lib/__tests__/authz-mechanic-matrix.test.ts "src/app/api/mechanic-licenses/__tests__/status-route.test.ts" "src/app/api/mechanic/__tests__/timer-route.test.ts" "src/app/api/mechanic-licenses/__tests__/token-route.test.ts"`.
- **Rollback** : la branche est isolée ; revenir à `main` (ou à la base `f9b91f9`) suffit.
  Les migrations mécanicien sont **additives** (colonnes nullables, tables neuves) — aucune
  perte de données sur rollback ; le token reste POST (le client mis à jour envoie le mot de passe).
- **Ne pas fusionner automatiquement.**

---

*Aucun résultat n'a été inventé. Tout ce qui n'a pas pu être exécuté ici (Gitleaks,
PostgreSQL, build Electron/Windows) est explicitement signalé et renvoyé à la CI ou à une
validation humaine.*
