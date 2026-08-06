# Plan d'exécution — Audit maître GarageFlows (Phases 0 → 29)

> Feuille de route opérationnelle de l'audit « acquisition-readiness ».
> Chaque phase produit des livrables datés et des preuves exécutées ; aucun
> statut « VALIDÉ » sans commande réellement lancée (voir `WORKLOG.md`).
> Priorités absolues, dans l'ordre : 1) aucune perte de données ; 2) aucune
> fuite inter-garages ; 3) exactitude financière ; 4) licences & sessions ;
> 5) propriété intellectuelle ; 6) conformité ; 7) résilience ;
> 8) maintenabilité ; 9) performance ; 10) démonstration.

## Vue d'ensemble et ordre d'exécution

| Lot | Phases | Contenu | Livrables clés | État |
|---|---|---|---|---|
| A | 0 | Conservation, empreintes, cartographie préliminaire | `BASELINE.md`, `INITIAL_SHA256.txt`, `REPOSITORY_INVENTORY.md`, `WORKLOG.md`, ce plan, `docs/audit/RISK_REGISTER.md` | en cours |
| B | 1-3 | Inventaire détaillé, architecture actuelle/cible, modèle de menaces | diagrammes (contexte, conteneurs, auth, licence, facture, e-invoicing, update, reprise, données personnelles, frontières), `THREAT_MODEL.md`, ADR initiaux | à faire |
| C | 4-6 | Sécurité applicative, isolation multi-garage, auth & licences | corrections + tests de permutations inter-garages, matrice de rôles testée, registre des clés, rapport rate-limit/journaux | isolation **faite** ; rate-limit fail-closed + CORS + blob-upload + jeton SSE **faits** (lot D1/D2) ; refonte clé admin (AUD-010) et preuve d'appareil notifications (AUD-011, rollout coordonné) **à cadrer** |
| D | 7-9 | Finance, e-invoicing, signature | revérification zéro Float, tests de concurrence numérotation, immuabilité factures, connecteur abstrait + validation de formats, qualification honnête des signatures | numérotation/concurrence + immuabilité + FEC (taux, nom fichier) + zéro-Float **faits & prouvés (PG réel)** ; connecteur e-invoicing abstrait + validation formats **à faire** ; qualification honnête signatures **à faire** |
| E | 10-11 | RGPD, propriété intellectuelle | registres (traitements, sous-traitants, clés), procédures droits/violations, SBOM SPDX + notices tierces, registre IA, dossier PI | à faire |
| F | 12-15 | BDD, Electron, PWA, contrats API | audit contraintes/concurrence, durcissement Electron/updates, stratégie SW explicite, spécification API + erreurs uniformes | à faire |
| G | 16-18 | Résilience, observabilité, performance | scénarios de panne, preuve de restauration, runbooks/alertes, mesures + budget de perf | à faire |
| H | 19-21 | UX, accessibilité, i18n | corrections UI atelier, audit WCAG 2.2 AA outillé + manuel, formats FR | à faire |
| I | 22-24 | Tests, supply chain, environnements | 30 parcours critiques + négatifs, CI durcie (SBOM/scans), manifeste des variables, scripts Windows documentés | à faire |
| J | 25 | Documentation | synchronisation totale, ADR, runbooks, contrôle automatique des affirmations | à faire |
| K | 26-28 | Démo, concurrence, data room | tenant de démo scripté + reset, matrice concurrentielle sourcée, data room + checklist de transfert | à faire |
| L | 29 | Sortie | critères de sortie vérifiés, scores /100 motivés, rapport final A-L, verdict | à faire |

Règle de séquencement : les lots C et D passent AVANT tout le reste dès la fin
du lot B, car ils portent les priorités 1-4. Les corrections sont commitées par
petits lots prouvés (tests avant/après), jamais en masse.

## Commandes de validation de référence (exécutées à chaque lot)

```bash
npm run type-check          # tsc --noEmit — 0 erreur exigé
npm run lint                # next lint — 0 avertissement exigé
npm test                    # vitest complet (+ TEST_POSTGRES_URL / TEST_REDIS_URL si dispo)
npm run check:consistency   # 9 gardes bloquants : branding, docs, pwa, money,
                            # money-calculations, money-json, migration-safety,
                            # sqlite-template, pg-migrations
npm run build               # build reproductible
DATABASE_URL=… node scripts/validate-server-db.js   # migrations PG réelles + JSON v2 + smoke
npm run test:migration      # migrations SQLite : succès, échecs, rollback, sauvegarde
node scripts/check-version.js
npm audit --omit=dev        # + node scripts/audit-ci.js (porte bloquante)
```

Preuves complémentaires par lot (exemples) : cluster PostgreSQL 16 jetable pour
les tests de migration sur données peuplées ; tests de permutations
inter-garages générés ; exercice de restauration sur environnement isolé.

## Critères de sortie par lot (extraits mesurables)

- **C** : zéro accès inter-garage possible dans les tests de permutations ;
  matrice de rôles couverte par tests positifs ET négatifs ; aucun secret actif
  suivi par git ; registre des clés complet.
- **D** : zéro Float monétaire re-prouvé sur les DEUX schémas ; numérotation
  sous concurrence testée ; facture émise inaltérable prouvée par test ;
  formats e-invoicing validés par schéma sur échantillons.
- **E** : SBOM généré et sans licence inconnue non résolue ; notices tierces
  publiées ; registres RGPD prêts pour revue juridique (revue externe = étape
  obligatoire, non réalisée ici).
- **I** : les 30 parcours critiques automatisés ou explicitement documentés
  comme manuels avec procédure ; CI verte avec les nouveaux contrôles.
- **L** : verdict choisi UNIQUEMENT parmi les 6 verdicts autorisés, justifié
  critère par critère ; aucun score moyenné ne masque un bloqueur.

## Ce qui ne peut PAS être validé dans cet environnement (assignation)

| Étape | Qui | Commande / action attendue |
|---|---|---|
| Build Windows signé + Fuses + Authenticode | opérateur, poste Windows | `npm run dist` puis vérification signature + SmartScreen |
| Scripts `.cmd`/`.ps1` réels | opérateur, poste Windows | dry-run documentés dans chaque script |
| Migration sur dump Neon réel | opérateur, staging Neon | procédure `docs/MIGRATION-MONEY.md §6` |
| E2E navigateur complet | CI dédiée / poste dev | `npx playwright test` |
| Dépôt de marque / e-Soleau / entiercement | conseil PI + fondateur | dossier préparé en lot E |
| Revue juridique RGPD / CGV / DPA | avocat | documents préparés en lot E |
| Validation comptable FEC / arrondis | expert-comptable | jeux d'essai fournis en lot D |
