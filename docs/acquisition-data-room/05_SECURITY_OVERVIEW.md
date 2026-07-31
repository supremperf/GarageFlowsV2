# 05 — Panorama sécurité

La sécurité et l'isolation multi-tenant sont **la partie la plus délibérément ingénierée** des deux codebases. Maturité de ce domaine : **production-candidate**. Score sécurité de l'audit : **70/100**.

## 1. Points forts (vérifiés)

### Gestion des secrets — fail-closed
- Aucun secret codé en dur ni fallback par défaut. `getAuthSecret`/`getSessionSecretString` rejettent les valeurs faibles/legacy connues et lèvent une exception (`auth-secret.ts:19-51`, `session-secret.ts:20-48`).
- Validation d'environnement au démarrage (`env.ts:19-104`) : la prod **refuse de démarrer** sur `NEXTAUTH_SECRET` manquant/faible, DB PWA non-Postgres, pepper device absent, ou backend de rate-limit distribué manquant.

### Isolation multi-tenant — défense en profondeur
- Middleware qui gate toutes les pages ; `requireSession()` valide centralement la session licenciée et **lie immuablement** une licence à un garage (bind-on-first-use via `updateMany` atomique, puis 403 en cas de mismatch).
- Scoping `where:{id, garageId}` sur chaque lecture/écriture métier ; guard dédié `tenant.ts assertRelations` contre l'IDOR de 2e ordre (via includes de relations).
- **Prouvé par tests** : `require-session-enforcement.test.ts` assure 401 sans session, 403 pour la licence d'un autre garage, 403 pour un device révoqué même avec cookie encore signé.

### Cryptographie — correcte et bien appliquée
- Vérification de licence **asymétrique ECDSA P-256** (seule la clé publique est embarquée) — `verify.ts`.
- **Mises à jour signées Ed25519** avec sérialisation canonique, algorithm pinning, anti-downgrade et allowlist d'hôtes de téléchargement HTTPS — `electron/update-verify.js`.
- **Sauvegardes AES-256-GCM authentifiées** qui échouent sur altération — `backup/crypto.ts` (KDF scrypt).
- Jetons device **HMAC-SHA256 opaques** avec révocation par version — `device-token.ts`. HWID jamais stocké en clair (seulement le hash HMAC-SHA256).
- Comparaisons **timing-safe** pour HWID, clés API et jetons partout.

### Enforcement des sièges — TOCTOU-safe
- La séquence activate/count/create tourne dans **une transaction** ouverte par `SELECT ... FOR UPDATE` sur la ligne de licence, avec re-count de contrôle qui rollback en cas de dépassement (`licenses/service.ts:411-472`).

### Durcissement desktop
- Isolation renderer (contextIsolation/sandbox), serveur loopback-only, secret `NEXTAUTH` par installation (écriture atomique 0600, rejet des secrets faibles, fail-closed).
- Crash reports **rédigés** (secrets/tokens/JWT/license-tokens/DB-URLs/usernames locaux) avec consentement explicite (opt-in par défaut OFF, RGPD).
- Manifeste d'intégrité HMAC build-time vérifié au runtime (protection niveau JS — voir limitations).

### Durcissement web de base
- CSP stricte, HSTS en prod, `noindex` sur /admin, `X-Frame-Options DENY` (`next.config.mjs:12-54`).

## 2. Faiblesses / risques résiduels (à remédier)

Aucune n'est catastrophique, mais chacune est un élément concret qu'un acquéreur devrait exiger corrigé :

| Sévérité | Risque | Détail | Fichier |
|---|---|---|---|
| medium | Bypass rate-limit login/2FA portail via X-Forwarded-For forgeable | `clientIp()` lit XFF sans gate proxy de confiance ; pas de compteur d'échec 2FA par compte → brute-force TOTP possible avec mot de passe connu | `src/lib/portal/auth-helpers.ts:31-35`; `2fa/verify/route.ts:17-20` |
| medium | Clé admin statique partagée unique pour tout le backend licensing | Une seule `LICENSE_ADMIN_API_KEY` (comparée constant-time), stockée en `sessionStorage` navigateur ; pas d'identité/MFA/RBAC par admin ; rotation = redéploiement | `garagesite3/src/lib/licenses/auth.ts:28-41`; `admin/_lib/client.ts:9-52` |
| low | Secrets TOTP portail stockés en clair | `twoFactorSecret`/`twoFactorPending` non chiffrés au repos → une fuite DB read-only donne les seeds 2FA | `2fa/setup/route.ts:18` |
| low | Rate limiter en mémoire sur routes serverless publiques | Crash ingestion / SSE utilisent `hit()` par-instance, pas le distribué | `garagesite3/src/app/api/crash/route.ts:18-21` |
| low | Backup codes en SHA-256 non salé | Acceptable car codes haute entropie, mais pas best practice | `portal/backup-codes.ts:22-60` |

## 3. Limitations de l'anti-tamper local (à ne pas surreprésenter)

- Le manifeste d'intégrité est vérifié **en JavaScript** avec une clé HMAC dérivée d'un « secret fragmenté » compilé dans le binaire ; **le code et le secret sont extractibles/patchables** par un reverse-engineer (auto-documenté dans `integrity.js:22-26`, `secure-key.js:16-22`).
- L'enforcement de licence est **fail-open** sur erreur réseau (`main.js:1042,1054`), et le binaire Windows est **non signé**.
- **Conclusion :** la protection de revenu est *best-effort*, **pas du DRM fort**, et ne doit pas être présentée comme tel.

## 4. CI sécurité

Les deux dépôts exécutent en CI : typecheck, lint, migrations sur Postgres vide, suite de tests contre postgres:16 + redis:7, build de production, **scan de secrets Gitleaks**, et audit de dépendances. `.env` est gitignored (non committé) ; `.env.example` ne contient que des placeholders documentés.

## 5. Corrections apportées cette session (P1)

- Rate-limit 2FA **par compte** ajouté (portail desktop).
- Cron Vercel d'auto-rollback avec auth `CRON_SECRET` fail-closed (cloud).
- Fichiers `LICENSE` + `SECURITY.md` ajoutés dans les deux dépôts.

---
*Référence croisée : voir `docs/ACQUISITION_READINESS_AUDIT.md` pour l'audit de préparation complet.*
