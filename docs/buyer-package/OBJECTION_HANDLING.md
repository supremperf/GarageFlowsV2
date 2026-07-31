# GarageFlow — Traitement des objections (réponses honnêtes)

*Principe : chaque objection réelle reçoit une réponse factuelle, sans enjolivement. Concéder ce qui est vrai, recadrer sur la valeur réelle, proposer une structuration qui répartit le risque.*

---

## Objection 1 — « Vous n'avez pas de clients / pas de traction prouvée. »

**Réponse honnête.** Exact : ce dossier ne présente aucun chiffre de clients, de revenu ou de churn, car ces éléments ne sont pas vérifiés et ne doivent pas l'être à votre place. Ce qui est vendu ici est **un actif logiciel et sa PI**, pas un fonds de commerce.

**Recadrage.** La valeur repose sur le **time-to-market évité** : un socle sécurité/licensing/control-plane de qualité production-candidate, testé (~857 cas, CI complète), qui représente plusieurs mois-ingénieur. Si vous apportez la distribution (réseau, canal, base installée), vous combinez votre marché à une infrastructure déjà construite.

**Structuration.** Une part **earn-out** peut aligner le prix sur la traction que *vous* générerez, réduisant votre risque d'entrée (voir `TRANSACTION_STRUCTURES.md`).

---

## Objection 2 — « Il n'y a pas de facturation électronique, alors que le mandat français arrive. »

**Réponse honnête.** Exact et assumé : **aucune** implémentation Factur-X/UBL/CII, aucun raccordement Chorus Pro/PDP, pas d'e-reporting, TVA mono-taux, pas de SIRET acheteur snapshotté, pas de modèle Avoir/Paiement. C'est un **chantier pluri-mensuel** avant conformité au mandat 2026-2027.

**Recadrage.** Les **fondamentaux** sur lesquels cette conformité se construit sont sains : numérotation séquentielle sans trou, immuabilité des factures émises, TVA exacte en centimes entiers, export FEC présent. On ne repart pas de zéro sur le modèle de facturation, seulement sur la couche normée.

**Structuration.** Deux options : (a) décote reflétant le coût du chantier ; (b) pour un acquéreur **PDP/e-invoicing**, c'est une **synergie** — vous apportez la capacité manquante. Voir `docs/E_INVOICING_ARCHITECTURE.md` pour le design proposé (proposition, pas fonctionnalité existante).

---

## Objection 3 — « Le produit dépend d'actifs que je ne vois pas dans le code (clés, backend, domaines) — comment l'exploiter ? »

**Réponse honnête.** C'est le **bloquant P0** et il est documenté sans détour : les clés privées de signature (licence ECC P-256, mise à jour Ed25519) sont **côté serveur uniquement**, le backend control-plane et les domaines garageflows.fr sont **hors dépôt**. Sans leur transfert, vous ne pouvez **ni émettre une licence ni signer une mise à jour**.

**Recadrage.** Ce ne sont pas des lacunes de code mais des **transferts d'actifs** — normaux dans une cession. Ils deviennent des **conditions suspensives** de closing.

**Structuration.** Prévoir un **paiement de transfert** distinct, conditionné à la remise vérifiée des clés/backend/domaines et de la cession de PI ; test d'acceptation = vous **émettez une licence et signez une mise à jour de bout en bout** vous-même avant de libérer ce paiement. Voir `docs/TRANSFER_PLAYBOOK.md`.

---

## Objection 4 — « L'API publique est vendue comme une plateforme d'intégration, mais c'est une démo. »

**Réponse honnête.** Exact : `/api/v1` est un **bac à sable in-memory non persistant** (documenté dans `store.ts`), qui perd les données au cold start serverless et n'a pas de webhooks. Il ne faut pas la valoriser comme une plateforme de production.

**Recadrage.** L'architecture, l'OpenAPI et l'authentification par clé existent ; la construire réellement = brancher la persistance + autorisation + rate-limiting distribué + webhooks. C'est un chantier cadré, pas une inconnue.

---

## Objection 5 — « Pas de tests E2E, donc toute modification est risquée. »

**Réponse honnête.** Exact : aucun Playwright/Cypress ni test de composant `.tsx` ; la couche UI est validée manuellement. La couverture est mesurée (v8) mais **non bloquante**.

**Recadrage.** Le **backend** est, lui, très couvert (~857 cas, faible mock, intégration réelle Postgres/Redis en CI) — c'est là qu'est la logique critique (licence, isolation, TVA, updates). Le chantier E2E est de quelques semaines et bien délimité.

---

## Objection 6 — « Le binaire Windows n'est pas signé et l'app se verrouille après 72 h hors-ligne. »

**Réponse honnête.** Exact sur les deux points : aucune signature de code configurée (SmartScreen « éditeur inconnu »), et `LOCK_PERIOD_MS = 72h` déclenche `app.quit()`. Pour des garages parfois mal connectés, le verrou dur est une vraie limite.

**Recadrage.** Deux corrections cadrées : procurer un certificat OV/EV et le câbler dans electron-builder ; ré-architecturer la grâce hors-ligne (durée configurable / mode dégradé lecture seule au lieu d'un arrêt forcé). Coûts identifiés, pas structurels.

---

## Objection 7 — « Le white-label est vendu comme 'un fichier de config', mais ce n'est pas câblé. »

**Réponse honnête.** Exact : `src/config/brand.ts` est une excellente config typée (Zod, 3 couches), mais seulement ~2 consommateurs `BRAND.*` hors du fichier ; le nom/titre/logo/couleurs sont codés en dur dans ~40+ endroits (~146 occurrences « GarageFlow »). Un rebranding complet touche des dizaines de fichiers, pas un seul.

**Recadrage.** La **fondation** (schéma de marque, override env/JSON) réduit tout de même le coût futur ; le câblage UI est un chantier mécanique. Voir `docs/WHITE_LABEL_GUIDE.md`.

---

## Objection 8 — « Pas d'import de données : comment migrer les garages existants ? »

**Réponse honnête.** Exact : aucune capacité d'import CSV/Excel (pas de parser, pas d'UI/mapping/dry-run) ; le CSV existant est **export-only**. Toute migration depuis un outil concurrent nécessite du développement.

**Recadrage.** C'est un module additif clairement borné, à chiffrer dans le plan d'intégration. Voir `docs/DATA_MIGRATION_GUIDE.md` (guide/proposition).

---

## Objection 9 — « Le back-office admin repose sur une clé unique partagée. »

**Réponse honnête.** Exact : toutes les opérations admin du licensing s'authentifient contre une **clé statique unique** (comparée en temps constant, ce qui est bien), sans identité par opérateur, MFA, RBAC ni rotation sans redéploiement. La clé est stockée en sessionStorage côté navigateur.

**Recadrage.** Fonctionnel pour un exploitant solo ; un vrai IAM admin est un chantier de durcissement à budgéter avant une exploitation en équipe / montée en gamme.

---

## Posture générale

Ne jamais nier une lacune réelle. La transparence sur les bloquants P0 et les écarts **augmente** la confiance de l'acquéreur et protège la transaction en due diligence. Chaque objection valide est déjà adressée dans la data room.

---
*Réf. croisée : voir `docs/ACQUISITION_READINESS_AUDIT.md`.*
