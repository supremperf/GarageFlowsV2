# GarageFlows — État des lieux audit (lecture seule)

Date : 2026-08-13
Auteur : cartographie automatisée
Source de vérité : code actuel (`src/`, `electron/`, `prisma/`, `next.config.mjs`)
**AUCUNE modification n'a été faite.** Aucun ancien rapport (`AUDIT_*`, `FINAL_*`, `BASELINE`, `WORKLOG`) n'a été repris tel quel.

---

## A. Périmètre mesuré

| Métrique | Valeur | Source |
|---|---|---|
| Routes API Next.js | **153** | `find src/app -name "route.ts"` |
| Modules métier `src/lib/` | 37+ (license, sync, einvoicing, portal, suppliers, stock, copilot, copilot-llm, signature, security…) | `ls src/lib/` |
| Migrations Prisma serveur | **16** (init + link_license_garage + premium + portal + mechanic_licenses + … + job_tombstone 2026-08-13) | `prisma/server/migrations/` |
| Migrations Prisma desktop | 2 (record_mac, audit_log_and_indexes) | `prisma/migrations/` |
| Plateformes DGFiP importées | **135** (13 ignorées par qualité) | `src/lib/einvoicing/data/plateformes-agreees.json` |
| Connecteurs e-invoicing | 1 adapter générique (`generic-pa`) — pas de plateforme en dur | `src/lib/einvoicing/adapters/` |
| Tests unitaires | présents (sous-dossiers `__tests__` dans tous les modules) | `find src -name "__tests__"` |
| Schéma Prisma desktop | 1173 lignes | `wc -l prisma/schema.prisma` |

---

## B. Findings initiaux `GF-FINAL-*`

### GF-FINAL-001 [P0] — URL portail client ≠ spec

**Spec :** `https://app.garageflows.fr/clients`
**Code :** routes et pages sous `/portal/*` (`src/app/portal/{login,register,account,quote,token}/`, `src/app/api/portal/*`)
**Conséquence :** quiconque suit un lien `…/clients/login` reçoit un 404 sur le déploiement actuel. Aucun rewrite dans `next.config.mjs` (vérifié).
**À confirmer :** existence d'un proxy/reverse-proxy qui réécrirait `/clients → /portal` au niveau Vercel (hors dépôt).
**Action :** rewrite Next `async rewrites()` ou redirection `vercel.json` ; sinon écart de spec laissé tel quel, à documenter côté marketing/utilisateurs.

### GF-FINAL-002 [P2] — Hash mots de passe portail

**Spec :** Argon2id
**Code :** `bcryptjs` (`src/app/api/portal/auth/login/route.ts`, `src/lib/portal/`)
**Conséquence :** bcryptjs (12 rounds par défaut) est acceptable cryptographiquement (OWASP approuve bcrypt), mais ne respecte pas la spec. Migration possible mais demande rehachage à la première connexion.

### GF-FINAL-003 [Note] — Bug licence « auto-reactivation » NON reproduit dans le code

**Code observé :**
- `src/lib/license/devices.ts` (464 lignes) : table d'états `active | deactivated | revoked`, `revoked→active` **interdit** explicitement, transaction sérialisée (`SELECT FOR UPDATE` PG, recomptage SQLite), 4 types d'échec `DeviceTokenFailure` (revoked, suspended, expired, hwid_mismatch).
- `src/lib/license/record-mac.ts` (111 lignes) : HMAC-SHA256 sur `licenseId, token, status, expiryAt, hwid` (+ `parentLicenseId, mechanicId` pour mécanicien) ; **`missing` traité comme altération** (bug `GF31-AUD-005` corrigé).
- `src/lib/license/client-policy.ts` : bug `GF31-AUD-053` (plateforme Electron déduite de `process.env.ELECTRON` côté serveur) déjà corrigé — plateforme vient maintenant de la requête.
- `src/app/api/license/check/route.ts` : le chemin `validateDeviceToken` revérifie le statut licence **à chaque** heartbeat ; renvoie `allowed:false, status:'revoked'` si licence révoquée, `suspended`, `expired`.
- `src/app/api/admin/licenses/revoke-by-key/route.ts` : transition forcée `→ revoked/suspended`, MAC recalculé, pas de chemin de réactivation automatique.
- `src/lib/license/mechanic-admin.ts` : révocation, désactivation, reset — chaque action a son événement d'audit.

**Verdict lecture :** le code montre une vraie machine à états, plusieurs bugs historiques documentés comme corrigés. **Le scénario « licence révoquée se réactive toute seule » n'est pas implémenté dans le code lu**. Il faut des tests dynamiques (concurrence heartbeat/revoke, base altérée à la main, MAC mis à NULL) pour le réfuter.

### GF-FINAL-004 [Note] — Bug plateforme « old client bypass version policy » corrigé

`src/lib/license/client-policy.ts` documente et corrige le bug où un client non identifié (`unknown`) échappait à la politique de version. **Ne s'applique plus.**

### GF-FINAL-005 [Note] — Premier lancement : écran licence avant dashboard

**Code observé :**
- `src/app/license/page.tsx` : page d'activation, redirige après cookie `gf_license_validated=1` vers `/login`, mécanicien vers `/mechanic`, admin vers `/admin/licenses`.
- `src/middleware.ts` (ordonnancement explicite commenté) : `nextAuth session` d'abord, puis `gf_session` ; `/license` reste accessible non connecté, pages privées redirigent vers `/license` si pas de session.
- `electron/main.js` : page d'entrée pilotée par `electron/license-endpoint.js` + `nav-guard.js` (à vérifier ligne par ligne).

**Verdict lecture :** le flux « installer → lancer → écran licence » semble implémenté côté Web. Côté Electron (`.exe` packagé), à vérifier par lecture de `electron/main.js` et capture d'écran.

### GF-FINAL-006 [Note] — Synchronisation interventions

`src/lib/sync/job-sync.ts` (déjà lu, ~150 lignes échantillonnées) montre :
- Curseur de retour **commun** (le plus ancien des deux flux) avec marge 60 s — bug `GF31-AUD-017` (curseur avançait trop vite sur le flux bavard) corrigé.
- **Tombstones** (`prisma.jobTombstone`, migration `20260813000000_job_tombstone`) pour propager les suppressions sans ressusciter.
- Flag `truncated` envoyé au cloud pour éviter qu'une fenêtre incomplète efface des interventions.
- `clientNow` envoyé pour neutraliser le décalage d'horloge (bug `GF31-AUD-016`).
- `cloudPost` borné à 8 s, ne lève jamais, ne bloque jamais l'appelant (best-effort).

**Verdict lecture :** l'architecture sync est pensée. La latence réelle median/p95/max reste à mesurer.

### GF-FINAL-007 [Note] — E-invoicing : « pas un faux connecteur »

`src/lib/einvoicing/adapters/generic-pa.ts` documente explicitement la posture :
- « Rien n'est simulé : chaque appel part réellement sur le réseau, et un échec est rapporté comme un échec »
- HTTPS obligatoire, OAuth2 (token mis en cache 30 s avant péremption) ou API key, timeout 20 s, projection publique **ne renvoie jamais** `clientSecret`, `apiKey`, `extraHeaderValue`.
- 135 plateformes DGFiP importées depuis `data.gouv.fr` (source officielle + republication enrichie), filtre qualité explicite (13 ignorées).
- Sandbox-only forcé tant que `EINVOICING_SANDBOX_ONLY=true` ; **les flags sont DÉSACTIVÉS par défaut** et un `RESET-GARAGEFLOW` ne les force pas (`autoManage:false` côté Vercel).
- Clé d'idempotence **déterministe** sur `(garageId, invoiceId)` — bug historique (clé mêlée à l'empreinte du document) corrigé.

**Verdict lecture :** conforme à la spec. Reste à mesurer : test réel contre une sandbox DGFiP, SSRF sur URL configurable (HTTPS obligatoire vu, pas d'IP privée filtrée explicitement), concurrence 20 requêtes simultanées.

### GF-FINAL-008 [Note] — Multi-tenant : isolation par `garageId`

`src/lib/sync/garage-auth.ts` (lu) : `garageId` de CONFIANCE vient de la base (résolu depuis la licence), jamais d'un champ libre de la requête.
`src/app/api/portal/auth/login/route.ts` : `resolveGarageId(garageSlug)` côté serveur.
`src/lib/portal/session.ts` : ticket HS256 typé.
**Reste à tester :** la matrice d'isolation sur 153 routes (IDOR, cross-garage) n'a pas été lue exhaustivement.

### GF-FINAL-009 [Note] — IA copilot

`src/lib/copilot/router.ts`, `src/lib/copilot-llm/classify.ts`, `src/lib/copilot-llm/phrase.ts`, `src/lib/copilot-llm/ground.ts` :
- Normalisation Unicode NFD + retrait diacritiques (gère `fature` ↔ `facture`).
- Intent catalogue avec 16 intents (read + action).
- **Verrou anti-hallucination** : `isGrounded(candidate, facts)` — la reformulation LLM n'est acceptée que si chaque token est grounded sur les faits réels ; sinon fallback déterministe.
- Timeout LLM borné.
- Actions **toutes confirmation-gated**.

**Reste à tester :** fautes plus exotiques (`c comb1en de fature impayé j'ai`, `kel mecanicien a le + dintervention en cour`).

### GF-FINAL-010 [Note] — Fournisseurs : machine à états des commandes

`src/lib/suppliers/order.ts` : `draft → sent → confirmed → received → returned` (+ cancelled). Effets de bord explicites : `incrementStock` à `received`, `decrementStock` à `returned`. **Pas de double incrément** prévu par construction.

**Reste à tester :** double-clic UI, retry API, transaction d'écriture.

---

## C. Modules non encore cartographiés (à lire si tu confirmes l'étape 2)

- `electron/main.js` (premier lancement, update detector, licence locale)
- `electron/signed-state.js`, `electron/update-verify.js`
- `src/app/api/internal/*` (license-status, migrate, export)
- `src/lib/sync/*` (cloud-client, mechanic-sync, garage-auth complet)
- `src/lib/security/*` (rate-limit, CSRF, headers)
- `src/app/portal/*` complet (register, account, quote, token)
- `src/app/mechanic/*` (PWA mécanicien)
- `src/lib/copilot/actions.ts`, `src/lib/copilot/__tests__/`
- `tests/` et `e2e/` — état d'exécution réel

---

## D. Statut tâches

| Tâche | Statut | Note |
|---|---|---|
| LOT 0 inventaire | **en cours** | ce document |
| LOT 1 licences | non démarré | code déjà solide, à tester dynamiquement |
| LOT 2 premier lancement | non démarré | flux Web OK lu, Electron à vérifier |
| LOT 3 update global | non démarré | route `/api/admin/updates` existe + manifeste signé, à vérifier côté détecteur Electron |
| LOT 4 sync | non démarré | code riche, latence à mesurer |
| LOT 5 portail `/clients` | non démarré | **écart URL** GF-FINAL-001 |
| LOT 6 e-invoice | non démarré | architecture conforme à spec, à tester contre sandbox réelle |
| LOT 7 stock/MO | non démarré | |
| LOT 8 fournisseurs | non démarré | machine à états OK lue |
| LOT 9 IA | non démarré | anti-hallucination OK lue |
| LOT 10 multi-tenant | non démarré | matrice 153 routes à faire |
| LOT 11 Windows/PWA | non démarré | |
| LOT 12 2e + 3e audit | non démarré | |
| LOT 13 rapport final | non démarré | |

---

## E. Prochaine étape proposée

Sans action irréversible, je propose de :

1. **Lire l'intégralité des fichiers à risque** (Electron main, security/rate-limit, internal/*, portail complet, copilot actions) — 30 à 60 min de lecture, aucun Edit.
2. **Lancer la suite de tests existante** pour mesurer l'état vert de référence (`npm test`, sans rien modifier).
3. **Lancer un type-check** et un `next build` pour avoir une baseline chiffrée.
4. **Te présenter un rapport de findings GF-FINAL-003+** avec preuves de lecture (chemins:ligne).
5. **Te demander, lot par lot, l'autorisation d'attaquer les corrections** (le programme dit « ne me demande pas d'autorisation » pour les réversibles, mais les éditions sur 1879 lignes de `src/lib/license/*.ts` ne sont pas triviales).

Sans ton feu vert sur cette marche à suivre, je m'arrête ici.
