# GarageFlow — Gestion des secrets & durcissement (Phase 1)

Ce document décrit le modèle de sécurité des secrets de GarageFlow et la
procédure de rotation. Il complète le validateur centralisé
[`src/lib/env.ts`](../src/lib/env.ts) et le template [`.env.example`](../.env.example).

## Principe : aucun secret par défaut

Toute variable critique est lue via le **validateur centralisé** (`src/lib/env.ts`).
Les règles appliquées :

1. **Aucun secret critique ne peut utiliser une valeur par défaut.** Les anciens
   fallbacks codés en dur (`gf-electron-local-secret-2026-…`,
   `fallback-dev-secret-…`, la valeur qui était committée dans `.env.example`,
   etc.) sont désormais dans une **liste noire** : les fournir revient à ne rien
   fournir.
2. **Démarrage bloqué si un secret obligatoire manque.** Au boot du serveur,
   [`src/instrumentation.ts`](../src/instrumentation.ts) appelle `assertStartupEnv()`
   qui lève une erreur explicite et empêche l'application de démarrer.
3. **Secrets de fonctionnalité validés à la demande.** SMTP, Stripe, Anthropic,
   stockage, etc. ne sont requis que lorsque la fonctionnalité est activée ; s'ils
   sont présents mais mal formés, l'erreur est explicite plutôt que silencieuse.

### Secrets gérés

| Variable | Statut | Génération |
|---|---|---|
| `NEXTAUTH_SECRET` | **Requis** | `openssl rand -base64 32` |
| `GF_DB_MAC_SECRET` | **Requis** en prod / Electron | `openssl rand -hex 32` |
| `GF_PORTAL_SECRET` | Optionnel (dérivé de NEXTAUTH_SECRET sinon) | `openssl rand -base64 32` |
| `GF_INTERNAL_EXPORT_KEY` | Requis pour `/api/internal/*` | `openssl rand -hex 32` |
| `GARAGEFLOW_API_KEY` | Requis pour la révocation distante | `openssl rand -hex 32` |
| `GF_PRIVATE_KEY` | Optionnel (génération de licences) | clé ECDSA P-256, base64 |
| `ANTHROPIC_API_KEY`, `SMTP_*`, `STRIPE_*` | Optionnels | selon le fournisseur |

En **Electron packagé**, `NEXTAUTH_SECRET` est généré et persisté par machine
(`userData/gf_session_secret.key`) et `GF_DB_MAC_SECRET` est dérivé du HWID —
aucun secret n'est donc codé en dur dans le binaire distribué.

## Rotation des secrets (sans déconnecter les utilisateurs)

Le cookie de session `gf_session` et les jetons du portail sont signés en HS256.
La vérification accepte **plusieurs clés** : la clé courante en premier, puis les
clés précédentes conservées pendant une **période de grâce**. La signature
utilise toujours la clé courante.

### Procédure

1. **Générer** un nouveau secret : `openssl rand -base64 32`.
2. **Déplacer l'ancien** dans la liste de grâce et **mettre le nouveau** comme
   secret courant :
   ```env
   NEXTAUTH_SECRET="<nouveau_secret>"
   NEXTAUTH_SECRET_PREVIOUS="<ancien_secret>"   # plusieurs possibles, séparés par des virgules
   ```
3. **Redémarrer** l'application. À partir de là :
   - les nouvelles sessions sont signées avec le nouveau secret ;
   - les sessions déjà émises restent valides (vérifiées via `…_PREVIOUS`).
4. **Journalisation** : lorsqu'un jeton n'est validé que par une clé précédente,
   un avertissement `[session-jwt] token verified with rotated key #n …` est émis
   — il permet de suivre la fenêtre de rotation.
5. **Clôturer** : une fois la durée de vie maximale des sessions écoulée (30 j par
   défaut) et des jetons portail (≤ 7 j), retirer `NEXTAUTH_SECRET_PREVIOUS`.

Le même mécanisme existe pour le portail via `GF_PORTAL_SECRET_PREVIOUS`.

### Révocation immédiate

Pour invalider **toutes** les sessions sans attendre l'expiration : effectuer une
rotation **sans** renseigner `…_PREVIOUS`. Tous les cookies signés avec l'ancien
secret deviennent invalides au redémarrage.

## Note de migration (compatibilité)

Les secrets **forts définis par l'opérateur** (variable d'environnement Vercel,
`.env` avec une vraie valeur générée, secret persisté Electron) continuent de
fonctionner sans interruption — aucune reconnexion nécessaire.

En revanche, les valeurs **placeholder / compromises** (dont la valeur qui était
committée dans `.env.example`) sont désormais refusées. Si une instance signait
réellement ses sessions avec l'une de ces valeurs, les cookies correspondants
deviennent invalides au déploiement : les utilisateurs devront se reconnecter une
fois. C'est la conséquence attendue et nécessaire du retrait d'un secret exposé
publiquement — un secret compromis ne peut pas continuer à être honoré, il ne
peut donc pas être placé dans `NEXTAUTH_SECRET_PREVIOUS` (il est filtré).

## Vérification de la configuration

- **Runtime** : `GET /api/health` renvoie l'état des variables critiques et
  d'éventuels avertissements de configuration (SMTP/Stripe/portail).
- **Tests** : `npm test` couvre le validateur (`env.test.ts`), la rotation
  (`session-jwt.test.ts`) et la comparaison à temps constant (`secure-compare.test.ts`).
