# Durcissement & protection de GarageFlow (post-compilation)

Ce document décrit la protection de GarageFlow une fois compilé (dossier
`dist/`) : l'utilisateur lance **uniquement `GarageFlow.exe`**, tout fonctionne
normalement, et les fichiers/ressources internes sont protégés contre la
consultation, la modification, la suppression et la rétro-ingénierie.

> **Honnêteté technique.** Aucune protection logicielle côté client n'est
> réellement « inviolable » : un attaquant déterminé disposant d'un accès administrateur à la
> machine peut, en théorie, contourner n'importe quelle protection locale. Ces
> couches **élèvent fortement la barre** (elles arrêtent les manipulations
> ordinaires et la rétro-ingénierie triviale) et doivent être **combinées** —
> en particulier avec la **signature numérique** (§8) et les **vérifications
> serveur** (licences, §5) qui, elles, ne dépendent pas de l'intégrité du poste
> client. Les décisions réellement critiques (validité de licence) sont déjà
> prises côté serveur.

---

## Vue d'ensemble des composants

| Fichier | Rôle |
| --- | --- |
| `electron/secure-key.js` | Reconstruit en mémoire le secret maître (fragmenté + masqué par XOR) ; dérive les clés HMAC (intégrité) et AES-256 (ressources) via HKDF. |
| `electron/secure-resources.js` | (Dé)chiffrement AES-256-GCM des ressources ; `decryptFileToMemory()` ne laisse jamais de clair sur le disque. |
| `electron/integrity.js` | Génère (build) et vérifie (runtime) le manifeste d'intégrité signé HMAC-SHA256 ; détection best-effort de débogueur. |
| `scripts/afterPack.js` | Hook electron-builder : écrit le manifeste après empaquetage, avant signature. |
| `scripts/protect-resources.js` | CLI de chiffrement des ressources sensibles au build. |
| `scripts/installer.nsh` | Durcissement optionnel des permissions du dossier d'installation (ACL). |

---

## 1 & 2. Chiffrement des ressources + clé fragmentée

- **Chiffrement** : `scripts/protect-resources.js <fichier|dossier>` produit des
  `.enc` (AES-256-GCM). Au runtime, `secure-resources.decryptFileToMemory()`
  renvoie un `Buffer` en mémoire — **aucun fichier sensible n'est déchiffré sur
  le disque**. GCM garantit aussi l'intégrité : un `.enc` altéré est rejeté.
- **Clé jamais en clair** : le secret maître est **fragmenté en 4 morceaux**,
  chacun **masqué par XOR**, et **reconstruit uniquement au lancement**
  (`secure-key.reconstructSecret()`). Les clés d'usage sont dérivées par HKDF
  (labels distincts pour intégrité vs ressources). Aucune chaîne de clé
  exploitable statiquement (`strings` ne révèle rien).

> Réservez le chiffrement aux ressources **chargées par l'application
> elle-même** (config, modèles, données). Ne chiffrez pas les fichiers lus tels
> quels par un tiers (ex. `schema.prisma` lu par Prisma, le moteur natif) : ils
> deviendraient illisibles.

Exemple :

```bash
# Build : chiffrer une config sensible avant packaging
node scripts/protect-resources.js resources/secret-config.json   # → .enc, original retiré
```

```js
// Runtime : lecture en mémoire uniquement
const { decryptFileToMemory } = require('./secure-resources')
const cfg = JSON.parse(decryptFileToMemory(path.join(process.resourcesPath, 'secret-config.json.enc')))
```

## 3. Vérification d'intégrité

Au démarrage (production), `GarageFlow.exe` vérifie l'empreinte **SHA-256** de
ses fichiers critiques contre un **manifeste signé HMAC-SHA256** :

- `app.asar` (tout le code applicatif + `package.json`),
- `app.asar.unpacked/**` (modules natifs déballés : moteur Prisma, DLL),
- `keys/public.pem` (clé publique de licence),
- `prisma/schema.prisma`.

Le manifeste est généré au build par le hook `afterPack` (sur les fichiers
**réellement empaquetés**). Le **générateur et le vérificateur partagent la même
fonction de sélection** (`integrity.criticalFiles`) : ils ne peuvent donc pas
diverger sur les chemins → **pas de faux positif** dû à un décalage.

Si un fichier est **modifié, remplacé ou supprimé**, ou si le **manifeste est
falsifié** (HMAC invalide), l'application affiche « installation corrompue » et
s'arrête.

### Modes (`GF_INTEGRITY_MODE`)

| Valeur | Comportement |
| --- | --- |
| `audit` *(défaut)* | Journalise les altérations **sans bloquer**. |
| `enforce` | **Arrêt immédiat** si altération (« arrêt immédiat » demandé). |
| `off` | Vérification désactivée. |

> **Rollout sûr.** Le défaut est `audit` car l'empaquetage Windows ne peut pas
> être testé dans tous les environnements. **Procédure recommandée :**
> 1. Faites un vrai build (`npm run dist`) et installez-le sur une machine Windows.
> 2. Vérifiez dans les logs (`%APPDATA%\GarageFlow\garageflow.log`) la ligne
>    `[integrity] OK — N fichiers critiques vérifiés`.
> 3. Passez alors en production à `GF_INTEGRITY_MODE=enforce` (variable
>    d'environnement, ou changez le défaut dans `electron/main.js`).

La vérification est **inactive s'il n'existe pas de manifeste** (dev, ou build
sans hook) : l'application **ne se bloque jamais** par accident.

## 4. Protection contre la modification

- **Remplacement de DLL / patch de binaire / injection de fichiers** :
  détectés par le manifeste (§3) → arrêt en mode `enforce`.
- **Modification des fichiers de configuration** : chiffrement + GCM (§1) et/ou
  inclusion dans le manifeste.
- **Suppression de fichiers critiques** : détectée (`missing:<fichier>`).
- **Permissions du dossier d'installation** : voir §10 (ACL) — empêche l'écriture
  par un utilisateur standard.

## 5. Protection des licences

Déjà en place et **côté serveur** (source de vérité `app.garageflows.fr`) :

- Licences signées **ECDSA-P256** (clé privée jamais distribuée) — non forgeables.
- Stockage local **chiffré AES-GCM** lié au **HWID** (`gf_license.dat`).
- **Record-MAC** (HMAC-SHA256) sur les champs critiques (`record-mac.ts`) : une
  licence éditée manuellement est invalidée.
- **Vérification serveur à intervalles réguliers** (`startPeriodicLicenseCheck`) :
  une **révocation** est prise en compte à la vérification suivante
  (overlay `LicenseRevokedOverlay`).

Aucune information de licence n'est modifiable manuellement de façon exploitable.

## 6. Mises à jour authentifiées

Système complet documenté dans le README (côté serveur : `garagesite3`). Points
de sécurité côté client (`electron/main.js` → `app:install-update`) :

- Téléchargement **HTTPS** depuis le **serveur officiel** uniquement
  (`GF_UPDATE_SERVER` / `GF_LICENSE_SERVER`).
- **Vérification SHA-256** du fichier téléchargé **avant** installation : un
  fichier altéré ou provenant d'une source non conforme est **refusé** (aucune
  installation).
- Téléchargement **reprenable** (Range) — fiable pour des centaines de clients.

> Pour exiger une **signature numérique** de l'installateur téléchargé (au-delà
> du SHA-256), signez le `.exe` (§8) : Windows SmartScreen/UAC affichera l'éditeur
> vérifié, et un installateur non signé sera visiblement suspect.

## 7. Obfuscation (rétro-ingénierie)

`app.asar` contient du JavaScript : par défaut lisible après extraction. Pour le
protéger :

1. **asar** (déjà activé, `"asar": true`) — regroupe et masque l'arborescence.
2. **Obfuscation JS** — ajouter une étape avant packaging :

   ```bash
   npm i -D javascript-obfuscator
   # Obfusquer electron/*.js et le serveur Next standalone (.next/standalone) :
   npx javascript-obfuscator .next/standalone --output .next/standalone \
     --compact true --self-defending true --string-array true \
     --string-array-encoding base64 --rename-globals false
   ```
   À brancher dans le script `dist` (après `post-build.js`, avant
   `electron-builder`). Teste bien : `--self-defending` et le renommage agressif
   peuvent casser du code dynamique.
3. **Suppression des métadonnées** — ne pas embarquer de source maps en prod
   (`productionBrowserSourceMaps: false` — défaut Next), retirer commentaires.
4. **Fuses Electron** (durcissement du runtime) :

   ```bash
   npm i -D @electron/fuses
   ```
   Désactiver `RunAsNode`, `EnableNodeCliInspectArguments`,
   `EnableNodeOptionsEnvironmentVariable` et activer
   `OnlyLoadAppFromAsar` + `EnableEmbeddedAsarIntegrityValidation` empêche de
   lancer l'app en « mode Node » ou de charger un asar substitué.

## 8. Signature numérique

Nécessite un **certificat de signature de code** (OV/EV) — non fourni ici.
electron-builder signe alors automatiquement `GarageFlow.exe`, les DLL et
l'installateur :

```jsonc
// package.json → "build".
"win": {
  "signtoolOptions": {
    "certificateSubjectName": "Votre Société SAS",   // certificat dans le magasin Windows
    "signingHashAlgorithms": ["sha256"],
    "rfc3161TimeStampServer": "http://timestamp.digicert.com"
  }
}
```

Le manifeste d'intégrité (§3) **ne couvre pas le `.exe`** (signé après
`afterPack`) : les deux mécanismes sont complémentaires — la **signature**
protège l'exécutable, le **manifeste** protège l'asar/les ressources.

## 9. Anti-altération / anti-débogage

- **Altération binaire / patch mémoire / DLL non autorisée / suppression** :
  manifeste d'intégrité (§3).
- **Débogueur / inspecteur** : `integrity.detectDebugger()` (inspecteur attaché,
  arguments `--inspect`, `--remote-debugging-port`). **Bloquant uniquement** si
  `GF_INTEGRITY_MODE=enforce` **et** `GF_ANTIDEBUG=1` (opt-in, pour éviter les
  faux positifs). Renforcer avec les **fuses Electron** (§7).

> L'anti-débogage en JS est intrinsèquement faible (contournable). Les fuses
> Electron et la signature sont des protections bien plus robustes.

## 10. Dossier d'installation & permissions

Par défaut, GarageFlow s'installe **par utilisateur** (`perMachine: false`,
`%LOCALAPPDATA%`) — aucune élévation, aucun mot de passe.

Pour installer dans **Program Files** avec des **permissions restreintes**
(l'utilisateur standard ne peut pas modifier/supprimer les fichiers, mais peut
lancer le logiciel sans mot de passe ; l'installateur officiel élevé peut mettre
à jour) :

```bash
npx electron-builder --win --x64 \
  --config.nsis.perMachine=true \
  --config.nsis.defines.GF_HARDEN_ACL=1
```

Le bloc ACL de `scripts/installer.nsh` (inactif sans `GF_HARDEN_ACL`) applique
alors via `icacls` : Administrateurs + SYSTEM = contrôle total ; Utilisateurs =
lecture + exécution seulement.

> **Compromis à connaître.** En `perMachine`, l'installation **et chaque mise à
> jour** demandent une **élévation UAC** (une fenêtre, pas un mot de passe pour
> un compte admin). Les **données utilisateur** restent dans `%APPDATA%\GarageFlow`
> (écriture toujours autorisée) — jamais affectées par le durcissement.

---

## Récapitulatif : activer la protection maximale

1. **Certificat de signature** → renseigner `win.signtoolOptions` (§8).
2. **Obfuscation** JS + **fuses** Electron dans le pipeline `dist` (§7).
3. **Build** : `npm run dist` (le manifeste d'intégrité est généré
   automatiquement par `afterPack`).
4. **Valider** un install réel, puis `GF_INTEGRITY_MODE=enforce` (§3).
5. **(Optionnel)** install `perMachine` + `GF_HARDEN_ACL=1` (§10).
6. **(Optionnel)** chiffrer les ressources sensibles (§1).
