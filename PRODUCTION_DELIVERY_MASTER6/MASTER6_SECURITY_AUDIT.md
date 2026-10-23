---
doc-numbers: journal
---

# AUDIT DE SÉCURITÉ — rapport MASTER 6

**Verdict : aucun secret exploitable dans le périmètre publié.** Une **exposition historique préexistante** du dépôt public est en revanche établie et exige une rotation : c'est le constat le plus important de cet audit.

Aucune valeur secrète ne figure dans ce document. Tous les scans ont été lancés avec `--redact`.

---

## 1. Fait de contexte déterminant

**`supremperf/GarageFlowsV2` est un dépôt PUBLIC.** Tout ce qui y est poussé est lisible par quiconque, immédiatement et de façon permanente. Cela a dicté la rigueur de cet audit avant publication.

## 2. Secrets — périmètre publié

### Scan du contenu versionné

```
gitleaks git . --config .gitleaks.toml --redact --no-banner --log-opts=--all
```

Findings dans le contenu suivi, triés un par un :

| Emplacement | Nature réelle |
|---|---|
| `artifacts/verification/campagne-100-licences.json` (6 lignes) | clé JSON **`empreinteJetonSha256`** — des **empreintes SHA-256 de jetons**, pas des jetons. Vérifié : le fichier ne contient **aucun** jeton GF2 complet, et son champ racine `fixturePublicFingerprint` atteste l'usage de clés de **fixture**. Une empreinte est à sens unique → publiable. |
| `tests/config.test.cjs:98` | fixture de test |
| `tests/setup-dev-permissions.test.cjs:39` (×2) | fixture : base64 de `foobarbazquxsecret1234567890` |
| `src/lib/__tests__/secrets-jamais-distribues.test.ts:128` | **entrée de détecteur** — bloc `BEGIN PRIVATE KEY` dont le corps est le base64 d'une phrase en clair, présent pour prouver que le détecteur ne le confond PAS avec une clé |
| `tests/private-key-material.test.cjs:79` | idem |

**Aucun de ces findings n'ouvre un accès.** Aucune rotation n'est requise de leur fait.

### Fichiers sensibles suivis — vérification directe

| Motif | Fichiers suivis |
|---|---|
| `.env` | **0** |
| `.env.local` | **0** |
| `*.pem` | **0** |
| `*.key` | **0** |
| `*.p12`, `*.pfx` | **0** |
| `licenses_db` | **0** |

### `.gitleaksignore` n'a pas été modifié

`tests/secret-scan-policy.test.cjs` le verrouille au fingerprint près et exige, pour chaque suppression, un reçu de triage verrouillé par SHA-256. Ajouter des entrées hors de ce processus aurait affaibli un contrôle de sécurité pour obtenir un vert. Le scanner sort donc en code 1, et le triage est consigné ici.

## 3. EXPOSITION HISTORIQUE DU DÉPÔT PUBLIC — à traiter

Le scan d'historique révèle trois fichiers qui **ne figurent dans aucune branche actuelle** mais existent dans d'anciens commits :

| Fichier | Findings |
|---|---|
| `.env.storage.local` | 3 × `generic-api-key` |
| **`keys/licenses_db.json`** | 1 × `jwt` — **base des licences émises** |
| `keys/server_config.json` | 1 × `generic-api-key` |

Vérifié : aucun n'est présent dans `origin/main`, `origin/arena/388085e0-garageflowsv2`, ni dans mon HEAD. Ils ont été retirés, mais **l'historique d'un dépôt public est permanent**.

Conformément à la doctrine du projet lui-même — « un secret committé est potentiellement compromis, jamais réputé sûr parce que retiré ensuite » — toute valeur qu'ils contenaient doit être **considérée comme publique à jamais**.

**Ce n'est pas introduit par MASTER 6.** Et **aucune réécriture d'historique n'a été faite** : ce serait masquer la fuite, ce que le mandat interdit explicitement.

→ Action de rotation détaillée dans `MASTER6_MANUAL_ACTIONS.md`.

## 4. Artefacts de build — hors périmètre publié

Le scan du disque signale des findings dans `dist/`. Ils ne sont **pas publiés** :

| Vérification | Résultat |
|---|---|
| `dist/` suivi par git | **0 fichier** |
| `dist/` ignoré par `.gitignore` | **oui** |
| `dist/` exclu de `.vercelignore` | **oui** |

Le plus notable, `private-key` dans `.next/server/src/middleware.js`, a été ouvert et lu : c'est du code de la bibliothèque `jose` validant un format PKCS#8 —

```js
if ("string" != typeof a || 0 !== a.indexOf("-----BEGIN PRIVATE KEY-----")) throw TypeError('"pkcs8" must be PKCS#8 f…
```

Le détecteur du produit (`containsPrivateKeyMaterial`) y voit **`false`**. Et `check:artifact-secrets` confirme indépendamment : **aucune clé privée, aucune valeur de secret** dans l'artefact (2 885 fichiers + installateur inspectés).

## 5. Variables d'environnement

| Source | Constat |
|---|---|
| Vercel Production | 10/10 variables du contrat présentes, aucun alias interdit (`check:env-vercel` → code 0) |
| Vercel Preview | environnement de staging complet et **distinct** (Neon + Upstash dédiés) |
| `GF_PRIVATE_KEY` | **absente de tous les environnements** — voir `MASTER6_ECC_KEY_REPORT.md` |
| `.env` local | gitignoré, absent de l'artefact, absent du téléversement Vercel |
| GitHub Actions | aucun secret ajouté ni modifié par MASTER 6 |

**Aucune variable n'a été créée, modifiée ou supprimée.** Aucune valeur n'a été affichée ni journalisée : la recherche de clé a travaillé exclusivement sur des **empreintes**.

## 6. Authentification, autorisations, isolation

Mesures sur serveur en **mode production** (sortie `.next/standalone`), contre les services de staging :

| Contrôle | Résultat |
|---|---|
| `GET /` sans session | **307** → `/login` |
| 11 API privées sans session (`clients`, `vehicles`, `jobs`, `invoices`, `parts`, `mechanics`, `garages`, `quotes`, `work-orders`, `finance`, `stats`) | **401** sur les 11 |
| jeton CSRF émis | **oui** |
| `POST /api/license/activate` avec jeton invalide | **400** `VALIDATION_ERROR` |
| session de licence inconnue en base | **401** `LICENSE_UNKNOWN` |
| cron e-invoicing sans jeton (fonction active) | **401** `UNAUTHORIZED` |
| cron e-invoicing avec mauvais jeton | **401** `UNAUTHORIZED` |
| identifiant d'un autre tenant (`GET /api/clients/<id étranger>`) | **404** — pas de fuite inter-garage |
| matrice de droits appliquée côté serveur | `invoice:manage`, `stock:manage` → 403 pour un rôle insuffisant |
| anti-IDOR | `clientId`, `vehicleId`, `jobId`, `partId` revérifiés comme appartenant au garage **avant toute écriture** |

**Preuve positive supplémentaire** : une sonde a tenté d'accéder aux API avec un cookie `gf_session` **forgé** mais signé. Toutes les routes ont répondu **401 `LICENSE_UNKNOWN`** — la porte de licence n'est pas contournable par un cookie seul.

## 7. En-têtes de sécurité — mesurés

Sur le serveur de production local **et** sur `https://app.garageflows.fr` :

| En-tête | Valeur |
|---|---|
| `Content-Security-Policy` | `default-src 'self'; script-src 'self' 'unsafe-inline'; … object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'` |
| **`unsafe-eval`** | **absent** — correctement restreint au développement |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains` (2 ans) |
| `X-Frame-Options` | `DENY` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` |

`'unsafe-inline'` sur `script-src` reste l'exception documentée (hydratation App Router sans nonce) ; le durcissement par nonce n'est pas réalisé.

## 8. Démarrage *fail-closed* — confirmé

L'instrumentation **refuse** de démarrer en production avec un environnement incomplet, et nomme ce qui manque :

```
Démarrage refusé — variables d'environnement invalides :
  UPSTASH_REDIS_REST_URL (doit être l'URL REST https:// (…upstash.io))
  TRUST_PROXY_HEADERS (proxy de confiance non déclaré en production PWA —
    sinon les limites de débit s'effondrent en un seul bucket)
```

Un déploiement sans limiteur de débit distribué valide **ne peut pas servir de trafic**.

## 9. Dépendances

| Contrôle | Résultat |
|---|---|
| `node scripts/audit-ci.js` — tous niveaux LOW→CRITICAL, dev et optional inclus, **sans dérogation** | **OK** |
| `scripts/check-desktop-runtime-audit.mjs` — runtime desktop empaqueté | **OK** |
| `npm run test:audit` | **23/23** |

`package.json` et `package-lock.json` sont **inchangés**. Aucun `npm audit fix`, aucune montée de version majeure, aucun `overrides` touché.

## 10. Durcissement de l'artefact Windows

| Contrôle | Résultat |
|---|---|
| secrets dans l'artefact | **aucun** |
| fusibles Electron | **9/9 conformes** (`RunAsNode=false`, `OnlyLoadAppFromAsar`, validation d'intégrité ASAR, inspection Node désactivée…) |
| manifeste d'intégrité | **540 fichiers critiques**, validation **observée à l'exécution** |
| élévation | `asInvoker`, `perMachine: false`, `allowElevation: false` |
| **signature Authenticode** | **absente** (`NotSigned`) — voir `MASTER6_WINDOWS_INSTALL_REPORT.md` |

## 11. Limites de sécurité restantes

1. **Exposition historique du dépôt public** (§3) — trois fichiers dans d'anciens commits ; rotation requise.
2. **Clé privée de licence introuvable** — émission impossible ; aucune rotation improvisée.
3. **Installateur non signé** — SmartScreen avertira chaque client.
4. **CSP avec `'unsafe-inline'`** — exception documentée, nonce non réalisé.
5. **Six composants tiers distribués sans notice** dans l'installateur — conformité de licence, pas vulnérabilité (hérité MASTER 5).
6. **Divulgation mineure d'état de configuration** sur une route interne (§4 de `MASTER6_FUNCTIONAL_AUDIT.md`).
