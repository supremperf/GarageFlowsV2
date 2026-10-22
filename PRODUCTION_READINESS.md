---
doc-numbers: journal
---

# Préparation à la production — décision et portes de sortie

**Verdict au 22 octobre 2026 : NON PRÊT POUR LA PRODUCTION.**

Cette décision concerne l’état mesuré de la base `150654535ca0b3b417e96be057ba674a119c512f` avec les corrections locales non commitées. Elle ne constitue pas un jugement définitif sur le code : les portes ci-dessous définissent exactement ce qu’il faut rejouer.

## 1. Matrice de décision

| Domaine | État | Preuve disponible | Décision release |
|---|---|---|---|
| TypeScript / ESLint | ✅ | exécution après corrections | favorable, à rejouer en CI |
| audit NPM | ✅ | 0 vulnérabilité au jour du contrôle | favorable, instantané seulement |
| tests hors infrastructure DB | ✅ | 3 561 réussites Vitest et autres suites | favorable dans le périmètre exécuté |
| suite complète | ❌ | 80 fichiers en échec d’infrastructure | bloquant de validation |
| build officiel | ❌ | échec de téléchargement Prisma avant Next | bloquant |
| compilation Next isolée | ⚠️ | réussie avec clients `noEngine` | preuve partielle, non substitutive |
| standalone | ⚠️ | structure et secrets contrôlés ; DB 503 | non livrable en l’état |
| SQLite/PostgreSQL Prisma | ⏸️ | aucun moteur natif/connexion valide | bloquant |
| isolation multi-tenant DB | ⏸️ | scénario réel interrompu par client `noEngine` | à valider |
| E2E navigateur | ⏸️ | 144 tests listés, 0 exécuté | à valider |
| notices tierces | ❌ | inventaires non réconciliés | bloquant avant distribution |
| Windows/NSIS/fuses/signature | ⏸️ | aucun artefact final | bloquant pour desktop |
| services externes | ⏸️ | aucune connexion staging | bloquant pour les fonctions concernées |
| configuration production | ⏸️ | aucune modification effectuée | validation manuelle requise |

## 2. Pourquoi la structure standalone ne suffit pas

Le post-build confirme la présence de fichiers, assets, schéma, template et clé publique. Le scan confirme l’absence des valeurs traquées et des clés privées détectables par l’outil. Après correction, `verify:standalone` refuse l’artefact courant. En revanche, les points suivants restent à résoudre :

- aucun moteur Prisma natif n’est présent dans les emplacements inspectés ;
- `/api/health` répond 503 ;
- le client `noEngine` est destiné à un autre mode d’accès et ne valide pas SQLite local ;
- les fuses Electron et le contenu NSIS ne sont contrôlables qu’après packaging.

La release doit donc être produite depuis une chaîne officielle complète, sans transposer le contournement de compilation utilisé pour l’audit.

## 3. Portes obligatoires

### Gate A — chaîne de build reproductible

- [ ] hôte propre, Node/npm dans les versions du manifeste ;
- [ ] `npm ci` terminé avec scripts Prisma officiels ;
- [ ] `npm run build` réussi sans variable de contournement `noEngine` ;
- [ ] moteurs natifs correspondant à la cible présents et chargés ;
- [ ] version/release manifest rattachée à un commit propre, pas à un état `dirty`.

### Gate B — données et migrations

- [ ] sauvegarde des environnements et restauration testée sur copie ;
- [ ] migrations PostgreSQL vérifiées puis appliquées sans reset ni réalignement arbitraire ;
- [ ] migrations SQLite desktop testées sur une copie de base existante ;
- [ ] scénario d’isolation deux garages exécuté ;
- [ ] health DB et parcours CRUD/sync/backup réellement exécutés.

### Gate C — sécurité et conformité

- [ ] Gitleaks ou équivalent exécuté sur working tree et historique selon la politique ;
- [ ] audit NPM et supply-chain rejoués sur le lockfile de release ;
- [ ] secrets produits dans un coffre, jamais dans les journaux ;
- [ ] notices tierces régénérées/réconciliées avec le paquet distribué ;
- [ ] textes LGPL/CC-BY et autres attributions revus pour l’artefact concerné ;
- [ ] revue des en-têtes, authentification et autorisations sur staging.

### Gate D — Windows autonome

- [ ] `dist/GarageFlows-Setup.exe` produit sur Windows x64 ;
- [ ] `dist/win-unpacked` et l’intérieur NSIS inspectés ;
- [ ] fuses Electron vérifiés sur le binaire final ;
- [ ] signature Authenticode vérifiée avec la chaîne de confiance et l’horodatage retenus ;
- [ ] installation sans élévation conforme à la configuration NSIS ;
- [ ] poste vierge + mise à niveau avec données de test existantes ;
- [ ] désinstallation sans suppression des données utilisateur (`deleteAppDataOnUninstall: false`) ;
- [ ] activation, HWID V1, offline, mises à jour et restauration validés.

### Gate E — parcours métier et externes

- [ ] 144 tests Playwright exécutés sur les cibles retenues ;
- [ ] PostgreSQL et Redis validés sur staging ;
- [ ] SMTP : envoi et réception réels ;
- [ ] portail : inscription, 2FA, devis, signature, tickets ;
- [ ] mécanicien : planning, photos, timer, synchronisation aller/retour ;
- [ ] facturation électronique : sandbox fournisseur et webhooks ;
- [ ] mise à jour : manifeste signé, téléchargement, refus d’un artefact invalide ;
- [ ] PWA : installation, offline, reprise et cache sur appareils réels.

## 4. Déploiement progressif proposé après validation

1. geler un commit relu et produire les artefacts depuis ce commit ;
2. déployer en staging avec secrets et services de staging ;
3. appliquer les migrations selon une procédure sauvegardée et réversible au niveau applicatif ;
4. exécuter smoke, health DB, authentification et parcours critiques ;
5. déployer à un groupe pilote limité ;
6. surveiller erreurs, synchronisation, licences et latence ;
7. conserver l’artefact précédent et une procédure de retour arrière qui ne supprime pas les données ;
8. élargir seulement après revue des résultats.

Aucune étape de déploiement production n’a été exécutée pendant cet audit.

## 5. Critères de changement de verdict

Un verdict « PRÊT SOUS CONDITIONS » ne pourra être envisagé que lorsque les portes A à D seront validées et que les éventuelles conditions restantes seront limitées à des environnements/fonctions explicitement exclus de la première livraison. Le verdict « PRÊT POUR LA PRODUCTION » exige la validation des fonctions incluses dans le périmètre de release et l’absence de porte ouverte non acceptée formellement.

À ce stade, les conditions portent encore sur le build, les données, le paquet et la conformité : le verdict reste **NON PRÊT POUR LA PRODUCTION**.
