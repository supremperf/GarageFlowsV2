---
doc-numbers: journal
---

# PRISMA — état final MASTER 5

**Verdict : RÉSOLU.** Les moteurs officiels sont installés, les deux clients sont générés, et des opérations réelles ont été exécutées sur Windows ET sur Linux.

## 1. Ce qui bloquait en MASTER 4, et pourquoi ce n'est plus le cas

MASTER 4 concluait `FAIL/BLOCKED` : « `binaries.prisma.sh` en `ECONNRESET` avant TLS », aucun moteur obtenu, aucun client exploitable. La cause était **réseau, sur l'hôte Linux de cette session-là** — pas une erreur de configuration du dépôt.

MASTER 5 s'exécute sur un autre poste. Le même point d'accès officiel répond normalement :

```
openssl s_client -connect binaries.prisma.sh:443 -servername binaries.prisma.sh
  subject=CN=binaries.prisma.sh
  issuer=C=US, O=Google Trust Services, CN=WE1
  Protocol: TLSv1.3   Cipher: TLS_AES_256_GCM_SHA384
  Verify return code: 0 (ok)
```

Aucun contournement n'a été employé : `strict-ssl` reste à `true`, aucun miroir, aucun moteur d'origine tierce, aucun fichier substitué.
Preuves : `MASTER5_EVIDENCE/logs/02-prisma-version.txt`, `04-prisma-generate.txt`.

## 2. Versions et moteurs réellement présents

| Élément | Windows (poste de build) | Linux (conteneur de vérification) |
|---|---|---|
| `prisma` | 5.22.0 | 5.22.0 |
| `@prisma/client` | 5.22.0 | 5.22.0 |
| cible binaire calculée | `windows` | `debian-openssl-3.0.x` |
| moteur de requêtes | `query_engine-windows.dll.node` — 19 261 952 octets | `libquery_engine-debian-openssl-3.0.x.so.node` — 16 161 048 octets |
| moteur de schéma | `schema-engine-windows.exe` — 18 145 792 octets | `schema-engine-debian-openssl-3.0.x` |
| empreinte de moteur | `605197351a3c8bdd595af2d2a9bc3025bca48ea2` | identique |
| Node.js | v22.23.2 | v22.23.4 |
| OpenSSL | 3.5.9 | 3.0.22 |

Les fichiers ont été constatés sur disque avec leur taille, pas seulement annoncés par `prisma -v`.

## 3. Génération des deux clients

```
npx prisma validate                                    → « schema is valid »
npx prisma generate                                    → node_modules/@prisma/client
npx prisma generate --schema prisma/server/schema.prisma → src/generated/server-client
```

Le client **serveur** embarque les moteurs de déploiement : `libquery_engine-debian-openssl-3.0.x.so.node` et `libquery_engine-rhel-openssl-3.0.x.so.node` (cibles Vercel), en plus de la cible Windows.
Preuve : `MASTER5_EVIDENCE/logs/05-prisma-artifacts.txt`.

## 4. Opérations RÉELLES, pas seulement une génération

Une base SQLite **isolée et jetable** est créée à chaque exécution depuis `prisma/garageflow-template.db` ; `prisma/dev.db` n'est jamais ouverte.

| Contrôle | Windows | Linux |
|---|---|---|
| connexion + version du moteur SQLite | 3.45.0 | 3.45.0 |
| inventaire | 45 tables / 43 modèles | 45 tables / 43 modèles |
| création d'un tenant `Garage` isolé | PASS | PASS |
| CRUD `Client` + relecture DANS la transaction | PASS | PASS |
| relation `Client → Vehicle` résolue par `include` | PASS | PASS |
| isolation multi-tenant (filtre `garageId`) | 1 dans le tenant, 0 hors tenant | idem |
| index réellement utilisé (`EXPLAIN QUERY PLAN`) | `SEARCH Client USING INDEX Client_garageId_idx` | idem |
| annulation de transaction (rollback effectif) | PASS | PASS |
| persistance après déconnexion/reconnexion | PASS | PASS |
| suppression en cascade du tenant | PASS | PASS |

Preuves : `MASTER5_EVIDENCE/logs/06-prisma-runtime-smoke.txt` (Windows) et `25-linux-container-verify.txt` (Linux, conteneur `node:22-bookworm`).

## 5. PostgreSQL serveur

Les 22 migrations serveur ont été **rejouées sur une base vierge** à nom unique, suivies du smoke test de la porte :

```
Datasource "db": PostgreSQL database "gf_gate_check_4932ccf019deb8b9" … neon.tech
22 migrations found in prisma/migrations
All migrations have been successfully applied.
Database schema is up to date!
✅  Base serveur PostgreSQL valide : migrations appliquées, contraintes et cascade vérifiées.
```

Aucun `DROP DATABASE`. La base de contrôle est conservée, pas supprimée automatiquement — voir `ACTIONS_MANUELLES_RESTANTES.md` pour son retrait.
Preuve : `MASTER5_EVIDENCE/logs/18-postgres-gate-fresh.txt`.

## 6. Effet de bord : TypeScript et la suite de tests

L'absence de moteur était la cause **unique** de deux autres blocages de MASTER 4 :

- `npm run type-check` passait de 247 lignes d'erreurs à **0** sans toucher une seule ligne de code applicatif (les types `@prisma/client` sont générés) ;
- les **84 fichiers Vitest en erreur** (79 classés « Prisma natif », 5 « client serveur ») s'exécutent désormais.

Voir `TYPESCRIPT_FINAL.md` et `VITEST_FINAL.md`.

## 7. Un défaut de portabilité corrigé au passage

`prisma migrate status` signale sur `prisma/dev.db` deux migrations non appliquées (`20260424000000_add_record_mac`, `20260425000000_add_audit_log_and_indexes`). C'est le comportement attendu : la base de développement est créée par **copie du modèle committé** (`setup-dev.js`), pas par `migrate deploy` — la table `_prisma_migrations` n'est donc pas renseignée. Le schéma, lui, est à jour. Aucune correction n'a été appliquée : modifier `dev.db` sortirait du mandat.
