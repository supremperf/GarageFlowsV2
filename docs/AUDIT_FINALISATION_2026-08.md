# Rapport d'audit & finalisation — GarageFlow

Date : 2026‑08‑03 · Périmètre : `GarageFlowsV2` (app desktop + PWA) et `garagesite3` (site vitrine)
Branche : `claude/audit-garageflow-finalisation-vz9ioc` · Environnement : Node 22.22, npm 10.9

> Méthode : audit lecture seule d'abord (14 auditeurs parallèles + relecture directe), puis
> corrections ciblées par lots atomiques, chacune vérifiée par exécution réelle des tests/build.
> **Aucun résultat n'est affirmé sans exécution.** Ce qui n'a pas pu être exécuté (PowerShell/Windows,
> GUI Python, déploiement) est explicitement marqué « inspecté, non exécuté ».

---

## 1. Résumé exécutif

- **État initial** : base déjà mature et bien conçue (garde‑fous d'environnement, isolation
  multi‑garage, licences ECDSA, durcissement Electron). Symptômes signalés : `503` sur la connexion,
  `JWT_SESSION_ERROR`, rate‑limit dégradé. Suite de tests **rouge** (3 suites d'intégration en échec).
- **État final** : `type-check`, `lint`, `build` (Next + Electron non exécuté, voir §7) et **740 tests
  verts** côté V2 ; `typecheck`/`lint`/`build`/**135 tests** verts côté vitrine. Erreur 503
  diagnostiquée, expliquée et rendue observable. Failles prouvées corrigées.
- **Niveau de préparation** : **PRÊT SOUS CONDITIONS** (voir §9). Le bloqueur n°1 — la **clé publique de
  licence divergente entre les trois consommateurs** — est désormais **RÉSOLU** : la clé de référence a
  été déterminée avec certitude (empreinte de `keys/public.pem` fournie par l'opérateur, jamais la clé
  privée) et les 3 emplacements sont alignés + verrouillés par test e2e. Restent des conditions
  d'exploitation non bloquantes pour le code (config d'env, validations Windows/PowerShell).
- **Principales corrections** : diagnostic/observabilité de l'auth ; purge de cookie NextAuth périmé ;
  non‑exposition des coûts/marges au portail client ; extraction d'IP fiable (anti‑contournement du
  rate‑limit) ; plafond d'upload ; garde de navigation Electron par origine ; cohérence HWID du keygen ;
  non‑rotation des clés de chiffrement au repos ; suppression d'un identifiant en clair dans le seed ;
  tests de couverture (authorize, jetons portail).

---

## 2. Cause racine du 503 (`POST /api/auth/callback/credentials`, ~14 ms, aucun appel sortant)

- **Fichier** : `src/app/api/auth/[...nextauth]/route.ts` (handler `POST`).
- **Fonction / condition** : le `POST` appelle `enforceRateLimit('login', clientIpFrom(req))`
  **avant** NextAuth. Dans `src/lib/security/rate-limit.ts`, `resolveBackend()` renvoie `null` quand
  `UPSTASH_REDIS_REST_URL/TOKEN` sont absents **et** `isPwaProduction()` est vrai ; la catégorie
  `login` est `critical`, donc `enforceRateLimit` renvoie `{ ok:false, degraded:'fail_closed' }` →
  `rateLimitResponse` renvoie **503**.
- **Pourquoi 503 et pas 401** : c'est un refus d'**infrastructure** (fail‑closed sécurité), pas un
  refus d'identifiants. La requête est rejetée **avant** toute vérification NextAuth/BD.
- **Pourquoi « aucun appel sortant » (~14 ms)** : le backend étant `null`, **aucun `fetch` Upstash
  n'est tenté** — d'où l'absence de trafic sortant et la durée quasi nulle.
- **Correctifs** :
  1. **Prévention au démarrage (déjà en place, vérifiée)** : `src/lib/env.ts` exige Upstash en prod
     PWA et `src/instrumentation.ts` (`assertEnv`, activé par `instrumentationHook`) **refuse le
     démarrage** avec un message clair si Upstash manque. Le 503 silencieux au login ne peut donc plus
     survenir par simple oubli de configuration.
  2. **Observabilité (ajoutée)** : la route journalise désormais
     `AUTH_STEP_3 result=fail_closed_503 reason=distributed_rate_limit_backend_unavailable` — l'erreur
     n'est plus silencieuse.
  3. **Durcissement env (ajouté)** : la prod PWA exige aussi un signal de proxy de confiance
     (`VERCEL=1` ou `TRUST_PROXY_HEADERS=1`), sinon toutes les IP retombaient sur `unverified` et les
     limites s'effondraient en un seul bucket.
- **Tests de non‑régression** : `src/__tests__/middleware.test.ts` (auth avant licence, pas de boucle),
  `src/lib/__tests__/security-rate-limit.test.ts` (503 fail‑closed), `src/lib/__tests__/env.test.ts`
  (refus de démarrage sans Upstash / sans proxy de confiance), `src/lib/__tests__/auth-authorize.test.ts`
  (401 pour identifiants invalides, jamais 503/500).

Concernant `JWT_SESSION_ERROR (decryption operation failed)` (rotation de `NEXTAUTH_SECRET`) : le
middleware `getToken` est déjà fail‑closed (pas de 500, pas de boucle). **Ajout** : purge sûre du cookie
`next-auth.session-token` périmé lors du renvoi vers `/login` → suppression du bruit de log et de toute
boucle résiduelle (`src/middleware.ts`, +4 tests).

---

## 3. Fichiers modifiés (corrections de cet audit)

| Fichier | Raison | Nature | Risque |
|---|---|---|---|
| `vitest.config.ts` | 3 suites d'intégration en échec (timeout amorçage SQLite) | `hookTimeout: 30s` | nul |
| `package.json` | script `type-check` manquant (attendu par la mission) | ajout `tsc --noEmit` | nul |
| `src/lib/auth.ts` | 503/500 indistincts, pas d'observabilité | journaux `AUTH_STEP`, distinction infra/identifiants, garde « sans garage » | faible |
| `src/app/api/auth/[...nextauth]/route.ts` | 503 silencieux | log fail‑closed + `AUTH_STEP_0` | faible |
| `src/middleware.ts` | cookie NextAuth périmé → bruit `JWT_SESSION_ERROR` | purge sûre (Max‑Age=0) | faible |
| `src/lib/redact.ts` | jeton portail dans un chemin d'URL non masqué (§10) | règle `/portal/[REDACTED]` | nul |
| `src/app/api/portal/quote/[token]/route.ts` · `portal/[token]/route.ts` | **fuite `unitCost`/marge au client** | `select` explicite sans `unitCost` | faible |
| `src/lib/portal/auth-helpers.ts` | IP forgeable → contournement rate‑limit portail | délègue à `clientIpFrom` | faible |
| `src/lib/env.ts` (+ `env.test.ts`) | prod PWA sans proxy → auto‑DoS rate‑limit | exige `VERCEL`/`TRUST_PROXY_HEADERS` | moyen |
| `src/app/api/jobs/[id]/photos/route.ts` (+ `api-helpers.ts`) | upload sans plafond/MIME → DoS disque/BD | cap 8 Mo (413) + MIME image (415) | faible |
| `electron/main.js` | garde nav `startsWith` contournable (userinfo) | comparaison d'origine analysée | faible |
| `scripts/keygen.py` | HWID divergent → licence matérielle jamais validée | sel/`unknown-disk` alignés | faible |
| `scripts/keygen_ui.py` | pas de point d'entrée → GUI non lançable | `main()` + `__main__` | nul |
| `scripts/reset-garageflow.ps1` | rotation de clés de chiffrement au repos → **perte de données** | exclusion `GF_TOTP_ENC_KEY`/`GF_SMTP_CIPHER_KEY` | moyen |
| `prisma/seed.ts` | identifiant admin en clair dans le dépôt | `SEED_ADMIN_PASSWORD` ou aléatoire | nul |
| `src/app/api/admin/licenses/revoke-by-key/route.ts` | route admin réseau sans rate‑limit | `enforceRateLimit('admin')` | faible |
| `.github/workflows/ci.yml` | `GITHUB_TOKEN` sans permissions déclarées | `permissions: contents: read` | nul |
| `src/lib/__tests__/auth-authorize.test.ts` · `src/lib/portal/__tests__/session.test.ts` | couverture manquante (§17) | +16 tests | nul |
| **garagesite3** `src/lib/licenses/http.ts` | IP forgeable → contournement rate‑limit | modèle de proxy de confiance | faible |

---

## 4. Tests exécutés (réels)

| Commande | Résultat | Notes |
|---|---|---|
| `npm ci` (V2 + vitrine) | ✅ | génère les 2 clients Prisma |
| `npm run type-check` (V2) | ✅ 0 erreur | script ajouté |
| `npx next lint` (V2) | ✅ 0 warning | |
| `npx next build` (V2) | ✅ | toutes routes + middleware |
| `npx vitest run` (V2) | ✅ **740 passés / 24 skip / 0 échec** | avant fix : 3 suites KO (timeout) |
| `npx vitest run src/integration --hookTimeout=60000 --no-file-parallelism` | ✅ 41 | preuve : échec = contention, pas bug |
| `npm run typecheck` (vitrine) | ✅ | |
| `npx next lint` (vitrine) | ✅ | |
| `npx vitest run` (vitrine) | ✅ **135 passés** | |
| `npm run build` (vitrine) | ✅ EXIT 0 | |
| `python3 -c ast.parse keygen*.py` | ✅ | validité syntaxique |

**Non exécutés** (marqués comme tels) : `npm run dist` / `electron:dev` (Electron sur Linux headless,
non représentatif) ; `env:reset:dry-run` et le configurateur (PowerShell/Windows) ; `keygen_ui.py`
(GUI Tkinter sans afficheur). Ces éléments ont été **inspectés** statiquement.

---

## 5. Sécurité

**Vulnérabilités corrigées (prouvées)** : fuite de coût/marge au portail client ; contournement du
rate‑limit par IP forgeable (portail V2 + vitrine) ; auto‑DoS du rate‑limit en prod PWA sans proxy ;
upload de photos sans plafond ni MIME ; garde de navigation Electron contournable (userinfo) ;
rotation destructive de clés de chiffrement au repos ; identifiant admin en clair dans le seed ;
route admin `revoke-by-key` sans rate‑limit ; jeton portail non masqué dans les logs de chemin ;
permissions CI non minimales.

**Secrets potentiellement exposés** : **aucun secret réel** trouvé dans les fichiers suivis des deux
dépôts (pas de clé privée, pas d'URL PostgreSQL avec identifiants réels, pas de token Upstash, pas de
`.env` suivi). Seuls des DSN de **test** en `localhost` figurent dans des tests/docs d'intégration.
L'ancien identifiant du seed est retiré (voir §3).

**Rotations recommandées** : aucune rotation obligatoire déclenchée par cet audit. La procédure de
rotation reste documentée dans `docs/SECRETS_ROTATION.md`. **Ne pas** roter `GF_TOTP_ENC_KEY` /
`GF_SMTP_CIPHER_KEY` sans migration de re‑chiffrement (données au repos).

**Actions externes NON exécutées** (volontairement) : aucune modification de Vercel/Neon/Upstash,
aucune migration destructive, aucune rotation de clé de production, aucune fusion vers `main`, aucune
release.

---

## 6. Éléments restants (non corrigés — justifiés)

- **RÉSOLU (2026‑08) — Clé publique de licence divergente entre dépôts.**
  Les trois consommateurs (`V2/src/lib/license/public-key.ts`, `V2/electron/main.js`,
  `garagesite3/src/lib/licenses/public-key.ts`) embarquaient des clés **P‑256 différentes** tout en
  vérifiant le **même format GF2 (ES256)** de l'**unique** keygen → un dépôt aurait rejeté toutes les
  licences réelles. L'empreinte de référence a été déterminée **avec certitude** à partir de
  `keys/public.pem` fourni par l'opérateur (jamais la clé privée) — elle ne correspondait à **aucune**
  des deux clés embarquées : **les deux dépôts étaient périmés**. Les trois emplacements ont été alignés
  sur la clé de référence.
  - Empreintes DER‑SHA256 **avant** — V2 (PWA+Electron) `c48e6b3e…9906a` ; vitrine `1a48d1cc…2974a`.
  - Empreinte DER‑SHA256 **après** (commune aux 3) : `7bed3cb736ccc8d422a7663939732faf6eb9a4c59daa590cc826b2f821b6d478`.
  - **Test e2e** : `public-key-consistency.test.ts` (V2 + vitrine) verrouille l'invariant « les 3 clés
    == empreinte de référence » et fournit un harnais de vérification d'un vrai jeton GF2 signé
    (activé par `GF_TEST_LICENSE`). Aucune paire régénérée, aucune clé privée dans le dépôt.
  - *Reste à faire (opérateur, non bloquant)* : fournir un jeton GF2 de test pour exécuter le chemin
    e2e **positif** en CI (sinon il est `skip`).

- **ÉLEVÉ / MOYEN — Panne transitoire d'Upstash → 503 au login.** Choix de conception (fail‑closed
  sécurité). Documenté ; l'observabilité ajoutée le rend diagnosticable. À arbitrer par le métier
  (disponibilité vs protection) si l'on veut un repli borné sur `login`.

- **RÉSOLU — Heartbeat PWA : `installId` transmis à `validateDeviceToken`**
  (`src/app/api/license/check/route.ts`). `installId` est désormais extrait et passé → l'empreinte
  d'appareil PWA est vérifiée au heartbeat (un jeton volé n'est plus rejouable depuis un autre
  navigateur). Rétro‑compatible (Electron → hwid inchangé). Tests : forwarding installId/hwid +
  empreinte erronée → jamais `allowed:true`.

- **RÉSOLU — Runner de migration desktop : 6 index UNIQUE rétablis avec contrôle de doublons**
  (`src/lib/migrations.ts` + `migrate/route.ts`). Nouveau variant `uniqueIndex` : détection préalable
  des doublons (NULL exclus) → si présents, index **différé** (jamais d'échec ni de perte), sinon
  `CREATE UNIQUE INDEX IF NOT EXISTS`. Tests SQLite réels (node:sqlite) : création + application,
  doublons → différé sans perte, réessai après nettoyage, NULL multiples.

- **RÉSOLU — `-DryRun` du reset rendu totalement inerte** (`scripts/reset-garageflow.ps1` +
  `configurer-api-garageflow.ps1`) : dossier d'exécution en TEMP éphémère, `vercel login`/`link`
  refusés en simulation, sauvegardes locales ignorées. *(PowerShell non exécutable ici — vérifié par
  inspection statique, modifications additives.)*

- **ÉLEVÉ / MOYEN — Panne transitoire d'Upstash → 503 au login.** Choix de conception (fail‑closed
  sécurité), inchangé — voir plus haut.

- **FAIBLE — MAC d'intégrité de licence n'inclut pas `seats`** (`src/lib/license/record-mac.ts`).
  *Non corrigé* : changer la formule invaliderait tous les MAC existants (faux « tampered ») → exige
  une migration/backfill contrôlée. À planifier.

- **FAIBLE — Divers restants** : couverture rate‑limit partielle sur d'autres routes `/api/admin/*` ;
  jetons portail sans révocation (stateless) ; code mort `garagesite3/src/lib/api.ts` ; CORS démo v1
  avec repli `*`. **Améliorations** : structured logging étendu ; Decimal pour la monnaie (migration
  destructive, hors périmètre).

---

## 7. Build Electron

`npm run dist` / `electron-builder --win` **non exécuté** : cible Windows, environnement Linux headless
non représentatif (et téléchargement de binaires). La configuration `build` de `package.json`
(asarUnpack Prisma, extraResources `.next/standalone` + `prisma`, `afterPack`) a été **inspectée** et
paraît cohérente. Le durcissement Electron (contextIsolation, sandbox, nodeIntegration:false,
webSecurity, single‑instance, gardes de navigation corrigées) est vérifié par lecture. **À valider sur
une machine Windows** avant distribution.

---

## 8. Retour arrière

Tous les changements sont sur la branche `claude/audit-garageflow-finalisation-vz9ioc` (les deux
dépôts), en commits atomiques thématiques. Pour revenir en arrière :

- Annuler un lot précis : `git revert <sha>` (chaque commit est autonome et testé).
- Revenir à l'état d'avant audit : `git checkout <sha d'origine/main>` ou réinitialiser la branche sur
  `origin/main` (`git reset --hard origin/main`) — aucun changement n'a été fusionné dans `main`.
- Aucune migration de base, aucune donnée et aucun secret externe n'ont été modifiés : le retour
  arrière est purement local au code.

---

## 9. Verdict final : **PRÊT SOUS CONDITIONS**

Le socle est de qualité professionnelle et l'ensemble des vérifications automatisables est **vert**.
Le **bloqueur n°1 (clé publique de licence divergente) est RÉSOLU** : les 3 consommateurs partagent
désormais la clé de référence du keygen (empreinte `7bed3cb7…`, §6). Restent des conditions
d'exploitation, **non bloquantes pour le code** :

1. **Config d'exploitation** : en prod PWA, définir `UPSTASH_REDIS_REST_URL/TOKEN`, `NEXTAUTH_SECRET`
   stable, `DEVICE_TOKEN_PEPPER`, et un signal de proxy de confiance (`VERCEL=1` automatique, sinon
   `TRUST_PROXY_HEADERS=1` derrière un proxy fiable) — sans quoi le démarrage est (volontairement)
   refusé avec un message clair.
2. **À valider hors CI Linux** : build Electron Windows, `env:reset:dry-run` (PowerShell), keygen GUI.
3. **Optionnel** : fournir un jeton GF2 de test (`GF_TEST_LICENSE`) pour exécuter le chemin e2e
   **positif** des licences en CI.

En dehors de ces conditions, aucune régression critique connue n'a été introduite ; le 503 est
diagnostiqué et corrigé ; la divergence de clé de licence est résolue et verrouillée par test ; les
failles prouvées sont traitées.
