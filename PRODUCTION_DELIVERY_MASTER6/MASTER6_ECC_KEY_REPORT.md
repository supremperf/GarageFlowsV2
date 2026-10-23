---
doc-numbers: journal
---

# CLÉ PRIVÉE ECC DE LICENCE — rapport MASTER 6

**Verdict : INTROUVABLE dans tous les emplacements autorisés.** La recherche a été menée méthodiquement et sans jamais afficher, copier, committer ni transmettre de matière de clé. Aucune nouvelle paire n'a été déployée. Une stratégie de rotation est proposée en §6 et attend votre décision.

---

## 1. Ce que l'on cherchait

| | |
|---|---|
| empreinte publique de l'autorité de production | **`b16d2e1bf6b9662f9748e009c0cf88770ab602233ee546895ac352f808bc3d9d`** |
| algorithme | ECDSA, courbe `prime256v1` (NIST P-256), condensat SHA-256 |
| ce que la privée permettrait | émettre et renouveler des licences GarageFlows acceptées par les clients déployés |

## 2. Méthode — et ce qu'elle n'a jamais fait

La correspondance a été établie par **empreinte uniquement** : pour chaque candidat, on dérive la clé publique, on calcule le SHA-256 de son SPKI DER, et on le compare à la cible. C'est la seule preuve de correspondance qui ne manipule aucun secret en clair.

Interdits respectés, sans exception :

- aucune matière de clé affichée, journalisée ou recopiée dans un rapport ;
- aucune clé écrite où que ce soit ;
- aucune transmission réseau ;
- **aucune tentative de reconstruction** de la privée depuis la publique ou une signature — vain sur P-256 et hors mandat ;
- aucune tentative de déchiffrement d'une clé protégée par phrase de passe.

Preuve : `MASTER6_EVIDENCE/logs/02-recherche-cle-ecc.txt`.

## 3. Emplacements fouillés

| Emplacement | Résultat |
|---|---|
| `GF_PRIVATE_KEY`, `LICENSE_PRIVATE_KEY`, `GF_SIGNING_KEY`, `GF_UPDATE_SIGNING_KEY`, `PRIVATE_KEY`, `GF_LICENSE_PRIVATE_KEY` dans l'environnement local | **0 / 6 définies** |
| `keys/private.pem`, `keys/private-key.pem`, `keys/licence-private.pem`, `keys/signing.pem` | **absents** |
| `~/.garageflows-publisher/` | 1 clé — **ed25519**, empreinte `8e74a7a5…` → c'est la clé de **signature des mises à jour**, pas celle des licences |
| `~/AppData/Roaming/GarageFlow/` | 4 fichiers de clé examinés — aucune correspondance |
| `~/Desktop/garageflows/` et `~/Desktop/garageflows.fr/` | 2 clés P-256 — empreinte `78e2626b…`, **ne correspond pas** |
| variables Vercel, tous environnements, aujourd'hui | `GF_PRIVATE_KEY` **absente partout** |
| sauvegarde `vercel-production-avant-reset.env` (2026-08-10) | `GF_PRIVATE_KEY` **nommée**, mais valeur = `"[SENSITIVE]"` — marqueur de non-export de `vercel env pull`, **aucune valeur récupérable** |

## 4. Ce que la recherche a mis au jour

### 4.1 Une paire de licence existe sur le poste, mais ce n'est pas l'autorité

`~/Desktop/garageflows/API générées/2026-08-10_22-13-18/nouvelle-paire-licence/` contient une paire P-256 complète, d'empreinte publique **`78e2626bbb5d76da7ab4a6eaecc9d8e94726882fbc7c21d400aa3ebcbb0c7924`**.

Elle n'est ni l'autorité actuelle, ni dans la liste des clés retirées du projet : elle a été **générée le 2026-08-10 et jamais déployée** sur les ancrages. Son dossier porte d'ailleurs le nom « nouvelle-paire-licence ».

### 4.2 `GF_PRIVATE_KEY` était configurée en production, puis a disparu

La sauvegarde du 2026-08-10 s'appelle littéralement `vercel-production-avant-reset.env` et **nomme** `GF_PRIVATE_KEY` parmi les 16 variables de production de l'époque. Elle est aujourd'hui absente de tous les environnements Vercel. La variable a donc été **retirée lors du reset** que ce nom de fichier documente, et la sauvegarde n'a capté que des marqueurs.

### 4.3 Le projet a connu onze rotations de clés

`scripts/check-critical-files.js` tient la liste des empreintes **retirées**, avec leur date :

```
c48e6b3e…  avant 2026-08-03
7bed3cb7…  2026-08-07 (keygen régénéré)
3150baac…  2026-08-08 (rotation cryptographique totale)
1f1be919…  2026-08-09 (rotation)
1c21d4bb…  2026-08-10 (rotation)
2dcd21a7…  2026-08-10 (rotation)
fe5b7807…  2026-08-14 (rotation)
835c1e90…  2026-08-14 (rotation 17:23 — valide 0/4 licences réelles)
e6605999…  2026-08-16 (rotation)
2f3c1693…  2026-08-16 (rotation)
bd8c0845…  2026-10-20 (rotation)
```

L'autorité actuelle `b16d2e1b…` a donc été installée **vers le 2026-10-20**, en remplacement de `bd8c0845…`. L'annotation du 2026-08-14 est instructive : le projet a déjà assumé une rotation qui « valide 0/4 licences réelles ».

### 4.4 Conséquence opérationnelle, mesurée

| Fait | Conséquence |
|---|---|
| la privée de `b16d2e1b…` est introuvable | **aucune licence ne peut plus être émise ni renouvelée** sous l'autorité actuelle |
| `GF_PRIVATE_KEY` absente de Vercel | `/api/admin/licenses/generate` renvoie « Clé privée d'émission introuvable » |
| les clients déployés vérifient `b16d2e1b…` | seules des licences signées par cette clé perdue restent acceptées |

Le système de licences est donc **fonctionnel en vérification, inopérant en émission**.

## 5. Les jetons ne portent aucun identifiant de clé — fait déterminant

L'en-tête des jetons GF2 a été décodé :

```json
{"alg":"ES256","typ":"GF-LIC","v":2}
```

**Aucun `kid`.** Et le modèle `LicenseKey` (PostgreSQL) **ne porte aucun champ** enregistrant la clé signataire : ni `keyFingerprint`, ni `signerKid`. Le jeton complet est stocké, mais rien n'indique qui l'a signé.

Enfin, le vérificateur n'accepte **qu'une seule** clé : `src/lib/license/verify.ts` appelle `getPublicKeyPem()`, qui renvoie un littéral unique `_LINES`, sans itération sur un jeu de clés et sans dérogation par variable d'environnement.

Ces trois faits conditionnent entièrement la stratégie de rotation.

## 6. Stratégie de rotation proposée — VOTRE DÉCISION REQUISE

Aucune de ces options n'a été mise en œuvre. Chacune est exposée avec son coût réel.

### Option A — Rotation simple (ce que le projet a déjà fait onze fois)

Déployer une nouvelle paire, déplacer les trois ancrages avec `keys:sync`, reconstruire.

- **Coût** : toutes les licences signées par `b16d2e1b…` cessent d'être acceptées. Chaque client doit recevoir une nouvelle licence.
- **Avantage** : aucun changement de code, procédure outillée et testée.
- **Pertinent si** : le nombre de licences réellement en circulation est faible ou nul.

### Option B — Vérificateur multi-clés (compatibilité ascendante)

Faire accepter **plusieurs** clés publiques en vérification, tout en n'émettant qu'avec la nouvelle.

Travail nécessaire, chiffré :

1. `src/lib/license/public-key.ts` : exposer un **tableau** de clés (active + anciennes encore honorées) au lieu d'un littéral unique.
2. `src/lib/license/verify.ts` : essayer chaque clé jusqu'à succès. **Les jetons n'ayant pas de `kid`, l'essai séquentiel est la seule voie** ; coût négligeable (quelques vérifications ECDSA).
3. `electron/main.js` : même traitement pour l'ancrage `_PK`.
4. `scripts/sync-public-key.mjs`, `materialize-build-public-key.cjs`, `check-critical-files.js`, `restore-public-anchors.cjs` : adapter les contrôles d'ancrage à un ensemble.
5. `REFERENCE_FP` : devient un ensemble de références.
6. Ajouter `keyFingerprint` à `LicenseKey` + migration, pour **tracer désormais** la clé signataire.
7. Décider de la **durée** pendant laquelle l'ancienne clé reste honorée.

- **Coût** : modification d'un composant de sécurité central, avec révision complète de ses gardes. À ne pas improviser.
- **Avantage** : aucune licence existante invalidée ; la transition est progressive.
- **Risque à nommer** : accepter plusieurs clés **élargit la surface de confiance**. Si l'ancienne privée est perdue, elle ne peut plus signer — l'honorer n'ajoute donc pas de risque d'émission frauduleuse, seulement de rejeu de licences déjà émises.

### Option C — Réutiliser la paire déjà présente (`78e2626b…`)

La paire de 2026-08-10 est complète et disponible. Elle pourrait devenir la nouvelle autorité sans génération.

- **À vérifier avant toute décision** : pourquoi elle n'a jamais été déployée, et si sa privée a été exposée entre-temps (elle est en clair sur le Bureau, hors coffre).
- **Mon avis** : préférer une **paire neuve générée dans un coffre**, précisément parce que celle-ci traîne en clair sur un poste de travail.

### Ce qu'il faut savoir avant de trancher

Le nombre de licences **réellement en circulation en production** est l'information décisive, et je ne l'ai pas : la base de staging en contient **0**, et la base de production n'a pas été interrogée — vous avez restreint l'accès aux services de Preview, et le mandat MASTER 6 réaffirme « ne réutilise jamais la base de production ».

**Si vous m'autorisez une lecture seule (`SELECT count(*)`) sur la base de production**, je peux chiffrer exactement l'impact de l'option A et vous dire si elle suffit.

## 7. Ce qui n'a pas été fait, délibérément

- aucune paire générée ni déployée ;
- `npm run keys:sync` **jamais exécuté** — il déplacerait les trois ancrages et remplacerait l'autorité de production ;
- les trois ancrages restent alignés sur `b16d2e1b…`, vérifié en fin de mission par `keys:check` et `check:public-key` ;
- aucune licence révoquée ;
- `RETIRED_FINGERPRINTS` non modifié.

## 8. Comment les tests ont néanmoins été débloqués

Sans la clé de production, et sans la contrefaire : une **paire de TEST** a été générée, et les ancrages n'ont été modifiés que dans une **copie isolée** du projet (`.tmp-m6-e2e/`, ignorée par git). La licence de test est `VERIFIED` sous l'ancrage de test et **`SIGNATURE_INVALID` sous celui de production** — elle ne peut donc jamais activer une installation réelle.

Voir `MASTER6_LICENSE_REPORT.md` et `MASTER6_PLAYWRIGHT_REPORT.md`.
