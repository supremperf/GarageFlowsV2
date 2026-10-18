# Migration Strategy

> **Document canonique : [`docs/runbooks/PRODUCTION_DATABASE_MIGRATION.md`](../../../docs/runbooks/PRODUCTION_DATABASE_MIGRATION.md)** — cette fiche de data room est
> un pointeur : le contenu fait foi à l'emplacement canonique (anti-divergence).

Backup → staging → validation (base neuve + smoke test) → production (migrate deploy) → vérification → rollback documenté. Interdits explicites (db push/reset en production).
