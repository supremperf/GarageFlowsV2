<!-- doc-numbers: journal -->
# GARAGEFLOWS — VALIDATION LOGICIELLE (session d'audit correctif)

> Portée honnête : ce document consigne l'état RÉELLEMENT VÉRIFIÉ et les correctifs
> RÉELLEMENT LIVRÉS pendant cette session, avec preuves reproductibles. Il ne
> prétend PAS couvrir l'intégralité du programme V21 : les éléments dépendant d'un
> environnement absent (Windows réel, Authenticode, PostgreSQL/Redis de prod,
> plateformes e-invoicing) ou d'une montée majeure non validable ici sont listés,
> non simulés, dans `EXTERNAL_BLOCKERS.md`. Environnement de mission : conteneur
> Linux headless (pas de Windows/wine).

## 1. Baseline

| Élément | Valeur |
|---|---|
| Dépôt / branche | supremperf/GarageFlowsV2 · `claude/garageflow-final-unified-merge-ub0l67` |
| HEAD (fin de session) | `d8352bb` |
| Node · npm · Python | v22.22.2 · 10.9.7 · 3.11.15 |
| OS mission | Linux x86_64 (headless) |
| Toolchain applicatif | Next.js 14.2.35 · React 18 · Prisma 5.22.0 · Electron 31.7.7 · NextAuth · Vitest · Playwright |

## 2. Écran blanc au lancement (desktop) — RÉSOLU

Symptôme utilisateur : fenêtre GarageFlows ouverte sur un fond bleu nuit, « rien
qui s'affiche ». **Ce n'était ni la licence, ni l'intégrité, ni le build**, et les
logs Vercel fournis concernaient le WEB (`app.garageflows.fr`, sain) — l'app
desktop sert son propre serveur local et ne touche jamais Vercel.

**Cause racine (reproduite)** : la fenêtre chargeait `http://127.0.0.1:PORT` mais
le serveur Next standalone réécrit toute URL loopback en `localhost`
(`REGEX_LOCALHOST_HOSTNAME`, mesuré) ; la redirection `/ → /login` visait donc
`localhost` — une AUTRE origine — que le garde de navigation Electron
(`will-redirect`) bloquait → fenêtre vide.

**Correctif retenu (canonique)** : `electron/main.js` aligne toute l'origine
client sur `APP_ORIGIN = http://localhost:PORT` + `host-resolver-rules MAP
localhost 127.0.0.1` (le serveur écoute sur 127.0.0.1 ; Chromium y résout
localhost, sans ambiguïté IPv4/IPv6). La redirection est alors same-origin et le
garde l'accepte.

Un correctif alternatif au niveau du nav-guard (canonicalisation loopback) avait
été livré puis **retiré comme redondant** une fois la correction `APP_ORIGIN`
confirmée — une seule mécanique subsiste (propreté due-diligence).

**Preuve (serveur standalone réel + Chromium réel)** : chargement de l'origine
`localhost` → `307 localhost/login` → `isLocalAppUrl(loc, origin)=true` →
formulaire de connexion affiché, same-origin conservé, cookie `gf_session`
présent, **0 erreur page**.

> ACTION UTILISATEUR : `git pull` → `npm run dist` → réinstaller le `.exe`. L'app
> arrive sur l'écran de connexion (compte garage ; « Créer votre garage » au 1er
> lancement).

## 3. Correctifs livrés cette session (repro → cause → patch → test → preuve)

| # | Domaine | Sévérité (vérifiée) | Correctif | Preuve |
|---|---|---|---|---|
| 1 | authz — révocation admin inopérante | **P1** | `isAdminSession()` revalide la licence admin EN BASE à chaque appel (existence/type/révocation/suspension/expiration), fail-closed | `audit-v21-fixes.test.ts` (matrice `adminLicenseAcceptable`) |
| 2 | immutabilité (TOCTOU) devis accepté | **P2** | re-contrôle du verrou DANS la transaction sur `fresh.status` (miroir `invoices/[id]`) | source guard + suite verte |
| 3 | immutabilité (TOCTOU) OR signé | **P2** | `updateMany` exige `signedAt: null` sur écriture des champs scellés → 409 si signé entre-temps (miroir `sign`) | source guard + suite verte |
| 4 | monnaie — TVA flottante | P2/P3 | `work-orders`(×2) + `quote-gen` utilisent la règle centrale `taxCentsFromBasis` (fini `Math.round(ht*rate/100)`) | test exactitude `5500c×0,7 %→39c` + source guard |
| 5 | restauration — `scripts/restore.js` | P2 | cycle readline réparé (une interface, fermée une fois ; Ctrl+C géré) + validation SQLite de l'archive avant écrasement + rollback | `restore-script.test.ts` (10 tests) + codes de sortie CLI |
| 6 | licences mécanicien — réattribution | P2 (partiel) | réattribution : révocation de TOUS les appareils non révoqués (actifs **et** déconnectés) de l'ancien titulaire, comme `revokeDevices()` (l'ancien code n'en coupait que les « active ») | correctif ciblé `assign/route.ts` ; **résiduel OUVERT** ci-dessous |

**Domaines audités** : multi-tenant / IDOR = **PROPRE** ; portail = **PROPRE** ;
authz/monnaie/immutabilité = findings ci-dessus (corrigés) ; **licences = 1
finding P2 confirmé** (réattribution mécanicien).

**Résiduel OUVERT (P2, honnête)** — la clé mécanicien est un **jeton porteur** :
un ancien titulaire ayant conservé la chaîne du token peut tenter une
**ré-activation fraîche** et obtenir l'identité du nouveau titulaire tant que le
siège (`seats=1`) est libre. Le durcissement livré (révocation complète des
appareils) + le plafond de sièges bloquent le cas courant (dès que le nouveau
titulaire s'active), mais **fermer complètement la fenêtre exige une
rotation/ré-émission de clé à la réattribution** — décision produit, suivie comme
finding P2 OUVERT (voir `EXTERNAL_BLOCKERS.md` #8bis).

## 4. Tests & vérifications (commandes EXACTES, HEAD d8352bb)

| Vérification | Commande | Résultat |
|---|---|---|
| TypeScript | `tsc --noEmit` | 🟢 0 erreur |
| ESLint | `next lint` | 🟢 0/0 |
| Tests | `vitest run` | 🟢 **1563 passed / 29 skipped / 0 failed** (151 fichiers) |
| Prisma desktop / serveur | `prisma validate` (×2) | 🟢 valides (serveur requiert `DIRECT_URL`) |
| Build | `next build` | 🟢 16/16 pages |
| Budget perf | `check:perf-budget` | 🟢 2.59 MiB < 3.00 |
| Gardes cohérence | `check:consistency` | 🟢 branding, docs, PWA, money×3, migrations, sqlite, pg, converge |
| Audit prod (high/crit) | `audit-ci.js` | 🟢 0 non dérogée (3 dérogations datées) |
| Release gate | `release:gate:fast` | 🟢 PASSÉ |

## 5. Dépendances (npm audit — honnête)

- **Production (`--omit=dev`)** : high/critical = `next`, `nodemailer`, `postcss` — **tous dérogés** (motif + date 2026-10-31 ; exploitabilité réelle faible). `nanoid` est rattaché à la chaîne `postcss` dérogée ⇒ l'ancien blocage CI ne se reproduit plus. 3 modérées.
- **Dev/build (incl. dev)** : 1 critique (`tar`) + 16 high — outillage `electron-builder`/`eslint`/`sharp`, **non embarqué dans le runtime**. Correctifs = montées majeures d'outillage (voir EXTERNAL_BLOCKERS / non fait ici).
- Note honnête (§7 V21) : la politique `--omit=dev` peut sous-estimer le runtime distribué Electron ; un durcissement de la porte (audit du runtime empaqueté) est recommandé et documenté comme suite à donner.

## 6. Domaines auto-audités (hors workflow)

- **PWA / service worker** — 🟢 sûr : pas de `skipWaiting()` à l'install ; `/api/*` jamais mis en cache ; navigations network-first sans stocker `no-store`/`private` ; purge privée à la déconnexion câblée (`Header.tsx`/`MobileNav.tsx` → `CLEAR_PRIVATE_CACHE` ; test `pwa.test.ts`).
- **Sécurité Electron** — 🟢 solide : `contextIsolation`/`sandbox`/`nodeIntegration:false`/`webSecurity`, menu retiré, DevTools prod gated (`GF_DEBUG`), `setWindowOpenHandler` allowlist HTTPS, `will-attach-webview` refusé, intégrité enforce, fuses testés, secrets injectés au runtime (`.env` retiré du standalone au post-build).

## 7. Limitations d'environnement (§84 — jamais falsifiées)

Voir `EXTERNAL_BLOCKERS.md`. En résumé : Windows réel (install/update/Authenticode),
PostgreSQL & Redis de prod, plateformes e-invoicing réelles, et les montées
majeures Electron/Next **non validables** dans ce conteneur Linux.

## 8. Verdict

**DUE_DILIGENCE_READY_WITH_CONDITIONS.**

Justification : sur l'état vérifiable ici, tout est vert (tsc, lint, 1563 tests,
build, gardes, release gate, audit prod), l'isolation multi-tenant est propre, la
monnaie est exacte au centime, et les findings d'audit confirmés (dont la
révocation admin P1) sont corrigés avec tests. Les conditions restantes sont
**externes** et listées dans `EXTERNAL_BLOCKERS.md` (validation Windows réelle +
Authenticode, PostgreSQL/Redis de prod, intégrations e-invoicing, montées majeures
Electron/Next). `PRODUCTION_READY` ne peut PAS être prononcé tant que la validation
Windows réelle et la signature Authenticode ne sont pas faites.
