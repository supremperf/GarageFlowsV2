---
doc-numbers: journal
---

# MASTER 4 — Prisma et bases de données

**Date : 22 octobre 2026 (Europe/Paris).**  
**Statut global : BLOCKED — les moteurs natifs officiels et les runtimes ne sont pas disponibles.**

## 1. Versions, cibles et configuration

| Contrôle | Résultat | Statut | Preuve |
|---|---|---|---|
| Prisma / Client | 5.22.0 / 5.22.0 ; specs communes `^5.16.1` | PASS de cohérence uniquement | `logs/02-prisma-native-generation.txt` |
| Moteur attendu | `605197351a3c8bdd595af2d2a9bc3025bca48ea2` | PASS d’identification | même preuve |
| Desktop | SQLite ; `native`, `windows`, `debian-openssl-3.0.x` | Cible compatible avec Windows x64/NSIS, non validée | schéma et `logs/01-architecture-and-config-inventory.txt` |
| Serveur | PostgreSQL ; `native`, `rhel-openssl-3.0.x`, `debian-openssl-3.0.x` | Cibles déclarées, non validées | même preuve |
| TLS npm | `strict-ssl=true`, registre officiel, HTTP 200 et certificat autorisé | PASS | `logs/02-prisma-native-generation.txt` |
| Proxy/CA/overrides | Aucun proxy, CA additionnelle ou chemin de moteur défini | PASS de diagnostic | même preuve |

## 2. Réseau et génération native

| Commande/contrôle | Code | Résultat | Statut |
|---|---:|---|---|
| `node scripts/diagnose-prisma-runtime.cjs` | 1 | DNS résolu ; `binaries.prisma.sh` en `ECONNRESET`, `tlsEstablished=false` ; NPM HTTP 200 | FAIL |
| `npx prisma generate` | 1 | Échec au SHA `libquery_engine` Debian | FAIL |
| `npx prisma generate --schema prisma/server/schema.prisma` | 1 | Même échec avant génération | FAIL |
| Inventaire des moteurs | — | Aucun fichier natif ; client serveur absent | BLOCKED |

La coupure réseau est démontrée **avant la négociation TLS**. Le proxy ou l’équipement de filtrage précis ne peut pas être identifié depuis ce symptôme. Il n’est donc ni affirmé que le certificat Prisma est invalide, ni qu’un proxy précis est en cause. Aucun contournement TLS, miroir ou moteur non officiel n’a été utilisé.

## 3. Bases et opérations réelles

- Client desktop : stub non initialisé ; **BLOCKED**.
- Client PostgreSQL serveur : non généré ; **BLOCKED**.
- Lecture/écriture SQLite via Prisma : **NOT RUN**.
- Connexion, requêtes et transactions PostgreSQL : **NOT RUN**, moteur et accès absents.
- Empreintes de moteurs : aucune référence officielle téléchargée, aucun binaire à vérifier ; **NOT RUN**.
- `.env` et `prisma/dev.db` : inchangés pendant les deux tentatives ; **PASS de préservation**.

Les canaux officiels déjà épuisés dans MASTER 3 — paquets natifs inexistants, releases sans moteur, artefacts CI non téléchargeables — ne sont pas représentés comme une nouvelle réussite. La correction externe requise est l’accès à `binaries.prisma.sh` ou la fourniture des moteurs officiels exacts avec références d’intégrité. Ensuite seulement pourront être exécutés les tests sur bases temporaires isolées, sans `DROP` ni migration destructive sur une base existante.
