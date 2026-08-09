# HWID_SPEC_V1 — empreinte matérielle canonique (AUD-036)

## Problème

Historiquement, deux implémentations RECONSTRUISAIENT l'empreinte à partir de
sources DIFFÉRENTES, produisant des HWID distincts pour la même machine :

| Champ | Electron (`electron/main.js` getHwid) | Keygen Python (`scripts/keygen.py` get_hwid) |
|---|---|---|
| CPU | `os.cpus()[0].model` | `platform.processor()` / `platform.machine()` |
| MAC | 1re interface non-loopback (`os.networkInterfaces`) | `uuid.getnode()` |
| Plateforme | `os.platform()-os.arch()` (`win32-x64`) | `platform.system()-machine()` (`Windows-AMD64`) |

→ une licence liée au matériel pouvait ne jamais valider selon l'outil ayant
produit le HWID. C'est **AUD-036**.

## Principe V1 : une seule autorité, un seul algorithme

**GarageFlows (client Electron) est la SEULE autorité qui COLLECTE les champs
matériels.** Le keygen et le backend ne reconstruisent plus l'identité : ils
**reçoivent** le HWID V1 produit par le client. L'algorithme de canonicalisation
est partagé et strictement déterministe (`src/lib/license/hwid-v1.ts`, référence
Python `scripts/hwid_v1.py`), prouvé identique octet-pour-octet par
`tests/fixtures/hwid-v1-vectors.json`.

## Algorithme (`hwidVersion = 1`)

Entrée : un jeu de champs déjà collectés par le client.

1. **Champs canoniques** (clés triées, TOUJOURS présentes, vide si absente) :
   `cpu`, `diskSerial`, `mac`, `machineId`, `platform`.
2. **Normalisation** de chaque valeur : Unicode **NFC** → espaces compressés
   (`\s+` → un espace) → `trim` → **minuscules**.
3. **Sérialisation** : `clé=valeur` par ligne, jointes par LF, préfixées du tag de
   séparation de domaine `GF-HWID-V1\n`.
4. **Hash** : SHA-256 (UTF-8) → hex.
5. **Sortie** : `HWID1-<64 hex>`.

Exemple (vecteur `full-windows`) →
`HWID1-acdfae38b699631799ef96cb1f1f0d27a7eb82d3824332c41d8296710e56744b`.

## Robustesse (tolérance au changement matériel mineur)

- Normalisation casse/espaces/Unicode : un même matériel décrit avec une casse ou
  des espaces différents (entre OS/outils) donne le MÊME HWID (prouvé : le vecteur
  `casing-and-space-noise` == `full-windows`).
- Champ absent → vide (l'empreinte reste définie) : l'ajout d'une carte virtuelle
  ou d'un VPN n'invalide pas tout, tant que le client choisit une valeur `mac`
  **stable** (politique de sélection côté client, hors périmètre de cet algorithme
  pur).
- Le client DOIT sélectionner des champs stables (préférer un identifiant machine
  persistant + numéro de série disque au MAC quand disponible).

## Compatibilité legacy (aucune licence cassée)

- `hwidVersion = 0` (legacy) : l'empreinte historique
  (`sha256(join("||GF2-HWID-SALT||", [cpu, mac, platform, hostnameHash, disk]))`,
  cf. `src/lib/license/hwid.ts` `generateHwid` + Electron `getHwid`). Les licences
  existantes restent validées par ce chemin.
- `hwidVersion = 1` : nouvelle empreinte canonique ci-dessus.
- La vérification accepte les deux selon le `hwidVersion` porté par le jeton/état
  de licence. **Aucune migration destructive** : une licence v0 continue de
  fonctionner ; une nouvelle activation produit v1.

## Adoption runtime (étape de bascule — à valider sur poste réel)

1. `getHwidV1()` (Electron) : collecte `{cpu, mac (sélection stable), platform,
   machineId, diskSerial}` puis appelle l'algorithme canonique ; l'app affiche le
   `HWID1-…`.
2. Le keygen **cesse** de reconstruire pour le binding : `create_license` lie la
   valeur `HWID1-…` **fournie** (copiée depuis le client). `get_hwid()` reste un
   outil de diagnostic legacy, **jamais** une source de binding.
3. `verify.ts` accepte v0 (legacy) et v1 selon `hwidVersion`.

Cette bascule touche le flux de licence en production (activation/validation) et
doit être validée sur un poste réel (desktop) — elle est suivie comme telle. La
FONDATION (algorithme canonique + spécification + parité Node/Python + vecteurs +
tests + stratégie legacy) est livrée et prouvée ici.

## Critère de fermeture AUD-036

| Exigence | État |
|---|---|
| Spécification | ✅ ce document |
| Code canonique commun (TS + Python référence) | ✅ hwid-v1.ts + hwid_v1.py |
| Vecteurs partagés | ✅ tests/fixtures/hwid-v1-vectors.json (5) |
| Identité Node ↔ Python | ✅ prouvée (test + `python3 scripts/hwid_v1.py --vectors`) |
| Legacy fonctionne | ✅ hwidVersion 0 conservé (chemin inchangé) |
| Bascule runtime (Electron émet v1, keygen consomme) | 🔶 documentée, à valider sur poste réel |

Statut AUD-036 : **MITIGATED** (fondation canonique livrée + parité prouvée ; la
bascule runtime est la dernière étape, validable sur desktop réel). Passera
**FIXED** une fois la bascule effectuée et validée par une activation réelle.
