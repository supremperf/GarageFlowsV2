# Rapport — Refonte du Keygen et suppression de la récupération de clé privée

**Date** : 2026-10-19 · **Branche** : `arena/3b9ee17c-garageflowsv2` · **Base** : `8dd5144`
**Règle de rédaction** : aucune fonctionnalité n'est déclarée validée sans exécution réelle. Ce qui
n'a pas pu être exécuté est listé dans la section **D — NON VALIDÉ**, avec la raison exacte.

---

## A · Objectif et périmètre

Deux demandes, traitées dans cet ordre :

1. **Supprimer, dans tout le dépôt, tout mécanisme permettant de retrouver la clé privée de
   production** (boutons, menus, fonctions, routes, scripts, documentation), sans casser la
   génération ECC légitime, la vérification, l'émission de licences ni la signature des mises à jour.
2. **Refondre réellement le keygen** (`scripts/keygen_ui.py`) : ergonomie moderne, deux offres
   commerciales seulement, durées en jours, fiche client complète, liaison matérielle honnête,
   gestion des licences complète, jetons jamais tronqués, clés ECC fiables, URL serveur centralisée,
   signature des mises à jour.

---

## B · Ce qui a été fait

### B.1 · Suppression de la récupération de clé privée

| Action | Détail |
|---|---|
| Fichiers supprimés | `scripts/find-issuer-key.cjs`, `tests/find-issuer-key.test.cjs`, `scripts/test_keygen_issuer_recovery.py` |
| Script npm supprimé | `keys:find-issuer` (et son entrée dans `test:release-safety`) |
| `scripts/keygen_trust.py` | Réécrit : **lecture seule**. `check_key_match`, `explain()`, `is_issuer_mismatch`, `--verify-key-match`. Aucune recherche de clé : en cas de divergence, la seule issue est la **restauration** depuis le coffre de l'exploitant. |
| `scripts/restore-public-anchors.cjs` | Le message d'erreur ne renvoie plus vers `keys:find-issuer`. |
| `docs/VERIFICATION_CLE_EMETTRICE.md`, `docs/KEYGEN.md` | Toute référence à un outil de recherche supprimée ; règle « aucune reconstruction » énoncée explicitement. |
| Verrou automatique | `TestAucuneRecuperationDeCle` (dans `scripts/test_keygen_v2.py`) prouve l'absence : fichiers supprimés, motifs interdits absents de `scripts, src, electron, tests, config, prisma, docs, public`, absence de `trust.run_find_issuer` / `ui.search_production_key` / `ui.offer_production_key_search`, message d'erreur orienté restauration, aucun script npm référencé. |

Ce qui reste **volontairement** en place, car ce n'est pas une récupération : la génération d'une
paire (jamais sur une paire existante sans confirmation), la lecture de la clé privée locale pour
comparer des **empreintes publiques** (`check_key_match`), et la propagation de la clé **publique**.

### B.2 · Refonte du Keygen

`scripts/keygen_ui.py` : 1753 → 2238 lignes, réécrites. Ce n'est pas un habillage : le code est
découpé en modules testés indépendamment.

| Module | Rôle |
|---|---|
| `scripts/keygen_core.py` | **Seul** chemin de signature. Offres `premium`/`enterprise`, durées en jours, LID **et** UUID distinct (signé dans le filigrane), contrôle de format HWID. |
| `scripts/keygen_db.py` | Base locale `keys/licenses_db.json` (chmod 600), `keys/server_config.json`, journal d'audit, `search_licenses` / `filter_licenses` / `sort_licenses`, alias de libellés (`ENTREPRISE → enterprise`, `Mécaniciens → mechanic`, …). |
| `scripts/keygen_server.py` | **Nouveau.** Client HTTP vers le serveur : `ROUTE_CREATE`, `ROUTE_LICENSES`, `ROUTE_HWID`, `ROUTE_STATUS`, `merge_server_state`, `set_status`, `test_connection`. |
| `scripts/keygen_updates.py` + `scripts/keygen-verify-update.cjs` | **Nouveaux.** Signature des mises à jour **via** `scripts/sign-release-manifest.mjs`, vérification **via** le vrai module client `electron/update-verify.js` — jamais une réimplémentation. |
| `scripts/keygen_ui.py` | IHM Tk : barre latérale, 5 pages, cartes, tables à double défilement, toasts, confirmations, états occupés, fenêtre redimensionnable, helpers résistants à `TclError`. |

**Les 5 pages** : Générer · Gérer les licences · Clés ECC · Serveur · Signature des mises à jour.

**Offres et durées** : `PREMIUM` et `ENTREPRISE` uniquement (`trial`, `admin`, `mechanic` restent
signables pour le parc installé, jamais proposés). Durée **en jours** : valeur libre + unité
(jours / mois / années) ou paliers 1, 7, 30, 90, 180, 365, 730 ; 1 mois = 30 j, 1 an = 365 j. La date
d'expiration est calculée à l'émission, jamais recopiée d'une saisie. Le CLI suit :
`--duration "90 jours"`, `--duration-days 365` (prioritaires sur `--years`).

**Liaison matérielle** : le keygen ne fabrique plus aucune empreinte. Le HWID vient du poste, est
collé ou importé, validé (64 hex v0, ou `HWID1-` + 64 hex v1) **avant** signature, et lié tel quel.

**Jetons** : jamais tronqués dans l'IHM ; zone de texte avec défilement, sélection, bouton de copie
et confirmation « ✓ copié ». La troncature n'existe que côté **API serveur**, où elle est signalée
par un drapeau `truncated` explicite.

**Recherche** : nom, prénom, entreprise, e-mail, téléphone, adresse, ville, pays, informations,
**clé de licence**, LID, UUID et HWID — chaque champ affiché est cherchable, et un test le verrouille
champ par champ. Filtres : PREMIUM, ENTREPRISE, active, non activée, expirée, révoquée (les libellés
d'interface sont traduits vers les types internes ; ce défaut — filtrer « ENTREPRISE » ne renvoyait
rien — a été corrigé au passage). Tri par création, par expiration ou par client.

**Clés ECC** : état de l'autorité, vérification de correspondance, propagation de la clé publique, et
**« COPIER LA CLÉ PUBLIQUE PEM »** — le PEM brut, distinct de sa forme tableau JS.

**Serveur** : URL préremplie `https://app.garageflows.fr`, **source unique**
`keygen_db.DEFAULT_SERVER_URL`, éditable, validée, persistée, avec test de connexion.

### B.3 · Synchronisation Keygen ↔ serveur (côté serveur)

| Route | Rôle |
|---|---|
| `GET /api/keygen/licenses` | Liste des licences pour le Keygen ; appareils pseudonymisés, aucun jeton renvoyé, drapeau `truncated`. |
| `POST /api/keygen/licenses/[lid]/status` | Changement de statut : machine à états (`canTransitionLicense`), `recordMac` recalculé **dans la transaction**, événement d'audit daté, réactivation soumise à confirmation + motif ≥ 5 caractères. |
| `POST /api/keygen/licenses/[lid]/hwid` | `reset` / `revoke` matériel, avec drapeau **`tokenBound`** : si le jeton signé porte lui-même un HWID, la route le **dit** au lieu de laisser croire qu'un reset suffit. |
| `POST /api/admin/licenses/revoke-by-key` | Retirée définitivement (404 `ENDPOINT_DISABLED`) : une clé partagée dans le corps n'est pas une authentification admin. |

---

## C · Preuves — ce qui a été exécuté pour de vrai

| Suite | Commande | Résultat |
|---|---|---|
| Keygen V2 (Python, 74 tests) | `python3 scripts/test_keygen_v2.py` | **74 OK** |
| Keygen historique (Python) | `python3 scripts/test_keygen.py` | **20 OK** |
| Liaison matérielle (Python) | `python3 scripts/test_keygen_hwid_binding.py` | **10 OK** |
| Campagne 105 licences | `node scripts/campagne-100-licences.mjs` | **allPassed** : 105 licences, 110 LID/jetons distincts, 20/20 contrôles négatifs, 40 cas HWID, 110/110 re-vérifiés après « redémarrage » |
| Reproduction aller-retour | `node scripts/reproduce-keygen-roundtrip.mjs` | **ok = true** |
| Contrat Python ↔ TS | `npx vitest run src/lib/license/__tests__/keygen-api-contract.test.ts` | **13 OK** |
| Portée des routes Keygen (nouveau) | `npx vitest run src/app/api/keygen/__tests__/admin-scope.test.ts` | **18 OK** |
| Routes sans appelant | `npx vitest run src/lib/__tests__/routes-sans-appelant.test.ts` | **8 OK** |
| Aller-retour d'activation | `npx vitest run src/lib/__tests__/keygen-activation-roundtrip.test.ts` | **10 OK** |
| Keygen e2e | `npx vitest run src/lib/license/__tests__/license-keygen-e2e.test.ts` | **11 OK** |
| Vérification des mises à jour | `npx vitest run src/lib/__tests__/update-verify.test.ts` | **28 OK** |
| Chaîne de signature | `npx vitest run src/lib/__tests__/release-signing-chain.test.ts` | **20 OK · 7 skippés** (clé de signature de recette absente) |
| Calculs d'argent / TVA | `npx vitest run … money, tva, money-document-consistency` | **33 OK** |
| **Suite complète** | `npx vitest run` | **3 451 OK · 3 échecs · 862 skippés** (4 316) |
| Sécurité (node --test) | `node --test tests/package-prisma-resources.test.cjs tests/restore-public-anchors.test.cjs tests/private-key-material.test.cjs tests/build-public-key.test.cjs tests/secret-scan-policy.test.cjs` | **45 OK** |
| TypeScript | `npx tsc --noEmit` | 269 erreurs **préexistantes** (client Prisma serveur non généré) — **0 sur les fichiers de cette mission** |
| ESLint | `npx eslint src/app/api/keygen …` | **propre** |
| Cohérence documentaire | `node scripts/check-docs-consistency.mjs` | **OK** (232 .md scannés) |

**Sur les 3 échecs de la suite complète** : ils sont dans
`src/test-utils/__tests__/prepare-test-db.test.ts` et échouent sur
`prisma db push → binaries.prisma.sh` injoignable. **Vérifié non régressif** : un `git worktree` sur
le commit de base `8dd5144`, sans aucune de mes modifications, produit exactement les 3 mêmes
échecs avec le même message.

La signature des mises à jour est éprouvée **par le module client réel** : un manifeste est signé,
puis relu par `electron/update-verify.js::validateManifest`. Sont couverts : l'aller-retour valide,
le refus d'une clé inconnue, la modification du fichier après signature (SHA-256 différent),
le refus d'un manifeste falsifié, l'absence de clé, une version non semver, une URL non HTTPS,
et les domaines autorisés **lus depuis le client**.

---

## D · NON VALIDÉ — exécutions impossibles dans cet environnement

Liste close. Un test skippé n'est pas un test réussi ; une simulation n'est pas une preuve.

| Élément | Raison exacte |
|---|---|
| **Rendu visuel de l'IHM Tk** | Aucun module `tkinter`, aucun affichage. La suite Python éprouve la **logique** via une sonde Tk (variables à traces réelles, magasin de lignes réel, `after` synchrone) — elle ne prouve pas le rendu. À valider à l'œil sur un poste. |
| `scripts/test_keygen_ui_lifecycle.py` | Importe `tkinter` réel → `ModuleNotFoundError`. Non exécuté. |
| **Toute écriture base de données réelle** | Le moteur natif Prisma ne peut pas être téléchargé (`binaries.prisma.sh` injoignable depuis cet environnement). Conséquence : 3 tests `prepare-test-db` en échec et **83 fichiers de test refusés à l'import** (`@/generated/server-client` absent). |
| **Application Electron / installateur Windows** | Binaire Electron non téléchargeable ; pas d'hôte Windows. Aucun installateur n'a été construit ni lancé. |
| **Activation réelle d'une licence sur un poste** | Nécessite l'app + une base : non exécutée. Le franchissement de la barrière cryptographique est prouvé (jeton réel vérifié par `verify.ts`, puis refus `DB_UNAVAILABLE`), **pas** l'activation en base. |
| `npm run keys:check`, `npm run check:public-key` | **NON EXÉCUTÉ** : `keys/public.pem` est absent du dépôt (gitignoré). Aucune comparaison n'a eu lieu ; la clé privée de production n'est pas dans cet environnement. |
| Facturation réelle, envoi d'e-mails, paiements, déploiement | Volontairement non exécutés. Données strictement fictives et isolées. |
| Parcours métier de bout en bout (clients → véhicules → devis → facture → PDF) | Nécessite l'application démarrée avec une base : **non exécuté** dans cette session. Seules les briques testables sans base l'ont été (calculs d'argent, TVA, cohérence documentaire, numérotation, matrices d'autorisation). |

---

## E · Fichiers modifiés

```
supprimés   scripts/find-issuer-key.cjs · tests/find-issuer-key.test.cjs · scripts/test_keygen_issuer_recovery.py
modifiés    scripts/keygen_ui.py (réécriture) · scripts/keygen_core.py · scripts/keygen_db.py
            scripts/keygen_trust.py · scripts/keygen.py · scripts/restore-public-anchors.cjs
            src/app/api/keygen/licenses/route.ts
            src/lib/__tests__/routes-sans-appelant.test.ts
            src/lib/license/__tests__/keygen-api-contract.test.ts
            src/lib/__tests__/keygen-activation-roundtrip.test.ts
            src/lib/__tests__/tenant-matrix-completude.test.ts
            docs/KEYGEN.md · docs/VERIFICATION_CLE_EMETTRICE.md · package.json
ajoutés     scripts/keygen_server.py · scripts/keygen_updates.py · scripts/keygen-verify-update.cjs
            scripts/test_keygen_v2.py
            src/app/api/keygen/licenses/[lid]/hwid/route.ts
            src/app/api/keygen/licenses/[lid]/status/route.ts
            src/app/api/keygen/__tests__/admin-scope.test.ts
```

---

## F · Points d'attention pour la suite

1. **`expiryAt` / `expiresAt`** : la route de collecte renvoie `expiryAt`, `keygen_server.merge_server_state`
   et l'IHM lisent `expiresAt`. Les deux noms coexistent aujourd'hui sans incidence (champs distincts
   de part et d'autre) mais doivent être alignés sur un seul avant toute évolution du contrat.
2. **Rendu Tk** : à valider visuellement sur poste Windows/Linux avec `python3 scripts/keygen_ui.py`.
3. **Activation réelle** : à rejouer sur un environnement disposant du moteur Prisma
   (`prisma generate` + base), avec des identités de test.
4. **`keys:check`** : à exécuter sur la machine de build, où `keys/public.pem` est présent.

---

## G · Commandes de reproduction

```sh
npm run test:keygen                    # 3 suites Python — 104 tests
node scripts/campagne-100-licences.mjs # 105 licences, contrôles négatifs, HWID
node scripts/reproduce-keygen-roundtrip.mjs
npx vitest run src/app/api/keygen src/lib/license src/lib/__tests__/keygen-activation-roundtrip.test.ts
npm run keygen                         # ouvre l'IHM
```
