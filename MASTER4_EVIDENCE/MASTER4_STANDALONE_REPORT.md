---
doc-numbers: journal
---

# MASTER 4 — Standalone Next.js

**Date : 22 octobre 2026 (Europe/Paris).**  
**Statut global : BLOCKED — aucun artefact standalone démarrable.**

| Contrôle | Commande | Résultat | Statut | Preuve |
|---|---|---|---|---|
| Structure standalone | `npm run verify:standalone` | Code 1 ; `.next/standalone` absent | FAIL | `logs/07-build-typecheck-standalone.txt` |
| Serveur | Inventaire de `.next/standalone/server.js` | Absent | BLOCKED | même preuve |
| Ressources statiques | Inventaire de `.next/static` | Dossier présent, mais sans build frais/`BUILD_ID` | FAIL | même preuve |
| Démarrage du serveur | Non lancé | Aucun serveur à démarrer | NOT RUN | — |
| Pages publiques/privées/erreurs/routes de santé | Non lancé | Aucun runtime standalone | NOT RUN | — |

Le standalone n’est pas substitué par le serveur de développement ou par un serveur HTTPS créé uniquement pour ce rapport. Après restauration du build, il faudra copier les ressources statiques et publiques selon le contrat Next, fournir une configuration de test sans journaliser les secrets, démarrer le vrai serveur sur `0.0.0.0`, vérifier ses écoutes et rejouer les requêtes HTTP réelles. L’inventaire de l’exécution courante ne liste aucun serveur Next actif ni port 3000 (`logs/05-playwright-chromium-diagnostic.txt`).
