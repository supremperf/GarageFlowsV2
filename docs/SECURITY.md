# Sécurité — GarageFlow (app + client desktop)

Ce document décrit **ce qui est réellement implémenté** (et ce qui ne l'est pas),
pour que la communication commerciale reste alignée sur le code. Aucune
affirmation non vérifiable ne doit être publiée sur la base de ce document.

## Authentification & sessions

- **Comptes utilisateurs** : e-mail + mot de passe haché avec **bcrypt**
  (`src/lib/auth.ts`). Les identifiants et le hash ne sont **plus journalisés**.
- **Sessions** : NextAuth (JWT). ⚠️ Durée actuelle 30 jours — à réduire pour un
  usage sensible.
- **2FA / MFA** : **non implémenté**. Ne pas l'annoncer tant que ce n'est pas le cas.
- **Limitation des tentatives** : rate-limit login (10 essais / IP / 15 min,
  `src/app/api/auth/[...nextauth]/route.ts`). En mémoire par instance (voir
  « Limites connues »).
- **Rôles** : trois niveaux fixes `OWNER` / `MANAGER` / `RECEPTIONIST`
  (`prisma/schema.prisma`). Pas de rôles personnalisables.

## Secret de session

- Lecture **centralisée** via `src/lib/auth-secret.ts` (`authSecret()` /
  `authSecretKey()`), utilisée par le middleware et toutes les routes — plus
  aucun secret de repli codé en dur. En l'absence de `NEXTAUTH_SECRET`, l'accès
  échoue explicitement (jamais de secret prévisible).
- **Electron** génère un `NEXTAUTH_SECRET` **aléatoire, unique par installation**
  au premier lancement et régénère les secrets faibles/hérités
  (`electron/main.js`). Aucun secret partagé n'est embarqué dans le binaire.
- Validation au démarrage : `src/lib/env.ts` + `src/instrumentation.ts` refusent
  le démarrage en production si `NEXTAUTH_SECRET`/`DATABASE_URL` sont
  invalides/faibles/d'exemple.

## Isolation multi-tenant (données par garage)

- **Solide** : tous les modèles métier portent `garageId` ; le `garageId`
  provient **toujours** de la session serveur (`session.user.garageId`), jamais
  du client. Les listes filtrent par `garageId` et les accès unitaires utilisent
  `findFirst({ id, garageId })`.
- **Amélioration de robustesse recommandée** : quelques routes `update`/`delete`
  scoprent l'appartenance via un `findFirst` préalable puis mutent par `id` seul
  (work-orders/purchase-orders/warranties/loaner-*). C'est **sûr** aujourd'hui
  (le contrôle préalable renvoie 404 hors garage) mais gagnerait à inclure
  `garageId` directement dans le `where` (défense en profondeur).

## Licences

- **Deux schémas coexistent** :
  - Ancien : clés `GF-XXXX-XXXX-XXXX-XXXX` validées par **HMAC-SHA256** avec un
    secret **partagé** (`GF_LICENSE_MASTER_SECRET`, désormais hors du code —
    `scripts/generate-license-key.js` le lit dans l'environnement). ⚠️ Un secret
    HMAC symétrique doit être présent côté client pour valider → **forgeable** si
    le binaire est inspecté. **Déprécié.**
  - Nouveau : tokens **`GF2`** signés **ES256 (ECC)**. La clé privée n'est jamais
    distribuée ; le client ne détient que la clé publique. **Schéma recommandé.**
- **Action** : migrer entièrement vers le schéma ECC et cesser d'émettre des clés
  HMAC. Toute clé `GF-XXXX` émise avec l'ancien secret doit être considérée comme
  potentiellement forgeable (le secret a été committé — voir
  `garagesite3/docs/SECRETS_ROTATION.md`).

## Sauvegardes & chiffrement (client desktop)

- Base applicative = **SQLite local** (poste de l'utilisateur). **Non chiffrée au
  repos** (pas de SQLCipher).
- Sauvegardes = copies de fichier `.db` **locales, non chiffrées**, planifiées
  (horaires ×24 / journalières ×7 / hebdomadaires ×4, `electron/main.js`). Pas de
  réplication ni de sauvegarde cloud.
- Chiffrement **en transit** via HTTPS/TLS uniquement.
- Communication commerciale : ne pas revendiquer « chiffrées au repos »,
  « en continu », « réplication temps réel » ni « aucune donnée ne peut être
  perdue ».

## En-têtes HTTP / navigateur

- CSP, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`,
  `Referrer-Policy`, `Permissions-Policy` (`next.config.mjs`).
- **HSTS** en production. **`X-Robots-Tag: noindex`** (application privée).
- La CSP conserve `unsafe-inline`/`unsafe-eval` (requis par Next.js sans nonces) —
  durcissement par nonces = amélioration future.

## Limites connues (à ne pas survendre)

- Rate-limit **en mémoire par instance** (`src/lib/api-helpers.ts`) : contournable
  en multi-instances/serverless et réinitialisé au redéploiement. Adosser à un
  store partagé (Redis) pour un anti-bruteforce robuste.
- Pas de monitoring/alerting/uptime/SLA applicatif.
- `logLogin` existe mais n'est pas branché : les connexions ne sont pas encore
  tracées (les écritures de données le sont via `AuditLog`).
