# GarageFlow — Structures de transaction

*Options de structuration pour une cession dans la fourchette 150 k – 350 k EUR. Document indicatif : à valider par conseils juridique et fiscal. Aucun montant ci-dessous n'est un engagement ; les pourcentages illustrent la logique de répartition du risque.*

Rappel structurant : le produit **ne s'exploite pas sans transfert d'actifs hors dépôt** (clés privées de signature, backend control-plane, domaines garageflows.fr) et **sans cession de PI écrite**. Toute structure doit rendre ces transferts **explicites et conditionnels**.

---

## 1. Vente d'actifs (asset sale) — recommandée

Cession des actifs plutôt que des titres : les deux bases de code, la marque et les assets (`public/`), les domaines, le backend, et — condition centrale — **les clés privées de signature**.

- **Avantages** : périmètre net, pas de reprise de passif, chaîne de titre clarifiée par une cession de PI dédiée.
- **Points d'attention** : neither dépôt ne contient de fichier LICENSE ni d'assignation de PI ⇒ la cession écrite est **indispensable** (risque high de l'audit). Confirmer que sharp/libvips reste lié dynamiquement et non modifié.
- **Livrables de cession** : code, docs (`docs/`), clés privées, accès backend + base, domaines/DNS, comptes d'hébergement, procédure de build Windows.

---

## 2. Paiement échelonné en composantes

Décomposer le prix pour aligner paiement et livraison/vérification. Exemple de répartition indicative :

| Composante | Déclencheur | Part indicative |
|---|---|---|
| **Upfront (signature)** | Signature LOI/SPA, remise du code + docs | 30-40 % |
| **Paiement de transfert** | Remise **vérifiée** des clés privées + backend + domaines + cession de PI, test d'exploitabilité réussi (l'acquéreur émet une licence et signe une mise à jour de bout en bout) | 20-30 % |
| **Intégration** | Transfert de connaissance réalisé, build reproductible côté acquéreur | 10-15 % |
| **Maintenance / transition** | Période de support (ex. 3-6 mois) exécutée | 10-15 % |
| **Earn-out** | Jalons post-acquisition définis par l'acquéreur (adoption, livraison d'un chantier) | 10-20 % |

Le **paiement de transfert** est la clé de voûte : il protège l'acquéreur (pas de paiement sans exploitabilité prouvée) et le vendeur (les clés ne partent qu'une fois ce paiement sécurisé, ex. séquestre).

---

## 3. Séquestre (escrow) des clés et du prix

- **Séquestre des clés privées** : dépôt chez un tiers, libéré à l'acquéreur au closing contre libération simultanée du paiement de transfert. Neutralise le risque irréversible du transfert de clés.
- **Séquestre d'une fraction du prix** (ex. 10 %) sur 6-12 mois en garantie des déclarations (notamment PI/chaîne de titre et propriété des domaines, non vérifiables depuis le code).

---

## 4. Earn-out (aligner le prix sur la traction future)

Puisque aucune traction n'est affirmée, une part earn-out laisse l'acquéreur payer davantage **s'il réussit** la mise en marché. Jalons possibles (à définir par l'acquéreur) : livraison de la conformité facturation électronique, nombre d'installations activées via le control-plane, mise en production de l'API persistante. Éviter les jalons dépendant d'éléments hors du contrôle du vendeur après cession.

---

## 5. Licence exclusive (alternative à la cession)

Si l'acquéreur ne veut pas acheter les actifs immédiatement : **licence exclusive** d'exploitation (éventuellement par territoire/segment) contre redevance + option d'achat.

- **Avantages** : ticket d'entrée réduit, test grandeur nature avant acquisition ferme.
- **Points d'attention** : l'exploitation reste **impossible sans les clés/backend/domaines** — la licence doit donc inclure l'accès opérationnel à ces actifs (ou leur mise à disposition), sinon elle est vide de substance. Prévoir gouvernance des mises à jour signées et de l'émission de licences pendant la période de licence.

---

## 6. Contrat de transition / support (complément, non substitut)

Adossé à toute structure : une prestation de transition (transfert de connaissance, aide au premier build signé, à la première release) valorisée séparément. Renforce la réussite du transfert des P0 sans grever le prix d'actif.

---

## Conditions suspensives recommandées (toutes structures)

1. Remise et validation des **deux clés privées** de signature.
2. Transfert opérationnel du **backend control-plane + base**.
3. Transfert des **domaines garageflows.fr**, DNS et hébergement.
4. **Cession de PI écrite** couvrant les deux dépôts et les assets de marque.
5. **Test d'exploitabilité** de bout en bout réussi par l'acquéreur.

---
*Réf. croisée : voir `docs/ACQUISITION_READINESS_AUDIT.md` et `docs/TRANSFER_PLAYBOOK.md`.*
