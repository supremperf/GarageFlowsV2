# Rotation des secrets — GarageFlow (client desktop / Next.js)

Ce document liste les secrets qui ont été exposés dans le dépôt (ou son
historique git) et **doivent être rotés**. Retirer un secret d'un fichier ne le
retire PAS de l'historique git : considérez toute valeur ayant figuré dans le
dépôt comme **compromise**.

> ⚠️ **Aucune valeur secrète en clair (ni partielle) ne doit figurer dans ce
> fichier.** Les secrets exposés sont identifiés par une **empreinte SHA-256**
> non réversible, jamais par leur valeur.

## Publication des credentials de test — commit `290d290`

Le fichier `.env.storage.local` a été publié dans le dépôt public sur demande
explicite. Il est désormais retiré du suivi, **mais reste dans l’historique**.
Les empreintes complètes figurent dans `scripts/compromised-secrets.json` ; ne
jamais recopier ici les valeurs, même partiellement.

À révoquer chez les fournisseurs : mot de passe du rôle Neon, tokens Redis
REST écriture **et lecture seule**, token Vercel Blob. Vérifier les sessions,
logs et accès historiques avec les outils des fournisseurs. Après rotation,
`node config` accepte les nouvelles valeurs dans le terminal masqué ; les
anciennes sont bloquées par défaut avant les sondes du nouveau gestionnaire.
Le dépannage Blob temporaire, limité et explicitement confirmé est documenté
dans `docs/CONFIG.md` ; il ne constitue jamais une preuve de rotation/révocation. Une analyse
Git de l’arbre courant ne certifie jamais l’effacement des anciennes versions.

## 1. Secrets exposés à révoquer / régénérer

| Secret | Empreinte (SHA-256, tronquée) | Où il était exposé | Action |
|---|---|---|---|
| `GARAGEFLOW_API_KEY` **=** `NEXTAUTH_SECRET` (même valeur réutilisée — 44 car.) | `59ca3f01…` | **Historique git** : anciennes versions de `.env.example` (`NEXTAUTH_SECRET=`) **et** `keys/server_config.json` (`api_key`). Présent dans des commits **ancêtres de `main`** (donc publiés). | **Rotation obligatoire** (voir §3) côté serveur de licences **et** Keygen. Les deux valeurs doivent devenir **distinctes**. |
| Anciens replis codés en dur (`gf-electron-local-secret-*`, `fallback-*-secret-change-in-production`) | — | `middleware.ts`, `api-helpers.ts`, `portal-secret.ts`, `license/{activate,status}` (historique) | **Supprimés du code** (plus aucun repli). Tout déploiement ayant démarré sans `NEXTAUTH_SECRET` utilisait ces valeurs → **régénérer `NEXTAUTH_SECRET`**. |
| Token de licence de test | — | `keys/licenses_db.json` (anciennement suivi git) | Fichier **retiré du suivi** (`keys/*.json` ignoré). Révoquer la licence de test si elle a une valeur réelle. |

**Vérification** : après rotation, la commande suivante doit renvoyer une
empreinte **différente** de `59ca3f01…` :

```sh
# n'affiche que l'empreinte, jamais la valeur
printf '%s' "$GARAGEFLOW_API_KEY" | sha256sum | cut -c1-8
```

**Preuve automatisée (recommandée)** — exécuter dans l'environnement de
production (variables réelles chargées) pour produire l'ARTEFACT DE PREUVE :

```sh
npm run verify:rotation            # échoue (exit 1) si un secret ACTUEL == valeur compromise
npm run verify:rotation -- --require-all   # exige en plus que tous les secrets listés soient présents (exit 2 sinon)
```

L'outil (`scripts/verify-rotation.mjs`, manifeste `scripts/compromised-secrets.json`)
compare l'empreinte SHA-256 du secret **actuel** aux empreintes des valeurs
**compromises** ; il n'affiche jamais de valeur. Un `exit 0` avec tous les
secrets présents constitue une preuve cryptographique que plus aucun secret de
production n'est égal à une valeur exposée dans l'historique. Le propriétaire
peut compléter le manifeste avec les empreintes 64-hex complètes (calculées
depuis l'historique) pour une précision maximale. Mécanique prouvée par
`src/lib/__tests__/verify-rotation.test.ts`.

## 2. Ce qui a déjà été corrigé dans le code (tip de la branche)

- `docs/SECRETS_ROTATION.md` (ce fichier) : la représentation partielle de la
  clé (préfixe/suffixe) a été **retirée** et remplacée par l'empreinte SHA-256.
- `.env.example` : toutes les valeurs sensibles sont des **placeholders** (aucune
  valeur réelle au tip).
- `keys/*.json` (`server_config.json`, `licenses_db.json`) retirés du suivi git
  et couverts par `.gitignore` (+ `*.pem`/`*.key`/`*.pfx`/`*.p12` défensifs).
- Suppression de **tous** les replis codés en dur → lecture centralisée
  `src/lib/auth-secret.ts` (lève si absent/faible ; aucun repli).
- `scripts/setup-dev.js` génère un `NEXTAUTH_SECRET` **aléatoire par installation**.
- Validation d'environnement + refus de démarrage en production (`src/lib/env.ts`
  + `src/instrumentation.ts`), analyse Gitleaks en CI (`.gitleaks.toml`).

> **Important** : ces corrections retirent le secret du **tip** de la branche, mais
> **pas de l'historique**. Tant que la rotation (§3) et la purge (§4) ne sont pas
> faites, la valeur `59ca3f01…` reste récupérable dans les commits publiés.

## 3. Rotation (À FAIRE EN PREMIER — rend la valeur fuitée inutile)

La rotation est le vrai correctif : une fois la clé changée côté production, la
valeur présente dans l'historique n'a plus aucune valeur d'usage.

1. **`GARAGEFLOW_API_KEY`** — rotation transactionnelle via l'outil (Vercel + `.env`
   local + `keys/server_config.json` + test de l'endpoint **après** déploiement) :
   ```
   npm run env:configure   # → option « 4. Faire tourner uniquement GARAGEFLOW_API_KEY »
   ```
   L'outil génère une nouvelle clé CSPRNG, met à jour les 3 emplacements, déploie
   et teste ; en cas d'échec, il restaure l'ancienne valeur partout.
2. **`NEXTAUTH_SECRET`** — générer une valeur **distincte** et la définir dans les
   variables d'environnement de l'hôte (jamais dans le dépôt) :
   ```sh
   openssl rand -base64 32
   ```
   ⚠️ Faire tourner `NEXTAUTH_SECRET` **invalide les sessions** et peut rendre
   illisibles des données dérivées (voir `docs/ROTATION_SECRETS.md`, section
   « secrets à ne jamais faire tourner à l'aveugle »). Le faire en connaissance
   de cause.
3. Côté serveur de licences (**garagesite3**) : mettre à jour
   `LICENSE_ADMIN_API_KEY` / `GARAGEFLOW_API_KEY` correspondants, puis invalider
   les sessions/jetons en cours.

## 4. Purge de l'historique git (APRÈS rotation — action du propriétaire du dépôt)

> 🚨 **Opération destructrice sur l'historique partagé.** Elle **réécrit `main`**
> et **toutes** les branches, impose un `--force` sur des refs publiées et casse
> tous les clones existants. Elle **n'a pas été exécutée automatiquement** :
> c'est une décision du propriétaire du dépôt, à faire en fenêtre de maintenance,
> **après** avoir vérifié la rotation (§3) et pris une sauvegarde miroir.

Prérequis : `git filter-repo` installé (`pip install git-filter-repo`).

```sh
# 0) Sauvegarde miroir AVANT toute réécriture
git clone --mirror <url-du-depot> depot-backup.git

# 1) Fichier de remplacement, créé LOCALEMENT (ne pas committer) :
#    remplace la valeur fuitée par un marqueur. Récupérer la valeur depuis un
#    ancien blob, sans l'afficher :
git show 0f519f04:keys/server_config.json | \
  python3 -c "import sys,json; print(json.load(sys.stdin)['api_key']+'==>***RETIRÉ***')" > expr.txt

# 2) Réécrire TOUT l'historique : retirer la valeur ET les fichiers de secrets
git filter-repo --replace-text expr.txt \
  --path keys/server_config.json --path keys/licenses_db.json --invert-paths

# 3) Nettoyer le fichier de remplacement
shred -u expr.txt   # ou: rm -f expr.txt

# 4) Republier toutes les refs réécrites (COORDONNER avec l'équipe)
git push --force --all
git push --force --tags
```

Après la purge :

- Demander à **chaque** collaborateur de **re-cloner** (les anciens clones
  contiennent encore le secret).
- Fermer puis rouvrir les **pull requests** ouvertes (elles épinglent d'anciens
  SHA).
- Contacter le **support GitHub** pour purger les vues mises en cache des anciens
  commits.
- Confirmer que **plus aucune** ref ne contient l'empreinte :
  ```sh
  git rev-list --all | while read c; do git grep -l 59ca3f01 "$c" 2>/dev/null; done
  ```
  (ne doit rien renvoyer ; adapter à un motif issu de la valeur, pas de l'empreinte)

## 5. Statut

- [x] Valeur partielle retirée du **tip** de la branche (ce fichier).
- [ ] **Rotation** `GARAGEFLOW_API_KEY` (§3.1) — *action infra, non réalisable hors production*.
- [ ] **Rotation** `NEXTAUTH_SECRET` distincte (§3.2).
- [ ] **Purge** de l'historique (§4) — *action du propriétaire du dépôt sur `main`*.
