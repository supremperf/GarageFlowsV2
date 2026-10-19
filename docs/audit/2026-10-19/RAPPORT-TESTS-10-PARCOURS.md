# Rapport de tests — les dix parcours métier

**Date** : 2026-10-19
**Commande reproductible** : `npm run rapport:parcours`
**Artefact machine** : [`artifacts/verification/parcours-metier-10.json`](../../../artifacts/verification/parcours-metier-10.json)

> Ce rapport mesure des tests **réellement exécutés**. Il ne compte jamais une
> suite non exécutée comme verte : les fichiers qui exigent une base PostgreSQL
> ou SQLite construite par le moteur Prisma sont listés séparément, avec leur
> nombre, et le restent tant que la CI ne les a pas joués.

---

## 1. Méthode

Le script lance **un seul run Vitest** sur l'union des fichiers de test qui ne
réclament pas de base de données, puis agrège les résultats par parcours. Un
fichier peut illustrer plusieurs parcours (le total global reste celui du run
unique).

Le script **refuse de démarrer** si un fichier sélectionné importe
`prepareTestDb` : aucune suite à base réelle ne peut être comptée par erreur.

Environnement : Node 22.22.3, Linux x64, Vitest 4.1.11, aucun moteur Prisma natif.

## 2. Résultat global du run

| Mesure | Valeur |
|---|---:|
| Fichiers uniques exécutés | **76** |
| Assertions | **897** |
| Réussies | **890** |
| Échouées | **0** |
| Ignorées (conditions de clé/Python) | **7** |
| Durée | 20,4 s |
| Code de sortie Vitest | 0 |

Les 7 assertions ignorées le sont par `it.skipIf` : absence de
`keys/public.pem` (clé de production gitignorée) et absence de `cryptography`
dans le Python système pour un test croisé. Elles ne sont pas des succès.

### Baseline élargie (tous les tests hors base)

```bash
find src -name '*.test.ts' ! -name '*.postgres.int.test.ts' ! -path 'src/integration/*' \
  -print0 | xargs -0 grep -L 'prepareTestDb\|prepare-test-db' \
  | xargs npx vitest run --reporter=json --outputFile=.vitest-nondb.json
```

| Mesure | Valeur |
|---|---:|
| Fichiers exécutés | **270** |
| Assertions | **3 460** |
| Réussies | **3 439** |
| Échouées | **0** |
| Ignorées | **21** |
| Code de sortie | 1 (une seule suite, voir ci-dessous) |

La seule suite dont le **chargement** échoue est
`src/lib/__tests__/tenant-isolation.test.ts` : ses 7 tests sont sautés avant
exécution, faute de moteur Prisma natif (`prisma.garage.create()` lève
`PrismaClientInitializationError`). Aucune assertion n'échoue. Les 132 fichiers
de `src/integration/*` et `.postgres.int` restent hors de cette mesure.

## 3. Détail par parcours

| # | Parcours | Fichiers | Assertions | Réussies | Échecs | Suites à base réelle non exécutées |
|---|---|---:|---:|---:|---:|---:|
| 1 | Client | 6 | 78 | 78 | 0 | 3 |
| 2 | Véhicule | 4 | 63 | 63 | 0 | 1 |
| 3 | Devis | 6 | 66 | 66 | 0 | 3 |
| 4 | Intervention (OR) | 6 | 50 | 50 | 0 | 3 |
| 5 | Facture | 8 | 70 | 70 | 0 | 3 |
| 6 | Facturation électronique | 14 | 206 | 206 | 0 | 2 |
| 7 | Licence | 14 | 149 | 142 | 0 | 2 (+1 hors run) |
| 8 | Abonnement / droits | 2 | 24 | 24 | 0 | 0 |
| 9 | Sauvegarde / restauration | 6 | 48 | 48 | 0 | 2 |
| 10 | Installation Windows | 13 | 176 | 176 | 0 | 0 |

La somme des colonnes dépasse 897 : certains fichiers couvrent deux parcours.

### Ce que chaque parcours prouve réellement

1. **Client** — politique d’accès, parcours portail, redirections sûres,
   sessions portail. Les cycles complets client/portail en base
   (`client-email-garage-portail`, `portal-access-lifecycle`,
   `intervention-rattache-client-vehicule`) ne sont **pas exécutés**.
2. **Véhicule** — VIN, format d’immatriculation, migration du champ contrôle
   technique, calculs de facturation. La création client/véhicule depuis une
   intervention est une suite à base réelle, **non exécutée**.
3. **Devis** — totaux HT/TTC, numérotation, transitions de statut, génération,
   cohérence monétaire. Publication et acceptation en base **non exécutées**.
4. **Intervention** — main-d’œuvre, pièces rattachées, inspection, pointage
   mécanicien. Le scénario maître et le workflow complet **non exécutés**.
5. **Facture** — projection API, immutabilité, TVA, PDF (qualité d’impression,
   poids, échappement HTML), export FEC. Intégrité en base et publication
   cloud **non exécutées**.
6. **Facturation électronique** — validation, catalogue, format Factur-X,
   adaptateur générique, garde SSRF, DNS, chaîne d’envoi, rejeu concurrent,
   **webhooks signés** (27 tests). L’échange avec une PDP réelle n’a pas eu
   lieu ; le tunnel poste → cloud est une suite à base réelle.
7. **Licence** — signature ECDSA P-256, format inter-langages, HWID v0/v1,
   refus de falsification, machine à états, émission bornée, changement de
   contrat. **7 assertions ignorées** faute de clé publique de production.
   `license-devices-unit.test.ts` est lancé **à part** : ses **16 assertions
   passent**, mais le processus sort en 1 à cause d’une
   `PrismaClientInitializationError` non capturée (client généré sans moteur) —
   vérifié par motif exact, jamais compté comme succès silencieux.
8. **Abonnement / droits** — **aucun module d’abonnement payant, aucune
   dépendance Stripe, aucun webhook de paiement** dans ce dépôt. Le parcours
   n’est donc pas simulé : il n’existe pas. Les deux fichiers exécutés couvrent
   le plan de contrôle Electron et le changement de contrat de licence, seuls
   droits payants modélisés.
9. **Sauvegarde / restauration** — chiffrement, snapshot, script de
   restauration, sauvegarde avant migration, détection d’une sauvegarde qui ne
   passe plus. La **restauration réelle dans une base** (`restore-roundtrip`) et
   la cohérence de sauvegarde API exigent le moteur Prisma : **non exécutées**.
10. **Installation Windows** — installateur NSIS (raccourcis, désinstallation),
    chaîne de signature, fuses Electron, garde de démarrage, navigation,
    loopback, sources de mise à jour. Ce sont des **gardes sur les fichiers
    réels du build**, pas une exécution de l’installateur : aucun Windows n’est
    disponible ici.

## 4. Preuves complémentaires exécutées

| Commande | Résultat |
|---|---|
| `npx tsc --noEmit` | **0 erreur** |
| `npx eslint src` | **0 erreur** |
| `npm run build` (`next-build.cjs`) | **exit 0**, compilation réussie, 18 pages générées |
| `npm run test:release-safety` | **164/164** |
| `npm run test:audit` | **21/21** |
| `npm run check:consistency` | **exit 0** (13 contrôles) |
| `node scripts/campagne-100-licences.mjs` | **`allPassed: true`** |
| `python3 scripts/test_keygen_hwid_binding.py` | **10/10** |
| `python3 scripts/test_keygen.py` | **20/20** |
| `python3 scripts/test_keygen_issuer_recovery.py` | **17/17** |
| `node scripts/reproduce-keygen-roundtrip.mjs` | **19/19, `ok: true`** |

Campagne licences (détail complet dans
[RAPPORT-LICENCES-ET-EINVOICING.md](RAPPORT-LICENCES-ET-EINVOICING.md)) :
100 licences garage + 5 mécanicien valides, 20 contrôles négatifs, 40 cas HWID,
re-vérification **110/110** dans un processus séparé. Ce n’est pas une
activation réelle dans l’application Windows ni une écriture en base
d’activation — ces deux étapes n’ont pas été exécutées.

## 5. Ce qui n’a pas été exécuté, et pourquoi

- **78 fichiers de test** du dépôt importent `prepareTestDb` (suites
  d’intégration PostgreSQL/SQLite). Le moteur Prisma natif n’est pas
  téléchargeable depuis cet environnement (`binaries.prisma.sh` inaccessible).
  Ils ne sont comptés nulle part comme verts.
- Le build Next.js affiche une `PrismaClientInitializationError` pendant
  « Collecting page data » : le client généré est sans moteur. Le build sort
  néanmoins en **0** et génère les 18 pages. C’est une limite d’environnement,
  pas une validation de la base.
- Aucun test Windows, aucun test sur PDP réelle, aucun test de charge.

## 6. Reproduire

```bash
npm run rapport:parcours        # ce rapport + l'artefact JSON
npm run test:release-safety
npm run test:audit
npx tsc --noEmit
npx eslint src
npm run build
node scripts/campagne-100-licences.mjs
```
