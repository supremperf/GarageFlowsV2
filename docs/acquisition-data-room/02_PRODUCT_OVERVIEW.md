# 02 — Présentation du produit

## 1. Positionnement

GarageFlow est un logiciel de **gestion d'atelier automobile** destiné aux garages indépendants francophones. Il couvre le planning atelier, la gestion des clients/véhicules, les devis, ordres de réparation et factures, avec un catalogue de pièces et des fonctions d'aide au diagnostic.

Le modèle opérationnel réel est **mono-garage par installation** (base SQLite locale côté desktop), coordonné par un control-plane cloud pour le licensing, les modules et les mises à jour à travers de nombreuses installations.

> **Réalité de positionnement (à énoncer clairement) :** il n'existe **aucune entité Organisation/Réseau de premier plan au-dessus de `Garage`** dans le schéma opérationnel. Le « réseau multi-garage » est une capacité de licensing + un palier d'offre marketing, **pas** une hiérarchie organisationnelle opérationnelle. À documenter comme limitation connue / élément de roadmap.

## 2. Surfaces de livraison

| Surface | Description | Base de données |
|---|---|---|
| Desktop (Electron) | Application installée chez le garage, serveur Next.js standalone embarqué sur 127.0.0.1:4028 | SQLite (Prisma, 37 modèles) |
| PWA | Même codebase Next.js, déploiement web | PostgreSQL |
| Control-plane / vitrine | Licences, releases signées, crash reports, modules, notifications, audit | PostgreSQL (Prisma, 13 modèles) |

## 3. Domaines fonctionnels (haut niveau)

D'après l'inventaire de fonctionnalités de l'audit — le détail avec statut opérationnel/partiel/non-construit figure dans `03_FEATURE_INVENTORY.md`.

**Métier atelier (opérationnel) :**
- Planning et gestion des interventions (jobs / ordres de réparation).
- Clients, véhicules, mécaniciens.
- Devis (Quote) et factures (Invoice) avec numérotation séquentielle transactionnelle sans trou et immutabilité des factures émises.
- Calcul de TVA en centimes entiers (exact).
- Catalogue de pièces, fournisseurs, prévisions de stock.
- OCR de plaque d'immatriculation et lookup plaque (fonctions IA optionnelles, dégradation gracieuse sans clé API).

**Licensing & exploitation (opérationnel côté control-plane) :**
- Activation de licence / heartbeat device / vérification (DB-backed, fail-closed).
- Publication de releases + rollout/rollback manuel.
- Crash reporting (fingerprinting, regroupement, triage).
- Modules / entitlements ; centre de notifications ; journal d'audit global.

**Non construit / partiel (à ne pas surévaluer) :**
- E-invoicing (Factur-X/UBL/CII/Chorus Pro/PDP) : **aucun code**.
- API publique `/api/v1` : **démo en mémoire non persistante**.
- Webhooks / événements sortants : **inexistants**.
- Import CSV/Excel de migration : **inexistant** (CSV = export uniquement).
- Avoir (credit note) / paiements : **non modélisés**.
- White-label : config présente mais **quasi non câblée**.
- Backup/restore : complet en code, **sans UI**.

## 4. Fonctions IA optionnelles

Deux fonctions utilisent `@anthropic-ai/sdk` (MIT) côté serveur :
- **OCR de plaque** (`/api/plate-ocr`) : photo → plaque.
- **Fallback lookup plaque** (`/api/plate-lookup`) : tente d'abord une API tierce (api-immat.com), repli sur Claude Haiku si `ANTHROPIC_API_KEY` est défini.

Les deux sont auth-gated, rate-limited, avec cap de taille de payload, et **dégradent silencieusement** (503 ou `source:'unknown'`) sans clé API — **aucun verrouillage fournisseur IA**. La couche LLM du Copilot est provider-agnostic (interface `LlmProvider`) et livrée en mode déterministe par défaut (aucun provider bundlé).

## 5. Environnement de démonstration

Vérifié cette session : `prisma db push` + `npm run db:seed` créent un « Garage Demo » avec **5 mécaniciens et 13 jobs** (`prisma/seed.ts`). L'identifiant de démo est une **crédential de démo étiquetée** (`admingarageflow@admin.fr`), pas un secret du dépôt. L'environnement de démo se construit de bout en bout.

---
*Référence croisée : voir `docs/ACQUISITION_READINESS_AUDIT.md` pour l'audit de préparation complet.*
