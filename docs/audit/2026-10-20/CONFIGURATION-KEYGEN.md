# GarageFlows — Configuration du Keygen

**Date :** 2026-10-20

## Architecture réelle, confirmée par le code

ECDSA **P-256 (secp256r1)** / SHA-256, signature **DER**, jetons
`GF2.<header>.<payload>.<signature>`, en-tête `{"alg":"ES256","typ":"GF-LIC","v":2}`.
Signature par `cryptography` (Python), vérification par `crypto.createVerify`
(Node) : l'interopérabilité entre les deux a été vérifiée.

## Chaîne cryptographique — VALIDÉE sur autorité de test

Bac à sable isolé, autorité P-256 créée à la volée, ancrages `_LINES` et `_PK`
cohérents, aucun contact avec l'état de production. **12 cas sur 12 conformes** :

| Cas | Verdict attendu | Obtenu |
|---|---|---|
| Licence valide | acceptée | **acceptée** |
| Payload altéré (`seats` 1 → 999) | `SIGNATURE_INVALID` | conforme |
| Signature d'un autre contenu | `SIGNATURE_INVALID` | conforme |
| Signature d'une autre clé P-256 | `SIGNATURE_INVALID` | conforme |
| Signature tronquée, puis vide | `SIGNATURE_INVALID` | conforme |
| Jeton vide, puis préfixe `GF1` | `FORMAT_INVALID` | conforme |
| Segment manquant | `SEGMENTS_INVALID` | conforme |
| **alg=none** | `HEADER_UNSUPPORTED` | conforme — pas de confusion d'algorithme |
| En-tête `v1` | `HEADER_UNSUPPORTED` | conforme |
| Licence expirée mais bien signée | `EXPIRED` | conforme |

## Garde de signature — CORRIGÉE

Le chemin CLI (`scripts/keygen.py`) utilisait son propre `_load_private()` **sans
aucune vérification d'émetteur**, là où le chemin graphique appelait
`load_checked_private_key()`. Une clé privée sans rapport avec la clé publique
embarquée produisait des jetons d'allure normale, affichés comme un succès et
**refusés à l'activation sans message** : le défaut ne se découvrait qu'au
support client.

Les quatre chemins (`--gen`, `--admin`, `--batch`, `--gen-mechanic`) refusent
désormais avec un code de sortie dédié. Vérifié non régressif : dans un bac à
sable à autorité cohérente, la génération **réussit** — ce n'est pas un blocage
aveugle.

## Clé de production

L'autorité de production (`bd8c0845…`) est ancrée en trois endroits, cohérents
entre eux. La clé **privée** correspondante n'est pas sur ce poste, et c'est sain.
Une autorité **locale** orpheline (`2cb8c677…`), créée par erreur le 20/10, a été
déplacée hors du dépôt après copie vérifiée : elle bloquait `npm run dist` et ne
pouvait signer aucune licence exploitable.

## Communication avec le serveur — NON TESTÉE

Deux causes distinctes, les deux établies :

1. **Les routes ne sont pas déployées.** `/api/keygen/licenses` renvoie **404** en
   production, là où une route existante dont la méthode ne correspond pas renvoie
   405 (comparé avec `/api/diagnostic`). Les trois routes `/api/keygen/**` ont été
   ajoutées par le commit du 19/10 ; le déploiement date du 17/10.
2. **Divergence de clé d'API.** `keys/server_config.json` porte une `api_key`
   d'empreinte `7c2b0d0e` alors que `GARAGEFLOW_API_KEY` vaut `7076985d`. Le keygen
   envoie `x-gf-key` avec la première, le serveur compare à la seconde : refus
   401/403. Aucune des deux n'est la valeur compromise — c'est une divergence de
   configuration, à aligner depuis Vercel.

Le code des routes, lui, a été relu et il est correct : refus si
`GARAGEFLOW_API_KEY` est absente ou fait moins de 16 caractères (le piège
`vide === vide` est impossible), comparaison à temps constant, rate-limit en amont.

**Reste à faire après le déploiement Preview** : enregistrement serveur d'une
licence de test, liaison HWID, vérification du LID et de l'UUID, expiration,
révocation, consultation administrative.
