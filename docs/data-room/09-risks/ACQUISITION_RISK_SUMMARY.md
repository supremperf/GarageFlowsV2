<!-- doc-status: actif -->

# GarageFlows — Acquisition Risk Summary

Lecture < 5 min pour un CTO. Sans marketing. Détail par item :
`OPEN_ITEMS.md` ; séparation code/externe : `EXTERNAL_VALIDATIONS.md`.

## Par sévérité

### Critical — **0**
Aucun risque critique CODE connu non traité.

### High — 4 (tous non bloquants pour la due diligence)
| ID | État | Action |
|---|---|---|
| AUD-005 | `EXTERNAL_ACTION_REQUIRED` | rotation + purge historique (opérateur) |
| AUD-006 | `EXTERNAL_ACTION_REQUIRED` | rotation prouvée `verify:rotation` (opérateur) |
| AUD-008 | `EXTERNAL_ACTION_REQUIRED` | Authenticode (certificat opérateur) |
| AUD-010 | `CODE_OPEN` | refonte clé admin → identités/jetons courts (dev) |

### Medium — 4
| ID | État | Action |
|---|---|---|
| AUD-007 | `BUSINESS_DECISION_REQUIRED` | décider sort du HMAC déprécié |
| AUD-011 | `BUSINESS_DECISION_REQUIRED` | device-proof notifications (2 phases) |
| AUD-024 | `CODE_OPEN` | CSP nonce (dev) |
| AUD-023 | `CODE_OPEN` | E2E authentifié en CI (dev) |

### Low — 3
AUD-012 (`RISK_ACCEPTED`, intentionnel) · rétentions journaux (`CODE_OPEN`) ·
handlers portail restants (`CODE_OPEN`).

## Par nature

**Code risks (dev interne)** : AUD-010, AUD-024, AUD-023, AUD-022, AUD-026,
e-invoicing PDF/A-3, anonymisation RGPD, rétentions — *aucun critique*.

**External operational actions (opérateur)** : rotation des secrets + preuve
(AUD-005/006), purge d'historique git, certificat Authenticode (AUD-008),
déploiement staging/production réel, exercice de restauration.

**Legal / accounting validations** : CGV, CLUF, DPA, cession PI, RGPD
juridique (DPO) ; validation FEC (expert-comptable).

**Production infrastructure validations** : migration sur staging Neon,
backup/restore réel chronométré, test de charge, alerting/APM.

**Accepted residual risks** : AUD-012 (mechanic hors vitrine, intentionnel) ;
`'unsafe-inline'` scripts CSP (verrouillé par test en attendant le nonce).

## Verdict

Risque technique **CODE** : faible et outillé (0 critique ouvert, gardes CI
bloquantes, release gate reproductible). Le risque résiduel est concentré sur
des **actions externes** (secrets, Windows, infrastructure) et des
**validations tierces** (juridique, comptable, e-invoicing), normales à ce
stade pré-acquisition. Classification globale :
**`DUE_DILIGENCE_READY_WITH_CONDITIONS`**
(cf. `docs/audit/FINAL_VERIFICATION_BASELINE.md`).
