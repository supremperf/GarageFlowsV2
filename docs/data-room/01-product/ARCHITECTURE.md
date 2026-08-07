# Architecture

> **Document canonique : [`docs/DATABASE_ARCHITECTURE.md`](../../../docs/DATABASE_ARCHITECTURE.md)** — cette fiche de data room est
> un pointeur : le contenu fait foi à l'emplacement canonique (anti-divergence).

Next.js 14 (App Router) + Prisma double schéma (SQLite desktop / PostgreSQL serveur) + Electron 31 + PWA. Frontières de confiance et flux : docs/audit/THREAT_MODEL.md ; e-invoicing : docs/EINVOICING_ARCHITECTURE.md.
