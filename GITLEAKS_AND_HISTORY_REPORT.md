---
doc-numbers: journal
---

# MASTER 3 — Gitleaks, working tree et historique

**Verdict : BLOQUÉ — Gitleaks n’a été exécuté ni sur le working tree ni sur l’historique.**

## 1. Disponibilité de l’outil

| Canal | Résultat | Preuve |
|---|---|---|
| Binaire `gitleaks` | Absent | `27-gitleaks-execution-attempt.txt` |
| Go pour compiler la source officielle | Absent | même preuve |
| Docker/Podman | Absents | même preuve |
| Release GitHub officielle | Téléchargement précédent en EOF sur l’hôte d’assets ; aucun binaire validé | preuve MASTER 2 `34-final-static-security.txt`, rappelée dans `27-gitleaks-execution-attempt.txt` |
| Paquet NPM `gitleaks` | Version 1.0.0, autre dépôt, quatre fichiers texte et aucun binaire ; non utilisé | `19-gitleaks-npm-channel.txt` |

Le paquet NPM homonyme n’est pas l’outil officiel `gitleaks/gitleaks` attendu et n’a pas été exécuté comme tel.

## 2. Matrice de scan

| Périmètre | Commande Gitleaks | Statut |
|---|---|---|
| Working tree, chemins non suivis inclus | Non lancée, binaire absent | NON EXÉCUTÉ |
| Historique Git complet | Non lancée, binaire absent | NON EXÉCUTÉ |
| Revue des findings et preuve de rotation | Sans scan, non réalisable | BLOQUÉ |

Les scans ciblés MASTER 2 et les contrôles statiques ne sont pas renommés « Gitleaks » et ne couvrent pas l’historique. L’échec du job Gitleaks de la CI au commit exact (`03-ci-job-outcomes.txt`) ne fournit pas davantage un scan local vert ; ses logs ne sont pas téléchargeables (`10-ci-e2e-log-access.txt` concerne le canal de logs CI).

## 3. Clôture requise

Fournir le binaire officiel avec empreinte vérifiée ou un environnement capable de l’exécuter, puis lancer les deux scans sans exposer les valeurs trouvées. Tout finding réel exigera une revue et, selon le cas, une rotation autorisée ; l’historique ne doit pas être réécrit dans cette mission. En l’état, l’absence de finding n’est pas démontrée.
