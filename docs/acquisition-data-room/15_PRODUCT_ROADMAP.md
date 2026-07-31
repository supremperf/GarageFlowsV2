# 15 — Feuille de route produit

_Document de data room M&A. Vérifié de première main le 2026-07-31._

> Cette feuille de route est **dérivée des écarts constatés par l'audit** (section `p1_risk_reduction` de la synthèse) — ce n'est pas un plan marketing, mais l'inventaire des chantiers nécessaires pour combler ce qui n'est pas construit. Les efforts sont des **ESTIMATIONS** non contractuelles. Tout ce qui est listé « non construit » ci-dessous l'est réellement à la date de l'audit.

## 1. Priorité absolue (P0 externe) — hors code

Rappel : les 4 bloqueurs P0 sont des **transferts d'actifs externes** (clés privées de signature, backend control-plane, domaines, cession de PI), pas des développements. Ils précèdent toute roadmap produit. Voir `17_TRANSFER_PLAN.md`.

## 2. Roadmap technique — chantiers priorisés

### Palier 1 — Débloquer la vente et l'exploitation légale (0–4 mois)

| # | Chantier | Pourquoi | Effort estimé |
|---|---|---|---|
| 1 | **E-invoicing français (réforme B2B 2026-2027)** | Enjeu **légal** sur le marché cible : zéro code aujourd'hui (Factur-X/UBL/CII, Chorus Pro/PDP, e-reporting). Nécessite per-line VAT, snapshots de montants HT/TTC/TVA, dates `DateTime`, SIRET/SIREN/TVA intra acheteur+vendeur, modèles Avoir + Paiement, statuts de cycle de vie. | **Multi-mois** (3–5 mois) |
| 2 | **Signature de code Windows** | Sans certificat OV/EV, SmartScreen « éditeur inconnu » à chaque install ; sape la conversion et le récit anti-tamper. | Procurement + câblage : 1–2 sem (hors délai d'obtention cert) |
| 3 | **Re-architecture du verrou hors-ligne 72 h** | `app.quit()` après 72 h hors-ligne contredit le positionnement desktop/offline ; risque de churn. Passer à une grâce configurable / mode dégradé lecture seule. | 2–4 sem |

### Palier 2 — Réaliser la valeur latente (2–6 mois)

| # | Chantier | Pourquoi | Effort estimé |
|---|---|---|---|
| 4 | **Persistance de l'API `/api/v1`** ou de-scoping | L'« API ouverte » est une démo en mémoire. Câbler `store.ts` à Postgres + autorisation par clé + rate limiting distribué + **webhooks**. Sinon retirer la promesse. | 4–8 sem |
| 5 | **Automatisation E2E + tests UI** | Zéro test E2E/composant sur 3 surfaces (desktop/PWA/vitrine) ; contraint la vélocité de refactor sûr. Playwright + seuils de couverture. | 3–6 sem |
| 6 | **Câblage white-label dans l'UI desktop** | Fondation `brand.ts` prête mais ~146 littéraux codés en dur. Si thèse rebrand. | 2–3.5 sem (voir `13_`) |
| 7 | **UI manquantes** (backup/restore, monitoring) | Services complets côté code, **sans UI** — un propriétaire non technique ne peut pas sauvegarder/restaurer. | 1–2 sem |

### Palier 3 — Extensions de valeur & durcissement (4–9 mois)

| # | Chantier | Pourquoi | Effort estimé |
|---|---|---|---|
| 8 | **Outil d'import/migration** (CSV/Excel, mapping, dry-run) | Aucun import aujourd'hui → coût d'onboarding élevé, frein à l'acquisition client. | 3–5 sem |
| 9 | **Hiérarchie organisation / multi-garage** | Le schéma s'arrête à `Garage` ; toute thèse roll-up/franchise exige un redesign schéma + RBAC + reporting consolidé. | 6–12 sem (redesign) |
| 10 | **IAM admin réel** (comptes par opérateur, MFA, RBAC, rotation, audit attribuable) | Aujourd'hui : **une seule clé admin partagée** en `sessionStorage`. Requis pour une vente upmarket/équipe. | 3–5 sem |
| 11 | **Correctifs sécurité** | Bypass rate-limit 2FA (XFF non filtré) + lockout par compte ; **chiffrer les secrets TOTP** au repos ; limiters publics en distribué. | 1–2 sem |
| 12 | **Dette de maintenance** | Upgrade Electron 31 → courant ; next-auth v4 → v5 ; pin `engines` Node ; **baseliner les migrations desktop** ; tester/dédupliquer les `electron/*.js` livrés ; rendre bloquant l'audit deps de garagesite3. | 3–6 sem cumulées |

## 3. Fonctionnalités « non construites » à ne pas promettre avant réalisation

Rappel explicite (pour éviter toute survente) — **aucune** de ces capacités n'existe aujourd'hui :

- E-invoicing (Factur-X/UBL/CII/Chorus Pro/PDP/e-reporting).
- Modèle Avoir (Credit Note) et modèle Paiement/Acompte.
- Assistant d'import CSV/Excel de migration.
- Hiérarchie organisation/réseau multi-garage.
- Tests E2E / tests de composants UI.
- Webhooks / API v1 persistante.
- Signature de code Windows.
- IAM admin multi-utilisateur.

## 4. Séquencement recommandé

**E-invoicing (#1) et signature de code (#2) conditionnent la commercialisation légale et fluide sur le marché cible** — ils doivent précéder tout investissement d'extension. Les paliers 2–3 sont ordonnables selon la thèse d'acquisition (rebrand-and-resell → prioriser #6 ; roll-up → #9 ; plateforme d'intégration → #4).

---
_Voir aussi : [docs/ACQUISITION_READINESS_AUDIT.md](../ACQUISITION_READINESS_AUDIT.md)._
