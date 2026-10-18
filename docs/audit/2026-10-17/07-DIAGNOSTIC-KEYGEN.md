<!-- doc-numbers: journal -->
# PHASE 7 — diagnostic keygen → vérification → activation

## 7.1 — étape 1 : provenance exacte (avant modification)

Constat UTC : 2026-10-17T20:49:19.970822+00:00.

- `scripts/keygen_ui.py`, `_generate_garage` et `_generate_mechanics_only` : `core.load_private_key(self._passphrase)`, puis `core.make_license` / `core.make_mechanic_license`. `scripts/keygen_core.py` définit `ROOT_DIR` depuis son fichier, puis `PRIV_FILE = ROOT_DIR / "keys/private.pem"`. **Le GUI n’utilise pas GF_PRIVATE_KEY.** La passphrase déchiffre ce fichier, elle ne choisit pas une autre autorité. Le répertoire courant ne choisit pas la clé.
- `GF_PRIVATE_KEY` (PEM encodé base64) appartient à l’émetteur HTTP `admin/licenses/generate`, pas à l’émetteur GUI Python. `keys/server_config.json` configure URL et clé API du support, **pas** la clé de signature ni l’ancre de vérification.
- `src/lib/license/verify.ts` appelle `getPublicKeyPem()` : tableau `_LINES` dans `src/lib/license/public-key.ts`, incorporé au build. Electron utilise `_PK` dans `electron/main.js`. Pas de variable d’environnement de clé publique substituée à cette ancre au runtime. `keys/public.pem` sert à l’exploitation/build mais ne remplace pas l’ancre d’un bundle déjà livré.
- **Aucun `keys/private.pem` / `keys/public.pem` de l’instance signalée ni jeton rejeté fourni dans ce checkout.** Leur appartenance à une même paire n’est pas vérifiable ici. Aucune demande de clé privée et aucune rotation effectuée.

## 7.1 — étape 2 : contrat cryptographique constaté

Python : EC SECP256R1 (P-256), ECDSA-SHA256, signature ASN.1 DER. Clé privée PEM PKCS8 éventuellement chiffrée ; publique PEM SPKI. Token `GF2.<header_b64url>.<payload_b64url>.<signature_b64url>` ; base64url sans padding. En-tête ES256 / GF-LIC / v=2. JSON compact, UTF-8 ; `iss` et `exp` en secondes Unix, `ver=2.0` (garage) ou 2.1 (mécanicien).

Les octets signés sont **exactement** `<header_b64url>.<payload_b64url>` en ASCII/UTF-8, sans le préfixe `GF2.`. Node utilise `createVerify('SHA256')` et la signature DER sur ces mêmes segments d’origine : **aucune re-sérialisation JSON**, donc ordre des champs et échappement Unicode ne créent pas d’incompatibilité de canonicalisation. Une reconstruction du payload après signature invaliderait le jeton, normalement.

## 7.1 — étapes 3–5 : mesure préalable et limites de causalité

Le test existant `issuer-fixture-roundtrip.test.ts` a été rejoué avant correction : **5/5 réussis**, dont signature par le véritable `keygen_core.make_license` Python puis véritables vérificateurs TypeScript/Electron avec l’ancre fixture correspondante. Rapport : `phase7/before-fixture.json`. Pas de DB ni HTTP ni Tk démarré.

Le message exact « Licence invalide ou modifiée » dans **cette version** correspond à `sigValid === false`, après contrôle de structure/en-tête et chargement d’une ancre P-256. Il ne permet pas de distinguer **clé étrangère**, **token altéré**, **signature/encodage altéré** ou **ancienne version réellement déployée**. Il n’est pas une preuve que l’expiration ou la DB est en cause : ces étapes sont ultérieures.

**Le succès d’une fixture cohérente ne suffit pas à prouver une mauvaise configuration de l’instance réelle.** La dichotomie proposée n’exclut pas copie/troncature/modification du jeton ou divergence de version déployée. La cause exacte reste NON CONFIRMÉE sans reçu de comparaison des clés publiques et diagnostic du jeton exact dans l’environnement concerné. Cette hypothèse est compatible avec le code mais NON CONFIRMÉE sans accès aux logs de production / à la base de données.

## Défauts structurels de prévention constatés avant correction

1. Le GUI signe sans comparer la clé privée chargée à `keys/public.pem` ni aux deux ancres du checkout : il peut produire silencieusement des jetons refusés par ces vérificateurs.
2. L’onglet clés affiche « configurées » sur simple présence des fichiers. Les instructions demandent encore de coller à la main des tableaux dans `verify.ts` (`_K`, inexistant) et `main.js`, puis de relancer ; elles ne garantissent ni rebuild ni propagation de toutes les ancres.
3. Le vérificateur distingue plusieurs motifs dans `reason` et l’activation les reflète. Il faut des codes de diagnostic internes stables, des journaux neutres sans token/payload/secret et une réponse générique pour format/signature en production ; pas de nouvelle ancre fournie par le client.

Corrections prévues : contrôle local fail-closed de la paire avant toute génération GUI (garage/mécanicien), commande headless `--verify-key-match`, fingerprints publics et bornes de preuve explicites, outil hors ligne du vrai vérificateur avec diagnostics, tests positifs/négatifs du chemin partagé et de non-divulgation, procédure opérateur sans rotation automatique. **Aucune affirmation de résolution de l’instance tant que ses reçus manquent.**

## 7.2 — corrections réalisées, sans rotation

Clôture de cette passe UTC : 2026-10-17T21:09:01+00:00.

- `scripts/keygen_trust.py` : dérivation SPKI/SHA-256 public, exigence P-256, comparaison du privé chargé aux trois sources locales et au PEM cible optionnel, refus si absent/illisible/divergent. Reçu avec seulement fingerprints publics, statuts et portée ; aucun réseau/DB/écriture de clé. Une ancre cible fournie par opérateur est comparée, **pas authentifiée à distance**.
- `scripts/keygen_core.py` : nouveau `load_checked_private_key`, partagé par les **deux** branches réelles du GUI (`_generate_garage`, `_generate_mechanics_existing`), avant `make_license` / `make_mechanic_license` et avant `db.add_license`. Les primitives bas niveau ne prétendent pas vérifier un déploiement distant. Le CLI legacy `keygen.py --gen` n’est pas certifié comme workflow GUI renforcé.
- `scripts/keygen_ui.py --verify-key-match [--ask-passphrase] [--public-key-file ...]` : dispatch avant import Tk/DB, contrôle en lecture seule et exit 0/1. Le contrôle depuis l’onglet clés expose la même comparaison ; les instructions manuelles obsolètes sont remplacées par avertissement/synchronisation publique/rebuild après approbation. Une paire partielle existante déclenche aussi la confirmation d’impact avant initialisation : pas d’écrasement silencieux du seul privé restant. Les messages de fichier absent demandent de restaurer l’autorité, pas d’en créer une pour dépanner.
- `src/lib/license/verify.ts` : observateur interne optionnel avec codes stables du point de rejet ; aucune exception de crypto brute exposée. Format/en-tête/signature/payload/version restent génériques en production. Aucun changement d’algorithme, de format signé ou d’ancre, aucun fallback acceptant une signature étrangère.
- `src/app/api/license/activate/route.ts` : après rate limiter, log `stage` fixe + request ID aléatoire, sans token/payload/clé/fingerprint ; même request ID dans le rejet et son header. `diagnosticCode` uniquement hors production. Clé de confiance illisible → `SERVER_MISCONFIGURED`, pas faux refus client. Les refus ne touchent pas la DB et ne créent aucune session.
- `scripts/diagnose-license.mjs` : exécute le **vrai source TypeScript** (et ses dépendances locales) avec l’ancre locale ou le PEM public explicitement fourni à l’outil hors ligne ; ne modifie jamais l’ancre du service. Entrée via fichier protégé, sortie sans token/payload. Indique toujours que le runtime déployé n’est pas attesté.
- `scripts/reproduce-keygen-roundtrip.mjs` et `keygen-activation-roundtrip.test.ts` : fixture temporaire isolée, chargeur/signataire réels Python, vérificateur réel TypeScript, cas garage/mécanicien et négatifs ; un jeton **Python** franchit aussi le vrai handler d’activation avec DB mockée. Le test attend ensuite **503** de la DB de fixture volontairement indisponible : il ne déclare pas une activation native réussie.
- Documentation visible : [runbook immédiat](../../KEYGEN.md), README, `.env.example`, manifest et registre d’environnement, procédure émetteur et [06](06-VERDICT-FINAL.md). Pas de nouvelle variable secrète ni de clé de production ajoutée.

## Preuves et revalidation

| Contrôle | Résultat réel |
|---|---|
| Avant correction, interop existante | 5/5, [rapport](phase7/before-fixture.json). Cohérence crypto déjà fonctionnelle. |
| Script reproductible | **19/19** étapes réussies, [rapport sans jeton](phase7/roundtrip.json). Mauvaise paire et payload altéré reproduisent tous deux `SIGNATURE_INVALID` ; ils ne sont donc pas départagés par le seul message UI. |
| Tests ciblés | **46/46**, zéro skip, [rapport](phase7/targeted.json) : nouveaux tests, fixtures antérieures, frontière d’activation et contrat keygen. |
| Globale finale | **4 204 total / 3 353 réussis / 3 échoués / 848 pending**, 346 fichiers, **79** en échec/empêchés d’aboutir. Même ensemble de fichiers que PHASE 6 ; trois assertions `prepare-test-db` échouent avant le métier sur TLS Prisma. [Messages/stacks complets et commande](phase7/global-failures.json). Pas de nouvelle régression finale observée dans les cas exécutables ; aucune innocence des tests empêchés déduite. |
| Node | **376/376**, sans skip/todo, [sortie](phase7/node-tests.txt). |
| Lint / TypeScript / syntaxe Python | Exit **0/0/0**, [lint](phase7/lint.txt), [types](phase7/types.txt). Syntaxe : `python -m py_compile` des trois modules Python modifiés. |
| Contrat d’environnement | **0 problème**, 126 canoniques / 8 alias interdits / 48 plateforme, [sortie](phase7/environment.txt). |
| Clés réelles locales | Fichiers absents, échec neutre attendu, [reçu](phase7/local-key-unavailable.json). Ce n’est pas un succès ni une divergence prouvée. |
| Ancre du checkout | [Empreinte publique et hash du vérificateur](phase7/local-anchor.json). Pas une attestation serveur/binaire. |

La baseline machine/canonique est régénérée depuis la globale finale, **pas** depuis le ciblé vert. Les preuves PHASE 6 et leur inventaire restent des snapshots historiques ; les sources PHASE 7 sont identifiées dans [source-hashes.json](phase7/source-hashes.json). [Résumé de validation](phase7/validation.json).

### Échecs intermédiaires et warnings non masqués

- Un nouveau test AST visait initialement un nom de méthode GUI inexistant ; corrigé vers `_generate_mechanics_existing`, sans retirer le contrôle de la seconde branche. [Trace](phase7/intermediate-test-failure.json).
- Une globale intermédiaire a fait échouer deux nouveaux tests de reproduction externe avec `STACK_TRACE_ERROR`, alors que le ciblé passait ; ce JSON ne fournit pas une cause précise et ces échecs **ne sont pas attribués à Prisma**. [Trace conservée](phase7/intermediate-global-failures.json). Préparation externe factorisée une seule fois dans `beforeAll` asynchrone, sous le budget de hook existant ; assertions, cas, timeout normal des tests et politique de skips inchangés. La globale finale repasse ces tests. Pas de retry ni de hausse du timeout d’assertion.
- L’installation reste sans hooks et les clients Prisma sont générés sans moteur pour typage/mocks : build, DB native et packaging non validés. Dépréciations npm (ESLint8/glob/rimraf/inflight) signalées à l’installation et SQLite expérimental restent des limites de maintenance, pas une cause crypto démontrée.
- Une commande groupée lint/types/Node a atteint le délai d’attente de l’outil ; ses seules sorties n’ont pas été interprétées comme un succès global. Contrôle env relancé séparément et Node rejoué séparément avec exit 0 confirmé ; lint/types avaient franchi leur étape sous `set -e` avant Node. Aucun doublon de processus long conservé.

## 7.3 — statut et résolution du cas réel

**Blocage 4 : PARTIEL, cause de l’instance NON CONFIRMÉE ; NO-GO global inchangé.** L’incompatibilité générale algorithme/encodage n’est pas reproduite avec une paire cohérente. Le défaut local de prévention et de diagnostic est corrigé/testé ; il ne démontre pas que c’est lui qui a causé ce rejet réel.

Le statut demandé `BLOQUÉ-CONFIGURATION-DOCUMENTÉ` sera justifié si le reçu de l’instance montre une empreinte privée dérivée différente de l’ancre publique **attestée déployée**, avec jeton et version rapprochés. `RÉSOLU` exige correction de la cause démontrée et recette sur la cible autorisée. Aucun des deux ne peut être prononcé sur le seul récit et des fixtures.

**Procédure exacte pour l’utilisateur : [docs/KEYGEN.md, étapes 1–5](../../KEYGEN.md). Aucune clé à régénérer par défaut.** Relever le fichier privé réellement utilisé, contrôler la paire via `--verify-key-match`, obtenir le PEM public cible attesté et diagnostiquer le jeton exact localement via `--token-file`. Restaurer la clé privée originale de l’autorité officielle **seulement si la divergence est démontrée et l’import approuvé** ; sinon alignement public/rebuild approuvé ou restauration du jeton original selon le résultat. Ne jamais éditer une signature, remplacer une ancre ou réémettre une licence pour masquer une cause encore inconnue.

Pour poursuivre : reçus **non secrets** des deux outils, SHA/digest de la cible et request ID/stage. **Ne fournir ni clé privée ni licence brute.** Aucun accès/mutation production, aucune rotation, aucun déploiement effectué.
