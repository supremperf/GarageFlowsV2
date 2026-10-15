<!-- doc-numbers: journal -->
# Config — génération automatique des clés (15 octobre 2026)

**PARTIELLEMENT VALIDÉ — NON PRÊT POUR LA PRODUCTION.**

## Demande et comportement livré

`node config` (mode complet par défaut, également via `config.cmd`) crée et enregistre les clés locales sans demander leurs valeurs sur une première installation. L’autorisation initiale `AUTORISER` reste nécessaire pour le plan ; la connexion aux fournisseurs et l’inspection de la base précèdent la génération. Aucune clé réelle de ce poste ni aucun compte de production n’a été configuré pendant cette intervention.

- Secrets de 32 octets (256 bits) issus de `crypto.randomBytes`, base64 ou hex selon le contrat : sessions, pepper, API interne GarageFlow, MAC/HMAC-SHA256, portail, signatures, SMTP, TOTP et sauvegardes. La clé de facturation est préparée uniquement sur une base serveur vide ; pas d’activation automatique de facturation.
- Première paire de licence P-256 : `keys/private.pem`, `keys/public.pem`, représentation base64 pour `.env.server.local`, synchronisation des ancrages publics via le véritable script `sync-public-key.mjs`. Le keygen reprend la même clé API que le serveur.
- Premier signer Ed25519 : coffre hors dépôt, clé publique ajoutée en conservant toutes les anciennes ; chemin/keyId dans `publisher.json`. Préparation avant setup desktop, migrations et déploiement.
- Reçu `GarageFlow-configuration/generated-keys.json` : empreinte publique de l’émetteur et indicateurs de première création/publication, sans secret. Reprise d’une synchronisation interrompue avec exactement la même paire ; contrôle de tous les ancrages, pas seulement Next.
- Écritures initiales exclusives : aucun écrasement d’un fichier existant, y compris une création concurrente. Réutilisation des originaux ; préservation des octets du PEM existant (PKCS#8, SEC1 ou chiffré).
- Une base utilisée, une clé publique/configuration d’émetteur sans son privé, un reçu divergent/corrompu ou la perte d’un signer déjà initialisé empêchent la régénération aveugle. Les clés historiques `*_OLD` ne sont pas inventées.
- SHA-256 est un algorithme, pas un secret à taper. Les jetons Anthropic/Vercel/Neon/Upstash restent émis par les fournisseurs. Les protections génériques/reset `autoGenerate=false` et `autoManage=false` de la clé de licence sont conservées ; seul le premier provisionnement contrôlé du mode complet crée une paire.
- Les profils ciblés restent des modes experts avec confirmation d’autorité ; cette automatisation sans choix de source de licence vise le mode complet demandé.

## Préflight et réconciliation du checkout

Le checkout restauré indiquait c4a2cca2cf446f96be580e99cca8afbca45396c5 au lieu du dernier commit publié cd131e5b2a1ac016babdc7b25621ba64661e0b77. Avant toute correction, comparaison de **1 897 blobs suivis** au commit distant : tous identiques, zéro manquant, zéro différence. Réalignement uniquement des métadonnées HEAD/index avec comparaison-and-swap et `read-tree` sans `-u` ; aucun fichier de travail supprimé, restauré ou remplacé. Preuve locale : `/home/user/config-reconciliation-2026-10-15.json`.

## Vérifications de cette exécution

- **VALIDÉ** : 77 tests du configurateur réussis, 0 échec, 0 ignoré, sortie 0. Les 65 tests préexistants sont conservés ; 12 nouvelles régressions couvrent première génération, fichiers exclusifs, reprise, absence de rotation, perte/corruption et préservation SEC1.
- **VALIDÉ** : crypto réelle Node/OpenSSL dans des fixtures jetables : création P-256/Ed25519, signature/vérification, chiffrement/déchiffrement AES-256-GCM et HMAC-SHA256 ; vrai script de synchronisation publique. Pas une preuve de licence émise par une autorité externe.
- **VALIDÉ** : premier plan complet et relances, sans saisie de clé locale, avec fournisseurs/SQL/déploiement simulés. Les originaux et le signer restent identiques après interruption/reprise ; les historiques de vérification Ed25519 sont conservés.
- **VALIDÉ** : contrat d’environnement (120 entrées), documentation, 7 contrôles de syntaxe, inventaire `--list` en lecture seule et espaces des fichiers modifiés.
- **VALIDÉ** : 2 tests de politique scanner, indépendants des 77 tests de configuration. Ne constitue pas un scan Gitleaks officiel.
- **BLOQUÉ** : exécution native CMD/ACL Windows et intégration sur vrais comptes/bases ; aucun runner Windows isolé ni environnement privé fourni pour cette intervention. Aucun déploiement réel lancé.
- **EN ATTENTE DE REVUE** : changements locaux non committés/non publiés ; aucune fusion, rotation réelle, signature de release ou mise en production. L’audit global et ses critères ouverts restent inchangés.

## Identité et reçus

- Node v22.22.3, Linux ; cwd `/home/user/GarageFlowsV2` ; branche `arena/c9eaae15-garageflowsv2` ; HEAD de référence `cd131e5b2a1ac016babdc7b25621ba64661e0b77`.
- Première commande finale : 2026-10-15T07:55:13.479323+02:00, Europe/Paris.
- Empreinte agrégée des 11 sources du contrôle : `d44d5c80537cf2f4d7fb291eda669ebf6b209ea15e68dc2fba7e7f2212c35b1b` (SHA-256 du JSON trié des SHA-256).
- Journaux et métadonnées exactes : `/home/user/config-key-generation-2026-10-15/final/`. Les reçus conservent commande, heure/fuseau, cwd, HEAD/branche, empreinte, sortie et hash du journal ; hors dépôt, non publiés. Les premières exécutions restent dans le répertoire parent, sans fusion de leurs comptes ni écrasement des preuves précédentes.

| ID | Commande | Sortie/statut | SHA-256 du journal |
|---|---|---|---|
| KEY-FINAL-01 | `node --test tests/config.test.cjs tests/config-full.test.cjs` | 0 / VALIDÉ | `b72c08dd97a85727d33c53aa3f614a829f016178b7b0bf207aa26126998da12f` |
| KEY-FINAL-02 | `node scripts/check-env-consistency.mjs` | 0 / VALIDÉ | `153ca4536bd8be9353e8c8344acdad3ecbeccf41dff6331b6e349dfbfec67de4` |
| KEY-FINAL-03 | `node scripts/check-docs-consistency.mjs` | 0 / VALIDÉ | `1db85b4f7586553d10cd684df7d53e2d44d82d9bc59a381c65530c2ac6bde0e1` |
| KEY-FINAL-04 | `node --test tests/secret-scan-policy.test.cjs` | 0 / VALIDÉ | `e3a3f03c3b392ea72705a6523478da32c2555afd28dcb902564222d11aa9b83a` |
| KEY-FINAL-05 | `node config --list` | 0 / VALIDÉ | `aca2bdde30a9935a130bcc20d146a81b0596781fbb9447a9a878a8c9c30b9d44` |
| KEY-FINAL-06 | `git diff --check` | 0 / VALIDÉ | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| KEY-FINAL-07 | `node --check config` | 0 / VALIDÉ | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| KEY-FINAL-08 | `node --check scripts/config-core.cjs` | 0 / VALIDÉ | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| KEY-FINAL-09 | `node --check scripts/config-full.cjs` | 0 / VALIDÉ | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| KEY-FINAL-10 | `node --check scripts/config-services.cjs` | 0 / VALIDÉ | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| KEY-FINAL-11 | `node --check scripts/config-keys.cjs` | 0 / VALIDÉ | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| KEY-FINAL-12 | `node --check tests/config.test.cjs` | 0 / VALIDÉ | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| KEY-FINAL-13 | `node --check tests/config-full.test.cjs` | 0 / VALIDÉ | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |

## Sources de la relecture ciblée

Relecture des flux modifiés et de leurs appelants ; les empreintes/ranges ci-dessous n’équivalent pas à une validation fonctionnelle de toutes les lignes historiques. Les tests externes simulés ne deviennent pas réels par cette lecture.

| Fichier | Lignes | SHA-256 |
|---|---:|---|
| `config` | 599 | `b86d68ec402b31aaaee270a78d68393b9808160cb68b618802f5bd108de6382c` |
| `scripts/config-core.cjs` | 237 | `d697b8e73aa24bc57533d8704983f3ce940dbc8aecea1243cd2c6bc2f5ce364f` |
| `scripts/config-full.cjs` | 338 | `5a3dfcc3dcd693abebd22f374ef7deeecb2ac94a90b2a0f17aabe128db4b0a76` |
| `scripts/config-services.cjs` | 309 | `a334a8eeb5f10d952b8e21ccb88119263bd099c4ffcbf77691cc012ccc7fa7c1` |
| `scripts/config-keys.cjs` | 38 | `75492bb0777ed4de9568b6f40d684f84b991e09e3a0e5f3817b004b5fa834edb` |
| `scripts/garageflow-env-manifest.json` | 2017 | `f86967d7ced07eb697b8f8ccd2e0f16ea819aae49aa02565341f72f840728943` |
| `tests/config.test.cjs` | 498 | `f9ab19b49bd3df58ff40448d11de1ca9b9b0f316f1e9a93aaeb34c915bd92cae` |
| `tests/config-full.test.cjs` | 651 | `4faf90621a8dbd85a104a289582b1afa0424707dfc660bbf6dadeaa2fa7beac6` |
| `docs/CONFIG.md` | 173 | `86e1017379488af2b9ee6a55849a4fdd5d91e745368f7b235beb064f10b8c253` |
| `.env.example` | 304 | `dbad18141c7a73c509e454c49540ed1f65c99067421effe54a3cdce496f5c5c6` |
| `ENVIRONMENT-VARIABLES.md` | 230 | `b8dc25bb588dbce3e09e8a7d7d0040540632633e22f986ff2263bee087a26adc` |

Le contrôle documentaire et les espaces sont répétés après création de ce rapport, avec reçu `report-checks.json` local. Les preuves historiques d’audit et le rapport du 14 octobre ne sont pas réécrits/reliés à ces nouvelles sources.

Guide : [CONFIG.md](CONFIG.md). **Décision globale : NON PRÊT POUR LA PRODUCTION** ; cette correction valide localement l’automatisation des clés, pas les comptes cloud, les clients déjà installés, garagesite3, l’ensemble du produit ou les contrôles CI obligatoires.
