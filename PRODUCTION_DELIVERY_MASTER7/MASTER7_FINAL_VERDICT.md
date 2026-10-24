---
doc-numbers: journal
---

# VERDICT FINAL — MASTER 7

# PRODUCTION VALIDÉE SOUS RÉSERVES

---

## 1. Pourquoi pas « PRODUCTION VALIDÉE »

Une réserve de gravité **critique** subsiste, et elle n'est pas de mon ressort : **un jeton Vercel Blob en lecture-écriture, publié sur un dépôt public, est toujours actif.** La CLI Vercel refuse par conception qu'un agent supprime un store. Deux commandes suffisent, mais vous devez les exécuter.

Trois autres réserves tiennent à un achat, une machine et une décision juridique.

## 2. Pourquoi pas « NON PRÊT POUR LA PRODUCTION »

Le serveur de production est **en ligne, sain et correctement verrouillé** : `GET /api/health` → 200, `GET /api/clients` → **401**. Le code publié passe 4 390 tests Vitest sans échec, 0 erreur TypeScript, 0 erreur ESLint, et 14 des 16 contrôles de `release:gate`. Les deux contrôles rouges tiennent à des avis de sécurité publiés il y a moins de 24 heures **dans l'outillage de développement**, et **aucun ne touche le produit livré**.

## 3. Ce que MASTER 7 a réellement accompli

| | |
|---|---|
| **Scan de secrets de la CI** | **6 signalements → 0**, job **passé au vert**, sans toucher au scanner, à `.gitleaksignore`, aux règles, ni aux registres de triage. Quatre tests de non-régression ajoutés. |
| **Deux vulnérabilités de production corrigées** | `zod` HIGH et `nodemailer` 3 × MODERATE — sans montée majeure, sans `--force`, suite de tests identique après (4 390 / 0 / 34). |
| **Générateur de notices réparé** | il ne pouvait plus s'exécuter du tout ; cause trouvée et corrigée, verrous SHA-256 préservés. |
| **Secrets exposés : classification et verdict d'activité** | 20 champs en 5 groupes, chacun sondé. **2 encore exploitables**, 7 neutralisés, 1 sans effet. |
| **Licence exposée : verdict définitif** | `SIGNATURE_INVALID` sous l'autorité de production — **elle ne peut activer aucune installation**. |
| **Clé privée : recherche concluante** | 2 090 fichiers, 3 clés EC trouvées, **aucune ne correspond** ; aucune variable `PRIVATE_KEY` chez Vercel. |
| **Trois chiffres de MASTER 6 corrigés** | « 3 secrets » → 20 champs · « 5 alertes » → 6 · « 6 composants sans notice » → **4**. |

## 4. Les réserves, une par une

### R1 · Jeton Vercel Blob encore actif — **CRITIQUE**

| | |
|---|---|
| **Gravité** | **critique** |
| **Cause** | `BLOB_READ_WRITE_TOKEN` committé le 2026-10-16 dans `.env.storage.local`, sur un dépôt **public**. Retiré du suivi, mais définitivement exposé dans l'historique. |
| **Impact** | écriture arbitraire sur le store **`garageflows-update`** (`store_4TyemjFvecVTkX2W`), en accès `Public`, destiné à la **distribution des mises à jour**. Vecteur d'empoisonnement du canal. Atténuations vérifiées : store **vide**, aucune variable Blob sur le projet, mises à jour exigeant un manifeste **signé**. |
| **Preuve** | `GET https://blob.vercel-storage.com?limit=1` → **HTTP 200**. `MASTER7_EVIDENCE/logs/03-revocation-blob-tentative.txt` |
| **Action** | `vercel blob delete-store store_4TyemjFvecVTkX2W` puis `vercel blob create-store garageflows-update`, depuis un terminal interactif. Vérifier avec `node MASTER7_EVIDENCE/outils/verifier-revocation-blob.cjs` (attendu : 401/403/404). |
| **Statut réel** | **révocation tentée, refusée par l'outil** (`dangerous_operation_requires_user`). **Non révoqué.** Action utilisateur requise. |

### R2 · Identifiant Neon encore valide — **ÉLEVÉE**

| | |
|---|---|
| **Gravité** | **élevée** |
| **Cause** | même fichier, même commit : 9 champs portant une URL de connexion PostgreSQL avec mot de passe. |
| **Impact** | authentification réussie en tant que **`neondb_owner`** — le rôle **propriétaire** — sur la base `neondb`. Prod ou Preview non tranché : les noms correspondent au jeu que l'intégration Neon injecte en **Preview**, mais une base Preview avec le rôle propriétaire reste une base vivante du compte. |
| **Preuve** | `psql … -c "select 1"` → code 0 ; `\conninfo` → connecté en `neondb_owner`. Aucune donnée métier lue. `MASTER7_EVIDENCE/logs/02-secrets-historiques-classification.txt` |
| **Action** | console Neon → réinitialiser le mot de passe de `neondb_owner` ; vérifier la propagation Vercel ; contrôler que l'ancienne URL échoue. |
| **Statut réel** | **non roté.** Aucune clé d'API Neon n'est disponible dans cette session, et ces variables sont gérées par l'intégration Vercel. |

### R3 · Installateur non signé — **MOYENNE**

| | |
|---|---|
| **Gravité** | moyenne — commerciale plus que technique |
| **Cause** | aucun certificat de signature de code : rien dans `build.win`, aucune variable `CSC_*`, aucun certificat dans les magasins Windows. |
| **Impact** | SmartScreen avertira chaque client. Inacceptable pour une distribution professionnelle. |
| **Preuve** | `Get-AuthenticodeSignature` → `NotSigned` sur les deux exécutables. `MASTER7_EVIDENCE/logs/07-windows-signature.txt` |
| **Action** | acquérir un certificat **OV** ou **EV**, le fournir par `CSC_LINK` / `CSC_KEY_PASSWORD` **en secrets de CI**, reconstruire. |
| **Statut réel** | **bloqué** — prérequis externe. Rien à corriger dans la configuration : il manque un achat. |

### R4 · Parcours Windows non joué — **MOYENNE**

| | |
|---|---|
| **Gravité** | moyenne |
| **Cause** | ce poste héberge une installation réelle et les données métier de l'utilisateur ; l'`appId` partagé rendrait cette installation non désinstallable. |
| **Impact** | installation, raccourcis, mise à niveau et désinstallation ne sont pas prouvés de bout en bout. |
| **Preuve** | déjà validé sans rien installer : 3 / 3 contrôles d'artefact, **9 / 9 fusibles**, et `deleteAppDataOnUninstall: false` garantit par configuration que les données survivent. |
| **Action** | jouer `scripts\test-windows-setup.ps1` sur une machine virtuelle propre, avec une licence de test. |
| **Statut réel** | **bloqué** — machine jetable requise, que je ne peux pas créer. |

### R5 · Clé privée de licence introuvable — **ÉLEVÉE**

| | |
|---|---|
| **Gravité** | **élevée** — commercialement bloquante |
| **Cause** | la privée de `b16d2e1b…` a disparu ; `GF_PRIVATE_KEY` n'est configurée dans **aucun** environnement Vercel. |
| **Impact** | les licences existantes **restent vérifiables**, mais **aucune nouvelle licence ne peut être émise**, ni renouvelée, ni étendue. Un produit sous licence qui ne peut plus délivrer de licence n'est pas commercialisable. |
| **Preuve** | 2 090 fichiers examinés, 3 clés EC trouvées, **0 correspondance** ; `vercel env ls \| grep -ci PRIVATE_KEY` → 0. `MASTER7_EVIDENCE/logs/05-cryptographie-licence.txt` |
| **Action** | décider d'une rotation. **Procédure de transition compatible préparée en 7 points localisés** — vérificateur multi-ancrages, qui n'invalide **aucune** licence existante. Non appliquée : elle touche un composant de sécurité central et exige votre décision. |
| **Statut réel** | **bloqué sur décision.** Information manquante pour arbitrer : le nombre de licences actives en production. |

### R6 · Quatre composants sans attribution — **MOYENNE**

| | |
|---|---|
| **Gravité** | moyenne — exposition juridique |
| **Cause** | double : les notices sont générées depuis l'inventaire **serveur** (donc les binaires Windows n'y figurent pas, et des composants Linux **non livrés** y sont attribués) ; et la sortie autonome de Next expédie des dépendances marquées `dev`, qu'aucun inventaire de production ne contient. |
| **Impact** | `@next/swc-win32-x64-msvc` (≈ 148 Mo d'un installateur de 251 Mo), `typescript`, `buffer-from`, `source-map-support` sont distribués **sans texte de licence ni section de notice**. |
| **Preuve** | `MASTER7_EVIDENCE/logs/06-licences-composants.txt`. Nuance établie : `app.asar` contient **238** fichiers de licence et `THIRD_PARTY_NOTICES.md` ; le défaut porte sur la charge `standalone` (24 paquets, 0 licence), dont **19 sont couverts** par les notices. |
| **Action** | générer les notices Windows depuis l'inventaire **Windows** (ferme 2 des 4 — mesuré), **et** faire déclarer par cet inventaire ce que le traçage autonome expédie réellement (ferme les 3 derniers). **Ne pas** régénérer les notices sur ce poste : mesuré, la régénération y retire 536 lignes. |
| **Statut réel** | **non corrigé**, mais **un blocage préalable a été levé** : le générateur de notices ne pouvait plus s'exécuter, il refonctionne. |

### R7 · Sous-composants natifs de `sharp` — **À QUALIFIER**

| | |
|---|---|
| **Gravité** | à qualifier — relève du conseil juridique |
| **Cause** | `@img/sharp-win32-x64` déclare `Apache-2.0 AND LGPL-3.0-or-later` ; seul le texte Apache-2.0 est expédié. La bibliothèque native liée statiquement embarque, d'après la documentation amont, du matériel **MPL-1.1** (cairo — mise à disposition des sources) et une **licence de brevet** (aom). `libvips 8.18.7`, la version réellement livrée, ne figure dans aucun inventaire. |
| **Impact** | obligations de redistribution potentiellement non satisfaites sur un binaire diffusé. |
| **Preuve** | `MASTER7_EVIDENCE/logs/06-licences-composants.txt §8` |
| **Action** | **relecture juridique.** Aucune licence ni autorisation n'est inventée ici. |
| **Statut réel** | **ouvert** — hors de portée d'un script. |

### R8 · CI rouge sur l'audit de dépendances — **FAIBLE**

| | |
|---|---|
| **Gravité** | faible — aucun impact sur le produit livré |
| **Cause** | avis publiés dans les dernières 24 heures sur la chaîne `@vercel/blob` → `@vercel/cli-config` / `@vercel/oidc` / `zod` / `undici`, plus `fast-uri`. **Toutes des `devDependency`.** |
| **Impact** | **nul sur le produit** : aucun de ces paquets n'est embarqué dans l'installateur ni déployé. L'exposition est circonscrite à la machine de développement et à la CI. |
| **Preuve** | `MASTER7_EVIDENCE/logs/09-validation-globale.txt §4-5`. La copie `zod` de **production** est 4.6.7, **non affectée** ; seule l'imbriquée de l'outillage (4.1.11) l'est. |
| **Action** | attendre un `@vercel/blob` stable ≥ 2.9.0. Le seul correctif proposé aujourd'hui est un **retour à 2.4.0**, qui casserait l'outillage de configuration (format de jeton documenté pour 2.8.2). |
| **Statut réel** | **rouge, assumé.** Abaisser le seuil est exclu : le mandat interdit de désactiver un contrôle pour obtenir un vert. |

### R9 · CI rouge sur la validation authentifiée — **FAIBLE**

| | |
|---|---|
| **Gravité** | faible — configuration de dépôt |
| **Cause** | le job *Authenticated browser validation* refuse de démarrer faute des secrets `BASE_URL`, `E2E_EMAIL`, `E2E_PASSWORD`, `E2E_LICENSE` et de la variable `E2E_NON_PRODUCTION`. **Refus volontaire *fail-closed*, antérieur à MASTER 7.** |
| **Impact** | la capacité est prouvée — 135 tests Playwright authentifiés verts en MASTER 6, localement. Seul le câblage CI manque. |
| **Preuve** | run `39193727183`, échec en 5 s sur `MISSING_INPUT`. |
| **Action** | déclarer une cible **non productive** dans *Settings → Secrets and variables → Actions*. Ne jamais y mettre `https://app.garageflows.fr`. |
| **Statut réel** | **ouvert** — seul le propriétaire peut poser ces secrets. |

## 5. Tableau de synthèse

| Domaine | Résultat | Réserve |
|---|---|---|
| Scan de secrets (CI) | **VALIDÉ** — 6 → 0, job vert | — |
| Secrets exposés | **PARTIEL** | R1 critique, R2 élevée |
| Cryptographie des licences | **VÉRIFICATION OK / ÉMISSION BLOQUÉE** | R5 |
| Signature Windows | **BLOQUÉ** | R3 |
| Parcours Windows réel | **BLOQUÉ** | R4 |
| Artefact Windows (secrets, fusibles, intégrité) | **VALIDÉ** sur l'octet livré | — |
| Licences des composants | **PARTIEL** — 4 sans attribution | R6, R7 |
| TypeScript · ESLint · Vitest | **VALIDÉ** — 0 · 0 · 4 390/0/34 | — |
| `release:gate` | **14 / 16** | R8 |
| Intégrité des preuves | **VALIDÉ** — 273 / 273 | — |
| Vercel / production | **VALIDÉ, non modifié** | aucune liaison Git |
| GitHub `main` | **PUBLIÉ** | — |

## 6. Ce qui n'a jamais été fait

- Aucun `git push --force`, aucun historique réécrit, aucune identité Git modifiée.
- `MASTER6_EVIDENCE` et les manifestes historiques : **intouchés**. 273/273 avant comme après.
- Aucune empreinte régénérée artificiellement.
- Aucun contrôle de sécurité désactivé, aucun seuil abaissé, aucun test supprimé.
- Aucun secret affiché, nulle part — ni dans les rapports, ni dans les preuves, ni dans les journaux de commandes.
- Aucune donnée métier lue : deux requêtes de diagnostic, `select 1` et `\conninfo`.
- Aucune écriture ni suppression sur l'infrastructure.
- `npm audit fix --force` : **jamais utilisé**. Aucune montée majeure.
- Production et configuration Vercel : **inchangées**.

## 7. Les deux commandes qui changent le verdict

```
vercel blob delete-store store_4TyemjFvecVTkX2W
vercel blob create-store garageflows-update
```

Puis, en console Neon, réinitialiser le mot de passe de `neondb_owner`.

Ces deux gestes referment R1 et R2 — les deux seules réserves où un attaquant disposerait aujourd'hui d'un accès réel. Le reste est un achat, une machine virtuelle, et deux décisions.
