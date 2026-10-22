---
doc-numbers: journal
---

# Corrections effectuées — 22 octobre 2026

Base : `150654535ca0b3b417e96be057ba674a119c512f`.  
Branche de travail : `arena/388085e0-garageflowsv2`.  
Les changements sont locaux et non commités ; aucun push n’a été effectué.

## 1. Parser `.env` : valeur vide suivie d’un commentaire

### Défaut reproduit

Dans `scripts/secrets.js`, l’expression de lecture utilisait `\s*` après `=`. Ce caractère inclut les retours à la ligne : pour une variable vide, le parser pouvait traverser la fin de ligne et capturer le commentaire suivant comme valeur. Le bootstrap considérait alors le secret comme déjà renseigné, ou utilisait une valeur incorrecte.

### Correction

- remplacement par une classe limitée aux espaces horizontaux `[\t ]*` ;
- conservation du comportement pour CRLF, guillemets et commentaires ;
- ajout de régressions dans `src/lib/__tests__/secrets.test.ts` et `tests/setup-dev-permissions.test.cjs`.

### Preuve

- avant : suite secrets 1 échec / 8 réussites ; setup 1 échec / 1 réussite ;
- après : secrets 9/9 ; setup 2/2 ; typecheck et ESLint verts ;
- journaux avant : `artifacts/verification/audit-2026-10-22/18-secrets-regression-before.txt` et `19-setup-regression-before.txt`.

## 2. Permissions et génération du secret local

### Défaut

Le setup initial était idempotent et ne modifiait pas les hashes de `.env` ou de `prisma/dev.db`, mais un `.env` existant pouvait conserver des permissions trop larges (`644` dans la reproduction POSIX). Le cas « variable vide + commentaire » empêchait en outre la génération attendue.

### Correction

- `scripts/setup-dev.js` réapplique les permissions restrictives prévues au fichier local ;
- le correctif du parser permet de générer uniquement lorsque `NEXTAUTH_SECRET` est réellement vide ;
- le test d’intégration vérifie génération, non-affichage, absence de rotation d’un secret fort et permissions ;
- `package.json` ajoute ce test à `test:release-safety`.

### Résultat réel

- `.env` local : mode `600` ;
- un seul `NEXTAUTH_SECRET` aléatoire fort de 44 caractères généré ;
- valeur jamais affichée ni recopiée dans les rapports ;
- `prisma/dev.db` préservée ; aucune réinitialisation ;
- release-safety après ajout du cas standalone : 172/172.

Sous Windows, le mode POSIX `600` n’est pas une preuve d’ACL NTFS : la vérification des ACL reste une étape Windows.

## 3. Typage du test de réception des commandes fournisseurs

Dans `src/app/api/purchase-orders/__tests__/receive-guards.test.ts`, une auto-référence de type a été supprimée. Aucun comportement de la route de réception n’a été modifié.

Validation : 8/8 tests de réception, typecheck et ESLint verts.

## 4. Version Next.js dans l’inventaire de configuration

`scripts/config-audit.cjs` affichait « Next.js 14 » en dur alors que le manifeste déclare Next.js 15.5.27. Le rapport lit maintenant `dependencies.next` depuis `package.json`. Un commentaire de test obsolète a également été aligné sur Next.js 15.5.

Cette correction change le texte généré, pas la dépendance ni le lockfile.

## 5. Garde standalone : client Prisma présent sans moteur natif

### Défaut reproduit

`scripts/verify-standalone-build.cjs` vérifiait seulement l’existence de `node_modules/.prisma/client`. Le test existant supprimait tout ce dossier et ne couvrait donc pas le cas réel du sandbox : `index.js` et le client sont présents, mais aucun moteur de requête natif ne l’est. La sortie était déclarée empaquetable alors que `/api/health` échouait.

### Correction

- le vérificateur exige maintenant au moins une bibliothèque `query_engine`/`libquery_engine` `.node` ou un binaire `query-engine` dans le client embarqué ;
- WASM, le seul client JS et le seul dossier `.prisma/client` ne satisfont pas ce contrôle ;
- la fixture saine contient un moteur factice ; une nouvelle régression retire uniquement ce moteur en conservant le client JS ;
- `tests/build-dist-chain.test.cjs` couvre l’acceptation d’une sortie complète et le refus du faux vert.

### Preuve

Sur une fixture identique sans moteur : version `HEAD` → exit 0 ; version corrigée → exit 1 avec « moteur Prisma natif absent ». Suite dédiée 16/16, release-safety 172/172, ensemble Node 495/495. Sur l’artefact réel, le contrôle corrigé refuse maintenant le standalone `noEngine`, comme attendu.

## 6. Livrables et preuves

- huit documents d’audit et d’exploitation créés à la racine ;
- inventaire des 169 routes API ajouté à `AUDIT_COMPLET.md` ;
- journaux essentiels copiés dans `artifacts/verification/audit-2026-10-22/` après suppression des seules séquences ANSI ;
- empreintes SHA-256 fournies dans `SHA256SUMS` ;
- scan ciblé des preuves avec la valeur du secret local et le détecteur de clé privée : 26 journaux texte + `SHA256SUMS`, soit 27 fichiers réellement lus, aucune détection.

## Fichiers de code/tests modifiés

- `scripts/secrets.js`
- `scripts/setup-dev.js`
- `scripts/config-audit.cjs`
- `scripts/verify-standalone-build.cjs`
- `package.json`
- `tests/build-dist-chain.test.cjs`
- `src/app/api/purchase-orders/__tests__/receive-guards.test.ts`
- `src/lib/__tests__/secrets.test.ts`
- `src/lib/__tests__/toolchain-node-version.test.ts` (commentaire)
- `tests/setup-dev-permissions.test.cjs` (nouveau)
- `docs/CONFIG_REPOSITORY_AUDIT.md` (régénéré)

## Ce qui n’a volontairement pas été changé

- aucune fonction `collectHwidFieldsV1` / `getHwidV1`, aucun champ, ordre, préfixe, algorithme ou format HWID ;
- aucune licence émise, clé privée, migration, structure Prisma ou donnée métier ;
- aucune dépendance ou version du lockfile ;
- aucune configuration de production, aucun DNS, compte Vercel ou service externe ;
- aucune protection ou suite de tests désactivée ;
- aucun `npm audit fix --force`, `db push --force-reset`, reset de base ou push forcé.

## Corrections non effectuées parce qu’elles exigent une autre validation

- chaîne Prisma/native : il faut rétablir l’accès aux artefacts officiels ou un cache approuvé, pas simuler un moteur ;
- notices tierces : les trois inventaires ne concordent pas ; une régénération depuis la SBOM réduirait la couverture. La correction doit être produite depuis l’artefact Windows réel et revue ;
- runtime PostgreSQL/Redis/SMTP/facturation : aucune fausse réussite ni identifiant inventé ;
- installateur Windows : aucune génération croisée présentée comme un test Windows.
