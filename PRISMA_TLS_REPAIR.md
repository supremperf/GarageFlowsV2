---
doc-numbers: journal
---

# MASTER 3 — Diagnostic et réparation Prisma/TLS

**Verdict : BLOQUÉ — aucun moteur Prisma natif officiel n’a pu être obtenu ; les clients natifs et les runtimes ne sont pas validés.**

## 1. Diagnostic précis

| Contrôle | Résultat mesuré | Preuve |
|---|---|---|
| Versions | Prisma et `@prisma/client` 5.22.0 ; Node 22.22.3 ; OpenSSL Node 3.5.6 | `08-prisma-diagnostic-after-restore.txt` |
| Commit moteur attendu | `605197351a3c8bdd595af2d2a9bc3025bca48ea2` | même preuve |
| Cible locale | Linux x64, `debian-openssl-3.0.x` | `01-prisma-network-recheck.txt`, schémas Prisma |
| DNS | `binaries.prisma.sh` et `registry.npmjs.org` résolus | `08-prisma-diagnostic-after-restore.txt` |
| TLS NPM | `secureConnect` établi, certificat autorisé, HTTP 200 | même preuve |
| TLS Prisma | `ECONNRESET`, `tlsEstablished=false`, aucun statut HTTP | même preuve |
| Configuration | `strict-ssl=true`, 145 racines Node, aucun proxy/CA miroir/override de moteur | `01-prisma-network-recheck.txt` |
| Moteurs présents | Aucun | `08-prisma-diagnostic-after-restore.txt` |

La coupure intervient **avant l’établissement de TLS**. Ce résultat ne prouve pas un certificat invalide. Aucune validation TLS n’a été désactivée et aucun miroir arbitraire n’a été utilisé.

## 2. Canaux officiels examinés

| Canal | Commande/contrôle | Code | Résultat |
|---|---|---:|---|
| Installation verrouillée | `npx --yes npm@11.16.0 ci` | 1 | Dépendances installées, postinstall arrêté au SHA distant du moteur |
| Génération desktop | `npx prisma generate --no-engine` | 1 | Prisma 5.22 doit encore obtenir le moteur CLI/DMMF |
| Génération serveur | `npx prisma generate --schema prisma/server/schema.prisma --no-engine` | 1 | Même blocage |
| Paquets natifs `@prisma` | Six noms de paquets ciblés + recherche NPM | 1 pour les six vues | Aucun paquet compatible 5.22.0 trouvé |
| Actions du commit exact | API runs/jobs/artefacts | 0 | Trois runs, aucun artefact ; CI principale en échec |
| Autres artefacts CI | Métadonnées + petit reçu Windows | 1 au téléchargement | Le commit candidat a le même moteur, mais le Blob signé répond EOF ; rien n’est utilisé |
| Logs CI | API du job E2E exact | 1 | Logs non téléchargeables |

Les installateurs CI d’autres commits ne sont **pas** des livrables MASTER 3 et n’ont été utilisés ni comme moteurs ni comme preuve Windows.

## 3. État après tentative

- `node_modules/.prisma/client` contient seulement le client par défaut non initialisé.
- `src/generated/server-client` est absent.
- Aucun fichier `libquery_engine`, `query-engine` ou `schema-engine` natif n’a été installé.
- Le mode `noEngine` n’est pas présenté comme une réparation native.
- Le build, les 79 fichiers de tests appelant `prisma db push`, les cinq imports du client serveur et les runtimes restent bloqués par cette cause.

## 4. Action externe nécessaire

Rendre accessible le canal officiel `binaries.prisma.sh`, ou fournir les moteurs officiels exacts avec leurs empreintes vérifiables pour les cibles déclarées. Il faudra ensuite reprendre l’installation verrouillée, générer les deux clients **sans** `noEngine`, contrôler les moteurs embarqués et exécuter les runtimes sur bases isolées. Un téléchargement depuis une source inconnue, une désactivation de TLS ou un moteur d’une autre version ne débloquera pas la validation.
