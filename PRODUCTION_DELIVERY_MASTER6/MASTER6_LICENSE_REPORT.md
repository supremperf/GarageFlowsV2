---
doc-numbers: journal
---

# LICENCE DE TEST — rapport MASTER 6

**Verdict : LICENCE DE TEST OPÉRATIONNELLE.** Elle active réellement l'application, et elle est **structurellement incapable** d'activer une installation de production. Le blocage qui laissait 90 tests Playwright inexécutés en MASTER 5 est levé.

---

## 1. Le problème à résoudre

`e2e/global-setup.ts` exige trois variables pour ouvrir une session applicative :

```ts
const email = process.env.E2E_EMAIL
const password = process.env.E2E_PASSWORD
const license = process.env.E2E_LICENSE
if (!email || !password || !license) { /* les tests d'application se déclarent skipped */ }
```

`E2E_LICENSE` doit être un jeton **GF2 réellement signé**, accepté par le serveur. Or la clé privée de l'autorité de production est introuvable (voir `MASTER6_ECC_KEY_REPORT.md`), et le mandat interdit — à juste titre — d'utiliser une clé de production pour simplifier les tests.

## 2. L'obstacle technique, et pourquoi il est voulu

La clé publique de licence est un **ancrage de compilation** :

```ts
// src/lib/license/public-key.ts
const _LINES = [ /* … */ ]
export function getPublicKeyPem(): string { return _LINES.join('\n') }
```

Recherche exhaustive effectuée : **aucune dérogation par variable d'environnement** n'existe (`GF_PUBLIC_KEY`, `PUBLIC_KEY_OVERRIDE`… : rien). `verify.ts` appelle `getPublicKeyPem()` sans paramètre de substitution.

C'est un choix de sécurité délibéré : **on ne peut pas substituer la racine de confiance au moment de l'exécution**. Il ne devait donc pas être contourné, mais contourné *proprement* — en construisant un environnement dont la racine de confiance EST la clé de test.

## 3. La solution retenue : une copie isolée

| Élément | Valeur |
|---|---|
| copie de travail | `.tmp-m6-e2e/` — **ignorée par git** (`.gitignore:27 .tmp-*/`), vérifié |
| fichiers copiés | 3 104 (sans `node_modules`, `.next`, `dist`, `.git`, `keys`, preuves) |
| résolution des dépendances | Node remonte l'arborescence → `node_modules` du projet réutilisé, rien dupliqué |
| paire de TEST | générée à l'exécution, P-256, **empreinte `613c89fb5ff6fa6c8632f780eefe2552fbd217ceeca9a8483e27027bde657946`** |
| ancrages modifiés | `src/lib/license/public-key.ts` et `electron/main.js` — **dans la copie seulement** |
| base de recette | `.tmp-m6-e2e/prisma/m6-e2e.db`, créée puis seedée |
| arbre de travail réel | **intact** — `git status` vide sur les deux fichiers d'ancrage |

Preuve : `MASTER6_EVIDENCE/logs/02-recherche-cle-ecc.txt` et la trace de préparation.

## 4. La licence émise

Produite par le **vrai générateur Python** du projet (`scripts/keygen_core.py`), pas par un script de contournement :

| | |
|---|---|
| type | licence **garage**, `premium` |
| identifiant client | **`MASTER6-TEST-NEVER-PRODUCTION`** — identifiable sans ambiguïté |
| libellé | « Recette MASTER 6 — licence de TEST » |
| validité | 1 an |
| identifiant de licence | `a1896fc7-ceb0-470c-98ce-f24db3efa3a9` |
| longueur du jeton | 652 caractères |

Le jeton lui-même n'est pas reproduit ici : il est sans valeur hors de la copie, mais le principe reste de ne pas publier de jeton de licence.

## 5. La garantie d'isolation — mesurée dans les deux sens

C'est le contrôle décisif :

| Vérification | Résultat |
|---|---|
| licence de test vérifiée sous l'ancrage de **TEST** | **`VERIFIED`** |
| même licence vérifiée sous l'ancrage de **PRODUCTION** | **`SIGNATURE_INVALID`** |

La licence de test est donc **incapable d'activer une installation de production**, par construction cryptographique — pas par convention.

L'inverse est tout aussi vrai : une licence de production ne serait pas acceptée par la copie de test.

## 6. L'activation a réellement eu lieu

Ce n'est pas une simulation. `e2e/global-setup.ts` a saisi la licence dans le formulaire `/license` et cliqué « Activer ». Trace réelle :

```
[e2e:setup] url=http://localhost:3200/
            cookies=next-auth.csrf-token,next-auth.callback-url,next-auth.session-token,
                    gf_session,gf_license_validated,gf_license_type
```

Les cookies **`gf_session`, `gf_license_validated` et `gf_license_type`** n'existent que si le serveur a vérifié la signature, enregistré la licence et émis une session de licence. L'enregistrement en base s'est fait par le chemin normal du produit : une licence **garage** valide s'auto-enregistre à l'activation (`prisma.licenseKey.create`, `src/app/api/license/activate/route.ts:455`).

## 7. Ce que l'application a refusé — et c'est une bonne nouvelle

Une sonde d'arbitrage a d'abord tenté de **forger** un cookie `gf_session` au lieu d'activer la licence. Toutes les API privées ont répondu :

```
HTTP 401  {"code":"LICENSE_UNKNOWN"}
```

Le serveur **exigeait réellement la licence** : aucun `LICENSE_ENFORCEMENT=off` n'était posé, et un identifiant de licence inexistant en base est refusé. La sonde a été corrigée pour réutiliser l'activation réelle, et elle est alors passée **8/8**.

C'est une preuve positive : la porte de licence n'est pas contournable par un cookie signé seul.

## 8. Parcours de licence réellement exercés

| Contrôle | Résultat |
|---|---|
| activation d'une licence valide via l'interface | **réussie**, cookies de licence émis |
| enregistrement en base à l'activation | **réussi** (auto-enregistrement garage) |
| vérification de signature | **`VERIFIED`** |
| jeton signé par une autre clé | **`SIGNATURE_INVALID`** |
| `POST /api/license/activate` avec jeton invalide | **400** `VALIDATION_ERROR` |
| session de licence inconnue en base | **401** `LICENSE_UNKNOWN` |
| licence expirée, charge utile altérée, `exp` absent, version non gérée, substitution d'algorithme, courbe incorrecte | **19/19** par `reproduce-keygen-roundtrip.mjs` (hérité MASTER 5, rejoué) |
| HWID V1 — identité Node ↔ Python | **5/5 vecteurs**, 23/23 tests |

## 9. Ce qui reste hors de portée

- **Révocation** : le modèle `LicenseKey` porte `status` et `revokedAt`, et les suites couvrent la machine à états. Le parcours de révocation **de bout en bout par l'interface d'administration** n'a pas été joué — il demande une licence d'administration et un garage de recette dédiés.
- **Vérification hors ligne sur poste Windows** : exige l'environnement jetable (voir `MASTER6_WINDOWS_INSTALL_REPORT.md`).
- **Émission de licences de production** : impossible tant que la clé privée de `b16d2e1b…` n'est pas retrouvée ou l'autorité rotée.

## 10. Nettoyage

La copie `.tmp-m6-e2e/` et sa paire de clés de test sont jetables et ignorées par git. Elles ne partent ni sur GitHub (`.gitignore`) ni sur Vercel (`.vercelignore`). La clé privée de test n'a aucune valeur : elle ne signe que pour une copie locale dont les ancrages ont été modifiés.
