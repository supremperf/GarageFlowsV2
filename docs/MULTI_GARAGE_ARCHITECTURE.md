# Architecture multi-garage / multi-organisation (DESIGN — non implémenté)

_État honnête : **NON IMPLÉMENTÉ**. Le modèle métier actuel est **mono-garage**
(isolation par `garageId`). Ce document décrit l'architecture cible et **pourquoi
elle n'a pas été implémentée dans cette session** (risque). Date : 2026-08-01._

## Pourquoi ce n'est pas fait ici (honnêteté)

Introduire une hiérarchie Organisation → Réseau → Garage touche **toutes** les
routes scopées `garageId`, l'authz, la numérotation, les exports et l'UI. Sur le
schéma **desktop SQLite** (pas de migration à l'exécution pour les installations
existantes, voir `KNOWN_LIMITATIONS.md`), un changement d'une telle ampleur ne
peut pas être livré **sûrement et testé** dans une session sans risquer de
déstabiliser l'isolation mono-tenant existante (prouvée par tests) — ce qui serait
**pire** qu'un report. C'est donc documenté comme un chantier dédié.

## Modèle cible

```
Organization (réseau)
  └── OrganizationMembership (user ↔ org, rôle: OWNER/ADMIN/ACCOUNTANT/VIEWER)
  └── Garage[] (établissements ; ajoute organizationId, nullable puis backfill)
         └── GarageMembership (user ↔ garage, rôle: MANAGER/RECEPTION/MECHANIC…)
```

- **Partagé au niveau org** : marque, plans, politiques, utilisateurs invités,
  tableaux consolidés.
- **Isolé par garage (défaut)** : clients, véhicules, pièces, stock, devis,
  **factures + numérotation**, documents, paramètres.
- **Garage actif** : indicateur permanent + sélecteur ; toute requête porte le
  garage actif ; l'authz vérifie l'appartenance (org ET garage) **côté serveur**.

## Migration (idempotente, sans perte)

1. Ajouter `Organization` + `organizationId String?` sur `Garage`.
2. Backfill : créer une organisation par défaut par garage existant, rattacher.
   Script de contrôle post-migration : compter garages sans org (doit être 0).
3. Rendre `organizationId` obligatoire dans une 2ᵉ migration une fois backfillé.
4. Idempotence : re-run sans effet ; vérification `SELECT count(*) WHERE organizationId IS NULL`.

## Rôles cibles (à adapter aux rôles existants)

OWNER org · ADMIN org · MANAGER garage · RECEPTION · MECHANIC · ACCOUNTANT ·
VIEWER. Permissions **effectives** = intersection (rôle org, rôle garage).

## Tests à écrire (preuves d'isolation)

Org A ⟂ Org B (lecture/écriture/recherche/export/fichiers/dashboard/routes) ;
user garage 1 ⟂ garage 2 sans droit ; numérotation de facture **par
établissement** ; transferts inter-garages audités (origine/destination/auteur/
date/motif/éléments/historique).

## Étapes recommandées (ordre)

1. Modèles + migration additive + backfill + script de contrôle.
2. Middleware d'authz org+garage côté serveur (jamais l'UI seule).
3. Sélecteur de garage + garage actif + filtres.
4. Tableau de bord consolidé (CA/marge/productivité par établissement).
5. Transferts inter-garages audités.
6. Suite de tests d'isolation exhaustive.

_Voir aussi : `docs/MULTI_TENANT_SECURITY_MODEL.md`, `docs/KNOWN_LIMITATIONS.md`._
