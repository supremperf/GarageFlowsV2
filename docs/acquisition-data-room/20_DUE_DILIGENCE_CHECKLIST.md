# 20 — Checklist de due diligence acquéreur

_Document de data room M&A. Vérifié de première main le 2026-07-31._

> Checklist actionnable mappant **chaque bloqueur P0 et risque de l'audit** à une **action de vérification concrète** pour l'acquéreur. Statut suggéré : ☐ à vérifier. Les priorités reflètent la gravité de l'audit.

## 1. Bloqueurs P0 — conditions de closing (à vérifier AVANT paiement)

| ☐ | Risque | Action de vérification |
|---|---|---|
| ☐ | **P0-1 Clés privées de signature** (licence ECDSA P-256 + update Ed25519) | Exiger la remise (ou séquestre) des 2 clés privées. **Test décisif** : émettre une licence de test et signer une update, et vérifier que le client desktop les accepte — **sans le vendeur**. Vérifier la correspondance clé publique embarquée ↔ privée reçue. |
| ☐ | **P0-2 Backend control-plane + Postgres** | Obtenir accès au projet Vercel + dump PostgreSQL. Re-déployer sur infra acquéreur et **boot en prod** (doit passer la validation d'env fail-closed). |
| ☐ | **P0-3 Domaines garageflows.fr** | Vérifier la titularité au registrar ; obtenir le transfert DNS. Confirmer les allowlists codées en dur (`update-verify.js:29-33`) et planifier un rebuild si rebrand de domaine. |
| ☐ | **P0-4 Cession de PI** | Exiger une cession écrite couvrant **les 2 bases de code + tous les assets `public/`**. Faire vérifier la chain-of-title par un conseil (aucune preuve in-repo). |

## 2. Risques élevés — vérifications techniques

| ☐ | Risque | Action de vérification |
|---|---|---|
| ☐ | **E-invoicing absent** (mandat FR 2026-2027) | Confirmer par grep que Factur-X/UBL/CII/Chorus/PDP sont absents. Faire chiffrer le chantier par un expert e-invoicing FR ; l'intégrer au business plan comme coût **obligatoire**. |
| ☐ | **API `/api/v1` = démo mémoire** | Lire `store.ts:1-8, 242-256`. Déployer et prouver qu'un POST puis GET après cold start **perd la donnée**. Ne pas valoriser comme API de prod. |
| ☐ | **Installeur Windows non signé** | Vérifier l'absence de certificat dans `package.json` build.win. Chiffrer l'obtention d'un cert OV/EV + délai de réputation SmartScreen. |
| ☐ | **Verrou dur 72 h hors-ligne** | Lire `main.js:298-299,1193-1206`. Tester : couper le réseau > 72 h → l'app quitte. Évaluer l'impact churn sur la cible (garages à internet instable). |
| ☐ | **Zéro E2E / test UI** | Confirmer l'absence de Playwright/`.tsx` de test. Budgéter la construction d'une suite E2E avant tout refactor. |
| ☐ | **White-label non câblé** | Éditer `brand.ts` (ex. changer `productName`) et lancer l'UI desktop : constater que ~146 littéraux restent « GarageFlow ». Chiffrer le câblage. |
| ☐ | **Pas d'import de données** | Confirmer l'absence de parser CSV/Excel. Tester l'onboarding d'un jeu de données concurrent → impossible sans dev. |
| ☐ | **Pas de hiérarchie multi-garage** | Grep schéma pour `Organization`/`Network` → néant. Si thèse roll-up, chiffrer le redesign schéma + RBAC. |

## 3. Risques moyens — durcissement & dette

| ☐ | Risque | Action de vérification |
|---|---|---|
| ☐ | **Clé admin unique partagée** (control-plane) | Vérifier `licenses/auth.ts:28-41` + `admin/_lib/client.ts` (sessionStorage). Exiger un plan IAM avant vente upmarket. |
| ☐ | **Backup/monitoring sans UI** | Confirmer l'absence de BackupTab / lien nav. Vérifier que les routes API existent. Chiffrer l'UI (faible). |
| ☐ | **Auto-rollback / cron** | Vérifier la présence de `vercel.json` (ajouté cette session) et le fail-closed `CRON_SECRET`. Tester le déclenchement. |
| ☐ | **Bypass rate-limit 2FA + TOTP en clair** | Lire `portal/auth-helpers.ts:31-35` et `2fa/setup/route.ts:18`. Exiger correction (gate XFF + lockout + chiffrement au repos) pré-close. |
| ☐ | **Anti-tamper JS-only / fail-open** | Lire `integrity.js:22-26`, `main.js:1042,1054`. Ne pas représenter comme DRM fort ; évaluer le risque de contournement revenus. |
| ☐ | **Migrations desktop non reproductibles** | Confirmer l'absence de baseline/`migration_lock.toml` desktop. Exiger un baselining avant reprise. |
| ☐ | **`electron/*.js` = copies non testées** | Diff `electron/*.js` vs copies `src` ; vérifier l'absence de divergence sur les chemins update/intégrité. |

## 4. Risques faibles / maintenance

| ☐ | Item | Action |
|---|---|---|
| ☐ | Electron 31 / Next 14–15 / next-auth v4 | Chiffrer le cycle d'upgrade ; vérifier CVE Chromium en attente. |
| ☐ | CORS `'*'` par défaut (API v1) | Vérifier `api/http.ts:9` ; corriger. |
| ☐ | Audit deps garagesite3 non bloquant | Vérifier `continue-on-error` ; rendre bloquant. |
| ☐ | Pas de `engines` Node | Ajouter un pin pour reproductibilité build. |
| ☐ | `plate-lookup` API tierce sans SLA | Évaluer la dépendance `api-immat.com`. |

## 5. Vérifications hors code (business & légal — à diligencer séparément)

| ☐ | Item | Action |
|---|---|---|
| ☐ | Revenus / clients / trafic / churn | **Non audités, non dans le code.** Exiger relevés financiers, contrats clients, analytics. |
| ☐ | DPA sous-traitants (Vercel, Upstash, Postgres, Anthropic) | Obtenir/rapatrier les DPA ; établir le registre RGPD des traitements. |
| ☐ | Mentions légales, DPO, registre des traitements | Vérifier l'existence organisationnelle (hors dépôt). |
| ☐ | État de déploiement prod réel | **Non observable depuis le dépôt** — demander accès Vercel/env pour confirmer clés/cron configurés. |
| ☐ | Dépendances de licence open-source | Revoir `SBOM.md` / `OPEN_SOURCE_LICENSE_AUDIT.md` : direct deps permissifs, copyleft transitif faible (LGPL sharp / MPL tooling). |

## 6. Test de reprise global (go/no-go)

**Condition de confiance** : l'acquéreur exécute la **validation E2E en 5 étapes** de `17_TRANSFER_PLAN.md` (émettre licence → activer device → signer update → révoquer → rollback) **sans aucune assistance du vendeur**. Si les 5 passent, l'opérabilité est prouvée ; sinon, un ou plusieurs P0 ne sont pas réellement transférés.

---
_Voir aussi : [docs/ACQUISITION_READINESS_AUDIT.md](../ACQUISITION_READINESS_AUDIT.md)._
