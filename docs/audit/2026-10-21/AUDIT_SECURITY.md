# AUDIT_SECURITY — 2026-10-21

Aucune valeur de secret, de clé ou de jeton ne figure dans ce document.

## 1. Secrets et Git

| Contrôle | Résultat | Statut |
|---|---|---|
| Fichiers suivis nommés `*.pem`, `*.key`, `.env` | aucun | VALIDÉ |
| Historique accessible (52 commits, **clone partiel**) : ajout d'un `-----BEGIN … PRIVATE KEY-----` | 3 occurrences, toutes des fixtures de test ou des contrôles de format, sans corps de clé | VALIDÉ (historique partiel) |
| Historique complet du dépôt | clone partiel ; non parcouru | NON TESTÉ |
| `.gitignore` | couvrait `.env*` (exemples exceptés), `keys/*.pem`, `dist/`, `/release/`, caches Python ; **ne couvrait pas** `*.pem`, `*.key`, `*.sig` hors de `keys/` → corrigé (GF-1021-05) | VALIDÉ après correction |
| Sortie de build `.next/standalone` + `.next/static` | seul `keys/public.pem` ; aucune clé privée, aucun `.env`, aucun nom de secret serveur dans le bundle client | VALIDÉ |

Les secrets déjà livrés dans d'anciens installateurs restent à considérer comme
compromis (`EXTERNAL_BLOCKERS.md` n° 10). Cette session n'avait aucun accès pour
les faire tourner.

## 2. Classification et rotation (Axe B)

La classification exhaustive existe et a été revérifiée :
`scripts/garageflow-env-manifest.json` (142 variables canoniques, alias
interdits, variables de plateforme), `ENVIRONMENT-VARIABLES.md`, plan de
rotation `docs/ROTATION_SECRETS.md`. `npm run check:env-consistency` → exit 0.

| Action demandée | Statut | Raison |
|---|---|---|
| Inventaire et classification | VALIDÉ | manifeste et garde de cohérence verts |
| Régénération des secrets internes (`NEXTAUTH_SECRET`, `GARAGEFLOW_API_KEY`, `DEVICE_TOKEN_PEPPER`, `GF_SMTP_CIPHER_KEY`, `GF_DB_MAC_SECRET`, etc.) | BLOQUÉ | aucun accès Vercel ; régénérer localement sans migrer les données protégées violerait §3.6 du cahier des charges |
| Migration `GF_SMTP_CIPHER_KEY` → `_OLD` puis rechiffrement | BLOQUÉ | aucune base de production accessible ; procédure et outillage décrits dans `docs/ROTATION_SECRETS.md` §3 |
| Récupération Neon / Upstash | BLOQUÉ | aucun jeton d'API (`NEON_API_KEY`, accès Upstash absents) |
| Synchronisation Vercel (Development, Preview, Production) | BLOQUÉ | aucun `VERCEL_TOKEN` |
| Conservation SMTP et fournisseurs tiers | VALIDÉ par abstention | aucune variable externe modifiée |
| Autorité ECC des licences | VALIDÉ | aucune nouvelle paire créée : le keygen refuse d'inventer une autorité quand la clé privée est absente |

## 3. Cryptographie

| Élément | Preuve | Statut |
|---|---|---|
| Licences ECDSA P-256 / SHA-256 | suites Python 20 + 88, `forgery-resistance` (parties sans clé privée) | VALIDÉ |
| Ancrages de clé publique | 3 ancrages et 2 consommateurs alignés sur `b16d2e1b…` | VALIDÉ |
| Licence signée par l'autorité de production | clé privée absente par conception | BLOQUÉ |
| HWID V1 (Electron = autorité) | vecteurs partagés Node / Python, 10 + 7 tests | VALIDÉ |
| Jetons d'appareil : HMAC, comparaison à temps constant, plafond de sièges | tests PostgreSQL réels de concurrence | VALIDÉ |
| Mises à jour Ed25519 : clé étrangère, binaire modifié, mauvais keyId, rétrogradation | `update-signing-cli` 8/8, `update-verify` 28, `release-signing-chain` 20 | VALIDÉ |

## 4. Surface d'API

Voir `AUDIT_API.md` : balayage dynamique des 169 routes sans session, aucune
donnée métier exposée. Webhook e-facturation : signature HMAC, fenêtre de 5 min,
plafond de taille, limiteur par IP.

## 5. Scan des captures (fail-closed)

Défaut réel trouvé à la première exécution de l'OCR : clés OpenAI et Stripe non
détectées (GF-1021-02, corrigé). Second défaut, révélé par la CI : sans Pillow,
une image falsifiée était acceptée et aucune limite de pixels ne s'appliquait
avant Tesseract (GF-1021-07, corrigé par une lecture d'en-tête sans
dépendance). Confirmé avec Tesseract réel : service lié à la
boucle locale, origine distante → 403, persistance refusée, aucune image
écrite, aucun texte OCR brut renvoyé.

## 6. Risques résiduels

1. Rotation des secrets exposés historiquement : non faite ici (accès absents).
2. Installateur non signé (Authenticode) : aucun certificat.
3. Control-plane administrateur à clé statique (MFA et RBAC fins absents) :
   `EXTERNAL_BLOCKERS.md` n° 8.
4. Clé mécanicien : jeton porteur non ré-émis à la réattribution (mitigation
   testée) : `EXTERNAL_BLOCKERS.md` n° 8 bis.
5. Historique Git complet non audité (clone partiel).
