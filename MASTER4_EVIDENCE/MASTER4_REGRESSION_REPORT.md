---
doc-numbers: journal
---

# MASTER 4 — Non-régression et préservation

**Date : 22 octobre 2026 (Europe/Paris).**  
**Verdict : PASS pour les contrôles exécutés ; il ne remplace pas les contrôles production bloqués.**

| Contrôle | Résultat | Statut | Preuve datée |
|---|---|---|---|
| Tests Node complets | 524/524, 0 skip, code 0 | PASS | `logs/35-final-license-and-node-regression.txt` |
| Release-safety | 193/193, 0 skip | PASS | `logs/29-performance-direct-guard-correction.txt` |
| Audit de sécurité Node | 23/23 | PASS | `logs/27-non-regression-node-audit-integrity.txt` |
| SBOM/notices | 11/11 tests ; 133/133 vérifiés | PASS | `logs/35-final-license-and-node-regression.txt` |
| ESLint et audit npm | Code 0 ; 0 vulnérabilité | PASS | `logs/06-eslint-config-next-alignment.txt` et gate `logs/30-release-gate-final.txt` |
| Fichiers critiques/HWID/licences/clés | Contrôles verts ; `git diff` vide | PASS | `logs/27-non-regression-node-audit-integrity.txt` |
| Base utilisateur | SHA-256 identique à l’initial : `2434c43f…c757` | PASS | même preuve |
| `.env` | Mode 600 et 28 573 octets, identiques à l’inventaire initial ; aucune valeur journalisée | PASS | même preuve |
| Preuves MASTER 3 | 57/57 empreintes OK après correction du répertoire de commande | PASS | `logs/28-prior-evidence-integrity-corrected.txt` |
| Preuves MASTER 2 | 41/41 empreintes OK | PASS | même preuve |
| Vitest | Comptes identiques au point de départ : 3 517/3/869 ; aucune dissimulation | FAIL maintenu | `logs/20-vitest-full-final.txt` |

Les corrections MASTER 4 sont limitées à l’alignement `eslint-config-next`, la SBOM/notices, la création non destructive des bases de contrôle PostgreSQL et le garde performance direct. Aucun schéma HWID, secret, seuil de test, moteur factice ou artefact n’a été altéré.

Deux erreurs d’invocation de vérification sont conservées : mauvais nom de script performance et manifestes SHA lancés depuis la racine. Elles ont été corrigées par les commandes réelles des journaux 26/28/29 ; aucune ancienne preuve n’a été modifiée.
