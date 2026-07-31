# GarageFlow — Profils d'acquéreurs stratégiques

*Analyse des motivations d'achat par type d'acquéreur. Factuel : les capacités citées sont vérifiées ; les écarts sont signalés honnêtement car ils déterminent l'adéquation de chaque profil.*

Rappel des bloquants communs à tous les profils (P0, hors dépôt) : transfert des **clés privées de signature**, du **backend control-plane**, des **domaines garageflows.fr**, et **cession de PI**. Aucun profil ne peut exploiter le produit sans ces transferts.

---

## 1. Réseau / groupement de garages

**Pourquoi il s'y intéresse** : internaliser un outil métier maîtrisé plutôt que payer des licences tierces récurrentes ; contrôler la feuille de route ; potentiellement en équiper ses adhérents.

**Ce qui colle** : fonctionnel atelier large et opérationnel (clients, véhicules, OR, devis, factures, planning, stock, fournisseurs). Sécurité et licensing solides. Config white-label présente pour poser sa marque.

**Ce qui manque pour lui** : **pas de hiérarchie organisation/multi-garage** — le schéma s'arrête à un `Garage` unique par installation ; un déploiement multi-sites avec reporting consolidé exige une refonte schéma + contrôle d'accès. **Pas d'import CSV/Excel** pour migrer le parc clients/véhicules existant des adhérents. White-label **peu câblé** dans l'UI.

**Levier de négociation** : chantier multi-garage + import à financer post-acquisition — argument de décote / d'earn-out lié à la livraison.

---

## 2. Distributeur / équipementier de pièces détachées

**Pourquoi il s'y intéresse** : placer son catalogue et ses flux de commande au cœur du poste de travail des garages ; capter la commande de pièces à la source (canal de distribution).

**Ce qui colle** : modules **catalogue pièces**, **stock / prévision de stock**, **fournisseurs**, **bons de commande** déjà présents. Le Copilot et les intégrations OCR/VIN facilitent l'identification pièce/véhicule.

**Ce qui manque pour lui** : l'**API publique /api/v1 est une démo in-memory non persistante** — inutilisable telle quelle pour un couplage catalogue/commande de production ; il faut la brancher sur une vraie persistance + autorisation + webhooks (absents). Pas de système d'événements sortants (webhooks) opérationnel.

**Levier de négociation** : valoriser le canal de distribution, mais chiffrer le coût de construction de l'intégration réelle ; ne pas payer l'API comme si elle était de production.

---

## 3. Éditeur concurrent (logiciel garage)

**Pourquoi il s'y intéresse** : acquérir des fonctionnalités, une base de code sécurisée, un pipeline de mise à jour signée et de licensing prêts à l'emploi ; éliminer un concurrent ; récupérer la marque et le domaine.

**Ce qui colle** : le **socle sécurité/licensing/control-plane** est précisément ce qu'un éditeur met des mois à durcir. Suite de tests + CI matures. Posture PI/dépendances propre pour absorption.

**Ce qui manque pour lui** : recouvrement fonctionnel possible avec son produit (valeur = infrastructure + marché, pas duplication). Dépendance d'exploitabilité aux clés/backend/domaines à intégrer proprement.

**Levier de négociation** : acquéreur le plus à même de valoriser le socle technique ; sensible à la qualité de la cession de PI et à la reprise sans couture du licensing.

---

## 4. Groupe de logiciels verticaux (roll-up SaaS)

**Pourquoi il s'y intéresse** : ajouter une brique automobile à un portefeuille vertical ; industrialiser l'exploitation ; jouer la synergie support/infrastructure.

**Ce qui colle** : documentation dense (architecture, runbooks, SLO, disaster recovery), CI, control-plane multi-installations. Modèle de licence + modules/entitlements réutilisable.

**Ce qui manque pour lui** : **pas de tests E2E/UI** (vélocité de refonte contrainte), backend admin à **clé partagée unique** (pas d'IAM par opérateur/MFA/RBAC) à durcir avant mise à l'échelle, observabilité sans IDs de corrélation/export métriques.

**Levier de négociation** : décote sur le coût de mise aux standards du groupe (IAM, E2E, observabilité) ; structuration avec maintenance/intégration.

---

## 5. Société de facturation électronique / PDP (plateforme de dématérialisation)

**Pourquoi il s'y intéresse** : un canal de distribution vers les garages français à l'approche du mandat B2B 2026-2027 ; poser sa capacité Factur-X/Chorus Pro dans un logiciel métier.

**Ce qui colle** : fondamentaux de facturation **de qualité** — numérotation séquentielle sans trou (transactionnelle), immuabilité des factures émises, calcul TVA exact en centimes entiers. Export FEC présent. Base saine sur laquelle brancher la conformité.

**Ce qui manque pour lui (et c'est central)** : **AUCUNE** implémentation de facturation électronique — pas de Factur-X/UBL/CII, pas de Chorus Pro/PDP, pas d'e-reporting ; TVA mono-taux au niveau en-tête (pas de ventilation par ligne EN16931), pas de SIRET/SIREN acheteur snapshotté, pas de modèle Avoir ni Paiement, dates stockées en chaîne. C'est un **chantier pluri-mensuel**.

**Levier de négociation** : cet acquéreur apporte précisément la capacité manquante — synergie forte, mais il valorisera le produit **avant** conformité, donc plutôt vers le plancher, avec earn-out sur la mise en marché post-mandat.

---

## 6. Groupement d'achat automobile / enseigne

**Pourquoi il s'y intéresse** : équiper ses adhérents d'un outil sous sa marque, fidéliser, remonter des données d'activité agrégées.

**Ce qui colle** : fonctionnel atelier complet, white-label (fondation), licensing multi-installations pour distribuer à N adhérents.

**Ce qui manque pour lui** : **pas de hiérarchie réseau** (reporting consolidé inter-garages inexistant), **pas d'import** pour onboarder les adhérents existants, white-label à câbler. Verrou hors-ligne 72 h et binaire Windows non signé = friction terrain pour des garages parfois mal connectés.

**Levier de négociation** : valeur = distribution ; coûts = multi-garage + import + signature de code + politique hors-ligne. Structuration adossée à la livraison de ces chantiers.

---

## Tableau de synthèse — adéquation par profil

| Profil | Atout principal exploité | Écart le plus coûteux pour lui |
|---|---|---|
| Réseau de garages | Fonctionnel atelier + white-label | Multi-garage + import |
| Distributeur de pièces | Catalogue/stock/fournisseurs/BC | API /v1 démo (à construire) |
| Éditeur concurrent | Socle sécurité/licensing/CI | Recouvrement fonctionnel |
| Groupe SaaS vertical | Control-plane + docs + CI | E2E, IAM admin, observabilité |
| Société e-invoicing / PDP | Fondamentaux facturation sains | Zéro facturation électronique |
| Groupement d'achat | Distribution multi-adhérents | Multi-garage + import + signature |

---
*Réf. croisée : voir `docs/ACQUISITION_READINESS_AUDIT.md`.*
