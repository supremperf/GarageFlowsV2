# 11 — Protection des données (posture RGPD)

_Document de data room M&A. Vérifié de première main le 2026-07-31. Les faits techniques proviennent de l'audit à sept domaines et de la lecture des sources ; aucune donnée client réelle n'est affirmée._

> Périmètre : posture RGPD **du code tel qu'audité**. La conformité opérationnelle réelle (registre des traitements, DPA fournisseurs, mentions légales publiées, désignation DPO) est **hors périmètre du code** et doit être diligencée séparément. Ce document décrit ce que le code fait, pas ce qu'une organisation a formellement documenté.

## 1. Localité des données — modèle à deux plans

GarageFlow sépare nettement les **données métier** (locales) du **plan de contrôle** (cloud) :

| Plan | Stockage | Contenu | Localité |
|---|---|---|---|
| Données métier | **SQLite local** (desktop), template committé, sauvegardes locales | Clients, véhicules, jobs, factures, devis, catalogue, mécaniciens | Reste **sur le poste du garage** ; jamais exposé au LAN (serveur Next.js lié à `127.0.0.1:4028`, `electron/main.js:1547`) |
| Plan de contrôle | **PostgreSQL cloud** (garagesite3) | Licences, devices (HWID **haché**), releases, crashs, modules, notifications, audit, leads | Cloud (Vercel/Postgres) |

**Conséquence RGPD favorable** : les données personnelles des clients finals du garage (nom, contact, plaque, historique) restent **localement chez le responsable de traitement** (le garage). Le control-plane ne reçoit **pas** ces données métier — il ne voit que des identifiants techniques de licence/device et des rapports de crash redigés.

Variante PWA : le même code métier tourne sur PostgreSQL (multi-tenant `garageId`), ce qui déplace les données métier vers un hébergement centralisé — le modèle de localité y est différent et doit être documenté au client PWA.

## 2. Minimisation & pseudonymisation dans le code

- **HWID jamais stocké en clair** : seul un HMAC-SHA256 du HWID est persisté (`schema.prisma:81`, `garagesite3` `licenses/service.ts:560-566`). Le HWID est un SHA-256 de caractéristiques machine (CPU/MAC/plateforme/hostname/disque), lui-même dérivé, non ré-identifiant directement.
- **Jetons device opaques** : jetons HMAC avec `tokenVersion` révocable (`device-token.ts`), pas de données personnelles embarquées.
- **Redaction des logs** : logger centralisé avec scrub/redaction PII (`src/lib/logger.ts:51-56`).

## 3. Crash reporting — opt-in RGPD

Le rapport de crash est un traitement conçu **privacy-by-default** :

- **Consentement explicite, désactivé par défaut** (opt-in, default OFF) — `verified-facts.md`, `electron/control-plane.js:104-157`.
- **Redaction avant transmission** : secrets, tokens, JWT, license-tokens, URLs de base de données et **noms d'utilisateur locaux** sont expurgés avant envoi.
- **File d'attente hors-ligne** : les rapports ne partent qu'après consentement.

C'est une posture nettement au-dessus de la moyenne pour un produit desktop.

## 4. Sécurité du stockage (mesures techniques)

| Mesure | Détail | Source |
|---|---|---|
| Chiffrement des sauvegardes | AES-256-GCM authentifié, KDF scrypt | `src/lib/backup/crypto.ts:33-74` |
| Stockage de licence local | AES-256-GCM (PBKDF2(HWID)) sous enveloppe OS `safeStorage` (DPAPI/Keychain/libsecret) | `verified-facts.md` |
| Secret par installation | `NEXTAUTH_SECRET` unique, écriture atomique 0600, rejet des secrets faibles, fail-closed | `electron/secret.js:33-146` |
| Isolation multi-tenant | Scoping `where:{id, garageId}` + garde relationnelle anti-IDOR 2nd ordre, **prouvée par tests** | `src/lib/tenant.ts`, `require-session-enforcement.test.ts` |
| En-têtes web | CSP stricte, HSTS en prod, `noindex` sur `/admin`, `X-Frame-Options: DENY` | `next.config.mjs` |

## 5. Droits des personnes — état honnête

| Capacité RGPD | État | Note |
|---|---|---|
| Localité des données client (minimisation par conception) | **Opérationnel** | SQLite local ; le cloud ne reçoit pas les données métier |
| Consentement crash (opt-in) + redaction | **Opérationnel** | Default OFF, expurgation avant envoi |
| Export des données (portabilité) | **Partiel** | Export FEC comptable (`export/fec`) et export CSV de rapports existent ; **pas** d'export « toutes données d'une personne » dédié (droit à la portabilité art. 20) |
| Effacement / droit à l'oubli | **Non outillé** | Suppressions en cascade au niveau schéma existent, mais **aucun workflow dédié** « effacer toutes les données d'un client » exposé en UI |
| Chiffrement au repos des secrets TOTP portail | **NON fait** | Les secrets TOTP du portail client sont **stockés en clair** en base — un accès en lecture seule livre des graines 2FA exploitables (`2fa/setup/route.ts:18`). À corriger. |
| Registre des traitements / DPA fournisseurs / mentions légales | **Hors périmètre code** | Non vérifiable depuis le dépôt ; à diligencer |

## 6. Sous-traitants (processeurs) apparaissant dans le code

- **Vercel** (hébergement control-plane + Blob installeurs), **Upstash Redis** (rate limiting), **PostgreSQL** (hébergeur à confirmer), **Anthropic** (optionnel — OCR plaque / lookup, désactivé sans clé API). Un acquéreur doit établir/rapatrier les **DPA** avec chacun ; ils ne sont pas dans le dépôt.

## 7. Écarts à corriger (priorisés)

1. **Chiffrer au repos les secrets TOTP** du portail (aujourd'hui en clair). — _Effort faible._
2. **Outiller le droit à l'effacement et la portabilité par personne** (workflow + UI). — _Effort moyen._
3. **Établir le registre des traitements, les DPA et les mentions légales publiées** (organisationnel, hors code). — _Externe._
4. Corriger le bypass de rate-limit 2FA (en-tête `X-Forwarded-For` non filtré) qui affaiblit une mesure de sécurité des accès (`portal/auth-helpers.ts:31-35`).

---
_Voir aussi : [docs/ACQUISITION_READINESS_AUDIT.md](../ACQUISITION_READINESS_AUDIT.md)._
