# Keygen GarageFlows — interface, offres et exploitation

> Ce document décrit l'IHM **réellement présente** dans `scripts/keygen_ui.py`.
> Il ne remplace pas [KEYGEN.md](KEYGEN.md) (diagnostic « licence invalide »)
> ni [VERIFICATION_CLE_EMETTRICE.md](VERIFICATION_CLE_EMETTRICE.md) (preuve
> d'ancrage).

## 1. Lancement

| Contexte | Commande |
|---|---|
| Windows, dépôt cloné | `npm run keygen` (ou `python scripts/keygen_ui.py`) |
| Diagnostic sans affichage | `python scripts/keygen_ui.py --verify-key-match` |
| Prérequis | Python ≥ 3.10, `cryptography`, `tkinter`, Node.js pour les mises à jour |

Au démarrage, l'interface vérifie : présence du module `cryptography`, présence
de la paire `keys/private.pem` + `keys/public.pem`, correspondance avec les
ancres locales (sinon la signature est bloquée). Elle **ne recherche ni ne
reconstruit jamais** une clé privée : une clé perdue se restaure depuis le
coffre de l'exploitant.

## 2. Les dix sections

| Section | Ce qu'elle fait réellement | Ce qu'elle ne fait pas |
|---|---|---|
| **Tableau de bord** | Compteurs des fiches locales (total, actives, expirées, révoquées, clients, matériel lié), état de la paire, URL serveur, 12 dernières lignes d'audit | Aucun chiffre simulé |
| **Générer une licence** | Client complet, durée en jours/mois/années, sièges, HWID collé/importé et validé, signature ECDSA P-256, enregistrement local | Pas de génération de HWID |
| **Gérer les licences** | Recherche multi-champs, filtres, tri, fiche complète, suspension/réactivation/révocation, synchronisation serveur | Pas de révocation « locale » présentée comme centrale |
| **Clients** | Agrégation par identifiant client depuis les licences, recherche, accès direct aux licences | Aucune fiche client inventée |
| **Appareils et HWID** | HWID complet, sièges, appareils actifs connus du serveur, réinitialisation matérielle côté serveur | Pas de recalcul du HWID |
| **Clés ECC** | État de l'autorité, correspondance privée/publique, procédure de propagation (`npm run keys:sync`), copie du PEM public | N'affiche jamais la clé privée |
| **Mises à jour** | SHA-256/taille du fichier, signature Ed25519 via l'outil du dépôt, vérification immédiate par le module client | Ne signe jamais sans clé configurée |
| **Détection des secrets** | Analyse locale d'une capture avec `scripts/secret_scan.py`, valeurs masquées, rapport JSON, service local 127.0.0.1:7070 | Ne conserve aucune image |
| **Journaux et diagnostics** | Journal d'audit local, export JSON (chemins, empreintes publiques, état des composants) | Aucun jeton de licence ni clé privée |
| **Paramètres et serveur** | URL/clé API du serveur central, test de connexion, persistance locale | Ne configure pas la paire de signature |

## 3. Offres

Seules **PREMIUM** et **ADMIN** sont proposées à la génération.

Les types `trial`, `enterprise` et `mechanic` restent **décodables** par le
client (`src/lib/license/verify.ts`) pour ne pas invalider le parc déjà émis.
Le CLI peut les signer explicitement avec `--legacy-type` (avertissement et
journalisation), jamais par défaut. `ENTREPRISE` n'est pas réintroduit comme
offre commerciale.

## 4. Clés et emplacements

| Élément | Emplacement | Sensibilité |
|---|---|---|
| Clé privée ECC | `keys/private.pem` (PKCS#8, éventuellement chiffrée) | Critique — jamais dans Git, jamais dans le build |
| Clé publique ECC | `keys/public.pem` | Diffusable ; propagée par `npm run keys:sync` |
| Configuration locale | `keys/licenses_db.json`, `keys/server_config.json` | Locale, permissions 0600 |
| Journal | `keys/keygen_audit.log` | Identifiants tronqués, jamais de jeton |
| Clé Ed25519 des updates | `GF_UPDATE_SIGNING_KEY` ou `GF_UPDATE_SIGNING_KEY_FILE` | Critique — hors dépôt, jamais affichée |

Sur Windows, la configuration par défaut de l'application utilise
`%APPDATA%/GarageFlows/keys/`. Le Keygen d'édition, lui, lit `keys/` à la racine
du dépôt : ne jamais copier la clé privée de production dans un poste client.

## 5. Configuration serveur

- URL par défaut : `https://app.garageflows.fr` (`keygen_db.DEFAULT_SERVER_URL`).
- Clé API : `GARAGEFLOW_API_KEY`, stockée dans `keys/server_config.json`.
- Le bouton **Tester la connexion** appelle réellement le serveur ; sans clé, la
  requête est refusée avant tout envoi.
- Une modification de statut est d'abord appliquée localement, puis envoyée au
  serveur. En cas d'échec, l'interface l'indique explicitement : le statut
  central n'est pas prétendu modifié.

## 6. Tests exécutables

```bash
python3 scripts/test_keygen.py            # 20 tests (compatibilité historique)
python3 scripts/test_keygen_hwid_binding.py  # 10 tests (HWID V1)
python3 scripts/test_keygen_v2.py         # 88 tests (IHM via sonde Tk, offres,
                                          # agrégations, serveur, updates)
python3 scripts/test_secret_scan.py       # 32 tests (détection/OCR/HTTP)
```

Le rendu graphique n'est pas prouvé par ces tests : la sonde Tk exécute la
logique sans affichage. Une validation visuelle sur poste Windows/Linux avec
`python3 scripts/keygen_ui.py` reste nécessaire.

## 7. Pannes courantes

| Message | Cause | Action |
|---|---|---|
| « Aucune clé — restaurez l'autorité » | `keys/private.pem` absent | Restaurer depuis le coffre ; ne pas générer une nouvelle paire sur un parc actif |
| « Paire incomplète » | une seule des deux clés présente | Restaurer la manquante ; vérifier `npm run keys:check` |
| « La clé privée n'est pas celle de production » | ancre locale différente | Diagnostic `--verify-key-match`, ne pas signer |
| « Type commercial invalide » | type hors PREMIUM/ADMIN | Utiliser l'offre correcte |
| « Clé API requise » | serveur sans clé | Renseigner la clé, puis tester |
| « OCR indisponible » | Tesseract absent | Installer Tesseract ou définir `GF_SCREENSHOT_TESSERACT` ; le scan image reste bloqué (fail-closed) |
