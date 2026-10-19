# Vérifier la correspondance de l’émetteur licence (lecture seule)

**Cas keygen GUI refusé à l’activation :** voir [la procédure immédiate](KEYGEN.md) et `python scripts/keygen_ui.py --verify-key-match` (ajouter `--ask-passphrase` pour un fichier chiffré). Le GUI n’utilise pas GF_PRIVATE_KEY. Aucun de ces diagnostics ne prouve un bundle distant non attesté.

## Ce qui doit correspondre

- `POST /api/admin/licenses/generate` signe en ES256/P-256 avec `GF_PRIVATE_KEY` **PEM encodé en base64**, prioritaire ; sinon `keys/private.pem` local. Voir `src/app/api/admin/licenses/generate/route.ts:33-50`.
- Le générateur Python signe avec l’objet privé chargé depuis `keys/private.pem` par `scripts/keygen_core.py:81-103` (mot de passe possible).
- Next vérifie avec `src/lib/license/public-key.ts` (`_LINES`, via `getPublicKeyPem()`), **pas une variable de clé publique choisie par le client**.
- Electron vérifie avec `electron/main.js` (`_PK` / `PUBLIC_KEY_PEM`) et exige une ancre EC prime256v1 via `electron/license-trust.js`.
- `keys/public.pem`, sur le poste de signature/build, doit être la dérivée de la même clé privée. `REFERENCE_FP` et la cohérence interne ne sont pas une attestation de la configuration réellement déployée.

Ne pas confondre cette paire ECDSA avec `NEXTAUTH_SECRET` (session JWT), `GF_DB_MAC_SECRET` (intégrité des enregistrements) ou la paire Ed25519 de mises à jour. Aucune de ces autres clés ne remplace la paire licence.

## Validation automatisée sans secret de production

`src/lib/__tests__/issuer-fixture-roundtrip.test.ts` génère une paire éphémère en mémoire, injecte **uniquement l’ancre publique de fixture** dans le test et exécute les véritables vérificateurs PWA et Electron (fonction Electron extraite sans démarrage d’application). Cinq tests : positif GF2 DER-SHA256, mauvaise paire, payload altéré, expiration et signature par le véritable `keygen_core.make_license` Python avec une autre paire transitoire. Pas de signature/crypto mockée, pas de clé privée persistée.

`tests/issuer-correspondence.test.cjs` éprouve aussi le contrôle opérateur : toutes les ancres concordantes, une ancre divergente, courbe incorrecte et CLI sans clé/avec clé étrangère en échec neutre. Le script ne fabrique pas de licence utilisable : son challenge est aléatoire et séparé du domaine GF2.

**Le mécanisme cryptographique de vérification est validé par test automatisé avec une paire de clés de test.** Cela ne prouve pas la correspondance avec les clés réelles.

**La correspondance entre GF_PRIVATE_KEY de production et la clé publique effectivement déployée ne peut être vérifiée que par un opérateur ayant accès aux deux valeurs en environnement de production, hors du périmètre de cet audit.** L’opérateur peut comparer les empreintes publiques sans exporter la clé privée.

## Procédure opérateur — avant promotion et sur chaque version distribuée

1. Identifier et consigner le SHA du code **réellement construit/déployé**, le digest de l’artefact signé, l’environnement et la date UTC. Vérifier sa provenance ; une vérification sur un checkout différent ne prouve rien sur la version en service. Pour Electron, couvrir les versions encore distribuées ; pour le serveur et l’émetteur Python, couvrir chaque cible et chaque source de signature réellement utilisée.
2. Utiliser un shell/job d’administration contrôlé (MFA/IAM et journaux d’accès). Ne pas lancer le reset, `--init`, `--gen`, `keys:sync`, de rotation, de migration ou d’enregistrement de licence. Ne jamais copier une clé privée dans le dépôt, un ticket, un terminal enregistré ou le chat.
3. Exécuter le script depuis le checkout/artefact de provenance attestée. Le gestionnaire de secrets doit injecter le **GF_PRIVATE_KEY actuel du service**, sans ligne de commande contenant sa valeur, sans `set -x`, sans export de `.env` en clair. Avec cette injection :

   ```sh
   node scripts/verify-license-issuer.mjs --public-key-file /chemin-controle/public-emetteur.pem
   ```

   `--public-key-file` est facultatif pour le contrôle des deux ancres du code, mais obligatoire pour attester aussi le PEM public du poste de signature ou de l’artefact. Ce fichier doit être extrait/attesté indépendamment de l’émetteur ou du paquet distribué, pas remplacé par une copie choisie pour faire passer le test.
4. Sur le poste Python utilisant un fichier privé **non chiffré** (sans variable GF_PRIVATE_KEY active), vérifier sa source réelle :

   ```sh
   node scripts/verify-license-issuer.mjs --private-key-file /coffre/lecture-seule/private.pem --public-key-file /coffre/lecture-seule/public.pem
   ```

   Le script refuse la combinaison fichier privé + GF_PRIVATE_KEY pour éviter une vérification de la mauvaise source. Pour une clé privée chiffrée, utiliser le gestionnaire/HSM autorisé pour dériver l’empreinte publique et signer un challenge de correspondance ; **ne pas créer une copie privée déchiffrée** pour ce script. Le support de passphrase/HSM n’est pas implémenté dans la CLI.
5. Exiger exit **0** et `{"ok":true,"publicFingerprint":"…","anchorsChecked":3}` avec le fichier public, ou 2 pour le code seul. Le script compare mathématiquement les empreintes SPKI DER SHA-256, exige P-256, signe un challenge aléatoire non-GF2 et le vérifie avec **chaque** ancre. Il n’ouvre ni DB ni HTTP et ne modifie aucun fichier. Conserver uniquement le reçu et les identifiants non secrets de l’artefact.
6. Rejouer également `npm run check:public-key`, `npm run keys:check` avec le PEM **public** officiel placé dans `keys/public.pem` via le canal approuvé. Un SKIP n’est **pas** un succès de correspondance. Ces commandes en mode check n’écrivent pas les ancres.
7. Attester le lien entre les ancres vérifiées et le bundle en service : comparer le digest d’artefact/SHA à l’attestation de build, contrôler le PEM public embarqué extrait du paquet quand présent et effectuer une recette de vérification d’un jeton de test autorisé sur le binaire/service réel. Ne pas envoyer une licence client dans les logs. Le script de source seul ne lit pas un bundle Next minifié et ne constitue pas à lui seul cette attestation runtime.
8. À la moindre divergence/erreur/SKIP, arrêter la promotion. Collecter les empreintes **publiques**, pas les clés privées ; décider humainement de l’alignement nécessaire et de l’impact sur les licences déjà émises. Une synchronisation/rotation n’est jamais la conséquence automatique de ce test.

Rejeu local sans production : `PATH="$PWD/.venv/bin:$PATH" npx vitest run src/lib/__tests__/issuer-fixture-roundtrip.test.ts` et `node --test tests/issuer-correspondence.test.cjs`. Python/cryptography se préparent avec `tests/requirements-keygen.txt` hash-locké ; aucun SKIP ajouté pour masquer l’absence de cet outil.

## Construction Windows : « Public anchors disagree; no key file written »

`npm run dist` commence par `preflight:release`, qui appelle `scripts/materialize-build-public-key.cjs`. Ce script recrée **uniquement** la ressource publique `keys/public.pem` (non versionnée) à partir des ancres du dépôt, après avoir vérifié que les trois ancres désignent la même clé :

| Ancre | Fichier | Rôle |
|---|---|---|
| `_PK` | `electron/main.js` | clé embarquée dans le binaire desktop |
| `_LINES` | `src/lib/license/public-key.ts` | clé du serveur Next.js / PWA |
| `REFERENCE_FP` | `src/lib/license/__tests__/public-key-consistency.test.ts` | empreinte SHA-256 (SPKI DER) épinglée de la clé de l’émetteur de production — l’arbitre |

La source de vérité est la **clé privée de l’émetteur de production** (`GF_PRIVATE_KEY` côté serveur, `keys/private.pem` sur le poste de signature) ; le dépôt en épingle la moitié publique via ces trois ancres, qui ne se déplacent **qu’ensemble**, par `npm run keys:sync`, après une rotation approuvée. Une ancre déclarée deux fois est refusée (aucun « premier trouvé »).

### Rétablissement automatique (prouvé) de `_PK` / `_LINES`

Quand `_PK` et/ou `_LINES` divergent de `REFERENCE_FP`, `preflight:release` (donc `npm run dist`) appelle `scripts/restore-public-anchors.cjs` (aussi : `npm run keys:restore`). Il cherche le **texte** de la clé dont l’empreinte est exactement `REFERENCE_FP`, dans cet ordre : une ancre restée correcte, `keys/public.pem`, `git HEAD` (seulement si le dossier est **lui-même** un dépôt git), puis le dépôt public `supremperf/GarageFlowsV2` (`raw.githubusercontent.com`, puis l’API GitHub ; TLS vérifié avec les autorités de Node **et** du magasin système, pour les antivirus/proxys qui inspectent le HTTPS). Chaque candidat est vérifié par empreinte : une source falsifiée est écartée, car aucune autre clé ne peut avoir la même empreinte.

S’il trouve la preuve, il réécrit `_PK`/`_LINES` (écriture tout-ou-rien, relecture), sauvegarde les originaux dans `.gf-anchor-backups/<horodatage>/` (non versionné), déplace dans cette sauvegarde un `keys/public.pem` portant la clé écartée, et le preflight continue. Il ne génère, ne dérive ni ne lit **aucune** clé privée, ne modifie jamais `REFERENCE_FP` ni la liste des clés retirées, n’adopte jamais la clé divergente (ce serait une rotation : `keys:sync`), et refuse une ancre ambiguë ou un `REFERENCE_FP` retiré. Sans preuve (hors ligne, dossier ZIP, aucune copie locale), il ne touche à rien et le refus ci-dessous s’applique. **Exception — autorité locale :** si la clé divergente est détenue par une autorité créée sur ce poste (reçu `GarageFlow-configuration/generated-keys.json` de `config` portant son empreinte, ou `keys/private.pem` dont le `keys/public.pem` voisin n’est pas la clé de référence), il s’agit d’une création ou rotation non terminée : rien n’est réécrit (sinon `config` resynchroniserait vers sa clé au passage suivant) et le message propose les deux décisions — revenir à la production (déplacer `keys\` et le reçu hors du projet, puis relancer) ou adopter la nouvelle autorité (`npm run keys:sync`, licences existantes invalidées). Rappel : `preflight:release` refuse toujours un `keys/private.pem` dans le projet — `config` l’y écrit pour le keygen, il faut donc construire depuis un dossier sans clé privée. `GF_NO_ANCHOR_RESTORE=1` désactive la réparation ; `GF_ANCHOR_RESTORE_NETWORK=0` interdit le téléchargement.

### Refus (aucune preuve disponible)

Le désaccord non réparé reste **bloquant** : un binaire dont `_PK` diffère de la clé qui signe les licences les refuse toutes, sans message. Le message d’erreur liste chaque ancre, son empreinte (donnée publique), signale une clé retirée (`RETIRED_FINGERPRINTS` de `scripts/check-critical-files.js`) et un fichier modifié par rapport au commit (`git status`, seulement si le dossier est lui-même un dépôt git : un dépôt **parent** ne fait plus apparaître les fichiers comme « modifiés »), puis indique le correctif :

- **Aucune rotation approuvée (cas normal)** : la copie de travail a été modifiée localement (ex. `keygen.py --init` suivi d’une copie manuelle des tableaux, synchronisation interrompue, fusion git). Examiner `git diff` des trois fichiers, mettre de côté toute autre modification, puis `git restore --source=HEAD --` sur ces trois fichiers.
- **Rotation approuvée et clé privée détenue** : placer la clé publique dérivée de cette clé privée dans `keys/public.pem`, lancer `npm run keys:sync` puis `npm run keys:check`, vérifier la correspondance avec `python scripts/keygen_trust.py --verify-key-match`, et mettre à jour la vitrine (autre dépôt).

Si la clé privée de production est inaccessible, **ne pas en générer une nouvelle pour faire passer la construction** : un binaire signé par une autorité de remplacement refuserait toutes les licences en circulation. Récupérer la clé depuis le coffre de l’exploitant (ou décider formellement d’une rotation, avec ses conséquences sur les licences émises).

`keys:sync` écrit désormais ses ancres de façon **transactionnelle** (fichiers temporaires, remplacement, relecture ; restauration des originaux en cas d’échec — fichier verrouillé sous Windows par un IDE, un antivirus ou OneDrive), et `keygen.py --init` refuse de remplacer une clé existante.

## Keygen : « Erreur de signature — KEY_MISMATCH_OR_ANCHOR_UNAVAILABLE »

Le keygen refuse de signer quand `keys/private.pem` n’est pas la clé dont l’empreinte est `REFERENCE_FP` (`issuerFingerprint` ≠ empreinte des ancres). C’est voulu : une licence signée ainsi serait refusée par le logiciel. Cas typique : nouveau dossier extrait d’un ZIP (jamais de `keys/`), puis paire générée localement par `config` ou le keygen.

Correctif : `npm run keys:find-issuer` (`scripts/find-issuer-key.cjs`). Il parcourt, de façon bornée, le dossier parent du projet, Bureau, Documents, Téléchargements et OneDrive, à la recherche de PEM privés et de `GF_PRIVATE_KEY` (base64) dans les `.env*.local` ; il ne retient qu’une clé P-256 dont l’empreinte publique est **exactement** `REFERENCE_FP`, n’affiche que des chemins et des empreintes publiques, installe la clé dans `keys/private.pem` (relecture vérifiée, `keys/public.pem` aligné) et **déplace** la clé remplacée hors du projet (`~/GarageFlows-cles-ecartees/<date>/`). Options : `--dry-run` (rapport seul), `--ask-passphrase` (clés chiffrées, saisie masquée). S’il ne trouve rien, il n’installe ni ne génère rien : la clé de production doit être restaurée depuis une sauvegarde (clé USB, ancien PC, coffre) ; à défaut, changer d’autorité est une rotation décidée (licences existantes invalidées, serveur et vitrine à aligner).

Rappel : `npm run dist` refuse un `keys/private.pem` présent dans le projet ; le keygen, lui, l’y lit. Déplacer la clé hors du dossier avant de construire l’installeur.
