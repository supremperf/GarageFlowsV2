---
doc-numbers: journal
---

# PLAYWRIGHT ET CHROMIUM — état final MASTER 5

**Verdict : RÉSOLU pour le lancement et les parcours exécutables ; les 90 tests authentifiés de la suite `playwright test` restent BLOQUÉS faute de licence signable.**

## 1. État MASTER 4

`npx playwright install chromium` : code 1 avant TLS. Chromium v1234 absent. Run complet : **144 listés, 0 réussi, 54 échecs de lancement, 90 skips**. Aucun scénario UI validé.

## 2. Chromium officiel installé

```
$ npx playwright --version
Version 1.62.1
$ npx playwright install chromium
Chrome for Testing 151.0.7922.34 (playwright chromium v1234)
  → C:\Users\<user>\AppData\Local\ms-playwright\chromium-1234
Chrome Headless Shell 151.0.7922.34 (playwright chromium-headless-shell v1234)
  → C:\Users\<user>\AppData\Local\ms-playwright\chromium_headless_shell-1234
EXIT=0
```

Source officielle `cdn.playwright.dev`, 191,8 Mio + 114,5 Mio, aucun miroir.
Preuve : `MASTER5_EVIDENCE/logs/08-playwright-install.txt`.

## 3. Suite `playwright test` — les 54 échecs de lancement sont résolus

```
  90 skipped
  54 passed (1.2m)
EXIT=0
```

Les 54 tests qui **échouaient au lancement du navigateur** passent maintenant réellement. Le serveur d'application est démarré par la configuration (`webServer: npm run dev`), les 6 gabarits d'écran sont exercés, et les mesures sont faites par le vrai moteur de rendu. Extraits :

- contraste mesuré par Chromium sur les 4 champs du contrôle véhicule, pour les thèmes `dark`, `light` et `night-shift` — ratios relevés entre 16,95:1 et 17,85:1 ;
- `class="dark"` effectivement appliquée au thème par défaut ;
- page de connexion : aucun débordement horizontal, formulaire visible et non coupé.

Preuve : `MASTER5_EVIDENCE/logs/20-playwright-run1.txt`.

## 4. Les 90 skips : cause unique et nommée

`e2e/global-setup.ts` exige **trois** variables pour ouvrir la session applicative :

```ts
const email = process.env.E2E_EMAIL
const password = process.env.E2E_PASSWORD
const license = process.env.E2E_LICENSE
if (!email || !password || !license) { /* les tests d'application se déclarent skipped */ }
```

`E2E_LICENSE` doit être un **jeton GF2 signé par la clé de licence du déploiement**. La clé publique vérifiée par le produit a l'empreinte `b16d2e1bf6b9662f…` ; **la clé privée correspondante n'est pas présente sur ce poste** et `GF_PRIVATE_KEY` n'existe pas non plus dans les variables Vercel de production. Aucun jeton valide ne peut donc être émis ici.

Ce qui a été refusé, délibérément :
- régénérer une paire de clés et déplacer les ancrages (`keys:sync`) pour fabriquer une licence — cela casserait toutes les licences déjà émises ;
- modifier `global-setup.ts` pour contourner l'exigence de licence ;
- compter ces 90 tests comme verts.

Ces 90 tests restent donc **BLOCKED**, et non « réussis ».

## 5. Couverture authentifiée obtenue par l'autre entrée prévue par le projet

`e2e/README.md` documente une seconde entrée, `e2e/audit.mjs`, conçue pour la recette locale : base SQLite dédiée + seed + interrupteur `LICENSE_ENFORCEMENT=off`, qui **n'existe qu'en développement** — `licenseEnforcementEnabled()` renvoie toujours `true` quand `NODE_ENV === 'production'` (`src/lib/license/session.ts:83`). Aucun chemin de désactivation n'existe en production.

Exécuté contre une instance dédiée (`prisma/e2e.db`, port 3100, 5 mécaniciens et 13 interventions seedés) :

```
==== 17/17 vérifications OK ====
```

Couverture réelle, sur 4 gabarits (390×844, 844×390, 768×1024, 1440×900) :

| Vérification | Résultat |
|---|---|
| aucun débordement horizontal (4 gabarits) | OK |
| planning avec données réelles (mécanicien + intervention visibles) | OK |
| barre de navigation mobile, bouton « Ajouter » | OK |
| changement de mécanicien (onglet + colonne) | OK |
| assistant IA : ouverture et fermeture | OK |
| menu « Plus » : Réception, Stock, Rappels, Finance | OK |
| création d'intervention (modale) | OK |
| ouverture d'une intervention (modale d'édition) | OK |
| rotation portrait ↔ paysage sans débordement | OK |
| desktop : assistant en colonne, nav mobile masquée | OK |

10 captures d'écran produites dans `e2e/shots/master5-final/`.
Preuve : `MASTER5_EVIDENCE/logs/22-e2e-authenticated-audit.txt`.

### Un faux positif écarté, pas dissimulé

La **première** exécution à froid a signalé 16/17 : « intervention non visible » sur le seul gabarit 390×844. Une sonde ciblée a mesuré, sur ce même gabarit, « Martin Dupont » **visible** à `x=94, y=219` (68×12 px), avec `/api/jobs` en HTTP 200. Deux exécutions suivantes : 17/17. Il s'agissait d'une course de compilation du serveur `next dev` à froid, pas d'un défaut de mise en page. Le journal conserve la mention de la première exécution.

## 6. Un défaut de portabilité corrigé

`e2e/audit.mjs` codait en dur `executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium'` — le chemin d'une image CI Linux. Sur tout autre poste, dont **Windows, la plateforme cible du produit**, l'audit s'arrêtait sur « Failed to launch chromium because executable doesn't exist », avant la moindre mesure. Le repli est désormais le Chromium que Playwright a lui-même installé ; le chemin CI reste accepté s'il existe réellement.

## 7. Ce qui reste hors de portée

- **WebKit/Safari réel** : la configuration émule les gabarits iPhone/iPad **sous Chromium** (choix documenté dans `playwright.config.ts`). Le rendu du vrai moteur WebKit exige du matériel Apple.
- **Parcours authentifiés contre un environnement de staging** : exige à la fois un Preview déployé et une licence signée. Voir `VERCEL_DEPLOYMENT_FINAL.md` et `ACTIONS_MANUELLES_RESTANTES.md`.
