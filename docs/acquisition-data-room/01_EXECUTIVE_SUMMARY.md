# 01 — Synthèse pour l'acquéreur (Executive Summary)

**Produit :** GarageFlow — logiciel de gestion d'atelier automobile pour garages indépendants (marché français).
**Fourchette de valorisation visée :** 150 k€ – 350 k€.
**Date de la documentation :** 2026-07-31.
**Nature de l'opération :** cession d'actifs (asset deal) — code source + actifs externes associés.

> Ce document synthétise la due diligence technique. Les chiffres de tests/builds proviennent de vérifications directes ; les classifications de fonctionnalités (opérationnel / partiel / code sans UI / non construit) proviennent de l'audit à sept domaines. Aucune donnée commerciale, financière ou client n'est affirmée ici : elle n'a pas été auditée et doit faire l'objet d'une diligence séparée.

## 1. Ce qui est vendu

GarageFlow est livré en trois artefacts issus de deux dépôts :

| Artefact | Dépôt | Stack | Rôle |
|---|---|---|---|
| Application desktop (Electron) | `/home/user/GarageFlowsV2` | Electron 31 + Next.js 14 + SQLite/Prisma | Produit métier installé chez le garage |
| PWA | `/home/user/GarageFlowsV2` (même code) | Next.js 14 + PostgreSQL | Variante web du même produit |
| Control-plane + site vitrine | `/home/user/garagesite3` | Next.js 15 + PostgreSQL/Prisma | Émission de licences, signature des mises à jour, crash reporting, modules |

## 2. Thèse d'investissement — l'actif réel

Le **cœur sécurité + licensing + logique backend** est d'une qualité d'ingénierie nettement supérieure à un SaaS développé en solo :

- Isolation renderer Electron « manuel scolaire » (contextIsolation, sandbox, loopback-only).
- Vérification de licence asymétrique ECDSA P-256 ; mises à jour signées Ed25519 avec vérification SHA-256 **avant** exécution + anti-downgrade.
- Sauvegardes chiffrées AES-256-GCM authentifiées ; jetons device HMAC ; comparaisons timing-safe partout.
- Application des sièges (seats) transactionnelle et TOCTOU-safe (`SELECT ... FOR UPDATE`).
- Isolation multi-tenant en défense en profondeur, **prouvée par tests** (401 non-licencié / 403 cross-garage / 403 device révoqué).
- Suite de tests backend substantielle (~857 cas) derrière une CI complète dans les deux dépôts.

Voir `05_SECURITY_OVERVIEW.md`, `08_TESTING_AND_QUALITY.md`.

## 3. Ce qui n'est PAS construit (à ne pas surévaluer)

L'audit distingue systématiquement le construit du façade-deep. Points à retenir :

- **Pas d'e-invoicing** (Factur-X / UBL / CII / Chorus Pro / PDP / e-reporting) — zéro code. Enjeu légal pour la réforme française B2B 2026-2027. Une route `export/fec` existe (export comptable FEC), mais ce n'est pas de la facturation électronique.
- **API publique `/api/v1`** = démo en mémoire non persistante (reset à chaque cold start serverless). Pas une plateforme d'intégration en production.
- **Pas d'assistant d'import CSV/Excel** de migration client. Le CSV existant est de l'export uniquement.
- **Pas de hiérarchie organisation / multi-garage** au-dessus de l'entité `Garage`. Le « réseau multi-garage » est une capacité de licensing + un palier marketing, pas une hiérarchie opérationnelle.
- **Pas de tests E2E** ni de tests de composants UI. Toute la couche présentation est validée manuellement.
- **White-label** : config typée excellente mais quasi non câblée (~2 consommateurs `BRAND.*` hors du fichier de config ; ~146 occurrences « GarageFlow » codées en dur).
- **Backup/restore** : complet côté code, **sans aucune UI**.

## 4. Bloqueurs P0 — transferts d'actifs EXTERNES (pas du code)

Le produit **ne peut être ni exploité ni monétisé** sans transfert d'actifs absents du dépôt et **non vérifiables par la diligence** :

1. **Les deux clés privées de signature** (licence ECC/ECDSA P-256 + mise à jour Ed25519) — server-side uniquement, `keys/private.pem` est gitignored.
2. **Le backend control-plane + base de données** en fonctionnement (api.garageflows.fr).
3. **Les domaines garageflows.fr**, DNS et hébergement (codés en dur dans les allowlists).
4. **La cession de PI écrite** (chain-of-title) — un fichier `LICENSE` a été ajouté cette session dans les deux dépôts, mais la cession de propriété reste **contractuelle**.

Détail : `07_DEPLOYMENT_MODEL.md`, `09_INTELLECTUAL_PROPERTY.md`.

## 5. Scores de maturité (source : synthèse d'audit)

| Dimension | Score /100 |
|---|---|
| Technique | 60 |
| Sécurité | 70 |
| Transférabilité | 45 |
| Démontrabilité | 57 |
| **Global** | **54** |

Maturité globale : **Beta** — un cœur sécurité/licensing candidat à la production entouré de fonctionnalités façade-deep, non construites ou dépendantes d'actifs externes. Ce n'est **pas** un going concern clé-en-main.

## 6. Lecture pour la valorisation

- Le **plancher** (150 k€) est justifié par le cœur sécurité/licensing et la propreté du posture PI/dépendances.
- Le **plafond** (350 k€) est contredit par : dépendance d'opérabilité aux actifs externes, absence d'e-invoicing sur le marché cible, et fonctionnalités façade-deep.
- Les coûts post-acquisition à budgéter (e-invoicing multi-mois, signature de code Windows, E2E, câblage white-label, IAM admin) sont détaillés dans `03_FEATURE_INVENTORY.md` et `06_INFRASTRUCTURE_AND_COSTS.md`.

---
*Référence croisée : voir `docs/ACQUISITION_READINESS_AUDIT.md` pour l'audit de préparation complet.*
