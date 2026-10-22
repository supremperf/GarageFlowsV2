---
doc-numbers: journal
---

# MASTER 3 — Test réel d’installation Windows

**Verdict : NON EXÉCUTÉ — installateur absent et aucun hôte Windows/Wine disponible.**

## 1. Prérequis constatés

| Prérequis | État | Preuve |
|---|---|---|
| `GarageFlows-Setup.exe` | Absent | `23-windows-build-attempt.txt` |
| Hôte Windows | Non fourni ; hôte d’exécution Linux x64 | `01-prisma-network-recheck.txt` |
| Wine | Absent | `13-system-browser-and-gitleaks-tools.txt`, `23-windows-build-attempt.txt` |
| Build/standalone | Échec/absent | `22-official-build-and-standalone.txt` |

## 2. Matrice de validation

| Scénario Windows | Statut |
|---|---|
| Installation sur poste isolé | NON EXÉCUTÉ |
| Premier lancement et création contrôlée des données | NON EXÉCUTÉ |
| Persistance après fermeture/redémarrage | NON EXÉCUTÉ |
| Conservation de la licence et du HWID V1 | NON EXÉCUTÉ |
| Fonctionnement hors ligne | NON EXÉCUTÉ |
| Mise à niveau avec conservation des données | NON EXÉCUTÉ |
| Sauvegarde/restauration réelle | NON EXÉCUTÉ |
| Désinstallation selon la politique produit | NON EXÉCUTÉ |
| Signature et réputation du binaire | NON EXÉCUTÉ |

Aucun de ces contrôles n’est déduit d’un test Linux, d’un artefact CI d’un autre commit ou d’un préflight vert. Aucune donnée, licence ou installation existante n’a été modifiée.

La clôture exige un vrai Setup.exe traçable, un poste Windows de test isolé et des preuves horodatées pour chaque ligne de la matrice. En l’état, cette phase bloque la production.
