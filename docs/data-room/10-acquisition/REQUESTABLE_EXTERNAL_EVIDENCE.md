<!-- doc-status: actif -->

# Requestable External Evidence — pièces qu'un acquéreur peut demander

Preuves qui vivent HORS du dépôt (ou qui exigent un environnement réel), qu'une
équipe de due diligence peut légitimement réclamer. **Aucune donnée
personnelle réelle ne doit être placée dans le dépôt** — les exemples doivent
être anonymisés.

## Preuves reproductibles depuis le dépôt (peuvent être fournies telles quelles)
- **SBOM** : `docs/sbom/*.cdx.json` (2 dépôts).
- **Audit licences OSS** : `docs/legal/OPEN_SOURCE_LICENSE_AUDIT.md`.
- **Liste des dépendances** : `package.json` + `package-lock.json`.
- **Schéma de base** : `prisma/schema.prisma` (desktop) + `prisma/server/schema.prisma`.
- **Baseline de vérification** : `docs/audit/FINAL_VERIFICATION_BASELINE.md` +
  `artifacts/verification/baseline.json`.
- **Résultats de tests** : reproductibles via `npm run release:gate`
  (rapport JSON `artifacts/verification/test-results.json`).

## Preuves à produire depuis un environnement réel (externe)
- **Capture d'écran CI verte** (run GitHub Actions) + logs de job.
- **Rapport de tests d'un run CI** (artefact Actions).
- **Artefacts de build Windows** (`.exe`, installeur) + **hash SHA-256** publiés par release.
- **Certificat Authenticode** + preuve de signature/timestamp de l'installeur.
- **Logs de migration** exécutée sur staging/production (Neon).
- **Rapport de restauration de sauvegarde** (exercice chronométré : RPO/RTO réels).
- **Rapport de test de charge** (p50/p95/p99) sur infra réelle (`scripts/loadtest.mjs`).
- **Exemples de factures Factur-X** générées, **anonymisées** (aucun client réel).

## Preuves juridiques / organisationnelles (propriétaire)
- **DPA** signés avec les sous-traitants (hébergeur, e-mail, e-invoicing).
- **CGV**, **CLUF/EULA**, politique de confidentialité.
- **Cessions de droits PI** (contributeurs/prestataires) + attestation
  non-contrefaçon.
- **Propriété** : domaines (`garageflows.fr`), comptes SaaS (Vercel/Neon/Upstash/
  SMTP), comptes de stores, certificats.
- **Preuve de propriété du code source** et des dépôts.

## Note
La reproductibilité est privilégiée : la plupart des preuves techniques se
régénèrent depuis le dépôt (`npm run release:gate`, `npm sbom`,
`verify:rotation`). Les preuves d'exécution réelle et les pièces juridiques
relèvent des validations externes (`../09-risks/EXTERNAL_VALIDATIONS.md`).
