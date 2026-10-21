# AUDIT_DATABASE — 2026-10-21

## 1. Schémas

| Base | Fichier | Modèles | Migrations |
|---|---|---|---|
| Poste (SQLite) | `prisma/schema.prisma` | 43 | 2 dans `prisma/migrations`, plus le modèle vide `prisma/garageflow-template.db` et les migrations applicatives de `src/lib/migrations.ts` |
| Serveur (PostgreSQL) | `prisma/server/schema.prisma` | 47 | 22 dans `prisma/server/migrations` |

Les 4 modèles propres au serveur (`GarageEInvoiceConnection`,
`EInvoiceTransmission`, `EInvoiceEvent`, `EInvoiceAuditEvent`) sont la
dérogation déclarée du contrôle de parité. `serverPrisma()` refuse leur accès
sur un poste.

## 2. Contrôles exécutés

| Contrôle | Résultat |
|---|---|
| `prisma validate` (poste, serveur) | valides |
| `check:migration-safety`, `check:pg-migrations`, `check:converge-additive`, `check:sqlite-template` | exit 0 |
| 22 migrations sur PostgreSQL 16 **vierge** + migration JSON monétaire v1 → v2 + smoke CRUD | réussi (`scripts/gate-fresh-postgres.mjs`) |
| Suites PostgreSQL réelles (`*.postgres.int.test.ts`) : appareils, session licenciée, numérotation, stock | toutes vertes |
| Intégrité transactionnelle SQLite : rollback après décrément, stock jamais négatif, journal des mouvements cohérent | vert (`stock-double-deduction.int.test.ts`) |

## 3. Anomalie corrigée : interblocage SQLite (GF-1021-01)

Voir `BUGFIX_CHANGELOG.md`. Toute transaction concurrente sur le poste était
exposée : validation de facture, activation d'appareil, numérotation. Le
plafond de sièges et l'unicité de numéro tenaient, car les perdants étaient
annulés, mais au prix d'un gel de 5 s et d'une erreur côté utilisateur. Le
client SQLite sérialise maintenant ses transactions. PostgreSQL garde ses
verrous de ligne (`FOR UPDATE`), prouvés par les tests de concurrence réels.

## 4. Points non vérifiés

- Migration d'une **copie de la base Neon de production** : aucun accès.
- Mise à niveau d'une base poste issue d'une version réellement installée chez
  un client : seul le modèle du dépôt a été utilisé.
- Comportement sous charge multi-instance Vercel avec Neon (pool, latence) :
  non mesuré.
