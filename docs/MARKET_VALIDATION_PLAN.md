# Plan de validation marché — GarageFlow

> Document data room. Ce document est un **PLAN** : il fournit les outils et le processus
> pour **collecter** une preuve marché, sans inventer aucun client, témoignage, chiffre
> d'affaires, note ou LOI. Tous les objectifs chiffrés ci-dessous sont des **cibles à
> atteindre**, pas des résultats obtenus. À la date de rédaction, aucun résultat de
> validation marché vérifié n'est présenté ; les sections « Résultats » restent vides et
> doivent être remplies uniquement avec des données réelles, datées et traçables.

## 0. Principe d'honnêteté (non négociable)

- Aucune donnée de ce plan ne doit être présentée comme un résultat tant qu'elle n'a pas
  été **réellement collectée**, datée et attribuée à une personne/entreprise identifiable
  (avec son consentement).
- Distinguer toujours : **cible** (objectif) vs **résultat** (observé).
- Ne jamais fabriquer de témoignage, de logo client, de note (rating), de certification ou
  de valorisation.

## 1. Cibles de validation (objectifs — PLAN, pas résultats)

| Étape | Cible | Signal recherché |
|---|---|---|
| Entretiens de découverte | **30** | Compréhension du problème, disposition à payer |
| Démonstrations produit | **10** | Adéquation produit/besoin, objections |
| Pilotes (usage réel) | **5** | Rétention, usage récurrent, valeur perçue |
| Lettres d'intention (LOI) | **3** | Intention d'achat / engagement conditionnel |

> Ces nombres sont des **jalons de validation**, pas des ventes réalisées. Toute
> communication à un acquéreur doit indiquer l'état réel : « X/30 entretiens réalisés au
> [date] ».

## 2. Grille de qualification des prospects (ICP)

À remplir pour chaque prospect **avant** entretien/démo. Sert à filtrer et prioriser.

| Critère | Valeurs | Pondération |
|---|---|---|
| Type d'établissement | Garage indépendant / MRA / réseau / concession | — |
| Nb de baies / postes | 1-2 / 3-5 / 6+ | Fort |
| Nb de mécaniciens | 1-3 / 4-8 / 9+ | Moyen |
| Outil actuel | Papier/Excel / logiciel concurrent / aucun | Fort |
| Facturation | Papier / logiciel / expert-comptable | Fort |
| Sensibilité e-invoicing 2026-2027 | Nulle / consciente / bloquante | **Fort** |
| Accès internet atelier | Fiable / intermittent / absent | Fort (cf. lock offline 72h) |
| Budget mensuel logiciel | < 50 € / 50-150 € / 150 €+ | Fort |
| Décideur joignable | Oui / non | Fort |

**Score de qualification :** additionner les critères « Fort » favorables. Prioriser les
prospects à fort score et à sensibilité e-invoicing élevée (le produit **n'ayant pas**
encore de facturation électronique — voir §7, à ne pas surpromettre).

## 3. Questionnaire d'entretien de découverte (structure)

Entretien non-directif, ~30 min. **Ne pas pitcher** avant la partie D.

**A. Contexte (5 min)**
1. Décrivez votre atelier : nb de postes, mécaniciens, volume d'interventions/jour.
2. Comment gérez-vous aujourd'hui le planning et la réception des véhicules ?

**B. Problèmes (10 min)**
3. Quelles sont vos 3 principales pertes de temps administratives ?
4. Comment produisez-vous devis et factures aujourd'hui ? Combien de temps par document ?
5. Avez-vous déjà perdu un client faute de relance/suivi ? À quelle fréquence ?
6. Comment suivez-vous la rentabilité par intervention / par mécanicien ?

**C. Contraintes réglementaires (5 min)**
7. Êtes-vous informé de la réforme de la facturation électronique B2B (2026-2027) ?
8. Qui gère votre conformité (expert-comptable, logiciel, vous-même) ?

**D. Solution & disposition à payer (10 min)**
9. Qu'avez-vous déjà essayé ? Pourquoi cela n'a pas marché ?
10. Si un outil réglait [problème n°1 cité], quelle valeur mensuelle y mettriez-vous ?
11. Qui décide de l'achat ? Quel est votre processus de décision ?

> Règle : consigner des **verbatims** datés, pas des interprétations. Ne pas induire les
> réponses. Enregistrement audio uniquement avec consentement explicite.

## 4. Grille de feedback post-démonstration

À remplir immédiatement après chaque démo (échelle 1-5, + verbatim) :

| Dimension | Note (1-5) | Verbatim / objection |
|---|---|---|
| Clarté de la valeur perçue | | |
| Adéquation au flux de travail réel | | |
| Réaction à la facturation (limites e-invoicing énoncées) | | |
| Réaction au fonctionnement hors-ligne (grâce 48h / lock 72h) | | |
| Intérêt pour un pilote | Oui / Non / Peut-être | |
| Prix évoqué spontanément | | |
| Prochaine étape convenue | | |

**Obligation d'honnêteté en démo :** énoncer les limites réelles (pas de facturation
électronique, pas d'import CSV, pas de hiérarchie multi-garage, lock hors-ligne 72h) —
cf. `docs/DEMO_SCRIPT.md`. Un feedback obtenu en masquant les limites n'est pas exploitable.

## 5. Modèle d'accord de pilote (gabarit — à faire valider juridiquement)

> Gabarit non contractuel, à faire relire par un conseil avant usage. Champs `[…]` à remplir.

```
ACCORD DE PILOTE — [Nom éditeur] / [Nom garage]

1. Objet : mise à disposition de GarageFlow à titre d'évaluation pour la période
   du [date] au [date] ([30/60/90] jours).
2. Périmètre : [postes / utilisateurs / modules activés]. Fonctionnalités NON incluses
   et connues comme non construites : facturation électronique (Factur-X/PDP/Chorus),
   import CSV/Excel, hiérarchie multi-garage. Le garage reconnaît en avoir été informé.
3. Données : le garage saisit des données réelles à ses risques ; sauvegardes à sa charge
   (l'interface de sauvegarde n'est pas exposée à ce stade). Aucune donnée n'est revendue.
4. Gratuité / tarif pilote : [gratuit / tarif réduit de [montant]].
5. Engagements du garage : usage réel [X] fois/semaine ; retour structuré en fin de pilote.
6. Confidentialité : réciproque, [durée].
7. RGPD : le garage reste responsable de traitement de ses données clients ; l'éditeur est
   sous-traitant pour l'hébergement/support [préciser].
8. Absence d'engagement d'achat : ce pilote ne vaut pas commande.
9. Résiliation : à tout moment par [préavis], sans frais.
10. Support : [canal], délai indicatif [X] jours ouvrés.

Signatures : [garage] — [éditeur] — [date]
```

## 6. Modèle de lettre d'intention (LOI) — gabarit

> Une LOI est une **intention**, généralement non engageante sur le prix final. À faire
> relire juridiquement. Ne jamais compter une LOI comme un revenu.

```
LETTRE D'INTENTION — [Nom garage]

Nous, [raison sociale, SIRET], déclarons notre intention, sous réserve de [conditions :
budget, validation direction, conformité e-invoicing livrée, etc.], de souscrire à
GarageFlow pour [nb postes/utilisateurs] à un tarif indicatif de [montant]/mois, à compter
de [date cible].

Conditions suspensives connues : [ex. livraison de la facturation électronique conforme,
import de nos données existantes, signature Windows].

Cette lettre exprime une intention et ne constitue pas un engagement ferme d'achat.

[Nom, fonction, signature, date]
```

## 7. Formulaire de liste d'attente (waitlist)

Formulaire de captation d'intérêt entrant. Champs minimaux (RGPD : finalité + consentement) :

- Nom / raison sociale, SIRET (optionnel), e-mail, téléphone.
- Type d'établissement, nb de postes, outil actuel.
- Case : « Je souhaite être recontacté pour une démonstration » (opt-in explicite).
- Case : « J'accepte d'être recontacté au sujet de la conformité facturation électronique ».
- Mention finalité + durée de conservation + droit d'accès/suppression (RGPD).

> Brique technique existante côté cloud : le schéma `garagesite3` contient les modèles
> `Lead` et `NewsletterSubscriber` (migration `add_leads_newsletter`), utilisables comme
> back-end de captation. Vérifier qu'aucune donnée réelle n'y est présentée comme preuve
> tant que la collecte n'a pas eu lieu.

## 8. Processus de collecte du feedback (boucle)

1. **Cadencer** : planifier entretiens/démos par lots hebdomadaires (suivi dans un CRM ou
   tableur unique, source de vérité).
2. **Consigner** : une fiche par prospect (grille §2 + verbatims §3/§4), datée.
3. **Synthétiser** : chaque semaine, regrouper les problèmes par thème et par fréquence.
4. **Prioriser** : croiser fréquence × intensité × disposition à payer.
5. **Reboucler produit** : alimenter la roadmap (notamment les gaps connus : e-invoicing,
   import, offline) — sans transformer un besoin exprimé en fonctionnalité annoncée comme
   livrée.
6. **Reporter honnêtement** : tenir un tableau d'avancement `X/30, Y/10, Z/5, W/3` daté.

## 9. Tableau de suivi des résultats (à remplir avec des données réelles uniquement)

| Étape | Cible | Réalisé (au [date]) | Source/traçabilité |
|---|---|---|---|
| Entretiens | 30 | _(vide — à remplir)_ | |
| Démonstrations | 10 | _(vide)_ | |
| Pilotes | 5 | _(vide)_ | |
| LOI | 3 | _(vide)_ | |

> **Aucun résultat n'est présenté à ce jour.** Ce tableau ne doit contenir que des données
> réellement collectées, vérifiables et consenties. Toute cellule non vide doit renvoyer à
> une preuve datée (fiche entretien, accord signé, LOI).

## 10. Ce qu'il ne faut PAS surpromettre en validation marché

Pour rester crédible et éviter des pilotes/LOI biaisés, énoncer d'emblée les limites réelles
(détaillées dans `docs/ACQUISITION_READINESS_AUDIT.md` et `docs/DEMO_SCRIPT.md`) :

- **Pas de facturation électronique** (Factur-X/UBL/CII/PDP/Chorus) — critique pour le
  marché français 2026-2027.
- **Pas d'import CSV/Excel** — la migration depuis un outil existant demande un chemin manuel.
- **Pas de hiérarchie multi-garage/réseau** — modèle mono-garage.
- **Lock hors-ligne à 72h** — l'app se ferme après 3 jours sans connexion.
- **Binaire Windows non signé** — avertissement « éditeur inconnu » à l'installation.
- **API publique v1 = démo mémoire non persistante** — pas une plateforme d'intégration.

---

*Réf. croisée : voir `docs/ACQUISITION_READINESS_AUDIT.md` pour l'audit complet, les risques classés, les bloquants P0 et les mises en garde d'honnêteté.*
