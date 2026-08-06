# BASELINE — État de référence de l'audit GarageFlows

> Document de PHASE 0 (conservation, traçabilité, intégrité). Figé au démarrage
> de l'audit maître du 2026-08-06. Aucune modification de code n'a été réalisée
> avant la capture de cet état. Les empreintes permettent de prouver l'état
> exact de départ (voir `INITIAL_SHA256.txt`).

## 1. Dépôts en périmètre

| Dépôt | Rôle | Commit de référence | Branche | Arbre |
|---|---|---|---|---|
| `supremperf/GarageFlowsV2` | Application GarageFlows (PWA app.garageflows.fr + desktop Windows Electron + serveur de licences) | `cec75887d8223fdfe4e3932e60653fff0f9b6d0c` | `claude/garageflow-final-unified-merge-ub0l67` | propre (0 fichier modifié, 0 non suivi) |
| `supremperf/garagesite3` | Site vitrine garageflows.fr | `2d5614255c6be143e9e26213d0130e32eaafa6e1` | `claude/garageflow-final-unified-merge-ub0l67` | propre (0 fichier modifié, 0 non suivi) |

> Note : cette baseline fige l'état de DÉPART de l'audit au commit `cec7588`
> (les empreintes SHA-256 ci-dessous en attestent). Les commits d'audit qui
> suivent (documents de référence, corrections) font AVANCER `HEAD` au-delà de
> ce point — c'est attendu : une baseline est un repère fixe, pas le HEAD
> courant. L'historique des avancées est dans `WORKLOG.md`.

Empreintes SHA-256 de l'arbre suivi (méthode : `git archive HEAD | sha256sum`,
déterministe pour un commit donné) :

```
GarageFlowsV2  d5b7ac61d47812d458f065bdeaffcd547a4adc5eec085de7c9383e88f5bd93f8
garagesite3    3643e508c6f0995b4a9b386acf9e6405e7d118c73d8a99ab52ce763303ce33aa
```

Contrainte d'exploitation : tout le travail d'audit est développé et poussé sur
la branche dédiée ci-dessus (règle de session : aucun push vers une autre
branche). Cette branche EST la « branche de travail dédiée » de la Phase 0.

## 2. Environnement de validation

| Outil | Version |
|---|---|
| Node.js | v22.22.2 |
| npm | 10.9.7 |
| Next.js (app) | 14.2.35 |
| Next.js (vitrine) | ^15.1.6 |
| Prisma | 5.22.0 |
| Electron | 31.7.7 |
| TypeScript | 5.9.3 |
| Vitest | 4.1.5 |
| PostgreSQL local (tests réels) | 16.13 (cluster jetable, non persistant) |
| Version applicative | 1.1.0 |

Limites de CET environnement (les résultats correspondants sont marqués
« NON EXÉCUTÉ » tant qu'ils ne sont pas produits ailleurs) :

- pas de poste Windows (build Electron signé, scripts .cmd/.ps1, keygen GUI) ;
- pas d'accès aux environnements réels (Neon production/staging, Vercel,
  Upstash Redis, SMTP) ;
- pas de navigateur stable pour la suite E2E Playwright complète ;
- pas d'accès aux comptes tiers (registres de marques, INPI, plateformes
  agréées de facturation électronique).

## 3. Reproduction de l'environnement

```bash
# Prérequis : Node >= 22.5 (node:sqlite), npm 10.
git clone https://github.com/supremperf/GarageFlowsV2 && cd GarageFlowsV2
git checkout claude/garageflow-final-unified-merge-ub0l67
npm ci                       # postinstall : setup-dev + prisma generate ×2
npm run type-check           # tsc --noEmit
npm run lint                 # next lint
npm test                     # vitest (ajouter TEST_POSTGRES_URL / TEST_REDIS_URL
                             # pour activer les tests d'intégration conditionnels)
npm run check:consistency    # les 9 gardes bloquants
npm run build                # prisma generate ×2 + next build

# Vitrine :
git clone https://github.com/supremperf/garagesite3 && cd garagesite3
git checkout claude/garageflow-final-unified-merge-ub0l67
npm ci && npm test
```

Validation PostgreSQL réelle (base vide + migrations + JSON v2 + smoke CRUD) :

```bash
DATABASE_URL=postgresql://…/gfvalidate node scripts/validate-server-db.js
```

## 4. Inventaire sommaire des fichiers suivis

| Dépôt | Total | Répartition |
|---|---|---|
| GarageFlowsV2 | 680 | src 516 · docs 53 · scripts 37 · racine 26 · prisma 19 · electron 16 · public 9 · e2e 3 · .github 1 |
| garagesite3 | 213 | src 175 · docs 14 · racine 13 · prisma 7 · public 2 · scripts 1 · .github 1 |

L'inventaire détaillé par sous-système est dans `REPOSITORY_INVENTORY.md`.

## 5. Règles de preuve appliquées à tout l'audit

- aucune affirmation de résultat sans exécution réelle de la commande dans ce
  journal (`WORKLOG.md`) ou dans la CI ;
- aucune valeur de secret dans les rapports (fichier + type + préfixe masqué
  au plus) ;
- toute étape non exécutable ici est listée avec : commande exacte, résultat
  attendu, responsable de l'exécution ;
- distinction systématique : prouvé / fortement probable / à vérifier /
  dépend d'un tiers / nécessite validation juridique ou comptable.
