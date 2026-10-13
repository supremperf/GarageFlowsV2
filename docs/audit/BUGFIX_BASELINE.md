<!-- doc-numbers: journal -->
<!-- doc-status: actif -->

# BUGFIX BASELINE — état figé avant correction

> Journal point-dans-le-temps (Phase 0). État machine faisant foi :
> `artifacts/verification/baseline.json` / `FINAL_VERIFICATION_BASELINE.md`.

## Environnement (mesuré)

| Champ | Valeur |
|---|---|
| Commit initial | `8d1271a` |
| Branche | `claude/garageflow-final-unified-merge-ub0l67` |
| git status | propre avant intervention |
| Node / npm | v22.22.2 / 10.9.7 |
| Electron (résolu) | 31.7.7 |
| electron-builder (résolu) | 24.13.3 |
| Next.js (résolu) | 14.2.35 |
| React (résolu) | 18.3.1 |
| Prisma / @prisma/client | 5.22.0 / 5.22.0 |
| TypeScript | 5.9.3 |
| Tests (suite standard) | 1383 / 1411 (28 ignorés), 0 échec |
| `tsc --noEmit` / `next lint` | 0 / 0 |
| Build de production | OK (release gate vert au commit 8d1271a) |

> **Contrainte d'environnement d'exécution** : ce conteneur est **Linux headless**.
> Ne peuvent PAS être exécutés ici : build d'un installateur Windows
> (electron-builder win), installation/relance sur Windows/VM, E2E Windows réel,
> lancement de l'application Electron. Ces vérifications sont **flaggées
> explicitement** comme requérant une machine Windows ; aucun résultat Windows
> n'est inventé (règle anti-hallucination du prompt).

## npm audit initial

`npm audit` (au commit 8d1271a) : **30 vulnérabilités** — 1 critical, 24 high,
4 moderate, 1 low.

- **critical** : `tar` (via chaîne electron-builder — build/dev).
- **high** : chaîne electron-builder (`app-builder-lib`, `builder-util`,
  `builder-util-runtime`, `dmg-builder`, `electron-publish`,
  `electron-builder-squirrel-windows`), `electron`, `next`/`postcss`,
  `sharp`, `nodemailer`, `@xmldom/xmldom`, `js-yaml`, `lodash`, `form-data`,
  `flatted`, `brace-expansion`, `picomatch`, `glob` (via `eslint-config-next`),
  `vite`, `tmp`.
- Beaucoup sont **dev/build-only** (electron-builder, sharp, vite, glob via
  eslint, postcss via build) → non exposés au runtime distribué. Classification
  complète : `docs/audit/NPM_SECURITY_REMEDIATION.md` (Phase 13).

## Bugs connus à corriger (source : prompt maître)

1. **UI** — écran générique « Une erreur est survenue » dans : Paramètres >
   Facturation électronique, Factures, Devis (`src/app/error.tsx` capture la
   vraie exception sans la remonter).
2. **Windows** — faux positif « installation corrompue » au démarrage, par
   intermittence, sans modification volontaire de fichier
   (`electron/integrity.js`).
3. **Licences** — fiabilité de bout en bout (génération → signature → validation
   → activation → HWID → cache).
4. **Sécurité npm** — 30 vulnérabilités à classifier et corriger sans casse.

## Méthode

Corrections en **lots atomiques** (Phase 31), chacune avec cause racine + preuve
+ correction + test de non-régression. Aucune fonctionnalité supprimée ; aucun
contrôle de sécurité désactivé ; aucun `catch {}` silencieux ; pas de
`npm audit fix --force` aveugle.
