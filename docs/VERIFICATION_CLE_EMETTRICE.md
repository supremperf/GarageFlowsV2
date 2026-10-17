# Vérifier la correspondance de l’émetteur licence (lecture seule)

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
