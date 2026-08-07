# Rapport final d'audit — GarageFlows (lot L)

> Synthèse de sortie de l'audit maître « acquisition-readiness » mené sur les
> deux dépôts (GarageFlowsV2 = application ; garagesite3 = vitrine + control-plane).
> Ce rapport ne remplace pas le détail : il renvoie au `RISK_REGISTER.md`
> (48 findings AUD-001..048, preuves `fichier:ligne`), au `WORKLOG.md` (journal
> horodaté des commandes réellement exécutées) et à l'`AUDIT_EXECUTION_PLAN.md`
> (lots A→L). Aucune affirmation de statut non étayée ; les points non
> exécutables ici sont explicitement assignés.

## 1. Échelle de verdict (6 niveaux)

| Niveau | Verdict | Signification |
|---|---|---|
| 1 | **GO** | Déployable et cessible sans réserve. |
| 2 | **GO sous conditions mineures** | Déployable ; réserves cosmétiques/non bloquantes. |
| 3 | **PRÉPARÉ — NON DÉPLOYÉ — SOUS CONDITIONS** | Socle technique corrigé et prouvé ; il RESTE des actions externes (infra, juridique) avant mise en production/cession. |
| 4 | **NON PRÊT — corrections majeures requises** | Défauts bloquants non corrigés. |
| 5 | **NON PRÊT — refonte partielle** | Défauts structurels. |
| 6 | **NO-GO / rejet** | Non viable en l'état. |

## 2. Verdict

> **Niveau 3 — PRÉPARÉ — NON DÉPLOYÉ — SOUS CONDITIONS.**

Cohérent avec `docs/PRODUCTION-READINESS.md`. Les priorités techniques 1 à 5 du
mandat (perte de données, fuite inter-garages, exactitude financière,
licences/sessions, PI technique) ont été traitées et **prouvées par des tests
exécutés** ; les conditions restantes relèvent d'actions **externes** (rotation
de secrets en production, revue juridique RGPD/CLUF, signature de l'installeur,
décisions produit) — voir §5. Le verdict ne pourra passer au niveau 2 puis 1
qu'une fois ces conditions levées et vérifiées.

## 3. Bilan des risques (registre)

48 findings recensés : **15 CORRIGÉS** (correctif + test dans cette session),
**3 PARTIELS**, **2 CONFIRMÉS avec mécanisme de preuve livré**, **28 PLAUSIBLES**
(en grande majorité de sévérité moyenne/basse relevant des lots non encore
traités G–L, ou conditionnés à une action externe).

Aucun risque **critique ou haut de perte de données / fuite inter-garages /
exactitude financière** ne reste ouvert côté technique : ceux identifiés
(AUD-001, 002, 004, 019, 020, 017) sont corrigés et prouvés.

## 4. Scores par axe (/100, sans moyenne masquante)

> Règle : un axe portant un point bloquant NON levé est plafonné, quel que soit
> le reste. Le score reflète l'état **vérifiable dans ce dépôt**, hors actions
> externes.

| # | Axe (priorité) | Score | Justification |
|---|---|---|---|
| 1 | Aucune perte de données | **90** | Immutabilité documents (machine à états) + restauration de sauvegarde prouvée par round-trip réel. −10 : parcours E2E métier complet non automatisé. |
| 2 | Isolation inter-garages | **95** | Audit statique 141 routes (0 faille) + matrice de permutation end-to-end + matrice de rôles 128 cellules. −5 : handlers portail/mécanicien peu couverts par tests dédiés (AUD-022). |
| 3 | Exactitude financière | **90** | Zéro Float re-prouvé, numérotation concurrente prouvée sur PostgreSQL réel, immutabilité, FEC (taux réel, nom DGFiP). −10 : validation comptable FEC (706/707, exercice décalé) = expert-comptable. |
| 4 | Licences & sessions / authz | **80** | Isolation + rôles + control-plane durci (rate-limit fail-closed, CORS, SSE, blob-upload). −20 : refonte clé admin (AUD-010), preuve d'appareil notifications (AUD-011), type `mechanic` vitrine (AUD-012) — décisions/rollout à cadrer. |
| 5 | Propriété intellectuelle | **70** | SBOM + notices + inventaire (0 copyleft fort) + LICENSE + provenance livrés. −30 : CLUF/EULA, cession de droits, garantie non-contrefaçon = conseil PI. |
| 6 | Conformité (RGPD/secrets) | **55** | Registre RGPD art. 30 (projet), mécanisme de preuve de rotation, gitleaks durci. −45 : rotation/purge effectives (infra), DPA art. 28, procédures droits/violations, consentement cookies = DPO/avocat + opérateur. |
| 7 | Résilience | **75** | Restauration prouvée, migrations fail-closed, E2E câblée en CI. −25 : observabilité/alertes, budget de perf, parcours E2E authentifié. |

Les axes 8 (maintenabilité), 9 (performance) et 10 (démonstration) relèvent des
lots H–K non encore traités et ne sont pas notés ici.

## 5. Conditions de levée (actions externes — hors périmètre technique)

| Condition | Responsable | Référence |
|---|---|---|
| Rotation effective des secrets en production + preuve `verify:rotation` | opérateur (Vercel/Neon) | AUD-005/006 |
| Purge de l'historique git (après rotation, avec sauvegarde miroir) | propriétaire du dépôt | SECRETS_ROTATION.md §4 |
| DPA art. 28, CLUF/EULA, CGV, revue RGPD, consentement cookies | avocat / DPO | AUD-014/016 |
| Signature Authenticode de l'installeur Windows | opérateur (poste Windows) | AUD-008 |
| Refonte clé admin (identités + expiration) | décision produit | AUD-010 |
| Preuve d'appareil notifications (rollout coordonné 2 phases) | produit + dev | AUD-011 |
| Confirmation du rejet du type `mechanic` par la vitrine | propriétaire | AUD-012 |
| Validation comptable FEC (imputation, arrondis, exercice) | expert-comptable | lot D résiduel |
| Parcours E2E métier authentifié en CI | dev (identifiants semés) | AUD-023 |

## 6. Travaux restants dans le dépôt (lots non traités)

Depuis la première édition de ce rapport, les lots B (modèle de menaces),
G (observabilité + budget de perf), H (error boundary, RTL, a11y StockPanel),
I (tests admin/stock/portail + garde critical-files en CI), J (synchronisation
documentaire) et K (tenant de démo scripté, matrice concurrentielle sourcée,
data room + checklist de transfert) ont été livrés — voir `WORKLOG.md` et le
registre pour les commits et preuves.

Restent poursuivables sans intervention externe : durcissement CSP à nonce
(AUD-024), i18n complète des 27 composants restants (AUD-026 partiel), tests
des autres handlers du portail (AUD-022 partiel), parcours E2E métier
authentifié en CI (AUD-023), connecteur e-invoicing abstrait + validation de
formats (lot D résiduel), ADR formels et runbooks complémentaires.

## 7. Preuves exécutées (rappel)

Toutes les corrections de cette session ont été validées : `tsc` 0, `next lint`
0, 9/9 gardes de cohérence verts, tests ciblés verts (dont concurrence de
numérotation et restauration de sauvegarde sur base réelle), migration PG
appliquée et index vérifiés, gitleaks 0 fuite sur les deux dépôts. Détails
horodatés dans `WORKLOG.md`.
