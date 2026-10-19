<!-- doc-status: actif -->

# External Validations Required — matrice code vs externe

Ce que le code ne peut pas prouver seul. Un item ici n'est **pas** un défaut de
code et ne doit pas être requalifié en bloqueur code. Colonnes : **Code** =
une modification de code est requise ; **Infra** = infrastructure réelle
requise ; **Jur.** = juriste ; **Compta** = expert-comptable ; **Fourn.** =
fournisseur/tiers externe.

| ID | Sujet | Code | Infra | Jur. | Compta | Fourn. | État |
|---|---|:--:|:--:|:--:|:--:|:--:|---|
| EV-01 | Signature Authenticode (installeur Windows) | ± | ✓ | — | — | ✓ (AC) | `EXTERNAL_ACTION_REQUIRED` (AUD-008) — pipeline prêt |
| EV-02 | Rotation effective des secrets + preuve | — | ✓ | — | — | — | `EXTERNAL_ACTION_REQUIRED` (AUD-005/006) — outil `verify:rotation` fourni |
| EV-03 | Purge de l'historique git (secrets) | — | ✓ | — | — | — | `EXTERNAL_ACTION_REQUIRED` — runbook `GIT_HISTORY_SECRET_PURGE.md` |
| EV-04 | Migration sur staging Neon (réel) | — | ✓ | — | — | ✓ (Neon) | `EXTERNAL_VALIDATION_REQUIRED` — runbook migration fourni |
| EV-05 | Restauration de sauvegarde (exercice réel chronométré) | — | ✓ | — | — | — | `EXTERNAL_VALIDATION_REQUIRED` — round-trip desktop déjà prouvé par test |
| EV-06 | Test de charge (p50/p95/p99) sur infra réelle | — | ✓ | — | — | — | `EXTERNAL_VALIDATION_REQUIRED` — `scripts/loadtest.mjs` fourni |
| EV-07 | Raccordement à une plateforme e-invoicing agréée | ✓ | ✓ | — | — | ✓ (PDP/PA) | `EXTERNAL_ACTION_REQUIRED` — architecture d'adaptateurs prête, registre vide |
| EV-08 | Certification / conformité e-invoicing (Schematron, PDF/A-3) | ✓ | — | — | — | ✓ (validateur) | `CODE_OPEN` + `EXTERNAL_VALIDATION_REQUIRED` — XSD MINIMUM déjà validé |
| EV-09 | Validation FEC sur exercice réel | — | — | — | ✓ | — | `EXTERNAL_VALIDATION_REQUIRED` — structure/libellés testés |
| EV-10 | RGPD juridique (bases légales, notifications, DPA) | — | — | ✓ | — | — | `EXTERNAL_VALIDATION_REQUIRED` — mesures techniques art. 32 fournies |
| EV-11 | CGV / CLUF-EULA / politique de confidentialité | — | — | ✓ | — | — | `EXTERNAL_ACTION_REQUIRED` |
| EV-12 | DPA sous-traitants | — | — | ✓ | — | ✓ (héberg.) | `EXTERNAL_ACTION_REQUIRED` |
| EV-13 | Cession de droits PI + attestations contributeurs | — | — | ✓ | — | — | `EXTERNAL_ACTION_REQUIRED` — provenance factuelle fournie |
| EV-14 | Déploiement production (Vercel/équivalent) + env fail-closed | — | ✓ | — | — | ✓ | `EXTERNAL_VALIDATION_REQUIRED` — validation d'env prouvée (démarrage refusé) |
| EV-15 | Tests machines Windows physiques (install/upgrade/SmartScreen) | — | ✓ | — | — | — | `EXTERNAL_VALIDATION_REQUIRED` — protocole fourni |

Légende : ✓ requis · ± partiellement · — non requis.

Aucun de ces items ne bloque une **due diligence** (tous documentés, avec
l'outillage ou le protocole fourni) ; plusieurs bloquent un **déploiement
production** tant qu'ils ne sont pas levés (EV-01, EV-02, EV-14).
