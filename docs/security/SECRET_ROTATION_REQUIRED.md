# SECRET_ROTATION_REQUIRED

Statut : **EXTERNAL_ACTION_REQUIRED** (nécessite un accès aux services de prod que
l'environnement d'audit n'a pas). Ce document N'AFFICHE AUCUNE valeur de secret —
uniquement l'inventaire, l'impact et la procédure.

## Contexte

D'anciens installateurs Windows ont pu embarquer un `.env` en clair dans
`resources/standalone/.env` (secrets de PRODUCTION). Le packaging actuel retire
désormais tout `.env` du standalone au post-build (`scripts/post-build.js`), donc
les NOUVEAUX installateurs ne fuitent plus. **Cela ne rend pas les secrets déjà
distribués sûrs** : tout secret ayant pu être livré doit être considéré COMPROMIS
et tourné par le propriétaire de l'infrastructure.

## Secrets à tourner (aucune valeur réelle ici)

| Secret (variable) | Service | Criticité | Consommateurs | Impact si compromis |
|---|---|---|---|---|
| `DATABASE_URL` (+ `DIRECT_URL`) | Neon (PostgreSQL) | CRITIQUE | serveur/PWA Next, migrations Prisma | Lecture/écriture totale de la base multi-tenant |
| `NEXTAUTH_SECRET` | NextAuth (PWA) | CRITIQUE | signature/chiffrement des sessions, vérif `gf_session` (HS256) | Forge de sessions (dont admin) → contournement d'auth |
| `GARAGEFLOW_API_KEY` | control-plane / intégrations | ÉLEVÉE | endpoints internes/admin selon usage | Accès API privilégié |
| `GF_PRIVATE_KEY` (si jamais présent hors control-plane) | signature licences ECDSA | CRITIQUE | émission de licences GF2 | Émission de licences/keys arbitraires |
| `GF_DB_MAC_SECRET` / `GF_INTERNAL_EXPORT_KEY` | intégrité DB / export interne | ÉLEVÉE | MAC d'enregistrements, export interne | Altération/contournement de contrôles d'intégrité |
| `UPSTASH_*` (REST URL/token) | Upstash (Redis) | MOYENNE | rate-limit distribué | Manipulation du rate-limit |
| SMTP (`SMTP_*`) | e-mail transactionnel | MOYENNE | notifications | Envoi d'e-mails au nom du garage |

> La liste exacte des variables fait foi dans `.env.example` /
> `garageflow-env-manifest.json` — s'y référer, sans jamais recopier de valeur.

## Ordre de rotation recommandé

1. `NEXTAUTH_SECRET` (invalide toutes les sessions — prévenir la reconnexion).
2. `DATABASE_URL` / `DIRECT_URL` (Neon : créer un nouveau rôle/mot de passe, basculer, révoquer l'ancien).
3. `GF_PRIVATE_KEY` (le cas échéant) + re-publication de la clé publique côté clients.
4. `GARAGEFLOW_API_KEY`, `GF_DB_MAC_SECRET`, `GF_INTERNAL_EXPORT_KEY`.
5. `UPSTASH_*`, `SMTP_*`.

## Procédure (par secret)

1. Générer une nouvelle valeur forte (`openssl rand -base64 32` pour les secrets symétriques).
2. La déposer dans le gestionnaire de secrets (Vercel/Neon/Upstash) — jamais dans Git.
3. Déclencher un redéploiement.
4. Vérifier le service (login, appel API, migration, rate-limit selon le secret).
5. Révoquer/supprimer l'ancienne valeur côté fournisseur.
6. Consigner date + opérateur (sans la valeur).

## Test post-rotation

- `NEXTAUTH_SECRET` : une ancienne session est refusée ; une nouvelle connexion réussit.
- `DATABASE_URL` : l'app lit/écrit ; l'ancien identifiant est refusé côté Neon.
- `GF_PRIVATE_KEY` : une licence émise avec l'ancienne clé est refusée ; une nouvelle est acceptée.
- `UPSTASH_*` : le rate-limit distribué répond avec les nouveaux identifiants.

## Ce qui a déjà été fait dans le dépôt (mitigation)

- `.env` retiré du standalone empaqueté au post-build (plus de fuite dans les nouveaux installateurs).
- Gitleaks en CI (working tree).
- Aucun secret réel n'est écrit dans ce document.
