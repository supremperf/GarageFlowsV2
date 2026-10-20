# Signature et vérification des mises à jour (Ed25519)

## 1. Séparation des autorités

| Autorité | Algorithme | Usage | Emplacement |
|---|---|---|---|
| Licence | ECDSA P-256 / SHA-256 | Jetons `GF2…` | `keys/private.pem`, clé publique embarquée |
| Mises à jour | Ed25519 | Manifestes de release | `GF_UPDATE_SIGNING_KEY` / fichier, clés publiques dans `electron/update-verify.js` |

Ces clés **ne sont jamais interchangeables**. Une clé de licence ne signe pas
une mise à jour, et inversement.

## 2. Signer

```cmd
npm run sign-update -- --file release/GarageFlows-Setup.exe
```

Options utiles :

| Option | Défaut | Rôle |
|---|---|---|
| `--version` | version du nom de fichier, sinon `package.json` | version publiée |
| `--download-url` | `GF_UPDATE_DOWNLOAD_BASE_URL` + nom du fichier | URL HTTPS servie aux postes |
| `--key-id` | `gf-update-2026-2` | identifiant d'ancre connu du client |
| `--key-file` | — | PEM PKCS#8 Ed25519 hors dépôt |
| `--current-version` | `0.0.0` | simulation anti-downgrade (diagnostic) |

`scripts/gf_sign_update.js` **ne réimplémente pas la cryptographie** :

1. résolution des paramètres manquants ;
2. contrôle du type de clé (Ed25519 uniquement) ;
3. refus si la clé ne correspond pas à l'ancre publique déjà embarquée pour le
   `keyId` demandé (sinon 100 % du parc rejetterait le manifeste) ;
4. délégation à `scripts/sign-release-manifest.mjs`, seul producteur accepté ;
5. vérification immédiate du manifeste par `electron/update-verify.js` via
   `scripts/keygen-verify-update.cjs` ;
6. contrôle que le SHA-256/taille du manifeste correspondent aux octets du
   disque, et que le `keyId` est celui demandé.

La clé privée n'est jamais affichée, écrite, ni journalisée.

## 3. Protocole signé

Objet signé : `JSON.stringify` d'un manifeste dont **toutes les clés sont
triées récursivement**, sans espaces. Champs : `schemaVersion`, `product`,
`version`, `channel`, `platform`, `architecture`, `downloadUrl`, `sha256`,
`size`, `fileName`, `keyId`, `signatureAlgorithm`, `releasedAt`, et
éventuellement `minVersion`, `releaseNotes`.

Fichier produit : `{ manifest, signature }` (signature base64 Ed25519).

Le client (`electron/update-verify.js`) vérifie : clé connue, signature,
produit, plateforme, canal, format SHA-256, taille, anti-downgrade, palier
`minVersion`, URL HTTPS et domaine autorisé. Ces champs **signés font
autorité**. Le téléchargement vérifie ensuite que les octets reçus produisent
le SHA-256 signé avant d'exécuter l'installateur.

## 4. Rotation

1. Générer une paire : `node scripts/sign-release-manifest.mjs --gen-key --key-id gf-update-2027`.
2. **Ajouter** la clé publique dans `PUBLIC_KEYS` de `electron/update-verify.js`
   sans retirer l'ancienne.
3. Publier une version qui embarque la nouvelle ancre.
4. Attendre que le parc ait cette version avant de signer avec la nouvelle clé.
5. Ne retirer une ancienne ancre qu'une fois certain qu'aucune release signée
   par elle n'est encore servie.

Une clé absente, illisible, non Ed25519, ou ne correspondant pas à l'ancre
produit un refus explicite ; aucun manifeste exploitable n'est généré.

## 5. Tests

```bash
node --test tests/update-signing-cli.test.cjs     # 8 tests
npx vitest run src/lib/__tests__/update-verify.test.ts \
               src/lib/__tests__/release-signing-chain.test.ts
```

Les tests couvrent : clé absente, mauvais algorithme, clé étrangère pour un
`keyId` connu, signature nominale vérifiée par le module client, binaire
modifié après signature (empreinte différente), manifeste falsifié, installeur
au nom fixe sans version, fichier absent.

## 6. Limites

- Aucun certificat Authenticode n'est disponible : la signature de code Windows
  reste une action externe.
- Un manifeste signé ne prouve pas que l'installateur a été construit sur une
  machine propre ; il prouve son intégrité et son authenticité.
- Les tests n'installent pas l'application sur Windows (environnement Linux).
