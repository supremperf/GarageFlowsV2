<!-- doc-numbers: journal -->
<!-- doc-status: actif -->

# Software V15 — verdict final logiciel

> Journal point-dans-le-temps. État faisant foi : `FINAL_VERIFICATION_BASELINE.md`
> / `artifacts/verification/baseline.json`. Ce document conclut la passe V15
> (durcissement logiciel exclusif) ; il ne remplace pas la baseline canonique.

## Classification

**`SOFTWARE_PRODUCTION_CANDIDATE`**

Le logiciel — code applicatif, API, isolation multi-garage, autorisation,
intégrité financière, machine à états documentaire, portail client, Electron —
ne porte, dans le périmètre V15, aucun risque de sécurité code ouvert connu.
Chaque faiblesse confirmée par la passe adverse a été corrigée **avec une preuve
reproductible**. La montée au niveau `PRODUCTION_READY` dépend exclusivement de
prérequis **externes non logiciels** (signature Authenticode réelle, validations
comptable/juridique, exécution du gate complet sur staging réel) — cf.
`SOFTWARE_TECH_DEBT_FINAL.md` §1.

## Base de preuve (ré-exécutée)

| Contrôle | Résultat |
|---|---|
| `tsc --noEmit` | 0 erreur |
| `next lint` | 0 avertissement |
| Suite standard (baseline.json) | 1368 / 1396 (28 ignorés), 0 échec |
| Gardes de cohérence (marque, docs, PWA, monnaie ×3, migrations ×3, fichiers critiques) | verts |

## Ce que V15 a durci (chaîne : faille → correctif → test)

| Sévérité | Faiblesse | Correctif | Preuve |
|---|---|---|---|
| P0 | OR signé re-signable / signature écrasable | Sceau atomique `updateMany(signedAt=null)` — anti-TOCTOU | `document-integrity-v15` |
| P1 | Facture émise ré-éditable via course TOCTOU | Re-contrôle du verrou **dans** la transaction | `document-integrity-v15` |
| P1 (élevée) | Prise de contrôle de compte portail par email | Rattachement Client **différé** à la vérification d'email | `portal-account-takeover-v15` |
| P1 | Open-redirect via `callbackUrl` | `safeInternalPath` — chemins internes uniquement | `safe-redirect` |
| P1 | Injection FEC (CSV/formule/délimiteur) | Neutralisation des champs TEXTE libres uniquement | `fec-injection-v15` |
| P2 | Mass-assignment statut BC → ré-inflation stock | États terminaux `received`/`cancelled` verrouillés | `status-mass-assignment-v15` |
| P2 | Mass-assignment statut garantie → suppression réclamée | `claimed` terminal + verrou `claimedAt` | `status-mass-assignment-v15` |
| P2 | Données financières copilote sans contrôle d'accès | Gate `financial:read` sur les résolveurs financiers | `copilot-financial-authz-v15` |
| P2 | `bulk-import` non borné (DoS) | Plafond 500 opérations/requête | `robustness-v15` |
| P2 | Transition RDV non atomique | `updateMany` conditionné au statut observé | `robustness-v15` |
| P2 | Dé-doublonnage mécanicien illusoire (P2002 mort) | Dé-doublonnage applicatif réel | `robustness-v15` |
| Def. | Listing stock non borné | Pagination + plafond 5000 | `parts-pagination` |
| Def. | RBAC de bout en bout | Preuve via vrais handlers | `rbac-enforcement-e2e` |

## Limites explicites (non couvertes par ce verdict)

- Le verdict porte sur le **logiciel**. Il n'atteste ni la conformité juridique,
  ni la validation comptable, ni la signature de code — toutes externes.
- Aucune protection logicielle locale n'est réputée absolue ; le durcissement
  Electron réduit la surface, il ne la supprime pas.
- Les contrôles conditionnels (PostgreSQL/Redis réels, build de production)
  doivent être exécutés sur l'infrastructure cible avant tout déploiement.
