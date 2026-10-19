# Keygen GUI — autorité de signature et diagnostic « licence invalide »

**Ne régénérez aucune clé pour diagnostiquer ce message.** Changer de paire peut couper un parc et ne répare pas un jeton déjà signé. Aucun des contrôles ci-dessous ne contacte une API, n’active/révoque une licence, ne modifie une DB ou ne synchronise des ancres.

## Les sources réelles — à ne pas confondre

| Usage | Source |
|---|---|
| Signature par `scripts/keygen_ui.py` | `<racine de cette copie du dépôt>/keys/private.pem`, éventuellement chiffré par passphrase ; chargé par `keygen_core.load_private_key`. **GF_PRIVATE_KEY n’est pas lu par le GUI.** |
| Signature par l’émetteur HTTP `admin/licenses/generate` | `GF_PRIVATE_KEY` = PEM privé encodé en base64, sinon fichier privé local selon sa configuration ; autre source à vérifier indépendamment. |
| Vérification Next/PWA | `_LINES` dans `src/lib/license/public-key.ts`, incorporé au build ; pas une variable publique choisie au runtime. |
| Vérification Electron | `_PK` dans `electron/main.js`, incorporé à la version distribuée. |
| PEM public opérateur | `keys/public.pem` ; ne remplace pas les ancres d’un bundle déjà construit. |
| `keys/server_config.json` | URL/API key pour les appels de gestion ; ne configure **pas** la paire de signature. |

**La clé privée du keygen DOIT appartenir à la même paire P-256 que la clé publique de l’instance GarageFlows cible.** Le nom du fichier, l’URL configurée, une API key correcte et le fait que deux clés soient P-256 ne prouvent pas cette correspondance. Algorithme : ES256, ECDSA-SHA256, signature ASN.1 DER, base64url ; token GF2. Node vérifie les segments signés d’origine, sans reconstruire le JSON.

Le GUI contrôle désormais, avant de signer une licence garage ou mécanicien et avant persistance, la clé privée chargée, le PEM public et les deux ancres **locales**. Une absence/divergence bloque l’émission avec fingerprints publics. **Ce contrôle local ne peut pas attester un serveur ou un ancien installateur distant** ; comparer leur provenance et leur clé publique indépendamment.

## Procédure immédiate pour le cas signalé — lecture seule d’abord

### 1. Identifier les copies et la cible réellement utilisées

Fermer les keygens ouverts ; relever le chemin de la copie utilisée pour signer et la version/SHA/digest du serveur ou installateur qui rejette le jeton. Utiliser le **même `keys/private.pem` que lors de cette génération**, pas un nouveau fichier créé pour le test. Conserver l’original dans le coffre/poste autorisé ; ne pas le transmettre ni le committer.

Sur Windows, depuis cette copie : `python scripts/keygen_ui.py --verify-key-match`. Sous le virtualenv Linux : `.venv/bin/python scripts/keygen_ui.py --verify-key-match`.

```sh
python scripts/keygen_ui.py --verify-key-match
# PEM privé chiffré : saisie masquée, jamais de passphrase en argument
python scripts/keygen_ui.py --verify-key-match --ask-passphrase
```

Le mode diagnostic fonctionne sans Tk/affichage et n’ouvre pas la DB JSON. Reçu JSON avec `issuerFingerprint` et empreintes de `local-public-pem`, `pwa-source`, `electron-source`, `matches`, `ok` et `scope`. Empreinte = **SHA-256 du DER SPKI public**, pas hash du texte PEM (retours à la ligne indifférents).

- `KEY_MATCH` + exit 0 : concordance **locale uniquement**.
- `KEY_MISMATCH_OR_ANCHOR_UNAVAILABLE` : lire chaque `matches/error` ; arrêter la génération.
- `PRIVATE_KEY_UNAVAILABLE_OR_UNREADABLE` : fichier absent, mauvais chiffrement/passphrase ou format ; retrouver l’original, pas initialiser une nouvelle autorité.
- `P256_REQUIRED` : mauvaise courbe/type ; retrouver la clé autorisée P-256.

### 2. Comparer à la cible, pas seulement au checkout du keygen

Faire extraire/attester par l’opérateur le **PEM public réellement embarqué** dans l’artefact cible et sa provenance. Le déposer par le canal approuvé dans un fichier public distinct. Ce fichier ne doit pas être fabriqué en recopiant le PEM du keygen pour faire passer le test.

```sh
python scripts/keygen_ui.py --verify-key-match --public-key-file /chemin/public-cible-atteste.pem
# Ajouter --ask-passphrase si nécessaire.
```

Le reçu ajoute `operator-target-pem`. Il prouve une comparaison mathématique avec **le fichier fourni**, pas son authenticité distante. Sur un checkout correspondant à l’artefact attesté, l’empreinte de son ancre peut aussi être lue sans clé privée :

```sh
node scripts/diagnose-license.mjs --print-public-fingerprint
```

L’empreinte du checkout audité est `bd8c08451489fb83cef0347b04801018c24cb026f88caffe8995bf9a7a9861e3`. **Ce n’est pas une preuve de celle déployée chez vous.** Pour l’émetteur HTTP GF_PRIVATE_KEY, utiliser en plus la [procédure émetteur](VERIFICATION_CLE_EMETTRICE.md), sans confondre cette variable avec le fichier du GUI.

### 3. Diagnostiquer le jeton exact refusé, sans le publier

Sur le poste autorisé, déposer le jeton exact dans un fichier local protégé hors dépôt (lecture du fichier, pas argument contenant la licence). Ne pas coller le jeton, ses segments ou une clé privée dans le chat/logs. L’outil retire uniquement les espaces de bord comme l’activation ; il ne corrige pas les caractères internes.

```sh
node scripts/diagnose-license.mjs --token-file /chemin-protege/licence-refusee.txt
# Pour la clé publique attestée d’une autre cible :
node scripts/diagnose-license.mjs --token-file /chemin-protege/licence-refusee.txt --public-key-file /chemin/public-cible-atteste.pem
```

Reçu seulement : `ok`, `code`, SHA-256 du jeton, empreinte publique, hash du source du vérificateur et portée. Aucun payload/client/token/signature/clé privée n’est imprimé. Le module TypeScript **réel** est transpilé/exécuté hors ligne ; ni vérification du binaire distant ni activation DB simulée comme réussie.

| Résultat | Interprétation prouvée / suite |
|---|---|
| `VERIFIED` | Le jeton passe ce vérificateur et cette ancre. S’il échoue sur l’instance : comparer digest exact du jeton, ancre et version réellement servis, puis trace corrélée. Ce n’est pas une preuve de panne DB. |
| `SIGNATURE_INVALID` / `SIGNATURE_ERROR` | Signature incompatible avec ces octets/cette ancre. **Clé étrangère ou altération/encodage ne sont pas départagés par ce seul code.** Comparer aux empreintes de l’étape 2 et au jeton original dans le gestionnaire local. |
| `FORMAT_INVALID`, `SEGMENTS_INVALID`, `HEADER_INVALID`, `HEADER_UNSUPPORTED` | Format/prefix/segments/JSON d’en-tête/algorithme incompatibles. Retrouver la chaîne GF2 originale sans transformation. |
| `PAYLOAD_INVALID`, `PAYLOAD_FIELDS_INVALID`, `VERSION_UNSUPPORTED` | Signature franchie, mais payload ou version incompatible ; rapprocher version de l’émetteur et du vérificateur. Pas de resérialisation/re-signature manuelle du token. |
| `EXPIRED` | Signature franchie, expiration constatée ; contrôler horloge UTC puis renouvellement métier approuvé, pas changement de clé. |
| `TRUST_ANCHOR_INVALID`, `DIAGNOSTIC_OR_ANCHOR_UNAVAILABLE` | Configuration/outillage illisible ; ne pas l’attribuer au client ou accepter le jeton par défaut. |

### 4. Corriger seulement la divergence démontrée

- **Fichier privé du poste non conforme à l’autorité officielle** : restaurer/importer, via le canal sécurisé approuvé et après validation humaine, **le fichier privé original de cette autorité** dans `keys/private.pem` de la copie du keygen utilisée. Restaurer son PEM public correspondant dans `keys/public.pem`. Pas de valeur de GF_PRIVATE_KEY à coller dans un PEM : cette variable HTTP est du base64 et n’est pas lue par le GUI. Ne pas convertir une clé chiffrée en copie déchiffrée pour faciliter le diagnostic.
- **Ancre locale ou cible obsolète mais autorité privée officielle correcte** : alignement de clés publiques après validation humaine, `npm run keys:sync`, `npm run keys:check`, contrôles cryptographiques, puis **rebuild et redistribution/déploiement explicitement approuvés** de toutes les surfaces concernées. Relancer seulement une ancienne application ne change pas son ancre. Une simple édition de `_LINES` ou `_PK` n’est pas une procédure de résolution.
- **Jeton altéré, empreintes concordantes** : reprendre le jeton original de l’enregistrement local autorisé ; comparer son digest et sa vérification. Ne pas modifier son JSON/base64 ou générer une nouvelle licence pour dissimuler la cause. Si l’original est déjà invalide, conserver les reçus neutralisés pour investigation.
- **Clé originale perdue** : aucune commande ne peut la reconstruire à partir de la clé publique. Arrêter et organiser une rotation/réémission **explicitement approuvée**, avec inventaire des versions et impact clients. Ce n’est pas une correction immédiate sûre.

**Aucune clé à régénérer par défaut.** Après toute correction approuvée, rejouer 1–3 avec exit 0 et provenance attestée. Seulement ensuite, si une émission métier nouvelle est autorisée, ouvrir `python scripts/keygen_ui.py`, générer une licence de recette dédiée et effectuer la recette d’activation autorisée. Le contrôle préalable est aussi automatique dans le GUI. Aucune migration/reset/révocation nécessaire au diagnostic de signature.

### 5. Traces de support et informations à retourner

Le nouveau code d’activation journalise le **stage fixe + request ID aléatoire**, sans token/payload/fingerprint, après le rate limiter. La réponse de rejet porte le même `X-Request-ID`. En production, format/signature/version restent génériques (« Licence invalide ou modifiée »), pas de `diagnosticCode` exposé. En développement seulement, la réponse comporte le code détaillé. Un ancrage inutilisable reste `SERVER_MISCONFIGURED`, pas `LICENSE_INVALID`.

Pour confirmer **votre** cause sans exporter de secrets, fournir uniquement : reçu `--verify-key-match`, provenance/SHA/digest de la cible, reçu `diagnose-license` (digest de jeton/empreinte/code), request ID/stage des logs autorisés. Les empreintes publiques peuvent être comparées hors chat si la politique interne l’impose. Sans ces éléments, une mauvaise paire reste une hypothèse.

## Liaison matérielle — ne JAMAIS calculer le HWID dans le keygen

**Le HWID d'une licence doit venir du POSTE CLIENT.** Le keygen ne sait pas le
reconstruire : il ne voit pas la machine du garage, et les deux implémentations
utilisent des sources différentes.

| Source | CPU | Plateforme | MAC | Disque |
|---|---|---|---|---|
| Electron / Next (`electron/main.js`, `src/lib/license/hwid.ts`) | `os.cpus()[0].model` | `os.platform()-os.arch()` → `win32-x64` | `os.networkInterfaces()` (première non-loopback) | `wmic` / `lsblk` |
| Python (`keygen_core.get_hwid`) | `platform.processor()` | `platform.system()-platform.machine()` → `Windows-AMD64` | `uuid.getnode()` (aléatoire si aucune MAC) | `wmic` ou `unknown-disk` |

Sur la même machine, ces deux empreintes **diffèrent toujours** (au minimum par
la chaîne de plateforme). Une licence signée avec l'empreinte locale du keygen
est donc refusée à l'activation : le garage lit « Licence invalide ou modifiée »
sur une licence qui vient d'être créée, en régénère plusieurs, et finit par en
obtenir une « valide » en laissant le champ vide. C'était exactement le symptôme
signalé.

### Ce qui a été corrigé

- Le bouton **« Ce PC »** du GUI (qui appelait `core.get_hwid()`) est remplacé
  par **« Coller »** et **« Fichier… »** : la valeur doit être produite par le
  poste à activer, puis collée/importée.
- `keygen_core.make_license` / `make_mechanic_license` **refusent avant de
  signer** tout HWID qui n'est ni 64 hexadécimaux (v0) ni `HWID1-` + 64 hex
  (v1) : tronqué, entre guillemets, espace interne, texte libre. La valeur est
  normalisée (espaces de bord, casse) exactement comme le vérificateur.
- `--bind-hwid` (CLI) applique le même contrôle ; `--hwid` affiche désormais
  explicitement qu'il s'agit d'une empreinte **locale de diagnostic**.
- La campagne `node scripts/campagne-100-licences.mjs` vérifie 100 licences
  garage + 5 mécanicien, 20 contrôles négatifs (altération, clé étrangère,
  expiration), 40 cas HWID et une re-vérification après « redémarrage ».

Le HWID V1 canonique reste la voie recommandée : le client le produit
(`hwid-v1.ts`), le keygen le **lie tel quel** — il ne le reconstruit jamais.

## Reproduction automatisée sans clé de production

```sh
python3 -m venv .venv
.venv/bin/python -m pip install --require-hashes -r tests/requirements-keygen.txt
node scripts/reproduce-keygen-roundtrip.mjs
PATH="$PWD/.venv/bin:$PATH" npx vitest run src/lib/__tests__/keygen-activation-roundtrip.test.ts
```

Le script crée une paire de fixture et une copie minimale des modules dans un répertoire temporaire hors dépôt, contrôle les ancres, signe via le **chargeur contrôlé partagé du GUI** puis les vrais `make_license` / `make_mechanic_license`, vérifie avec le **vrai `verify.ts`**, et supprime ses fichiers. Cas positifs/négatifs : mauvaise paire, altération, format, algorithme, champs, expiration, version, ancres manquantes/divergentes, PEM chiffré et mauvaise courbe. Aucun token ni clé privée dans le rapport. Le test HTTP transmet aussi un token Python au véritable handler d’activation avec DB mockée : franchissement crypto prouvé, **pas** activation réelle en base. Tk/Electron graphique, DB native et déploiement restent hors de cette preuve.
