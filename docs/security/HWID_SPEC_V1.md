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

## Adoption runtime (chaîne de code LIVRÉE + prouvée ; reste le déploiement réel)

Les trois maillons du flux sont désormais **écrits et prouvés en tests
automatisés** (sans matériel réel) :

1. **Émetteur client** — `getHwidV1()` (`electron/main.js`) : collecte
   `{cpu, mac (sélection stable), platform, machineId, diskSerial}` puis applique
   l'algorithme canonique. Réimplémentation **octet-pour-octet identique** à
   `hwid-v1.ts` (prouvée : l'algorithme sérialise `full-windows` →
   `HWID1-acdfae38…56744b`, comme TS et Python). `getMachineId()` lit une source
   stable par OS (MachineGuid Windows / IOPlatformUUID macOS / `/etc/machine-id`).
2. **Keygen consomme, ne reconstruit plus** — `create_license` lie la valeur
   `HWID1-…` **fournie** (option `--bind-hwid`, copiée depuis le client).
   `get_hwid()` reste un outil de diagnostic legacy, **jamais** une source de
   binding. Prouvé par `gen_test_licenses.py` (L7) : le keygen officiel signe une
   licence liée à l'empreinte v1 produite par l'algorithme partagé.
3. **Vérificateur accepte v1** — `verify.ts` : `isValidHwidFormat` /
   `verifyHwid` / `hwidVersionOf` acceptent v0 (64 hex) **et** v1
   (`HWID1-<64 hex>`), comparaison stricte à temps constant. v0 et v1 ne peuvent
   **jamais** se confondre (longueurs 64 vs 70 → `verifyHwid` renvoie false entre
   versions). Round-trip complet prouvé (test E2E `license-keygen-e2e`) :
   *client → hwid v1 → keygen signe → verifyLicenseToken + verifyHwid = OK ;
   mauvaise machine = rejet*.

**Ce qui reste (déploiement réel, non simulable en conteneur Linux headless)** :
basculer le **défaut LIVE** de l'app pour émettre v1 aux **nouvelles**
activations (les licences v0 existantes continuent par le chemin v0 — aucune
migration destructive), puis valider sur un **poste Windows réel** la **stabilité
des champs collectés au fil des redémarrages** (propriété inhérente à tout HWID,
non vérifiable sans matériel). Les call-sites internes de signature d'état
(horloge de confiance, online-check) restent volontairement en v0 pour ne pas
invalider l'état des installations existantes lors d'une mise à jour.

## Critère de fermeture AUD-036

| Exigence | État | Preuve |
|---|---|---|
| Spécification | ✅ | ce document |
| Code canonique commun (TS + Python référence) | ✅ | hwid-v1.ts + hwid_v1.py |
| Émetteur client (Electron) | ✅ | `getHwidV1()` — parité octet-pour-octet vérifiée |
| Vecteurs partagés | ✅ | tests/fixtures/hwid-v1-vectors.json (5) |
| Identité Node ↔ Python ↔ Electron | ✅ | tests + `python3 scripts/hwid_v1.py --vectors` |
| Keygen consomme la valeur cliente (ne reconstruit plus) | ✅ | `--bind-hwid` + L7 dans gen_test_licenses.py |
| Vérificateur accepte v0 **et** v1, sans confusion | ✅ | verify.ts + hwid-verify.test.ts |
| Round-trip client→keygen→verify (sans matériel) | ✅ | license-keygen-e2e.test.ts (L7) |
| Legacy v0 fonctionne (aucune licence cassée) | ✅ | hwidVersion 0 conservé (chemin inchangé) |
| Défaut LIVE bascule vers v1 + validation poste réel | 🔶 | déploiement/desktop — hors conteneur |

Statut AUD-036 : **MITIGATED** — la **divergence** (deux reconstructions →
empreintes différentes) est **architecturalement éliminée** (une seule autorité
collecte ; keygen/backend consomment la valeur) et la **chaîne de code complète
est livrée et prouvée end-to-end en tests**. Reste, avant **FIXED**, le seul
maillon non simulable ici : basculer le défaut LIVE de l'app et valider la
stabilité des champs sur un poste Windows réel par une activation réelle.
