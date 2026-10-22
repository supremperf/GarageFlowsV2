---
doc-numbers: journal
---

# Installation Windows — build, vérification et déploiement

**État au 22 octobre 2026 : aucune version Windows n’a été produite ou testée dans ce sandbox Linux.** La procédure ci-dessous est donc une checklist d’exécution, pas un compte rendu de réussite Windows.

## 1. Contrat d’artefact du projet

La configuration `package.json` définit :

- cible Electron : Windows **x64**, NSIS ;
- artefact : `dist/GarageFlows-Setup.exe` ;
- mode `oneClick: false`, installation par utilisateur (`perMachine: false`) ;
- `requestedExecutionLevel: asInvoker`, `allowElevation: false` ;
- raccourcis Bureau et Menu Démarrer ;
- `deleteAppDataOnUninstall: false` : la désinstallation ne doit pas supprimer les données applicatives ;
- ressources : standalone Next, `schema.prisma`, template SQLite, `keys/public.pem`, icône ;
- `asarUnpack` prévu pour `query_engine-windows*` et les moteurs Prisma.

Dans l’artefact Linux d’audit, aucun `query_engine-windows*.dll.node` n’est disponible. Il faut le générer/obtenir sur la chaîne Windows officielle.

## 2. Prérequis de la machine de build

- Windows x64 et version supportée par la toolchain retenue ;
- Git, Node 22 (`>=22.12.0 <23`) et npm conforme au manifeste ;
- accès réseau aux registres NPM et artefacts Prisma officiels ;
- outils et certificat de signature de code gérés par l’organisation ;
- espace disque pour `node_modules`, `.next`, `dist` et les bases de test ;
- comptes de staging pour les services inclus dans la release ;
- aucune donnée de production sur la machine de test.

Ne pas désactiver TLS, les scripts d’installation, les protections Electron ou les tests pour faire passer le build.

## 3. Préparer un checkout de release

Utiliser un commit approuvé et un checkout propre. Les fichiers actuellement modifiés dans le sandbox doivent être revus avant toute release.

```powershell
git status --short
git rev-parse HEAD
npm ci
npm run config:check
npm run check:consistency
```

Le manifeste de l’audit est marqué `1.1.0+150654535.dirty` parce que le build isolé a été fait avec des changements locaux. Une release ne doit pas utiliser ce manifeste dirty comme référence finale.

## 4. Exécuter les validations avant packaging

```powershell
npm run typecheck
npm run lint
npm test
node --test tests/*.test.cjs
npm run test:config:auto
npm run test:keygen
npm run audit:strict
npm run preflight:release
```

Conditions :

- les suites Prisma doivent utiliser des bases isolées/copies temporaires ;
- les tests PostgreSQL/Redis nécessitent leurs URL de test explicites ;
- `test:keygen` nécessite l’environnement Python verrouillé ; un OCR ignoré doit rester signalé ;
- ne pas lancer les suites destructrices sur une base existante.

Pour les E2E, installer les navigateurs avec la procédure Playwright approuvée, configurer une cible de test et exécuter :

```powershell
npm run test:e2e
```

La simple énumération des 144 tests n’est pas une validation.

## 5. Produire l’installateur

La commande prévue par le dépôt est :

```powershell
npm run dist
```

Elle enchaîne : préflight, build officiel avec Prisma, vérification standalone, Electron Builder Windows x64, scan des secrets, contrôle des fuses et vérification de l’installateur.

Ne pas reprendre le client `noEngine` du sandbox pour cette étape. Si Prisma échoue, corriger l’accès aux artefacts officiels ou utiliser un cache interne approuvé et vérifiable.

## 6. Contrôler l’artefact réel

Après `npm run dist`, conserver les résultats de :

```powershell
npm run check:artifact-secrets
npm run check:artifact-fuses
npm run verify:installer
```

Vérifier manuellement en complément :

1. `dist/GarageFlows-Setup.exe` et `dist/win-unpacked` existent et correspondent au même build ;
2. le moteur Prisma Windows attendu est présent et chargé depuis l’emplacement unpack ;
3. `keys/public.pem` est présent, sans `private.pem`, `.key`, `.pkcs8` ou `.env` ;
4. le contenu de l’installateur NSIS correspond à `win-unpacked` ;
5. `THIRD_PARTY_NOTICES.md` couvre les paquets réellement distribués, y compris natifs/optionnels ;
6. les fuses Electron sont contrôlés sur le binaire et non sur la seule configuration ;
7. l’empreinte SHA-256 et la taille de l’installateur sont consignées ;
8. `Get-AuthenticodeSignature .\dist\GarageFlows-Setup.exe` confirme la signature selon la politique de l’organisation.

Le scan autonome du sandbox n’est pas une preuve pour ces fichiers Windows.

## 7. Tests sur poste vierge

Sur une machine ou VM Windows de test sans installation précédente :

1. installer sans élévation avec le compte utilisateur cible ;
2. vérifier les raccourcis et le premier lancement ;
3. vérifier les ACL NTFS des fichiers de secrets et des données ;
4. confirmer la création de la base depuis le template et l’application des migrations ;
5. vérifier `/api/health` via les diagnostics internes et un parcours CRUD réel ;
6. activer une **licence de test existante** compatible HWID V1 ;
7. fermer/réouvrir, tester le mode offline puis la reprise réseau ;
8. tester photos, sauvegarde, export et restauration sur copie ;
9. vérifier qu’aucune clé privée ou configuration de développement n’est embarquée ;
10. désinstaller et confirmer que les données utilisateur sont conservées conformément au contrat.

Ne pas utiliser une licence de production ni régénérer l’autorité pour ce test.

## 8. Tests de mise à niveau et de mise à jour

Sur une seconde VM contenant uniquement des données de test représentatives :

- sauvegarder puis installer la nouvelle version par-dessus l’ancienne ;
- vérifier la migration sans perte et la compatibilité des licences déjà émises ;
- tester un manifeste de mise à jour correctement signé ;
- vérifier le refus d’un manifeste, d’une signature ou d’un hôte non approuvé ;
- tester l’interruption/reprise du téléchargement si le parcours le prévoit ;
- vérifier le retour à la version applicative précédente sans reset de base.

## 9. Publication

La publication exige une autorisation séparée. Avant envoi :

- associer l’artefact à un commit propre et aux journaux de validation ;
- signer le manifeste de release avec la clé privée conservée hors dépôt ;
- publier sur le service approuvé, sans changer DNS ou canal par défaut ;
- vérifier le téléchargement public, l’empreinte et la signature depuis un poste distinct ;
- conserver l’artefact précédent et la procédure de retour arrière.

Aucun installateur, certificat, manifeste signé ou service de publication n’a été modifié pendant cet audit.
