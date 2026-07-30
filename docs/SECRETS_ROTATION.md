# Rotation des secrets — GarageFlow (client desktop / Next.js)

Ce document liste les secrets qui ont été exposés dans le dépôt (ou son
historique git) et **doivent être rotés**. Retirer un secret d'un fichier ne le
retire PAS de l'historique git : considérez toute valeur ayant figuré dans le
dépôt comme **compromise**.

## Secrets exposés à révoquer / régénérer

| Secret | Où il était exposé | Action |
|---|---|---|
| `GARAGEFLOW_API_KEY` = `3jvKZFYUKLjGTI/…7+I=` | `.env.example` (l.31) **et** `keys/server_config.json` (suivi git) | **Régénérer** (`openssl rand -hex 32`) côté serveur de licences **et** dans le Keygen. L'ancienne valeur est dans l'historique git. |
| `NEXTAUTH_SECRET` = `3jvKZFYUKLjGTI/…7+I=` | `.env.example` (l.16) | **Régénérer** (`openssl rand -base64 32`). Même valeur que l'API key ci-dessus (réemploi dangereux) → les deux doivent devenir **distinctes**. |
| Anciens replis codés en dur (`gf-electron-local-secret-2026-xK9mP3qR`, `fallback-*-secret-change-in-production`) | `middleware.ts`, `api-helpers.ts`, `portal-secret.ts`, `license/{activate,status}` | **Supprimés du code** (plus aucun repli). Tout déploiement ayant démarré sans `NEXTAUTH_SECRET` utilisait ces valeurs → **régénérer `NEXTAUTH_SECRET`**. |
| Token de licence de test | `keys/licenses_db.json` (suivi git) | Fichier **retiré du suivi git** (`keys/*.json` ignoré). Révoquer la licence de test `59eaa25b-…` si elle a une valeur. |

## Ce qui a été corrigé dans le code

- `.env.example` : toutes les valeurs sensibles remplacées par des placeholders
  vides (`NEXTAUTH_SECRET=`, `GARAGEFLOW_API_KEY=`).
- `keys/*.json` (`server_config.json`, `licenses_db.json`) retirés du suivi git
  et ajoutés au `.gitignore`.
- Suppression de **tous** les secrets de repli codés en dur → lecture centralisée
  `src/lib/auth-secret.ts` (lève si absent/faible, aucune valeur en dur).
- `scripts/setup-dev.js` génère un `NEXTAUTH_SECRET` **aléatoire par installation**
  (`crypto.randomBytes(32)`), sans jamais écraser une valeur forte existante.
- Validation d'environnement + refus de démarrage en production
  (`src/lib/env.ts` + `src/instrumentation.ts`).
- Analyse de secrets Gitleaks ajoutée à la CI (`.gitleaks.toml`).
- Journalisation d'identifiants supprimée de `src/lib/auth.ts` (mot de passe / hash).

## Procédure de rotation (production)

1. Générer les nouvelles valeurs :
   ```sh
   openssl rand -base64 32   # NEXTAUTH_SECRET
   openssl rand -hex 32      # GARAGEFLOW_API_KEY (distincte)
   ```
2. Les définir dans les variables d'environnement de l'hôte (jamais dans le dépôt).
3. Côté serveur de licences (garagesite3) : mettre à jour `LICENSE_ADMIN_API_KEY` /
   `GARAGEFLOW_API_KEY` correspondants, puis invalider les sessions en cours.
4. Purger l'historique git des secrets si le dépôt doit être rendu public
   (`git filter-repo` / BFG) — sinon, considérer les anciennes valeurs comme
   définitivement révoquées côté serveur.
