<!-- doc-numbers: journal -->
<!-- doc-status: actif -->

# Software V15 — dette technique résiduelle (état final)

> Journal point-dans-le-temps. La source d'état faisant foi reste
> `FINAL_VERIFICATION_BASELINE.md` / `artifacts/verification/baseline.json`.

| Champ | Valeur |
|---|---|
| Branche | `claude/garageflow-final-unified-merge-ub0l67` |
| Date UTC | 2026-08-07 |
| `tsc --noEmit` | 0 erreur |
| `next lint` | 0 avertissement |
| Suite standard (baseline.json) | 1368 / 1396 (28 ignorés), 0 échec |

Ce document liste **honnêtement** ce qui n'est PAS traité par la passe V15 —
soit parce que hors périmètre logiciel, soit parce que jugé à risque/coût
disproportionné pour un gain marginal. Rien n'est masqué.

## 1. Prérequis externes (hors périmètre logiciel — non corrigeables en code)

Ces points ne sont pas de la dette logicielle : ce sont des actions humaines /
contractuelles à mener avant une mise en production réelle. Le logiciel est prêt
à les recevoir ; il ne peut pas les accomplir lui-même.

- **Signature Authenticode réelle** de l'exécutable Electron : nécessite l'achat
  d'un certificat EV et une infrastructure de signature. Le pipeline de build
  est prêt à consommer un certificat ; aucun n'est fourni.
- **Validation comptable / juridique externe** : conformité FEC, CGV, CLUF, DPA,
  mentions légales — revue par un expert-comptable et un juriste. Le logiciel
  produit des artefacts conformes aux formats ; leur validation légale finale
  est externe.
- **Validation des migrations sur un vrai staging PostgreSQL** et build de
  production dans l'environnement cible : exécutables mais dépendants d'une
  infrastructure non disponible ici (contrôles conditionnels du release gate).

## 2. Dette technique logicielle résiduelle (assumée)

| # | Sujet | Nature | Pourquoi non traité en V15 | Risque résiduel |
|---|---|---|---|---|
| D1 | Unicité mécanicien en base | Le dé-doublonnage est appliqué au niveau **applicatif** (V15), pas par une contrainte SQL `@@unique`. | Ajouter une contrainte sur des données existantes potentiellement « sales » (doublons déjà présents) ferait échouer la migration sans une étape de nettoyage préalable, elle-même risquée sans données réelles. | Faible : fenêtre de course concurrente étroite sur deux créations simultanées du même nom ; corrigé pour le flux normal. |
| D2 | Transitions de statut BC/garantie | Machine à états centralisée (V15), mais **pas** encore de journal d'audit dédié par transition d'inventaire. | Les mutations sont déjà tracées par `logAudit` au niveau route ; un journal par-transition est une amélioration, pas un défaut de sécurité. | Faible. |
| D3 | Rate-limiting distribué | Repli mémoire locale hors production ; Redis requis en PWA multi-instance. | Comportement voulu et déjà documenté ; le test multi-instance est conditionnel (Redis réel). | Faible, connu. |
| D4 | Résolveurs financiers du copilote | Gate `financial:read` sur les résolveurs clairement financiers (CA, marge, revenu client, prévision). `low_stock`/`proactive` exposent un coût de réappro estimé et restent ouverts. | Ce sont des données opérationnelles de stock, pas du résultat comptable ; utiles à la réception. Choix explicite. | Très faible. |
| D5 | Bornes de pagination | `/api/parts` et `bulk-import` bornés (V15). D'autres listings scopés-garage restent non paginés. | Volumétrie par garage petite ; bornés implicitement par le scope tenant. | Faible. |

## 3. Ce qui a été VÉRIFIÉ non exploitable (rejeté, pas corrigé)

Issu de la passe adverse V15 — signalé pour transparence, **volontairement non
modifié** car non exploitable :

- IPC Electron : `senderFrame`, consentement crash (intentionnel), `removeAllListeners`
  du preload — pas de vecteur.
- `findMany` sur work-orders / purchase-orders / jobs-photos : bornés par le
  scope garage, pas de chargement arbitraire cross-tenant.
- Entrées IPC (`pushBreadcrumb`, `sanitizeCrashReport`) : **déjà** bornées
  (longueurs tronquées) avant V15 — aucune correction nécessaire, aucune inventée.

## 4. Suivi recommandé (post-V15, non bloquant logiciel)

1. Migration de nettoyage + contrainte `@@unique([garageId, name])` sur Mechanic
   (après audit des données réelles) — lèverait D1.
2. Exécuter le release gate **complet** avec `TEST_POSTGRES_URL` / `TEST_REDIS_URL`
   réels sur staging (lève les contrôles conditionnels).
3. Signature Authenticode + revue comptable/juridique externe (section 1).
