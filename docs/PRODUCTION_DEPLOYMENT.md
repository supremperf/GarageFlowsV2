# Déploiement en production

> **Runbook** — décrit la procédure. L'**état de préparation** faisant autorité
> est dans la source canonique **[FINAL_VERIFICATION_BASELINE.md](./audit/FINAL_VERIFICATION_BASELINE.md)**
> (résumé : [PRODUCTION-READINESS.md](./PRODUCTION-READINESS.md)). Ne pas déployer
> tant que les conditions externes ne sont pas levées.

Deux produits distincts sortent de ce dépôt :

1. **Application Electron desktop (mono-poste)** — SQLite locale, serveur Next
   limité à 127.0.0.1. C'est le produit principal.
2. **Serveur / PWA multi-instance** (app.garageflows.fr sur Vercel) —
   PostgreSQL + Upstash Redis OBLIGATOIRES.

Le control plane des licences (api.garageflows.fr) est le dépôt `garagesite3`
et a sa propre documentation.

## 1. Desktop Electron

Rien ne change pour l'atelier : build `npm run dist`, installateur Windows.
La base est créée depuis le template commité ; les migrations locales
(`src/lib/migrations.ts`) s'appliquent au démarrage. Pour pointer le client
vers le control plane, packager avec `GF_LICENSE_SERVER=https://api.garageflows.fr`.

## 2. Serveur / PWA (Vercel)

### Variables d'environnement REQUISES

| Variable | Rôle | Sans elle |
|---|---|---|
| `DATABASE_URL` | PostgreSQL **poolé** (jamais `file:`) | démarrage refusé |
| `DIRECT_URL` | PostgreSQL direct (migrations) | migrations impossibles |
| `NEXTAUTH_SECRET` | signature sessions (≥ 32 aléatoires) | démarrage refusé |
| `NEXTAUTH_URL` | URL publique | flux NextAuth dégradés |
| `DEVICE_TOKEN_PEPPER` | HMAC des jetons/HWID d'appareils | démarrage refusé |
| `UPSTASH_REDIS_REST_URL` | rate limiting distribué | démarrage refusé |
| `UPSTASH_REDIS_REST_TOKEN` | idem | démarrage refusé |

Optionnelles : `RATE_LIMIT_*` (politiques), `GF_PORTAL_SECRET`,
`ANTHROPIC_API_KEY`, `TRUST_PROXY_HEADERS` (hors Vercel).
Générer chaque secret : `openssl rand -base64 32`. Aucun secret par défaut
n'existe dans le code — un secret absent/faible bloque le démarrage
(`src/lib/env.ts`, exécuté par `src/instrumentation.ts`).

### Configuration PostgreSQL

- Fournisseur managé (Neon, Supabase, RDS…). `DATABASE_URL` = URL poolée
  (suffixe `-pooler` chez Neon) ; `DIRECT_URL` = même base SANS pooler.
- TLS requis (`sslmode=require` selon le fournisseur).

### Configuration Redis (Upstash)

- Créer une base Upstash Redis (REST). Copier URL + token REST.
- Le rate limiting utilise un script Lua atomique (INCR+PEXPIRE+PTTL) : le
  compteur est partagé entre TOUTES les instances.
- **Politique d'indisponibilité (fail-closed)** : si Redis est absent ou en
  panne en production, les routes sensibles (connexion, activation/statut de
  licence, admin) répondent **503** avec `Retry-After` — il n'existe AUCUN
  repli mémoire silencieux en production. Les routes générales authentifiées
  restent servies (fail-open explicite, journalisé). En dev/test et sous
  Electron (mono-processus), un backend mémoire local est utilisé et documenté
  comme tel.

### Déploiement initial

```bash
# 1. Base vide → migrations + vérification complète (échoue si quoi que ce soit cloche)
DATABASE_URL=$DIRECT_URL DIRECT_URL=$DIRECT_URL npm run db:server:check

# 2. Déploiement Vercel (build = generate desktop + serveur + next build)
vercel deploy --prod
```

À chaque évolution de schéma :

```bash
DATABASE_URL=$DIRECT_URL DIRECT_URL=$DIRECT_URL npm run db:server:deploy
```

`prisma migrate deploy` n'applique que les migrations manquantes déjà **inscrites
dans l'historique**. ⚠️ **Important** : si des migrations sont enregistrées mais
**absentes** de la base (drift), `migrate deploy` les **saute** — le schéma reste
désaligné (cause du HTTP 500 observé le 2026-08-05). Dans ce cas, appliquer le
**DDL idempotent** documenté (`prisma db execute`, `ADD COLUMN/CREATE TABLE/INDEX
IF NOT EXISTS`) **puis** réaligner `_prisma_migrations`. Voir
`POST_ROTATION_RECOVERY.md §7` et `PRODUCTION-READINESS.md` (bloqueur B2). Une
convergence DDL manuelle **peut donc être nécessaire** — contrairement à ce que
laissait entendre l'ancienne rédaction.

### Rollback

1. **Code** : redéployer le build précédent (Vercel « Rollback »). Les
   migrations déjà appliquées restent compatibles (elles sont additives).
2. **Migration défaillante** :
   ```bash
   npx prisma migrate resolve --rolled-back <nom_migration> --schema prisma/server/schema.prisma
   ```
   puis corriger la migration et re-déployer. Ne JAMAIS éditer une migration
   déjà appliquée en production.
3. **Restauration données** : sauvegardes du fournisseur PostgreSQL (PITR
   recommandé). Après restauration, `npm run db:server:check` doit passer.

### Santé et supervision

- `GET /api/health` (public) : `{"status":"ok"}` ou `{"status":"degraded"}`
  (503) — rien d'autre. Aucun détail interne n'est exposé ; les diagnostics
  vont dans les logs serveur (redactés par `src/lib/redact.ts`).
- Indisponibilité PostgreSQL : les routes licence répondent 503 générique
  (fail-closed) ; le client Electron conserve son état (indéterminé ≠ refus).

### Test sur une machine Windows propre

1. Installer le build (`GarageFlow-Setup-x.y.z.exe`) sur un poste vierge.
2. Premier lancement : la base locale se crée depuis le template ; l'écran de
   licence s'affiche.
3. Activer avec une licence de test → vérifier dans l'admin du control plane
   que l'appareil apparaît (deviceId, plateforme, lastSeenAt).
4. Vérifier la limite : activer la même licence (`seats=1`) sur une seconde
   machine → refus « Nombre maximal d'appareils atteint ».
5. Révoquer l'appareil depuis l'admin → au heartbeat suivant (≤ 30 min) l'app
   affiche l'écran de blocage.
6. `reset` de l'appareil depuis l'admin → la machine peut se réactiver.
7. Couper le réseau : l'app fonctionne hors ligne ; au-delà de 48 h un
   avertissement s'affiche, à 72 h le poste se verrouille jusqu'à reconnexion.

## 3. Checklist avant mise en production PWA

- [ ] `npm run db:server:check` vert sur la base de production (vide) ;
- [ ] variables requises présentes (le démarrage échoue sinon) ;
- [ ] CI verte sur le commit déployé (migrations + concurrence + build) ;
- [ ] `GET /api/health` répond `{"status":"ok"}` ;
- [ ] test 429 : dépasser la limite d'activation → `Retry-After` présent ;
- [ ] logs de production : aucun token, aucune clé de licence, aucun HWID brut
      (redaction active), aucun bloc de debug.
