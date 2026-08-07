# Data room GarageFlows — index des livrables & checklist de transfert

Ce document est l'**index unique** des pièces produites par l'audit de
préparation à l'acquisition (lots A à L) et la **checklist de transfert
d'actifs**. Chaque pièce est un fichier du dépôt, versionné et traçable par
commit. L'état de préparation fait foi dans `docs/PRODUCTION-READINESS.md` ;
le verdict global dans `docs/audit/RAPPORT_FINAL_AUDIT.md`.

## 1. Pièces de la data room — dépôt `GarageFlowsV2` (application)

| Pièce | Emplacement | Contenu | Lot |
|---|---|---|---|
| Baseline d'audit | `BASELINE.md` | état initial, versions, périmètre | A |
| Empreintes initiales | `INITIAL_SHA256.txt` | SHA-256 des deux dépôts au début de l'audit | A |
| Inventaire du dépôt | `REPOSITORY_INVENTORY.md` | 12 sous-systèmes cartographiés | A |
| Journal d'audit | `WORKLOG.md` | opérations horodatées, preuves, commits | A–L |
| Plan d'exécution | `docs/audit/AUDIT_EXECUTION_PLAN.md` | lots A–L, états | A–L |
| Registre de risques | `docs/audit/RISK_REGISTER.md` | 48 findings AUD-001..048, états et preuves | A–L |
| Modèle de menaces | `docs/audit/THREAT_MODEL.md` | STRIDE par frontière de confiance | B |
| Rapport final | `docs/audit/RAPPORT_FINAL_AUDIT.md` | verdict (échelle à 6 niveaux), scores par axe | L |
| Source de vérité préparation | `docs/PRODUCTION-READINESS.md` | seul état de préparation faisant foi | J |
| SBOM | `docs/sbom/sbom-garageflowsv2.cdx.json` | CycloneDX, composants de production | E |
| Inventaire de licences | `docs/sbom/LICENSE_INVENTORY.md` | analyse copyleft/permissif | E |
| Notices tierces | `THIRD_PARTY_NOTICES.md` | attributions générées | E |
| Licence propriétaire | `LICENSE` | tous droits réservés | E |
| Provenance du code | `docs/PROVENANCE.md` | faits observables, développement assisté par IA tracé | E |
| Registre RGPD (projet) | `docs/legal/RGPD_REGISTRE_TRAITEMENTS.md` | art. 30 — à valider par conseil | E |
| Observabilité / runbook | `docs/OBSERVABILITY.md` | signaux, seuils, procédures de panne | G |
| Budget de performance | `docs/PERFORMANCE_BUDGET.md` + `perf-budget.json` | mesures + garde CI | G |
| Matrice concurrentielle | `docs/COMPETITIVE_MATRIX.md` | comparatif sourcé du marché FR | K |
| Tenant de démonstration | `prisma/demo-tenant.ts` | seed riche + reset scopé (voir §3) | K |

## 2. Pièces de la data room — dépôt `garagesite3` (vitrine + control-plane)

| Pièce | Emplacement | Contenu | Lot |
|---|---|---|---|
| SBOM | `docs/sbom/sbom-garagesite3.cdx.json` | CycloneDX | E |
| Notices tierces | `THIRD_PARTY_NOTICES.md` | attributions générées | E |
| Licence propriétaire | `LICENSE` | tous droits réservés | E |

## 3. Environnement de démonstration (lot K)

Tenant de démo **scripté, réinitialisable, strictement scopé** :

```bash
npm run demo:seed    # crée le tenant s'il n'existe pas (idempotent)
npm run demo:reset   # supprime le tenant de démo puis le re-crée (état neuf)
npm run demo:wipe    # suppression seule
```

- Contenu semé : 2 comptes (OWNER + RECEPTIONIST), 5 mécaniciens, 6 clients,
  7 véhicules, 8 références de stock (prix en dix-millièmes d'€ exacts),
  9 interventions (aujourd'hui + demain), 3 devis `DEV-…-001..003`,
  4 factures `FAC-…-001..004` (payées/envoyée/brouillon), 2 rendez-vous.
  Compteurs de numérotation posés en cohérence (`invoiceCounter=4`,
  `quoteCounter=3`) — aucune collision avec les documents créés ensuite.
- **Sécurité du reset** : double marqueur d'identité (slug `demo-garage` **et**
  email `contact@garage-demo.fr`) — un garage réel n'est jamais supprimé ;
  refus si `NODE_ENV=production` sans `DEMO_RESET_FORCE=1` ; suppression par
  cascade Prisma (0 ligne orpheline vérifiée sur 12 tables).
- **Mot de passe** : jamais dans le dépôt — `SEED_ADMIN_PASSWORD` ou généré
  aléatoirement et affiché une seule fois.

## 4. Outils de vérification transférés avec le code

| Outil | Commande | Rôle |
|---|---|---|
| Chaîne de gardes CI | `npm run check:consistency` | 10 gardes (marque, docs, monnaie ×3, migrations ×3, PWA, fichiers critiques) |
| Budget de perf | `npm run check:perf-budget` | poids du bundle client (après build) |
| Preuve de rotation | `npm run verify:rotation` | empreintes SHA-256 vs manifeste des secrets compromis |
| Scan de secrets | gitleaks (config `.gitleaks.toml`, 2 dépôts) | 0 fuite vérifié sur `git archive HEAD` |
| Suites de tests | `npm test` (+ tests PostgreSQL réels sous `TEST_POSTGRES_URL`) | baseline datée dans PRODUCTION-READINESS §3 |

## 5. Checklist de transfert d'actifs

À dérouler lors de la cession ; chaque ligne indique qui agit. La rotation des
secrets est **obligatoire et à prouver** — un secret déjà exposé reste considéré
compromis tant que `verify:rotation` ne démontre pas le contraire (AUD-004).

### 5.1 Code & dépôts
- [ ] Transfert des dépôts `GarageFlowsV2` et `garagesite3` (cédant → acquéreur).
- [ ] Revue des branches ouvertes ; la branche d'audit contient tous les livrables.
- [ ] Vérification des empreintes vs `INITIAL_SHA256.txt` + historique des commits d'audit.
- [ ] Transfert de la propriété des workflows CI (secrets GitHub Actions **recréés**, jamais copiés).

### 5.2 Secrets & clés (rotation obligatoire — preuve exigée)
- [ ] Rotation de **tous** les secrets d'exécution (session, portail, SSE, admin, SMTP, base) par l'acquéreur.
- [ ] Exécution de `npm run verify:rotation` → sortie « OK » archivée comme preuve (AUD-004).
- [ ] Remise de la **clé privée ECDSA de signature des licences** (détenue hors dépôt) par canal sûr, puis décision : conservation ou re-keying (AUD-007).
- [ ] `GF_SIGNATURE_SECRET` (sceau des signatures) : généré côté acquéreur, jamais transmis.

### 5.3 Infrastructure & services
- [ ] Domaines (`garageflows.fr` et sous-domaines) : transfert de registrar + DNS.
- [ ] Hébergement vitrine/control-plane (Vercel ou équivalent) : transfert de projet ou redéploiement.
- [ ] Base PostgreSQL serveur : export/import contrôlé + `validate-server-db` sur base neuve.
- [ ] Upstash/Redis (rate-limit distribué fail-closed) : compte acquéreur + nouvelles clés.
- [ ] SMTP transactionnel : compte acquéreur, secrets chiffrés via `encrypt-smtp-secrets`.

### 5.4 Distribution desktop (Windows)
- [ ] Certificat **Authenticode** au nom de l'acquéreur puis signature des installeurs (AUD-013 — à ce jour l'installeur n'est pas signé).
- [ ] Chaîne de mise à jour : republication des artefacts de MàJ signés.

### 5.5 Juridique & conformité (conseil externe requis)
- [ ] CLUF/EULA et CGV finalisés par conseil (AUD-015).
- [ ] DPA sous-traitants + validation du registre RGPD art. 30 (base projet fournie).
- [ ] Cession de droits de propriété intellectuelle formalisée (base factuelle : `docs/PROVENANCE.md`, AUD-016).
- [ ] Revue des affirmations marketing de la vitrine vs capacités réelles (AUD-044).

### 5.6 Données & continuité
- [ ] Inventaire des instances clientes existantes (le cas échéant) et plan de migration.
- [ ] Sauvegardes : procédure prouvée (`restore-roundtrip`, AUD-017) — transmettre les clés de chiffrement de backup par canal sûr, puis rotation.
- [ ] Tenant de démonstration recréé côté acquéreur (`npm run demo:reset`).

## 6. Limites honnêtes de cette data room

- Les pièces juridiques (CLUF, DPA, cession PI) sont des **prérequis externes**
  (conseil/DPO) : la data room fournit les bases factuelles, pas les actes.
- La preuve de rotation des secrets ne peut être produite que par le détenteur
  de l'infrastructure ; l'outil `verify:rotation` est fourni à cet effet.
- La matrice concurrentielle (`docs/COMPETITIVE_MATRIX.md`) est un instantané
  sourcé à sa date de collecte — les prix et périmètres des concurrents évoluent.
