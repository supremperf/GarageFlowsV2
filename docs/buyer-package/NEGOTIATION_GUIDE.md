# GarageFlow — Guide de négociation

*Usage interne vendeur. Factuel. La fourchette 150 k – 350 k EUR reflète l'audit interne ; ce n'est pas une valorisation certifiée par un tiers. Aucun chiffre commercial n'est affirmé.*

---

## 1. Ancrage de valeur

**Ancre haute (plafond ~350 k).** Justifiée si l'acquéreur valorise le socle technique et la distribution combinée : sécurité production-candidate, control-plane licensing testé, isolation multi-tenant prouvée, PI/dépendances propres, documentation dense. Argument central : **mois-ingénieur évités**, pas volume de code.

**Ancre basse (plancher ~150 k).** Ce que la partie adverse mettra en avant : produit **inexploitable sans transfert d'actifs externes**, **zéro facturation électronique** face au mandat, API publique de démo, absence d'import/multi-garage/E2E, binaire non signé, verrou 72 h.

**Point d'équilibre.** Le prix se déplace selon (a) le profil (une société e-invoicing ou un éditeur concurrent valorise plus le socle), (b) la répartition du risque via la structuration, (c) la vérifiabilité des P0.

---

## 2. Ce qui pousse le prix vers le haut

- Acquéreur **stratégique** dont la faiblesse du produit est sa force (PDP pour l'e-invoicing ; distributeur pour l'API/canal ; éditeur pour le socle).
- P0 **dérisqués proprement** : clés/backend/domaines prêts à transférer, cession de PI rédigée, test d'exploitabilité de bout en bout réalisable.
- Reprise **sans couture** du licensing (l'acquéreur émet une licence / signe une mise à jour lui-même en démo).
- Qualité vérifiable : faire tourner la CI et les tests devant l'acquéreur (678/0 et 140/0, tsc propre).

## 3. Ce qui pousse le prix vers le bas (à anticiper)

- Coût du chantier **facturation électronique** (pluri-mensuel) chiffré par l'acquéreur.
- Coûts additifs : import, multi-garage, E2E, signature de code, IAM admin, politique hors-ligne.
- Incertitude sur les **actifs non vérifiables** (existence/validité/exclusivité des clés, propriété des domaines) — tant qu'ils ne sont pas prouvés, ils justifient une retenue.

---

## 4. Leviers de concession (dans l'ordre de préférence vendeur)

1. **Structuration plutôt que prix** : déplacer une part vers earn-out / paiement de transfert conditionnel plutôt que baisser le montant total (voir `TRANSACTION_STRUCTURES.md`).
2. **Période de transition / support** : offrir de l'accompagnement (intégration, transfert de connaissance) valorise sans décoter le prix de base.
3. **Exclusivité temporaire** de négociation contre engagement de calendrier.
4. **Prix** en dernier recours, adossé à un écart documenté et chiffré (jamais concédé « à l'aveugle »).

---

## 5. Séquencement recommandé

1. NDA → partage du résumé une page + audit d'acquisition.
2. Démos technique et métier (montrer soi-même les limites — cela protège la suite).
3. Due diligence : donner accès à la data room complète (`docs/`).
4. Vérification P0 : plan de transfert (`docs/TRANSFER_PLAYBOOK.md`) + test d'exploitabilité.
5. LOI avec structuration ; conditions suspensives = transferts P0 + cession de PI.
6. Closing par tranches (voir structures).

---

## 6. Lignes rouges vendeur

- Ne pas garantir de chiffres de traction/revenu (non vérifiés) — refuser toute déclaration de ce type dans le contrat.
- Ne pas présenter l'API /v1, la facturation électronique, le white-label complet ou les sauvegardes UI comme **existants** : ce sont des designs/chantiers.
- Ne pas transférer les clés privées avant sécurisation du paiement correspondant (risque irréversible).

## 7. BATNA / alternatives

- Continuer à développer les P1 (câblage white-label, UI backup, cron rollback déjà fait, IAM) pour remonter les scores de transférabilité (45) et de démonstrabilité (57) avant une prochaine ronde.
- Élargir le sourcing acquéreur aux six profils (`STRATEGIC_BUYER_PROFILES.md`) pour créer de la concurrence.

---

## 8. Concessions à obtenir en échange d'un prix ferme

- Calendrier de closing court et engageant.
- Prise en charge par l'acquéreur des chantiers connus (e-invoicing, import) actée dans son plan — ce qui déplace la conversation du prix vers la valeur future.

---
*Réf. croisée : voir `docs/ACQUISITION_READINESS_AUDIT.md`.*
