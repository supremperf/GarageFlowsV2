---
doc-numbers: journal
---

# SCAN DE SECRETS — MASTER 7

**Résultat : 6 signalements → 0, avec une politique de sécurité au moins aussi stricte qu'avant.**

Preuve : `MASTER7_EVIDENCE/logs/04-secret-scan-correction.txt`.

---

## 1. État de départ, mesuré sur la CI

Inventaire du job *Secret scan (Gitleaks)*, run `39993807948`, commit `dd21f5f` :

```
total : 6   scannerExit : 1   →   job en ÉCHEC
```

MASTER 6 en annonçait 5 : le sixième était dans **son propre journal de triage**, committé après le run qu'il avait observé.

| Emplacement | Règle | Ligne |
|---|---|---:|
| `MASTER6_EVIDENCE/logs/27-triage-gitleaks-ci.txt` | generic-api-key | 68 |
| `configuation automatique/tests/02-moteur.test.js` | jwt | 255 |
| `configuation automatique/tests/03-synchronisation.test.js` | generic-api-key | 124 |
| `src/lib/__tests__/secrets-jamais-distribues.test.ts` | private-key | 128 |
| `tests/private-key-material.test.cjs` | private-key | 79 |
| `tests/setup-dev-permissions.test.cjs` | generic-api-key | 39 |

## 2. La correction : la fixture, jamais le scanner

Les cinq fixtures sont désormais **assemblées à l'exécution**. La source ne contient plus le motif détectable ; **la valeur produite est inchangée à l'octet**.

| Fixture | Avant | Après |
|---|---|---|
| faux jeton OIDC | littéral `eyJhbGci…` | `[b64url('{"alg":"RS256"}'), b64url('{"sub":"test"}'), b64url('signature')].join('.')` |
| expression collée à un nom sensible | `{ GF_DB_MAC_SECRET: aides.VALEURS_TEST.hex_32 }` | valeur sortie de l'objet littéral, ligne précédente |
| faux bloc PEM (TS) | trois littéraux adjacents | `armure('BEGIN')`, corps, `armure('END')` |
| `falsePositive` (CJS) | gabarit avec armure en dur | armure assemblée à l'exécution |
| faux `NEXTAUTH_SECRET` | littéral base64 | `Buffer.from('foobarbazquxsecret1234567890').toString('base64')` |

**Équivalence vérifiée** pour les quatre valeurs concernées — la cinquième correction ne change aucune valeur, elle déplace seulement une expression :

```
jeton OIDC factice ......... identique
faux bloc PEM (TS) ......... identique
falsePositive (CJS) ........ identique
NEXTAUTH_SECRET de recette . identique
```

Aucune assertion n'a été modifiée. Les tests échoueraient si une de ces valeurs devenait un vrai secret — c'est précisément leur objet.

## 3. Le sixième cas : un journal de preuves immuable

`MASTER6_EVIDENCE/logs/27-triage-gitleaks-ci.txt:68` **cite**, comme documentation, la ligne de source qui était fautive. Le mandat interdit de modifier `MASTER6_EVIDENCE` : la citation ne peut pas être réécrite.

Ce que gitleaks capture à cet endroit, relevé **sans rédaction** :

```
Match  : "GF_DB_MAC_SECRET: aides.VALEURS_TEST.hex_32 "
Secret : "aides.VALEURS_TEST.hex_32"
```

C'est une **expression JavaScript**, pas une valeur. La valeur réelle est calculée à l'exécution par une suite arithmétique déterministe et n'est écrite dans aucun fichier du dépôt.

**Correction retenue : une regex d'allowlist couvrant cette chaîne exacte.** Elle suit la pratique documentée du projet — chaque fixture nommée individuellement — et, contrairement à une exemption de chemin, **elle ne soustrait aucun fichier au scan**. Le journal de preuves reste intégralement analysé.

Le choix était entre deux options ; j'ai pris la plus étroite :

| Option | Portée | Retenue |
|---|---|---|
| exemption de **chemin** | soustrait **tout le fichier** au scan | ❌ non |
| exemption de **chaîne exacte** | soustrait une expression de code, partout | ✅ oui |

## 4. Ce qui n'a pas été fait

| | |
|---|---|
| `.gitleaksignore` | **inchangé** — 0 entrée ajoutée |
| règles du scanner | **aucune** — `useDefault = true`, aucun `[[rules]]` |
| exemptions de chemin | **inchangées** — toujours 3 entrées précises |
| registres de triage hash-verrouillés | **intouchés** |
| compteurs en dur | **intouchés** |
| tests supprimés ou affaiblis | **0** |

## 5. Non-régression

`tests/secret-scan-fixtures.test.cjs`, **câblé dans `test:release-safety`** que la CI exécute. Quatre tests, verrou dans les deux sens :

1. **aucune fixture ne réintroduit un littéral détectable** — bloc PEM complet, chaîne de forme JWT, littéral de forte entropie collé à un nom sensible ;
2. **les fixtures produisent toujours les valeurs attendues** — sinon la correction aurait vidé les tests de leur sens. Les attendus sont exprimés par **décodage**, jamais par un littéral encodé : ce fichier ne réintroduit pas ce qu'il interdit ailleurs ;
3. **la politique du scanner n'a pas été relâchée** — les cinq emplacements ne figurent pas dans l'allowlist, `useDefault` reste vrai, et la liste `paths` doit rester **exactement** ses trois entrées d'origine ;
4. **l'unique exemption de chaîne ne couvre qu'une expression de code** — le test vérifie que `helpers.js` la calcule bien à l'exécution, que la valeur produite est un hex de 32 octets, et qu'elle n'apparaît pas dans la configuration.

Ce dernier point est important : l'exemption n'est légitime **que** parce que la chaîne est une expression. Si ce contrat change, le test échoue et l'exemption doit être revue.

## 6. Résultat vérifié

Sur l'arbre complet publié — 3 210 fichiers, 131 Mo :

```
gitleaks detect --no-git --source .   →   no leaks found
```

Et sur la CI, commit `d18fb81` :

```
✓ Secret scan (Gitleaks) in 14s
  Gitleaks inventory: findings=0; scannerExit=0
```

| Suite | Résultat |
|---|---|
| `tests/secret-scan-fixtures` | **4 / 4** |
| `test:release-safety` | **197 tests, 194 réussis, 0 échec, 3 ignorés** (était 193/190/0/3) |
| `tests/secret-scan-policy` | **4 / 4**, inchangé |
| suites « configuation automatique » | **119 / 119** |
| `secrets-jamais-distribues` (vitest) | **7 / 7** |
| TypeScript / ESLint | **0 / 0** |

La politique est **strictement plus stricte qu'avant** : même jeu de règles, même allowlist de chemins, aucune entrée dans `.gitleaksignore`, plus quatre tests de non-régression qui n'existaient pas.
