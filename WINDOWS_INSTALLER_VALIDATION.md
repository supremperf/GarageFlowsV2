---
doc-numbers: journal
---

# Validation de l’installateur Windows — MASTER 2

**Verdict : BLOQUÉ — aucun `GarageFlows-Setup.exe` produit ou inspecté ; aucun test Windows exécuté.**

## 1. Environnement constaté

- hôte Linux x64, pas Windows natif ;
- Wine et Wine64 absents ;
- moteur Prisma Linux absent et moteur Windows non généré ;
- binaire Electron local absent, téléchargement en échec ;
- dossier `dist/` absent ;
- `npm run verify:installer` sort 1 : construction non exécutée.

Le préflight statique réussit mais avertit explicitement que l’installation, le lancement et la désinstallation doivent être validés sur Windows. Il ne s’agit pas d’un feu vert Windows.

## 2. Contrat statique préservé

La configuration reste Windows x64/NSIS, installation par utilisateur, `oneClick: false`, `perMachine: false`, `asInvoker`, sans élévation, avec conservation des données à la désinstallation. Les tests statiques Windows et de chaîne de distribution sont inclus dans les 184 tests release-safety réussis.

Ces contrôles ne prouvent pas un Setup réel, sa signature, ses fuses ou son comportement sur un poste.

## 3. Contrôles non exécutés

- build Windows officiel et présence/charge du `query_engine-windows` ;
- génération NSIS et comparaison du contenu avec `win-unpacked` ;
- inspection PE, fuses Electron et absence de secrets/clés privées dans le paquet ;
- signature Authenticode, chaîne de confiance et horodatage ;
- installation sans élévation sur poste vierge, raccourcis et premier lancement ;
- création/migration de la base, health 200 et parcours CRUD ;
- activation d’une licence de test existante et compatibilité HWID V1 ;
- offline/reprise, photos, sauvegarde/restauration et mise à jour ;
- mise à niveau avec données de test, désinstallation et conservation des données ;
- réconciliation SBOM/notices avec le contenu réellement embarqué.

Aucun Setup factice n’a été créé et aucune réussite Windows n’est revendiquée.

## 4. Déblocage

Sur une machine/VM Windows x64 propre : restaurer les dépendances et moteurs officiels, exécuter toutes les suites, puis `npm run dist`. Inspecter l’EXE et `win-unpacked`, vérifier signature/fuses/secrets/notices, puis exécuter les parcours ci-dessus sur données de test. `npm run readiness:final` doit rester rouge tant qu’une de ces preuves manque.

Preuves : `04-prisma-environment.txt`, `10-playwright-browser-channels.txt`, `18-official-and-partial-build.txt`, `21-environment-access-inventory.txt`, `25-artifact-static-checks.txt`, `26-hwid-and-data-preservation.txt`, `33-final-node-release-safety.txt`.
