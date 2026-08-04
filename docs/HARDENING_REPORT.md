# GarageFlow — Rapport de durcissement, finalisation et préparation à la vente

Branche : `claude/garageflow-hardening-production-0acqfe`
Base : **rebasée sur `claude/garageflow-v2-audit-vuaajt`** (branche d'audit de cette nuit), et non plus sur `main`.
Date : 2026-08-04
Portée : `GarageFlowsV2` (application Next.js + Electron + Prisma).

> **Note d'intégration.** Ce travail a d'abord été construit par erreur sur
> `main`, puis **rebasé sur `claude/garageflow-v2-audit-vuaajt`** (main + 26
> commits d'audit antérieurs). Découverte clé : le rapport d'audit de `vuaajt`
> listait plusieurs correctifs comme **« Non appliqués volontairement »**
> (migrations/builds non validables dans son environnement) — A17 (Fuses +
> intégrité `enforce`), A18 (URL serveur licence), A27 (marge finance), A33-A37
> (perte de saisie React), A47 (FK RepairTypePart), A48 (index), « chiffrement
> SMTP réel ». **Cette session les a réellement implémentés ET testés** (avec
> PostgreSQL + Redis réels) : mon travail net-neuf **complète l'audit de
> vuaajt**. Les quelques doublons que vuaajt avait déjà appliqués (nav-guard A16,
> IDOR véhicule/job) ont été **réconciliés** : garde de navigation conservée via
> mon helper testé `electron/nav-guard.js` (+ 5 tests) ; IDOR conservé dans
> l'implémentation de vuaajt, mes tests d'intégration adaptés à ses codes de
> réponse (véhicule 400, job 404).

> **Honnêteté d'abord.** Chaque affirmation ci-dessous renvoie à une commande
> exécutée, un fichier modifié ou un test ajouté. Les éléments non faits, non
> testables dans cet environnement, ou nécessitant une validation externe
> (juridique, comptable, certificat, fournisseur) sont explicitement listés en
> §4 et §5 — ils ne sont **pas** maquillés en « terminés ».

---

## 1. Résumé exécutif

### État AVANT (baseline mesurée, cf. §3)
Le socle était déjà mûr et fortement durci par des sessions antérieures :
125 routes API, 703 tests verts (avec PostgreSQL + Redis réels), TypeScript/lint
propres, build OK, migrations serveur valides sur base vide. Mais il restait des
**failles concrètes et vérifiables** dans les zones les plus sensibles.

### État APRÈS
- **13 commits atomiques**, +1687/−145 lignes sur 34 fichiers, **54 tests de
  non-régression ajoutés**, rebasés sur `vuaajt` → **843 tests verts / 2 skippés**
  (les ~764 tests de vuaajt + les miens).
- Tous les critères d'acceptation techniques exécutables **passent** (§3).

### Principaux risques CORRIGÉS (preuves en §2/§3)
| # | Risque supprimé | Phase |
|---|---|---|
| 1 | Mot de passe SMTP stocké **en clair** en base (le schéma prétendait le contraire) | 3 |
| 2 | Intégrité Electron **inactive par défaut** en prod + contournable par `ELECTRON_DEV=1` | 1 |
| 3 | Licence **silencieusement désactivée** si `GF_LICENSE_SERVER` absent (cas de l'app packagée) | 2 |
| 4 | État de grâce hors-ligne / horloge **éditables à la main** (JSON clair) | 2 |
| 5 | **IDOR inter-garage** sur PATCH véhicule (clientId) et job (mechanicId) | 7 |
| 6 | **Perte de saisie** d'inspection (autosave n'envoyait qu'un item, rien à la fermeture) | 5 |
| 7 | Marge « pièces » comparant des **populations incohérentes** | 4 |
| 8 | Contournement du garde de navigation Electron (`startsWith` → userinfo/port) | 1 |
| 9 | `RepairTypePart.garageId` sans FK/cascade/index (orphelins à la suppression d'un garage) | 6 |
| 10 | Electron **Fuses jamais gravés** (RunAsNode/--inspect actifs) | 1 |
| 11 | `Part.garageId` et FK `JobPart` non indexés (scans sur tables chaudes) | 6 |
| 12 | Doublon `httpGetJson` désactivant redirections + User-Agent | 1 |

### Niveau de préparation
- **Production** : nettement renforcé sur les axes critiques (secrets au repos,
  intégrité, licences, isolation multi-tenant, pertes de saisie). **Reste** à
  faire hors de cet environnement : signature Authenticode réelle, test des
  Fuses sur un binaire Windows, tests de charge, preuve de restauration
  end-to-end (§4/§5).
- **Vente / due diligence** : la base est démontrable et reprenable ; les
  limites sont documentées sans exagération. Les éléments « externes » (§4) sont
  ce qui sépare « démontrable » de « exploité en clientèle ».

---

## 2. Changements effectués

| Prio | Problème | Cause racine | Correction | Fichiers | Tests | Statut |
|---|---|---|---|---|---|---|
| Haute | SMTP en clair en base | Écriture directe sans chiffrement ; commentaire schéma mensonger | AES-256-GCM au repos (`GF_SMTP_CIPHER_KEY`), nonce/tag, format versionné+marqué, rotation via `_OLD`, migration idempotente | `secret-cipher.ts`, `email/route.ts`, `reminders/send`, `notifications/dispatch`, `encrypt-smtp-secrets.js`, schémas | 11 + preuve E2E | ✅ |
| Haute | Intégrité Electron non appliquée en prod | Défaut `audit` + garde sur `ELECTRON_DEV` (variable attaquable) | Décision sur `app.isPackaged` ; packagé ⇒ toujours `enforce`, aucune rétrogradation env ; manifeste absent/erreur ⇒ refus | `integrity.js`, `main.js`, `afterPack.js` | 13 | ✅ |
| Haute | Licence désactivée si `GF_LICENSE_SERVER` absent | Aucun défaut compilé (contrairement à `UPDATE_SERVER`) | URL officielle compilée ; heartbeat/connectivité/activation l'utilisent ; surcharge non-https refusée en prod | `license-endpoint.js`, `main.js`, `.env.example` | 4 | ✅ |
| Haute | Grâce hors-ligne / horloge falsifiables | `last_online.json` / `gf_clock.json` en JSON clair | Signature HMAC liée au secret d'installation + hwid ; rejet du non-signé/copié (fail-closed) | `signed-state.js`, `main.js` | 7 | ✅ |
| Haute | IDOR inter-garage (véhicule/job PATCH) | `assertRelations` non appelé (2 routes sur 10) | Garde `assertRelations` sur `clientId`/`mechanicId` | `vehicles/[id]`, `jobs/[id]` | 4 (handlers réels) | ✅ |
| Haute | Perte de saisie inspection | Timer debounce partagé ne flushait qu'un item ; rien à la fermeture/unmount | `flushAll` (tous les items), flush au debounce/close/unmount, suppression clé après succès | `inspection-autosave.ts`, `InspectionModal.tsx` | 5 (logique pure) | ✅ |
| Haute | Marge « pièces » incohérente | Coût = toutes pièces consommées (jobPart) vs CA = factures payées, fenêtres différentes | Coût calculé sur les lignes non-MO des **mêmes** factures payées | `finance/route.ts` | 1 (handler réel) | ✅ |
| Haute | Garde navigation contournable | `url.startsWith('http://127.0.0.1:PORT')` | Comparaison `URL(...).origin === localOrigin` | `nav-guard.js`, `main.js` | 5 | ✅ |
| Moy. | `RepairTypePart` sans FK garage | Colonne `garageId` nue | Relation `onDelete: Cascade` + `@@index` + migration sûre (nettoyage orphelins avant FK) | schémas, migration serveur, `migrations.ts` | Preuve PG (cascade + orphelins) | ✅ |
| Moy. | Fuses Electron non gravés | Aucun `flipFuses` au build | `@electron/fuses` en afterPack (RunAsNode off, --inspect off, OnlyLoadAppFromAsar, cookies chiffrés…) | `fuse-config.js`, `afterPack.js` | 4 | ✅ (flip réel = externe) |
| Moy. | Index manquants | `Part.garageId`, `JobPart.jobId/partId` non indexés | `@@index` (2 schémas) + migration serveur + runtime desktop | schémas, migration, `migrations.ts` | Preuve PG (index présents) | ✅ |
| Basse | Doublon `httpGetJson` | 2 déclarations au scope module (la 2ᵉ écrase) | Doublon supprimé (redirections + UA rétablis) | `main.js` | Vérif. statique | ✅ |

Détails et preuves : messages de commit correspondants (12 commits, cf. §7).

---

## 3. Résultats techniques (exécutés)

Environnement : Node 22, PostgreSQL 16 + Redis 7 réels (démarrés localement),
Prisma 5.22, Next 14.

| Élément | Commande | Résultat |
|---|---|---|
| Installation | `npm install` | ✅ exit 0 |
| TypeScript | `npx tsc --noEmit` | ✅ exit 0 (0 erreur) |
| Lint | `npx next lint` | ✅ « No ESLint warnings or errors » |
| Prisma desktop | `prisma validate` | ✅ valide |
| Prisma serveur | `prisma validate --schema prisma/server/schema.prisma` | ✅ valide |
| Tests (unit + intégration) | `vitest run` (avec `TEST_POSTGRES_URL`+`TEST_REDIS_URL`) | ✅ **843 passed / 2 skipped** (dont isolation multi-tenant, seats licence, rate-limit distribué) |
| Migrations serveur (base vide) | `node scripts/validate-server-db.js` | ✅ 5 migrations appliquées + smoke CRUD + cascade |
| Migration `RepairTypePart` (données) | test PG dédié | ✅ orphelin supprimé, ligne valide conservée, FK ensuite appliquée |
| Build PWA | `npm run build` | ✅ « Compiled successfully » |
| Audit deps (prod high/critical) | `node scripts/audit-ci.js` | ✅ pass (3 dérogations datées : next/nodemailer/postcss, réexamen 2026-10-31) |
| Chiffrement SMTP (E2E) | script de preuve | ✅ clair → migré → marqué `GFSEC1:` → déchiffre à l'original → 2ᵉ passe idempotente |

**Non exécuté dans cet environnement (honnêteté) :**
- **Gitleaks** : binaire non disponible ici. Le workflow CI (`.github/workflows/ci.yml`)
  scanne l'arbre courant à chaque push/PR ; aucun secret n'a été ajouté par ces
  commits (revue manuelle : seules des **clés/paramètres** documentés, jamais de
  valeur secrète).
- **Build Electron / test des Fuses sur binaire Windows** : impossible sur ce
  runner Linux (voir §4).
- **Tests de charge (Phase 11)** et **preuve de restauration end-to-end
  (Phase 12)** : non réalisés ici. Des tests unitaires de crypto de sauvegarde
  (`backup/crypto`, `backup/snapshot`) passent, mais un cycle
  sauvegarde→destruction→restauration→comparaison complet reste à exécuter.

---

## 4. Éléments restant EXTERNES (hors code / hors cet environnement)

| Élément | Nature | Action requise |
|---|---|---|
| Certificat Authenticode Windows | Signature `.exe`/installateur | Fournir un certificat EV/OV ; brancher dans la CI (secret) et signer après afterPack |
| Test des Electron Fuses | Vérification sur binaire réel | Générer un build Windows et vérifier `getCurrentFuseWire` + démarrage |
| `EnableEmbeddedAsarIntegrityValidation` natif | Empreinte asar embarquée | Passer electron-builder v25 (embarque l'empreinte) puis activer le fuse et tester |
| Validation FEC / TVA / avoirs | Conformité comptable | Validation par un expert-comptable (le code est renforcé, la conformité **n'est pas** revendiquée) |
| RGPD / cessions de droits / SBOM | Juridique | Validation par un avocat / DPO |
| Fournisseurs (SMS, TecDoc, OCR, VIN, e-invoicing) | Contrats + clés | Contractualiser ; ces intégrations ne sont **pas** présentées comme opérationnelles |
| Tests de charge & preuve de restauration | Exécution | Jeux de données réalistes + cycle restauration complet |

---

## 5. Risques restants (classés honnêtement)

- **Élevé (non entièrement clos)** — *Grâce hors-ligne rafraîchie par la
  simple joignabilité de `/api/health`* : la sonde vise désormais l'autorité de
  licence (plus de repli 1.1.1.1), mais atteindre `/api/health` ne prouve pas un
  **contrôle de révocation réussi**. Reste à conditionner le rafraîchissement de
  la grâce à une réponse `/api/license/check` valide. *Partiellement mitigé.*
- **Moyen** — *Numérotation FAC des brouillons* : un numéro définitif est attribué
  à des factures brouillon supprimables → **trous** dans la séquence légale.
  Correctif = numéroter à la finalisation ; **impact FEC** → à cadrer avec un
  expert-comptable avant modification (non fait pour ne pas casser la sémantique).
- **Moyen** — *Manifeste de mise à jour sans fraîcheur* (pas de
  `issuedAt/expiresAt/nonce`) : rejeu possible d'un ancien manifeste signé.
  Atténué par la vérification SHA-256 + signature, mais à durcir (anti-downgrade
  + fenêtre temporelle).
- **Moyen (accepté)** — *Téléchargement de MàJ suit les redirections* : la porte
  SHA-256 (empreinte issue du manifeste signé) empêche l'exécution d'un binaire
  piégé ; risque réel faible, conservé comme défense-en-profondeur à ajouter
  (allowlist d'hôtes).
- **Faible** — *`labor-operations/bulk-import` non borné* : ajouter une limite de
  taille du tableau client + pagination.
- **Limite crypto assumée** — la signature de l'état local (grâce/horloge) et le
  secret d'intégrité embarqué protègent contre l'édition « ordinaire », pas
  contre un attaquant local lisant `userData` : la révocation reste vérifiée
  côté serveur (défense en profondeur).

---

## 6. Impact sur la valeur

- **Réduction de risque (sans hausse directe de valorisation)** : intégrité
  Electron, Fuses, signature de l'état de licence, doublon `httpGetJson`.
- **Qualité / fiabilité** : perte de saisie d'inspection supprimée, marge « pièces »
  cohérente, index de performance.
- **Facilité de reprise (due diligence)** : 54 tests de non-régression ciblés,
  helpers **purs et testables** extraits (résolution de mode d'intégrité, garde
  de navigation, endpoint de licence, état signé, regroupement autosave),
  migrations sûres documentées, `.env.example` à jour.
- **Valeur commerciale directe** : le chiffrement des secrets au repos et la
  suppression du fail-open licence sont des **prérequis** d'une vente sérieuse
  (une due diligence sécurité les aurait bloqués). L'isolation multi-tenant
  renforcée (IDOR fermés) protège la promesse SaaS.
- **Nécessite des clients pour une vraie hausse** : les intégrations fournisseurs
  et les preuves d'exploitation en garages pilotes (§4) restent le principal
  levier de valorisation.

---

## 7. Pull Request

- **Branche** : `claude/garageflow-hardening-production-0acqfe` (poussée sur `origin`).
- **Commits** (12, atomiques) :
  `feat(security): encrypt SMTP credentials at rest` · `fix(electron): enforce
  packaged-app integrity` · `fix(electron): block will-navigate/redirect bypass`
  · `feat(database): add RepairTypePart→Garage relation` · `fix(security): close
  cross-garage IDOR on vehicle/job PATCH` · `fix(accounting): coherent 'Marge
  pièces'` · `perf(database): index Part.garageId and JobPart FKs` · `fix(license):
  remove production fail-open` · `fix(ui): prevent inspection autosave data loss`
  · `feat(electron): flip hardening Electron Fuses` · `fix(license): sign
  offline-grace and trusted-clock state` · `fix(electron): remove duplicate
  httpGetJson`.
- **CI** : le pipeline `.github/workflows/ci.yml` couvre gitleaks, tsc, lint,
  migrations PostgreSQL sur base vide, tests (PG+Redis), build, porte d'audit deps.
- **Revue** : commencer par les 5 helpers purs testés (`electron/*.js`,
  `src/lib/security/secret-cipher.ts`, `src/lib/inspection-autosave.ts`), puis les
  routes API, puis les migrations.
- **Test** : `npm ci` puis (avec PostgreSQL + Redis) `TEST_POSTGRES_URL=… TEST_REDIS_URL=…
  npm test` ; `npm run build` ; migration data SMTP : `GF_SMTP_CIPHER_KEY=… node
  scripts/encrypt-smtp-secrets.js --dry-run`.
- **Rollback** : chaque commit est atomique et réversible (`git revert <sha>`).
  Les migrations serveur sont additives ; la migration `RepairTypePart` supprime
  uniquement des lignes déjà orphelines (aucune donnée valide touchée). La
  migration SMTP est précédée d'une sauvegarde recommandée et détecte le
  déjà-chiffré (idempotente).

> **Ne pas fusionner automatiquement** — PR à ouvrir en brouillon, revue humaine
> requise.
