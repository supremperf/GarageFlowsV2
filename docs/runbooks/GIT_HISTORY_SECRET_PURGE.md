<!-- doc-status: actif -->

# Runbook — purge des secrets de l'historique git (AUD-005)

> ⚠ **Opération DESTRUCTIVE et contrôlée.** Réécrire l'historique change tous
> les SHA et invalide chaque clone/fork/PR ouverte. **Ne PAS exécuter
> automatiquement.** Ce runbook est une procédure à dérouler par le
> propriétaire du dépôt, en pleine conscience. L'audit ne l'a **pas** exécutée
> (contrainte : aucune modification destructive non autorisée).

## Principe

La rotation (AUD-006) est le contrôle **effectif** : un secret roté ne vaut
plus rien même s'il reste lisible dans l'historique. La purge est un
**complément d'hygiène** — à faire APRÈS rotation, jamais à sa place.

## Procédure

### 1. Identification (déjà faite)
Secrets historiques recensés : `scripts/compromised-secrets.json` (empreintes
SHA-256, jamais de valeurs) ; sources dans `docs/security/SECRET_ROTATION_REGISTER.md`.

### 2. Rotation PRÉALABLE (obligatoire)
Roter chaque secret concerné (AUD-006) et prouver via `npm run verify:rotation`
→ **OK**. Sans cette étape, la purge ne réduit pas le risque (le secret peut
avoir déjà été copié).

### 3. Sauvegarde
```bash
git clone --mirror <url> backup-pre-purge.git   # sauvegarde complète du dépôt
```

### 4. Purge avec git-filter-repo (recommandé plutôt que filter-branch)
```bash
pip install git-filter-repo
# Retirer des chemins de fichiers ayant contenu des secrets :
git filter-repo --path keys/server_config.json --path keys/licenses_db.json --invert-paths
# (côté vitrine) :
git filter-repo --path .env.local --invert-paths
# Ou remplacer des valeurs précises (fichier de règles, valeurs masquées) :
# git filter-repo --replace-text purge-rules.txt
```

### 5. Force push CONTRÔLÉ
```bash
git push origin --force --all
git push origin --force --tags
```
Coordonner avec toute l'équipe : prévenir AVANT, fenêtre planifiée.

### 6. Invalidation des clones
Tous les clones/forks existants sont désormais divergents : chacun doit
**re-cloner** (un `git pull` sur un ancien clone réintroduit l'historique).

### 7. Re-clone & vérification post-purge
```bash
git clone <url> fresh && cd fresh
gitleaks git . --config .gitleaks.toml --redact --no-banner   # attendu : 0 fuite historique
```

### 8. Suites & PR
Rouvrir/rebaser les PR en cours sur le nouvel historique ; invalider les
caches CI qui référenceraient d'anciens SHA.

## Décision

Cette purge relève du **propriétaire du dépôt**. Recommandation : la planifier
**après** la cession (l'acquéreur peut préférer conserver l'historique pour
l'audit, la rotation ayant neutralisé le risque). Statut : `EXTERNAL_ACTION_REQUIRED`.
