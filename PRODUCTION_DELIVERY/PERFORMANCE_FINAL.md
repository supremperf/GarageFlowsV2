---
doc-numbers: journal
---

# PERFORMANCE — état final MASTER 5

**Verdict : MESURÉE ET DANS LE BUDGET**, sur un vrai build de production. Le garde `BUILD_ID` durci en MASTER 4 n'a pas été affaibli — il a été satisfait.

## 1. État MASTER 4

`BLOCKED` : après durcissement, `npm run check:perf-budget` s'arrêtait sur l'absence de `BUILD_ID` **sans mesurer**. La valeur de 9,96 Mio relevée avant ce durcissement provenait d'assets de DÉVELOPPEMENT et avait été explicitement écartée. Aucun budget n'avait été modifié.

## 2. Mesure sur le build de production

```
$ npm run check:perf-budget

Budget de performance — mesure du bundle client :
  Total JS client : 3.49 MiB (budget 3.65 MiB)
  Plus gros chunk : 322.3 KiB — .next\static\chunks\164f4fb6.f11ea67e0ec94950.js (budget 512.0 KiB)
  Fichiers .js scannés : 244

✅ Budget de performance respecté.
EXIT=0
```

Preuve : `MASTER5_EVIDENCE/logs/31-perf-budget.txt`, confirmé par la porte (`36-release-gate.txt`).

| Indicateur | Mesure | Budget | Marge |
|---|---:|---:|---:|
| total JS client (octets bruts sur disque) | 3,49 Mio | 3,65 Mio | ~4,4 % |
| plus gros chunk | 322,3 Kio | 512,0 Kio | ~37 % |
| fichiers `.js` scannés | 244 | — | — |

Le garde a bien exigé la présence de `.next/BUILD_ID` **et** de `.next/static` : la mesure porte donc sur les assets immuables d'un build de production, pas sur une sortie `next dev`.

**`perf-budget.json` n'a pas été modifié.** Le plafond reste celui relevé le 16/10/2026 (3 829 408 octets = mesure de référence + 5 %). C'est un plafond de NON-RÉGRESSION, pas un objectif : la dette de ~3,5 Mio demeure entière, et sa réduction passe par l'allègement des dépendances.

## 3. Temps de compilation et de démarrage mesurés

| Étape | Mesure |
|---|---:|
| `next build` — compilation | 2,9 min (174 s) |
| `next build` — étape complète dans la porte (type-check + pages + traces) | 204 s |
| démarrage du serveur autonome de production | **399 ms** (« Ready in 399ms ») |
| génération des pages statiques | 18/18 |
| `tsc --noEmit` (incrémental chaud) | 9–34 s |
| suite Vitest complète (365 fichiers, 4 424 tests) | 52–89 s |

## 4. Temps de réponse HTTP — serveur autonome local

Première requête après démarrage comprise (compilation déjà faite, cache froid) :

| Route | Statut | Temps |
|---|---:|---:|
| `/api/health` | 200 | **10 ms** |
| `/api/ping` | 200 | **17 ms** |
| `/login` (page rendue) | 200 | **133 ms** |
| `/` (redirection middleware) | 307 | **20 ms** |
| `/api/clients` (refus 401, traverse l'authentification) | 401 | **324 ms** |
| `/portal` (redirection permanente) | 308 | **6 ms** |

Preuve : `MASTER5_EVIDENCE/logs/37-standalone-http.txt`.

## 5. Temps de réponse HTTP — PRODUCTION en ligne

Mesures réelles sur `https://app.garageflows.fr` :

| Route | Statut | Temps total | Cache |
|---|---:|---:|---|
| `/` | 307 → `/login?callbackUrl=%2F` | 1,089 s (première connexion TLS incluse) | — |
| `/login` | 200 | **0,284 s** | `X-Vercel-Cache: HIT` |
| `/api/health` | 200 `{"status":"ok"}` | mesuré, réponse immédiate | — |

Servi depuis la région `fra1`. En-têtes de sécurité conformes à `next.config.mjs`.

## 6. Requêtes SQL et index

| Contrôle | Résultat |
|---|---|
| index effectivement emprunté sur le filtre de tenant | `EXPLAIN QUERY PLAN SELECT id FROM Client WHERE garageId = ?` → `SEARCH Client USING INDEX Client_garageId_idx (garageId=?)` |
| migrations serveur rejouées sur base vierge | 22/22, 5 s (PostgreSQL local) / 11 s (Neon) |
| numérotation sous concurrence (50 créations parallèles) | aucun doublon, aucun trou, compteur exact |

## 7. Comportement sous charge — et sa limite, nommée

Le test de concurrence (`document-numbering.postgres.int.test.ts`) lance **50 créations de factures en parallèle** via le vrai gestionnaire `POST /api/invoices`.

- Contre un **PostgreSQL 17.11 local jetable** : **PASS**. 50 numéros distincts et contigus, compteur du garage exact, aucune création en échec.
- Contre l'URL **directe d'une base Neon serverless** : **ÉCHEC** — `PrismaClientKnownRequestError: Transaction API error: Unable to start a transaction in the given time.`

Ce second résultat n'est pas un défaut de la numérotation : le verrou de ligne sur `garage.update` sérialise correctement les incréments. C'est une **limite de capacité** : une instance de calcul Neon serverless n'accorde pas 50 transactions interactives simultanées dans le délai d'acquisition par défaut de Prisma, et chaque transaction paie en plus un aller-retour réseau. Le test documente lui-même sa cible attendue — « service postgres en CI, ou cluster local jetable ».

**À retenir pour la production** : si un pic de 50 créations simultanées sur un même garage est un scénario réaliste, il faut soit augmenter le calibre du calcul Neon, soit relever `maxWait`/`timeout` de la transaction, soit valider explicitement que le pic réel est très inférieur. Cette décision est consignée dans `ACTIONS_MANUELLES_RESTANTES.md`. Les deux mesures sont conservées dans les preuves.

## 8. Ce qui n'a pas été mesuré

- **Core Web Vitals / Lighthouse** sur la production : non exécutés, aucun outil de mesure terrain n'a été lancé contre le domaine public.
- **Charge soutenue** : `scripts/loadtest.mjs` existe mais n'a pas été lancé contre la production ni contre une Preview — le déploiement Preview a été bloqué par une permission de plateforme (voir `VERCEL_DEPLOYMENT_FINAL.md`).
- **Taille des assets du paquet Windows** : l'installateur pèse 234,0 Mo ; voir `BUILD_WINDOWS_FINAL.md §Poids` pour le détail, dont 8,9 Mo de TypeScript embarqué sans usage à l'exécution.
