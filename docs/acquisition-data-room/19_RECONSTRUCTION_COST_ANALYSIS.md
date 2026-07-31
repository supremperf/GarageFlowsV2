# 19 — Analyse du coût de reconstruction

_Document de data room M&A. Vérifié de première main le 2026-07-31._

> **Toutes les valeurs de ce document sont des ESTIMATIONS** de coût de remplacement (« combien pour reconstruire un équivalent from scratch »), pas des prix ni des faits. Elles s'appuient sur le **périmètre de code réel** mesuré par l'audit. Le coût de reconstruction établit un **plancher de raisonnement** pour la valorisation (`21_VALUATION_RATIONALE.md`), pas une valeur de marché.

## 1. Périmètre de code réel (mesuré)

| Élément | Volume | Source |
|---|---|---|
| Routes API desktop (`route.ts`) | **125** | `verified-facts.md` |
| Routes API cloud | **56** (dont API v1 versionnée + OpenAPI) | `verified-facts.md` |
| Modèles Prisma desktop | **37** (+ 37 miroir serveur) | `verified-facts.md` |
| Modèles Prisma cloud | **13** | `verified-facts.md` |
| Fichiers de test | **~87** (~857 cas ; 678 desktop + 140 cloud non-intégration vérifiés localement) | `verified-facts.md` |
| Systèmes transverses | Licensing (ECDSA/HWID/sièges), update signé (Ed25519), sécurité/isolation Electron, backup chiffré, control-plane, monitoring | Audit |

C'est un périmètre **substantiel** : ~181 routes, 50 modèles, une suite de tests haute-fidélité, et surtout un **cœur sécurité/licensing d'une complexité rare** pour un produit de cette taille.

## 2. Décomposition par domaine (dev-mois — ESTIMATION)

Les estimations supposent des **développeurs seniors** (le cœur crypto/sécurité ne se sous-traite pas à des juniors). « dev-mois » = un mois-personne d'ingénieur senior.

| Domaine | Contenu | Dev-mois (bas–haut) |
|---|---|---|
| Shell Electron + durcissement sécurité | Isolation renderer, serveur loopback, packaging standalone, update verify, intégrité HMAC, gestion de secret par install | 2.5 – 4 |
| Système de licensing | ECDSA P-256, HWID, jetons device HMAC, application des sièges TOCTOU-safe, politique offline, anti-tamper | 2 – 3.5 |
| Control-plane cloud | 56 routes, 13 modèles, activation/heartbeat/révocation, releases/rollout/rollback, crash reporting, modules, notifications, audit, rate limiting distribué fail-closed, validation d'env | 3 – 5 |
| Application métier | 37 modèles, 125 routes : jobs, clients, véhicules, factures/devis (numérotation transactionnelle, immutabilité, TVA centimes), catalogue, fournisseurs, OCR, rapports, dashboard, copilot | 6 – 10 |
| Suite de tests + CI | ~857 cas, harnais d'intégration SQLite/Postgres/Redis, CI (typecheck/lint/build/gitleaks/audit) sur 2 dépôts | 2 – 3.5 |
| White-label, backup chiffré, monitoring, PWA | Config Zod 3-couches, backup AES-256-GCM, dashboard monitoring, variante PWA | 1.5 – 2.5 |
| **Sous-total ingénierie** | | **17 – 28.5** |
| Overhead (PM, design/UX, QA, doc) ~20–30 % | | **+3.5 – 8.5** |
| **Total (personnes-mois)** | | **≈ 20 – 37** |

## 3. Conversion en coût (fourchettes de taux — ESTIMATION)

Taux **chargés** de référence, marché français/UE (à titre indicatif, non contractuels) :

| Modèle de production | Coût mensuel chargé (senior) | Hypothèse |
|---|---|---|
| Freelance / interne lean | **9 000 – 13 000 €/mois** | ~450–650 €/jour |
| Agence / ESN | **15 000 – 22 000 €/mois** | ~700–1 000 €/jour |

### Coût de reconstruction brut (ESTIMATION)

| Scénario | Calcul | Fourchette |
|---|---|---|
| Bas (équipe lean, 20 mois × 9 k€) | 20 × 9 000 | **~180 000 €** |
| Médian (24 mois × 11 k€) | 24 × 11 000 | **~265 000 €** |
| Haut (agence, 32 mois × 16 k€) | 32 × 16 000 | **~510 000 €** |

**Fourchette de coût de reconstruction retenue : ~180 000 € – 450 000 €** (en écartant les extrêmes agence les plus hauts), avec un **médian autour de 250 000 – 280 000 €**.

## 4. Nuances importantes (honnêteté)

- **Coût de remplacement ≠ valeur.** Ce chiffre mesure ce que coûterait *reconstruire l'artefact équivalent*, pas ce qu'il *vaut* sur un marché (qui dépend du revenu, de la traction, du risque — non audités).
- **Le coût brut n'intègre pas la valeur négative** des écarts : un reconstructeur ne referait **pas** les erreurs (API v1 démo, absence d'e-invoicing, verrou 72 h). Reconstruire un équivalent *fonctionnel et vendable* (avec e-invoicing, signature de code, E2E, import) coûterait **davantage** — ce qui renforce le plancher.
- **Le cœur sécurité/licensing est la part chère et différenciante** (~5–8 dev-mois cumulés) : c'est précisément l'actif que l'audit qualifie de « bien au-dessus d'un SaaS solo ».
- **Time-to-market** : reconstruire prend **~18–30 mois calendaires** en équipe réduite — un acquéreur qui achète évite ce délai (valeur d'option, cf. `21_`).

## 5. Lien avec la valorisation

Le coût de reconstruction (~180–450 k€, médian ~250–280 k€) **soutient le plancher** de la fourchette cible 150–350 k€ : même en escomptant fortement pour le risque d'opérabilité et les écarts, la valeur de remplacement de l'ingénierie déjà réalisée dépasse largement le bas de la fourchette. Voir `21_VALUATION_RATIONALE.md` pour la logique complète.

---
_Voir aussi : [docs/ACQUISITION_READINESS_AUDIT.md](../ACQUISITION_READINESS_AUDIT.md)._
