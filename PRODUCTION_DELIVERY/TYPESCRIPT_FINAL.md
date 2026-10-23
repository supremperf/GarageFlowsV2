---
doc-numbers: journal
---

# TYPESCRIPT — état final MASTER 5

**Verdict : RÉSOLU — 0 erreur.** Aucune ligne de code applicatif n'a été modifiée pour y parvenir.

## 1. État MASTER 4 et cause réelle

MASTER 4 : `npm run type-check` → code 1, **247 lignes d'erreurs** (journal `07a-typecheck-raw.txt`). La conclusion de l'époque invitait à « reclassifier les erreurs avec les vrais types puis relancer ».

La cause était unique et externe au code : `@prisma/client` n'était pas généré, donc **aucun type de modèle n'existait**. Tout accès à `prisma.client`, `prisma.invoice`, `Prisma.ModelName`, aux `*WhereInput`, `*CreateInput`… était non typé ou introuvable.

## 2. Résultat mesuré

```
$ npx tsc --noEmit --pretty false
(aucune sortie)
EXIT=0
```

Preuve : `MASTER5_EVIDENCE/logs/07-typescript-raw.txt` — fichier **vide**, code de sortie 0.

## 3. Le périmètre réellement compilé a été vérifié

Un code de sortie 0 sur un périmètre vide ne prouverait rien. Le périmètre a donc été mesuré :

```
$ npx tsc --noEmit --listFiles | grep -v node_modules | wc -l
957        ← fichiers du projet réellement analysés
$ npx tsc --noEmit --listFiles | wc -l
2425       ← total, déclarations de dépendances comprises
```

`tsconfig.json` est resté **inchangé** : `strict: true`, `include: ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"]`.

## 4. Ce qui n'a PAS été fait

- aucun `strict: false`, aucune option assouplie ;
- aucun `@ts-ignore` / `@ts-expect-error` ajouté ;
- aucun `any` introduit pour masquer une erreur ;
- aucun fichier retiré de `include`.

Le diff du dépôt le confirme : `tsconfig.json`, `tsconfig.scripts.json` et `tsconfig.seed.json` ne figurent pas parmi les fichiers modifiés (voir `CORRECTIONS_MASTER5.md`).

## 5. Confirmation par la porte de release

`npm run release:gate` rejoue le contrôle de façon indépendante :

```
▶ TypeScript (tsc --noEmit)… OK (34s)
```

Preuve : `MASTER5_EVIDENCE/logs/36-release-gate.txt`.

## 6. ESLint

Mentionné ici car MASTER 4 le couplait au même lot : `eslint src --ext .ts,.tsx` reste à **0 erreur**, `eslint-config-next` aligné sur Next.js 15.5.28 (acquis MASTER 4, non régressé).

```
▶ ESLint… OK (39s)
```
