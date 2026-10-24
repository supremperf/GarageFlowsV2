---
doc-numbers: journal
---

# CRYPTOGRAPHIE DES LICENCES — MASTER 7

Preuve : `MASTER7_EVIDENCE/logs/05-cryptographie-licence.txt`. **Aucune clé privée n'est affichée, copiée ni transmise.**

---

## 1. Le système tel qu'il est

| | |
|---|---|
| algorithme | **ECDSA P-256 (`prime256v1`) + SHA-256** |
| encodage de signature | DER SEQUENCE — compatible Node.js ↔ Python |
| format du jeton | `GF2.<en-tête>.<charge>.<signature>`, base64url |
| en-tête | `{"alg":"ES256","typ":"GF-LIC","v":2}` |
| **identifiant de clé (`kid`)** | **ABSENT** — vérifié : aucune occurrence dans `src/lib/license/*.ts` |
| autorité de production | **`b16d2e1bf6b9662f9748e009c0cf88770ab602233ee546895ac352f808bc3d9d`** |
| empreinte du vérificateur | `afbed2df6d94fbccf3ce0e7e17b96116a524f8175e75587c9f96c69bd83eb894` |
| ancrages de compilation | **3, tous alignés** |
| consommateurs internes | **2, alignés** |
| empreintes retirées | **11** (`RETIRED_FINGERPRINTS`) |

La clé publique est un **ancrage de compilation sans dérogation à l'exécution** : figée dans les sources, dont `electron/main.js`. Aucune variable d'environnement ne peut la remplacer. C'est un choix de sécurité délibéré, qu'il ne faut pas contourner.

## 2. Où la vérification se joue exactement

`src/lib/license/verify.ts`, un seul point :

| Lignes | Rôle |
|---|---|
| 142-151 | construction de la clé depuis l'ancrage, avec contrôle du type (`ec`) et de la courbe (`prime256v1`). Un ancrage mal configuré lève `TRUST_ANCHOR_INVALID` — **ce n'est pas confondu** avec une signature invalide |
| 153-166 | `crypto.createVerify('SHA256')` sur `<en-tête>.<charge>`, puis `verifier.verify(...)` |
| 168-170 | échec → `SIGNATURE_INVALID`, message volontairement vague |

Huit suites de tests dédiées couvrent ce point, dont `forgery-resistance`, `public-key-consistency`, `issuer-key`, `license-crosslang-format`, `license-keygen-e2e`.

## 3. La clé privée est définitivement introuvable

Méthode concluante : pour chaque matériel de clé privée trouvé, **dériver la clé publique** et comparer son empreinte SPKI à celle de l'autorité. Un nom de fichier ne prouve rien.

```
emplacements explorés ......................... 4
fichiers candidats examinés .................... 2 090
clés privées EC chargeables trouvées ........... 3
correspondant à l'autorité de production ....... 0
```

| Empreinte publique dérivée | Emplacement | Nature |
|---|---|---|
| `613c89fb5ff6fa6c…` | `.tmp-m6-e2e/keys/private.pem` | paire de **test** de MASTER 6 — son existence **confirme l'isolation** |
| `78e2626bbb5d76da…` | `Desktop/garageflows/API générées/2026-08-10_22-13-18/nouvelle-paire-licence/private.pem` (2 copies) | paire en clair hors coffre, datée du **2026-08-10** — la date même où `GF_PRIVATE_KEY` avait été configurée en production. Elle ne correspond pourtant **pas** à l'ancrage actuel |

Et chez Vercel :

```
npx vercel env ls | grep -ci "PRIVATE_KEY"   →   0
```

**Aucune variable de clé privée dans aucun environnement** (Production, Preview, Development). Confirmation indépendante.

Aucune clé n'a été inventée, et il n'est pas affirmé qu'une clé absente aurait été retrouvée.

## 4. Conséquences sur les licences existantes

| | |
|---|---|
| vérification des licences déjà émises | **INTACTE** — ancrage présent partout, vérification hors ligne fonctionnelle, 19 tests de contrefaçon verts |
| **émission** de nouvelles licences | **IMPOSSIBLE** |
| renouvellement, extension de sièges | **IMPOSSIBLE** |
| révocation | **POSSIBLE** côté serveur — l'état est en base, indépendamment de la signature |

Un produit sous licence qui ne peut plus délivrer de licence à un nouveau client n'est pas commercialisable en l'état. **C'est le blocage central de cette mission.**

## 5. Rotation avec transition compatible — procédure préparée, non appliquée

**Contrainte structurante** : les jetons ne portent aucun `kid`. Un vérificateur ne peut donc pas savoir quelle clé a signé un jeton — il doit les essayer. **La seule transition qui n'invalide aucune licence existante est un vérificateur multi-ancrages.**

Elle est décrite ici et **volontairement non appliquée** : elle touche un composant de sécurité central, et le mandat exige une décision explicite avant toute invalidation.

**Principe.** Conserver `b16d2e1b…` comme ancrage de vérification et **ajouter** le nouvel ancrage. Les licences en circulation continuent de vérifier sous l'ancien ; les nouvelles sont signées par la nouvelle paire. Coût à l'exécution : au pire deux vérifications ECDSA au lieu d'une — négligeable.

**Sept points de travail, localisés :**

1. `src/lib/license/public-key.ts` — `_LINES` (l. 14) et `getPublicKeyPem()` (l. 21) exposent une seule clé. Ajouter `getTrustedPublicKeysPem(): string[]`, ordonnée, la nouvelle en tête ; conserver `getPublicKeyPem()` comme clé **primaire** (celle d'émission) pour ne rien casser.
2. `src/lib/license/verify.ts` l. 142-170 — construire un tableau de clés ; n'échouer en `TRUST_ANCHOR_INVALID` que si **aucune** n'est chargeable ; accepter à la première signature valide ; conserver `SIGNATURE_INVALID` vague.
3. `electron/main.js`, ancrage `_PK` — même liste, pour la vérification hors ligne sur le poste.
4. `REFERENCE_FP`, `sync-public-key.mjs`, `check-public-key.mjs` — passer d'une empreinte unique à un **ensemble** d'empreintes de confiance, et échouer si une empreinte inconnue apparaît.
5. Émission (keygen Python + `issuer-key.ts`) — signer **exclusivement** avec la nouvelle privée.
6. Les huit suites de tests, à étendre **sans en affaiblir aucune**. En particulier `forgery-resistance` doit continuer à **rejeter** une clé étrangère : la liste d'ancrages ne doit jamais devenir « accepte n'importe quelle clé P-256 ».
7. Retirer l'ancien ancrage **plus tard seulement**, quand toutes les licences signées par lui auront expiré — la plus lointaine connue expire vers **juillet 2027**.

**À ne pas faire :**

- exécuter `keys:sync` pour débloquer un test — cela remplacerait l'autorité que vérifient les postes déployés ;
- réutiliser la paire `78e2626b…` trouvée sur le Bureau — en clair hors coffre, exposition inconnue ;
- une rotation simple sans multi-ancrages — elle invaliderait **toutes** les licences en circulation.

## 6. Information manquante pour arbitrer

Le **nombre de licences réellement actives en production**. Le staging en contient 0 ; la base de production n'a pas été interrogée — hors périmètre, et aucune donnée personnelle ne doit être lue.

→ Une lecture seule (`SELECT count(*) FROM "LicenseKey"`) suffirait à chiffrer l'impact exact. Autorisez-la si vous voulez l'arbitrage chiffré.
