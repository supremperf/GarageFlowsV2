<!-- doc-numbers: journal -->
<!-- doc-status: actif -->

# Rapport final — GarageFlows Software Hardening V15

> Journal point-dans-le-temps. Source d'état faisant foi :
> `FINAL_VERIFICATION_BASELINE.md` / `artifacts/verification/baseline.json`.
> Verdict : `SOFTWARE_FINAL_VERDICT.md`. Dette : `SOFTWARE_TECH_DEBT_FINAL.md`.

## 1. Objet

Passe **exclusivement logicielle** : trouver et corriger les faiblesses de code
restantes de GarageFlowsV2, chacune avec une preuve reproductible (test). Aucun
travail juridique/comptable/contractuel (hors périmètre). Aucune correction
inventée ni résultat non mesuré.

## 2. Méthode

1. Baseline logicielle avant durcissement (`SOFTWARE_V15_PRE_BASELINE.md`).
2. Inventaire des canaux IPC Electron (`ELECTRON_IPC_INVENTORY.md`).
3. Passe **adverse** (chasseurs multiples + vérification indépendante) → 18
   constats ; tri REAL / non-exploitable.
4. Correction des constats confirmés, **un test reproducteur par correctif**.
5. Vérification globale (tsc, lint, suite complète, baseline machine, gardes).

## 3. Corrections livrées

Chaque ligne = commit atomique avec test. Détail en `SOFTWARE_FINAL_VERDICT.md`.

- **Intégrité documentaire (P0/P1)** — OR signé non re-signable (sceau atomique) ;
  facture émise protégée contre la course TOCTOU (re-contrôle en transaction).
- **Portail — prise de contrôle de compte (P1 élevée)** — l'inscription ne lie
  plus un compte au dossier Client d'un tiers par simple correspondance d'email ;
  le rattachement est différé jusqu'à la preuve de possession (vérification email).
- **Open-redirect (P1)** — `callbackUrl` restreint aux chemins internes.
- **Injection FEC (P1)** — neutralisation CSV/formule/délimiteur sur les seuls
  champs texte libres ; montants/dates/comptes intacts.
- **Mass-assignment de statut (P2)** — bons de commande et garanties passent par
  une machine à états ; états terminaux verrouillés (anti ré-inflation de stock,
  anti-contournement des verrous de suppression).
- **Contrôle d'accès financier du copilote (P2)** — `financial:read` requis sur
  les rapports et résolveurs financiers ; intentions opérationnelles ouvertes.
- **Robustesse (P2)** — `bulk-import` borné (anti-DoS), transition de RDV
  atomique, dé-doublonnage mécanicien réel.
- **Défense en profondeur** — listing stock borné + paginé ; RBAC prouvé E2E via
  les vrais handlers.

## 4. Résultats mesurés (ré-exécutés)

| Contrôle | Résultat |
|---|---|
| `tsc --noEmit` | 0 erreur |
| `next lint` | 0 avertissement |
| Suite standard (baseline.json) | 1368 / 1396 (28 ignorés), 0 échec |
| Tests V15 ajoutés | 6 fichiers d'intégration + 1 unitaire (sécurité) |
| Gardes de cohérence | verts |

## 5. Tests introduits par V15

- `src/integration/document-integrity-v15.test.ts`
- `src/integration/portal-account-takeover-v15.test.ts`
- `src/integration/fec-injection-v15.test.ts`
- `src/integration/status-mass-assignment-v15.test.ts`
- `src/integration/copilot-financial-authz-v15.test.ts`
- `src/integration/robustness-v15.test.ts`
- `src/integration/rbac-enforcement-e2e.test.ts`
- `src/lib/__tests__/safe-redirect.test.ts`
- `src/app/api/parts/__tests__/parts-pagination.test.ts`

## 6. Constats VÉRIFIÉS non exploitables (transparence)

Signalés par la passe adverse, **non corrigés car sans vecteur** : IPC
`senderFrame` / consentement crash / `removeAllListeners` ; `findMany`
scopés-garage ; entrées IPC déjà bornées avant V15. Aucun correctif inventé.

## 7. Verdict

`SOFTWARE_PRODUCTION_CANDIDATE`. La montée au niveau supérieur dépend de
prérequis **externes** (signature de code réelle, validations comptable/
juridique, gate complet sur staging réel), listés en `SOFTWARE_TECH_DEBT_FINAL.md`.
