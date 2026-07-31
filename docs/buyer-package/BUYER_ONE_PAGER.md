# GarageFlow — Synthèse acquéreur (une page)

*Document commercial pour data room. Chiffres techniques vérifiés en première main ; aucune donnée commerciale, financière ou de traction n'est inventée.*

---

## Ce qui est vendu

Un logiciel de gestion d'atelier automobile pour garages indépendants (marché français), livré sous **trois formes partageant un socle de code** :

- **Application desktop Electron** (GarageFlowsV2 — Next.js 14 + SQLite/Prisma, 37 modèles, 125 routes API)
- **PWA** dérivée du même code
- **Control-plane cloud + site vitrine** (garagesite3 — Next.js 15 + PostgreSQL, 13 modèles, 56 routes API) qui émet les licences et signe les mises à jour.

## La proposition de valeur (pas des lignes de code)

| Levier | Réalité vérifiée |
|---|---|
| **Time-to-market** | Un socle sécurité + licensing + control-plane opérationnel, testé (~857 cas de test backend, CI complète). Reconstruire cet équivalent depuis zéro représente plusieurs mois-ingénieur. |
| **Fonctionnel métier automobile** | Large couverture opérationnelle : clients, véhicules, OR/devis/factures, RDV, catalogue pièces, opérations de main-d'œuvre, inspections, VIN/plaque (OCR), stock, fournisseurs, bons de commande, garanties, prêt de véhicule, rapports. |
| **Personnalisation** | Config white-label typée (Zod, 3 couches d'override) — fondation présente (câblage UI à finaliser, voir caveats). |
| **Déployabilité** | Build Windows x64 fonctionnel ; PWA ; déploiement cloud Vercel/PostgreSQL documenté. |
| **Réduction de risque** | Sécurité de qualité « production-candidate », isolation multi-tenant prouvée par tests, posture IP/dépendances propre. |
| **PI transférable** | Toutes les dépendances directes permissives (MIT/ISC/Apache/BSD) ; aucun GPL/AGPL/SSPL. |
| **Documentation** | Data room dense : architecture, sécurité, licensing, déploiement, runbooks, audit d'acquisition. |

## Points forts vérifiés (première main)

- **Sécurité** : isolation renderer Electron (contextIsolation/sandbox), serveur loopback-only, mises à jour signées Ed25519 avec vérification SHA-256 **avant** exécution, sauvegardes AES-256-GCM authentifiées, tokens device HMAC, comparaisons timing-safe.
- **Licensing** : vérification asymétrique ECDSA P-256, contrôle de sièges transactionnel TOCTOU-safe (SELECT … FOR UPDATE), rate-limiting distribué fail-closed.
- **Qualité** : GarageFlowsV2 **678 tests passés / 0 échec** ; garagesite3 **140 tests passés / 0 échec** ; `tsc --noEmit` propre dans les deux ; CI (typecheck + lint + build + tests sur Postgres/Redis réels + gitleaks).
- **Score de maturité (audit interne)** : technique 60/100, sécurité 70/100, transférabilité 45/100, démonstrabilité 57/100, **global 54/100**.

## Ce qu'un acquéreur doit savoir avant de conclure (honnêteté)

- **Bloquants P0 — actifs hors dépôt** : le produit **ne peut pas être exploité ni monétisé** sans transfert (a) des **clés privées de signature** (licence ECC P-256 + mise à jour Ed25519, absentes du dépôt), (b) du **backend control-plane + base**, (c) des **domaines garageflows.fr** (DNS/hébergement), (d) d'une **cession de PI écrite**. Ce sont des transferts d'actifs, pas du code.
- **Facturation électronique** : **AUCUNE** implémentation (Factur-X/UBL/CII, Chorus Pro/PDP, e-reporting). Chantier pluri-mensuel avant conformité au mandat français 2026-2027.
- **API publique /api/v1** : **démo in-memory non persistante** (perd les données au cold start serverless) — pas une plateforme d'intégration de production.
- **Absents** : assistant d'import CSV/Excel, tests E2E, hiérarchie organisation/multi-garage. Signature de code Windows non configurée ; verrou hors-ligne à 72 h.

## Fourchette de valorisation

Fourchette cible **150 k – 350 k EUR**. Le socle sécurité/licensing et la posture IP/dépendances justifient le **plancher** ; la dépendance d'exploitabilité (clés/backend/domaines), l'écart facturation électronique et les fonctions « façade » plaident contre le **plafond**.

---
*Réf. croisée : voir `docs/ACQUISITION_READINESS_AUDIT.md`.*
