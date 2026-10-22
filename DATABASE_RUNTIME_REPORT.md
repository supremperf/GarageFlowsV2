---
doc-numbers: journal
---

# MASTER 3 — Validation des runtimes de bases de données

**Verdict : BLOQUÉ — aucun runtime Prisma natif SQLite ou PostgreSQL n’a été validé.**

## 1. Contrôles réels

| Contrôle | Résultat | Preuve |
|---|---|---|
| Instanciation du client desktop | Échec : `@prisma/client did not initialize yet` | `25-database-runtime-and-access.txt` |
| Module client serveur | `src/generated/server-client` absent | même preuve |
| Génération desktop | Code 1, moteur indisponible | `11-prisma-noengine-test-bootstrap.txt` |
| Génération serveur | Code 1, moteur indisponible | même preuve |
| Tests appelant SQLite via Prisma | 79 fichiers encore rouges dans la passe finale | `vitest-final-results.json` |
| Accès PostgreSQL de test | Aucun DSN de test fourni | `25-database-runtime-and-access.txt` |

## 2. Statut par runtime

- **SQLite/Prisma natif : NON EXÉCUTÉ.** Le client est un stub non initialisé ; les anciens contrôles `node:sqlite` ne valident pas ce runtime.
- **PostgreSQL/Prisma natif : BLOQUÉ.** Le moteur et le client sont absents, et aucun accès PostgreSQL de test n’est disponible.
- **Migrations sur base neuve et restauration : NON EXÉCUTÉES dans MASTER 3.** Leur prérequis natif manque.
- **Staging PostgreSQL/Redis : BLOQUÉ — ACCÈS MANQUANT.** Aucun service n’est fabriqué ou supposé vert.

## 3. Préservation des données

Au début de la restauration des dépendances, `.env` et `prisma/dev.db` étaient absents du nouvel environnement. Le postinstall officiel les a créés sans écraser de fichiers existants. La nouvelle base fait 909 312 octets et est identique au modèle `prisma/garageflow-template.db` ; `.env` a été placé en mode 600 (`07-local-dev-files-after-restore.txt`).

Les passes Vitest et build confirment ensuite que ces deux fichiers restent inchangés. Aucune base utilisateur, migration destructive, réinitialisation ou opération de production n’a été effectuée. Aucune valeur de DSN ou de secret n’est consignée.
