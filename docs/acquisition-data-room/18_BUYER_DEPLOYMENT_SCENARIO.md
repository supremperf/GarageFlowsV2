# 18 — Scénario de déploiement acquéreur

_Document de data room M&A. Vérifié de première main le 2026-07-31._

> Scénario **illustratif** pour aider un acquéreur à évaluer l'effort réel de mise en service. Les acteurs et volumes sont hypothétiques ; les contraintes techniques et efforts sont grounded dans l'audit. Rien ici n'affirme un client ou un revenu réel.

## 1. Le scénario

Un **distributeur de pièces automobiles** (ou une **enseigne / réseau de garages**) acquiert GarageFlow pour :
1. **Rebrander** le produit sous sa marque.
2. Le **déployer chez N garages pilotes** de son réseau (ex. 10 ateliers).
3. À terme, l'utiliser comme point d'entrée pour vendre ses pièces (canal distributeur).

Ce scénario teste **quatre capacités** que l'acquéreur croit acheter : opérabilité, rebranding, déploiement multi-sites, onboarding des données existantes des garages.

## 2. Étape 0 — Rendre le produit opérable (bloquant, semaines 1–4)

**Avant tout déploiement**, exécuter les 4 transferts P0 (voir `17_TRANSFER_PLAN.md`) : clés privées de signature, backend control-plane + Postgres, domaines, cession de PI. Puis **prouver la reprise sans le vendeur** via la validation E2E (émettre une licence, activer un device, signer une update, révoquer, rollback).

> Sans cette étape, **aucun** garage pilote ne peut être activé. C'est le chemin critique.

## 3. Étape 1 — Rebranding (semaines 3–6, parallélisable)

| Tâche | État de départ | Effort |
|---|---|---|
| Vitrine cloud (nom, domaines) | **Largement prêt** via `NEXT_PUBLIC_PRODUCT_NAME` + `domains.ts` | Configuration (jours) |
| UI desktop (nom, logo, couleurs) | Fondation `brand.ts` prête mais **~146 littéraux codés en dur** | **~2–3.5 semaines** de dev (voir `13_`) |
| Nouveau domaine distributeur | Domaines codés en dur dans les allowlists | **Rebuild + re-signer** les clients desktop pointant le nouveau domaine |
| Certificat de signature de code | **Non configuré** | Procurer OV/EV + câbler electron-builder (sinon SmartScreen chez chaque garage) |

**Point de friction majeur** : changer de domaine implique un rebuild/re-signature ; ce n'est pas une simple bascule DNS côté client desktop.

## 4. Étape 2 — Déployer chez N garages pilotes (semaines 6–10)

Par garage :
1. **Émettre une licence** (control-plane) liée au HWID du poste — sièges appliqués transactionnellement.
2. **Installer le client Windows** (⚠️ SmartScreen tant que non signé — friction support à chaque install).
3. **Activation** : le desktop vérifie la licence (ECDSA), enregistre le device, initialise la base SQLite depuis le template.
4. **Configurer** le garage (coordonnées, mécaniciens, TVA) via l'UI settings.
5. **Modules/entitlements** poussés par le control-plane selon l'offre.

Le modèle **fan-out** aide ici : chaque garage a sa base locale isolée ; pas de base métier centrale à dimensionner. Le control-plane voit le trafic agrégé (activation/heartbeat), borné par le rate limiting distribué.

**Contrainte à anticiper** : le **verrou dur 72 h hors-ligne** (`app.quit()`) — un garage pilote avec internet instable verra l'app se fermer après un long week-end offline. À ré-architecturer avant un déploiement réseau sérieux.

## 5. Étape 3 — Onboarding des données existantes (BLOCAGE)

Les garages pilotes ont déjà des clients/véhicules/historiques dans un outil concurrent.

- **Il n'existe AUCUN import** (pas de parser CSV/Excel, pas de mapping, pas de dry-run — `src/lib/reports/csv.ts` est export-only).
- Conséquence : chaque garage doit être onboardé **manuellement** ou via des **scripts sur mesure** à développer.
- **Effort à budgéter** : outil d'import (~3–5 semaines) **avant** un déploiement à l'échelle, sinon l'onboarding devient le goulet.

## 6. Ce qui doit être construit AVANT ce scénario à l'échelle

| Prérequis | Pourquoi | Réf. |
|---|---|---|
| Transferts P0 | Opérabilité | `17_` |
| Signature de code Windows | Éviter SmartScreen chez chaque garage | `16_` H7 |
| Câblage white-label desktop | Rebrand réel de l'UI | `13_` |
| Outil d'import | Onboarding des données existantes | `16_` H11 |
| Re-architecture verrou 72 h | Fiabilité offline en réseau | `16_` H8 |
| E-invoicing | Légalité facturation B2B FR | `15_` |
| _(si réseau centralisé)_ Hiérarchie multi-garage | Reporting consolidé, RBAC réseau | `16_` H12 |

## 7. Verdict d'effort (ESTIMATION)

- **Pilote minimal (rebrand cloud + quelques licences, données saisies à la main)** : faisable en **~1–2 mois** après les transferts P0, avec la friction SmartScreen et le verrou 72 h comme risques opérationnels.
- **Déploiement réseau propre (rebrand desktop complet, signé, import, offline fiable)** : **~4–6 mois** de développement en plus des transferts, avant un rollout confortable à N garages.
- **Facturation légale (e-invoicing)** : chantier multi-mois additionnel, indépendant.

Le scénario est **réaliste mais pas clé-en-main** : l'ossature technique et sécurité est solide, mais les capacités « rebrand + déployer + onboarder » exigent un investissement de réalisation, pas seulement de la configuration.

---
_Voir aussi : [docs/ACQUISITION_READINESS_AUDIT.md](../ACQUISITION_READINESS_AUDIT.md)._
