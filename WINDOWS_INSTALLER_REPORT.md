---
doc-numbers: journal
---

# MASTER 3 — Rapport de l’installateur Windows

**Verdict : BLOQUÉ — aucun `GarageFlows-Setup.exe` MASTER 3 n’a été produit.**

## 1. Chaîne officielle exécutée

| Phase | Commande | Code | Mesure | Preuve |
|---|---|---:|---|---|
| Préflight | `npm run preflight:release` | 0 | Cible Windows x64/NSIS reconnue ; avertissement de validation Windows finale | `23-windows-build-attempt.txt` |
| Distribution | `npm run dist` | 1 | Arrêt dans `npm run build`, au téléchargement Prisma | même preuve |
| Vérification | `npm run verify:installer` | 1 | Aucun dossier `dist/` | même preuve |

Le préflight vert ne signifie pas que l’installateur est construit. Electron n’est pas présent dans `node_modules/electron/dist`, Wine est absent et le build/standalone est rouge.

## 2. Artefacts et provenance

- `release/GarageFlows-Setup.exe` : absent.
- `dist/GarageFlows-Setup.exe` : absent.
- Aucun exécutable factice, renommé ou partiel n’a été créé.
- Des artefacts CI existent sur d’autres commits, mais leur téléchargement échoue et ils ne représentent pas le working tree MASTER 3 (`04-other-ci-artifact-discovery.txt`, `06-ci-candidate-provenance.txt`). Ils ne sont donc ni livrés ni inspectés comme produit final.

## 3. Contrôles non atteints

L’inspection NSIS, les moteurs Prisma Windows, le contenu unpack, les fuses, la SBOM du paquet, la signature et le manifeste de l’installateur ne sont pas validés. Il faut d’abord obtenir les moteurs officiels, réussir le build/standalone, produire le vrai paquet puis exécuter toute la chaîne de vérification sur ce fichier précis.
