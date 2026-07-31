# GarageFlow — Script de démonstration métier

*Public : direction / produit de l'acquéreur. Objectif : montrer le parcours atelier réel. Factuel : on démontre des fonctionnalités présentes ; on ne cite aucun chiffre de clients/revenu. Durée cible : 30-40 min.*

Jeu de données de démo (vérifié) : « Garage Demo » seedé avec **5 mécaniciens et 13 jobs** (`prisma/seed.ts`), connexion via identifiant de démo étiqueté `admingarageflow@admin.fr`. `npm run db:reset` remet à zéro entre deux passages.

---

## 0. Positionnement (2 min)

« GarageFlow gère le quotidien d'un garage indépendant : de l'accueil du véhicule à la facture. Je vais dérouler un parcours réel sur des données de démonstration. » Préciser d'emblée : périmètre **mono-garage par installation** ; pas de vue réseau consolidée (limitation connue).

---

## 1. Tableau de bord & réception (5 min)

- Ouvrir le **Dashboard** : charge de l'atelier, jobs en cours (13 en démo), mécaniciens (5).
- **ReceptionBoard / ScheduleBoard / WeekView** : planification des rendez-vous, affectation aux mécaniciens.
- Message : le planning et l'affectation sont opérationnels et scoping-garage.

---

## 2. Véhicule & client (5 min)

- Créer/ouvrir un **client** et un **véhicule** ; montrer l'historique véhicule (`VehicleHistoryModal`).
- Démontrer **VIN decoder** et **OCR plaque** (`plate-ocr`) : saisie assistée de l'immatriculation/du véhicule (fonctions IA optionnelles, dégradation gracieuse sans clé API).

---

## 3. Ordre de réparation, devis, facture (10 min)

- Créer un **work-order / OR** ; ajouter des **opérations de main-d'œuvre** (catalogue) et des **pièces** (catalogue pièces).
- Générer un **devis** puis une **facture**.
- Points forts à souligner (vérifiés) : **numérotation séquentielle sans trou** (transactionnelle), **immuabilité de la facture émise** (les éditions financières sont bloquées après émission), **TVA calculée en centimes entiers** (TTC = HT + TVA exact).
- Honnêteté à afficher : **TVA mono-taux** au niveau en-tête (pas de multi-taux par ligne), **pas de modèle Avoir ni Paiement** en base (l'UI renvoie « créez un avoir » mais le workflow n'est pas modélisé), **pas de facturation électronique** (Factur-X/Chorus Pro) — chantier à venir pour le mandat 2026-2027.

---

## 4. Stock, fournisseurs, achats (5 min)

- **StockPanel** + **prévision de stock** ; **SuppliersPanel** ; **bons de commande**.
- Montrer le lien pièces → stock → réapprovisionnement fournisseur.

---

## 5. Modules complémentaires (5 min)

- **Inspections** (checklist), **garanties**, **prêt de véhicule (loaner)**, **rappels/reminders**, **signatures**, **rapports** et **tableau de bord financier / rentabilité**.
- **Copilot** : couche d'assistance provider-agnostique (déterministe par défaut).

---

## 6. Personnalisation & exploitation (3 min)

- Évoquer la config **white-label** (marque/couleurs) — préciser honnêtement qu'elle est **partiellement câblée** dans l'UI aujourd'hui (fondation présente, finalisation à prévoir pour un rebranding complet).
- Sauvegardes chiffrées : capacité présente côté moteur, **UI à construire**.

---

## 7. Ce qu'il faut retenir (2 min)

- Parcours atelier de bout en bout **fonctionnel** sur les briques cœur.
- Fondamentaux de facturation **sains** — bonne base pour la conformité électronique à venir.
- Limites assumées : mono-garage, pas d'import, facturation électronique et Avoir/Paiement à construire.

---
*Réf. croisée : voir `docs/ACQUISITION_READINESS_AUDIT.md`.*
