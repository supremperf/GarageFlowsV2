# Test Strategy

> **Document canonique : [`docs/PRODUCTION-READINESS.md`](../../../docs/PRODUCTION-READINESS.md)** — cette fiche de data room est
> un pointeur : le contenu fait foi à l'emplacement canonique (anti-divergence).

Pyramide réelle : unitaires + intégration (vitest, SQLite réel), suites conditionnelles PostgreSQL/Redis réels (concurrence), E2E métier via vrais handlers, Playwright responsive contre build de production, 10 gardes CI, release gate final. Baseline chiffrée unique : PRODUCTION-READINESS §3 + FINAL_VERIFICATION_BASELINE.
