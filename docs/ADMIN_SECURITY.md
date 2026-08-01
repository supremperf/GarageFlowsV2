# Sécurité de l'administration (état + cible)

_État honnête du modèle d'administration du control-plane cloud (`garagesite3`) et
plan de durcissement. Date : 2026-08-01._

## État actuel (réel)

- **Clé admin unique partagée** : toutes les opérations `/api/admin/*`
  s'authentifient contre une variable d'environnement (`LICENSE_ADMIN_API_KEY`),
  comparée en **temps constant** (`src/lib/licenses/auth.ts`), avec **rate-limit
  distribué** (Upstash, fail-closed en prod) et **journalisation d'audit** des
  refus (`guardAdmin`).
- **Cron sécurisé** : `verifyCronRequest` (bearer `CRON_SECRET`, fail-closed) —
  ajouté cette session pour le rollback automatique.
- **Limite** : pas de **comptes administrateurs nominatifs**, pas de **MFA**, pas
  de **RBAC** ; la clé est stockée en `sessionStorage` côté back-office et envoyée
  à chaque requête ; rotation = redéploiement ; audit non attribuable à une personne.

## Risques

- Compromission de la clé unique = contrôle total des licences (émission/révocation).
- XSS sur le back-office pourrait exfiltrer la clé.
- Pas de traçabilité par opérateur.

## Cible (durcissement recommandé — non implémenté ici)

1. **IAM par opérateur** : comptes nominatifs, mots de passe forts (bcrypt/argon2),
   sessions révocables.
2. **MFA obligatoire** pour tout admin (TOTP — la brique TOTP + chiffrement au
   repos existe déjà côté portail, réutilisable).
3. **RBAC** : rôles admin granulaires (licences / releases / support…).
4. **Ré-authentification** pour les opérations sensibles (révocation en masse).
5. **Clé maître « break-glass »** : la clé unique actuelle devient un secours
   d'urgence scellé, pas l'outil quotidien.
6. **Audit attribuable** : chaque action tracée à un opérateur.
7. **Anti-bruteforce** + verrouillage temporaire + rate-limit (déjà partiel).

## Validation d'environnement (déjà en place)

`src/lib/env.ts` (cloud) : en production, refus de démarrage si un secret critique
manque/est faible (`DEVICE_TOKEN_SECRET`, `HWID_HMAC_SECRET`, Redis). Étendre à
`LICENSE_ADMIN_API_KEY` (longueur/force) est recommandé.

## Statut

- **PARTIAL** : garde admin fonctionnelle, constant-time, rate-limitée, auditée,
  fail-closed — mais **clé unique** sans IAM/MFA/RBAC. Le durcissement ci-dessus
  est un chantier dédié (pré-vente montée en gamme / admin d'équipe).

_Voir aussi : `docs/SECURITY_ARCHITECTURE.md`, `docs/THREAT_MODEL.md`,
`docs/VULNERABILITY_MANAGEMENT.md`._
