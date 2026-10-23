---
doc-numbers: journal
---

# PLAYWRIGHT — rapport MASTER 6

**Verdict : BLOCAGE LEVÉ. 135 tests réussis, 0 échec, 9 ignorés par conception.** Les 90 tests authentifiés que MASTER 5 n'avait jamais pu exécuter tournent désormais réellement, avec une licence de test signée.

---

## 1. Progression

| | MASTER 4 | MASTER 5 | **MASTER 6** |
|---|---:|---:|---:|
| réussis | 0 | 54 | **135** |
| échoués | 54 (lancement) | 0 | **0** |
| ignorés | 90 | 90 | **9** |

## 2. Ce qui bloquait, et comment c'est résolu

`e2e/global-setup.ts` exige `E2E_EMAIL`, `E2E_PASSWORD` **et `E2E_LICENSE`** — un jeton GF2 réellement signé. Sans lui, tous les tests d'application se déclarent `skipped` : la suite passait 54/54 mais ne mesurait **que la page de connexion**.

La clé publique étant un ancrage de compilation sans dérogation runtime, la solution a été une **copie isolée** du projet avec une paire de clés de TEST. Détail complet : `MASTER6_LICENSE_REPORT.md`.

**L'activation a réellement eu lieu** — ce n'est pas un contournement :

```
[e2e:setup] url=http://localhost:3200/
            cookies=next-auth.csrf-token,next-auth.callback-url,next-auth.session-token,
                    gf_session,gf_license_validated,gf_license_type
```

## 3. Les quatre exécutions, dans l'ordre

| # | Configuration | Résultat | Journal |
|---|---|---|---|
| 1 | licence de test, 6 workers, seed standard (5 mécaniciens) | 80 réussis, **7 échoués**, 9 ignorés | `04` |
| 2 | + jeu de recette (24 mécaniciens), 6 workers | 131 réussis, **1 échoué**, 9 ignorés | `06` |
| 3 | 2 workers | 132 réussis, **1 échoué**, 9 ignorés | `08` |
| 4 | **1 worker (sérialisé)** | **135 réussis, 0 échoué**, 9 ignorés, **code 0** | `09` |

## 4. Les 7 échecs de la première exécution — prérequis, pas défaut

Six étaient identiques, et le test **nommait lui-même** ce qui manquait :

```
Error: effectif insuffisant (5 < 20) : préparez le jeu de recette
       avant d'exécuter ce scénario
```

`e2e/planning-mechanics.spec.ts` explique pourquoi il ne crée pas les mécaniciens lui-même :

> « L'effectif est donc préparé en amont (jeu de recette), et le scénario se contente de le lire. » — un scénario qui modifie un état partagé ne peut pas rendre un verdict stable.

**Satisfaire ce prérequis n'affaiblit aucune assertion** : c'est la condition d'exécution que le test réclame. 19 mécaniciens ont été ajoutés dans la base de recette (5 → 24, minimum 20). Aucune ligne de test modifiée.

Le septième (`inspection-contrast.spec.ts:233`, modale thème sombre, `mobile-portrait`) était un dépassement de délai de 30 s ; il passe dans les exécutions suivantes.

## 5. L'échec résiduel des exécutions parallèles — transport, pas application

Exécutions 2 et 3, un seul échec chacune, **sur un test différent à chaque fois** :

```
Error: apiRequestContext.get: read ECONNRESET
```

- exécution 2 : `planning-mechanics.spec.ts:158` (« des clics rapides répétés ne cassent pas l'état »), `mobile-landscape`
- exécution 3 : `planning-mechanics.spec.ts:177` (« naviguer ne réattribue AUCUNE intervention »), `desktop`

L'erreur survient sur `page.request.get('/api/mechanics')` — **l'assertion n'est jamais évaluée**. C'est le serveur `next dev` qui lâche une connexion sous la charge de plusieurs contextes navigateur frappant les API simultanément.

Preuve que ce n'est pas un défaut : le test de l'exécution 2 **rejoué seul sur son gabarit** passe **9/9** (journal `07`). C'est exactement l'instabilité que `e2e/README.md` documente :

> « les échecs observés ne sont jamais les mêmes gabarits d'une exécution à l'autre […] Ce n'est donc pas un défaut de mise en page : c'est un serveur de DÉVELOPPEMENT sollicité par six contextes simultanés depuis une seule IP. »

L'exécution sérialisée (`--workers=1`) donne **135 réussis, 0 échec**. Réduire le parallélisme ne modifie aucune assertion et n'ignore aucun test : cela cesse seulement de saturer le serveur de recette.

## 6. Les 9 tests ignorés — par conception, vérifié

| Test | Condition d'exclusion dans le code |
|---|---|
| `responsive.spec.ts:91` — assistant IA (mobile) ×3 | `test.skip(viewport.width >= 768, 'Assistant en colonne au-delà de md')` |
| `responsive.spec.ts:101` — accès aux autres mécaniciens en portrait ×3 | `test.skip(viewport.width >= 768, 'Sélecteur mono-mécanicien en mobile uniquement')` |
| `responsive.spec.ts:114` — menu « Plus » ×3 | `test.skip(viewport.width >= 768, 'Menu « Plus » en mobile uniquement')` |

Ce sont des comportements **mobile uniquement**, correctement écartés sur les gabarits tablette et desktop. Ils s'exécutent et passent sur les trois gabarits mobiles. Aucun n'est ignoré faute de prérequis.

## 7. Couverture réellement obtenue

Les 135 tests exercent, sur 6 gabarits (320×568, iPhone 12 portrait et paysage, iPad Mini portrait et paysage, 1440×900) :

| Domaine | Couvert |
|---|---|
| connexion, session, protection des routes | oui |
| **activation de licence** | oui — réelle, via le formulaire |
| planning : colonnes, fenêtre de mécaniciens, navigation, flèches, clics répétés | oui |
| **non-réattribution des interventions pendant la navigation** | oui |
| nombre de colonnes suivant la largeur réelle | oui |
| assistant IA : ouverture et fermeture | oui |
| menu « Plus » : Réception, Stock, Rappels, Finance | oui |
| création d'intervention (modale), ouverture en édition | oui |
| contraste mesuré par le moteur de rendu, 3 thèmes, modale incluse | oui |
| absence de débordement horizontal, rotation d'orientation | oui |
| page de connexion : visible, non coupée | oui |

Le rapport HTML et les traces sont dans `playwright-report/` et `test-results/` de la copie de recette.

## 8. Ce qui reste hors de portée

- **WebKit/Safari réel** : la configuration émule les gabarits Apple **sous Chromium**, choix documenté dans `playwright.config.ts`. Le vrai moteur exige du matériel Apple.
- **Parcours authentifiés contre la Preview déployée** : la Preview est protégée par Vercel Authentication (réglage du projet) et renvoie 302 vers le SSO pour tout accès anonyme. Les endpoints ont été exercés via `vercel curl` authentifié (voir `MASTER6_VERCEL_REPORT.md`), mais une suite Playwright complète contre cette URL demanderait de lever la protection ou de configurer un jeton de contournement — décision qui vous appartient.
