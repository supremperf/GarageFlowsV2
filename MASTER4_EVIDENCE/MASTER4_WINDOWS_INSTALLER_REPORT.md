---
doc-numbers: journal
---

# MASTER 4 — Installeur Windows NSIS

**Date : 22 octobre 2026 (Europe/Paris).**  
**Statut global : BLOCKED — aucun installeur produit et aucun Windows de test disponible.**

| Contrôle | Résultat | Statut | Preuve |
|---|---|---|---|
| Commande de distribution | `npm run dist:win` → code 1 dans `npm run build`, avant Electron Builder | FAIL | `logs/08-windows-nsis-attempt.txt` |
| Artefacts | `GarageFlows-Setup.exe`, `win-unpacked`, métadonnées de release absents | BLOCKED | même preuve |
| Version | GarageFlows 1.1.0, Electron 44.9.3, Builder 26.15.3 | PASS de configuration | même preuve |
| Architecture | NSIS Windows x64 ; hôte Linux x86_64 | PASS de configuration, binaire non vérifié | même preuve |
| Droits | `asInvoker`, installation par utilisateur, `allowElevation=false` | PASS de configuration | même preuve |
| Installation | Répertoire imposé par la configuration ; raccourcis Bureau et menu Démarrer | Non exécuté | NOT RUN |
| Persistance | `deleteAppDataOnUninstall=false` ; conservation configurée | Exécution réelle absente | NOT RUN |
| Mise à jour | Aucune référence `autoUpdater`, `publish` ou flux de mise à jour dans les chemins desktop inspectés | Mécanisme automatique non démontré | BLOCKED | `logs/08a-windows-update-inspection.txt` |
| Désinstallation | Configuration inspectée seulement | Aucun Windows/Wine | NOT RUN |
| Signature | Aucun EXE à inspecter | NOT RUN | — |

Le copyright et le nom de produit sont repris de la configuration existante, sans inventer de titulaire ou de licence. La construction multiplateforme ne remplacerait de toute façon pas les tests Windows obligatoires. Action restante : rétablir le build et les moteurs Windows officiels, produire NSIS, vérifier son architecture/signature et son contenu, puis exécuter installation, lancement, migrations, persistance, mise à jour applicable et désinstallation sur un Windows isolé.
