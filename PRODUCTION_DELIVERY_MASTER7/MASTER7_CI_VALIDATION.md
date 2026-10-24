---
doc-numbers: journal
---

# VALIDATION ET CI — MASTER 7

Preuve : `MASTER7_EVIDENCE/logs/09-validation-globale.txt`.

---

## 1. Résultats mesurés

| Contrôle | Résultat |
|---|---|
| TypeScript (`tsc --noEmit`) | **0 erreur** |
| ESLint | **0 erreur** |
| Vitest | **4 390 réussis, 0 échec, 34 ignorés** (365 fichiers) |
| `test:release-safety` | **197 tests, 194 réussis, 0 échec, 3 ignorés** |
| `tests/secret-scan-policy` | **4 / 4** — inchangé |
| `tests/secret-scan-fixtures` | **4 / 4** — nouveau |
| suites « configuation automatique » | **119 / 119** |
| intégrité des preuves | **273 / 273**, sur disque et en versionné |
| `check:consistency` | **OK** |
| `check:artifact-secrets` · `check:artifact-fuses` · `verify:installer` | **OK** sur l'octet livré |
| **`release:gate`** | **14 / 16** — deux échecs, une seule cause |
| `readiness:final` | 25 pass, 8 bloqués, **aucune erreur d'intégrité** |

## 2. GitHub Actions

| Workflow | Commit | Résultat |
|---|---|---|
| **CodeQL** | `d18fb81` | **succès** |
| **Secret scan (Gitleaks)** | `d18fb81` | **✓ succès** — `findings=0; scannerExit=0` *(était en échec avec 6 signalements)* |
| Native base (TypeScript, build, budget JS) | `d18fb81` | **succès** |
| E2E (Playwright — responsive) | `d18fb81` | **succès** |
| Full dependency tree | `d18fb81` | **succès** — run du 2026-10-23, **avant** la publication des nouveaux avis |
| Full dependency tree | `91ba4b2` | **échec** — la CI voit désormais les mêmes avis que mon audit local (§5) |
| Type-check, Lint & Test | `d18fb81` | **succès** |

**Le job de scan de secrets, rouge depuis MASTER 6, est passé au vert** — sans affaiblir la politique. C'est le gain principal de cette mission côté CI.

**Corroboration indépendante.** Le job *Full dependency tree* était vert sur `d18fb81` (2026-10-23) et rouge sur `91ba4b2` (2026-10-24), sur un `npm ci` neuf à chaque fois. La CI confirme donc, sans mon intervention, que la cause est la **publication de nouveaux avis**, pas une modification du code.

Reste rouge en CI : *Authenticated browser validation (approved staging only)*, qui refuse de démarrer faute des secrets de dépôt `BASE_URL`, `E2E_EMAIL`, `E2E_PASSWORD`, `E2E_LICENSE` et de la variable `E2E_NON_PRODUCTION`. **C'est un refus volontaire *fail-closed*, antérieur à MASTER 7**, et c'est une configuration de dépôt que seul le propriétaire peut poser.

## 3. Les deux échecs de `release:gate` — une seule cause

```
❌ Audit complet dépendances (tous niveaux)      ÉCHEC — exit 1
❌ Audit runtime desktop empaqueté (Electron)    ÉCHEC — exit 1
```

`audit-ci.js` et `check-desktop-runtime-audit.mjs` exécutent **tous deux `npm audit`** et rapportent les mêmes totaux. C'est **un seul problème compté deux fois**.

### Ce n'est pas une régression du produit

Le même contrôle était **vert hier** (MASTER 6, 2026-10-23 : « Audit complet dépendances (tous niveaux)… OK (2s) »). Au 2026-10-24 : `MODERATE=3 HIGH=5 TOTAL=8`.

`npm audit` interroge une base d'avis qui évolue. **Des avis ont été publiés dans les dernières 24 heures.** L'état du monde a changé, pas le code.

## 4. Ce que j'ai corrigé : les deux expositions de production

| Paquet | Avant | Après | Avis traité |
|---|---|---|---|
| **`zod`** | `^4.3.6` (verrou 4.3.6) | `^4.6.7` | **HIGH** — épuisement mémoire à la validation de collections surdimensionnées |
| **`nodemailer`** | `10.1.1` | `10.1.7` | **3 × MODERATE** sur `addressparser`, dont **une livraison possible vers un domaine que l'en-tête ne nomme pas** |

Le second point est directement pertinent : le produit envoie des courriels.

**Deux précautions prises :**

- `zod` : le caret `^4.3.6` autorisait **déjà** 4.6.7 ; seul le verrou l'épinglait. **Aucune montée majeure, aucun changement de contrat.**
- `nodemailer` : `npm` avait introduit un caret (`^10.1.7`) alors que le paquet était **délibérément épinglé sans caret**. J'ai **rétabli l'épinglage exact**.

**`npm audit fix --force` n'a pas été utilisé. Aucune montée majeure.**

**Résultat** : `TOTAL=8 → 6`, `MODERATE 3 → 1`.

**Et rien n'a cassé** — vérifié après la montée : TypeScript 0, ESLint 0, Vitest **4 390 réussis / 0 échec / 34 ignorés**, strictement identique à la référence d'avant.

## 5. Les 6 avis restants : aucun ne touche le produit livré

| Gravité | Paquet | Version | Statut |
|---|---|---|---|
| HIGH | `@vercel/blob` | 2.8.2 | **dev** |
| HIGH | `@vercel/cli-config` | 0.3.1 | **dev** |
| HIGH | `@vercel/oidc` | 3.8.10 | **dev** |
| HIGH | `undici` | 6.29.1 / 6.29.0 / 7.30.0 | **dev** (3 copies) |
| HIGH | `zod` | 4.1.11, imbriquée sous `@vercel/cli-config` | **dev** |
| MODERATE | `fast-uri` | 3.1.8 | **dev** |

**Point important sur `zod`.** L'avis porte sur la plage `< 4.6.6` :

```
node_modules/zod                              (PRODUCTION)  4.6.7   → NON AFFECTÉ
@vercel/cli-config/node_modules/zod           (dev)         4.1.11  → affecté
```

La copie de production est corrigée ; **seule l'imbriquée de l'outillage reste vulnérable**.

Toute cette chaîne descend de `@vercel/blob`, une `devDependency` utilisée par `scripts/lib/config-cloud.cjs`. **Elle n'est ni embarquée dans l'installateur Windows, ni déployée.**

## 6. Pourquoi je ne force pas le vert

Le seul correctif que `npm` propose est `@vercel/blob@2.4.0` — un **retour en arrière majeur**. Or :

- **2.8.2 est la dernière version stable** (les `2.9.0-*` sont des pré-publications du 2026-10-14) ;
- `scripts/lib/config-cloud.cjs:250` documente explicitement *« Supported read-write token format used by @vercel/blob 2.8.2 »* : la régression casserait l'outillage de configuration ;
- le paquet est utilisé, il ne peut pas être retiré.

**Abaisser le seuil de l'audit est exclu** : le mandat interdit de désactiver un contrôle de sécurité pour obtenir un résultat vert, et ce contrôle est volontairement « tous niveaux, sans dérogation ».

**La porte reste donc rouge sur ce contrôle, et c'est le résultat correct.** Un audit qui signale une vulnérabilité réelle dans l'outillage fait exactement son travail.

## 7. Action restante

Surveiller la publication d'un `@vercel/blob` stable ≥ 2.9.0 corrigeant la chaîne `@vercel/oidc` / `zod` / `undici`, puis monter la `devDependency` et revérifier. En attendant, l'exposition est circonscrite à la machine de développement et à la CI — jamais au produit livré ni à la production.
