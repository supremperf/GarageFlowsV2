# Database Architecture

> **Document canonique : [`docs/DATABASE_ARCHITECTURE.md`](../../../docs/DATABASE_ARCHITECTURE.md)** — cette fiche de data room est
> un pointeur : le contenu fait foi à l'emplacement canonique (anti-divergence).

Double schéma Prisma aligné (SQLite desktop / PostgreSQL serveur), runner de migration desktop fail-closed à checksums, migrations PG à vérification par colonne avant tout DROP.
