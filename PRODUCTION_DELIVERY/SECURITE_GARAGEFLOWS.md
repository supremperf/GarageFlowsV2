---
doc-numbers: journal
---

# SÉCURITÉ — état final MASTER 5

**Verdict : CONTRÔLES EXÉCUTÉS, AUCUN SECRET EXPLOITABLE EXPOSÉ.** Trois limites subsistent, toutes nommées : signature de code absente, clé privée d'émission introuvable, historique Git du dépôt amont non scanné.

Aucune valeur secrète n'apparaît dans ce document.

## 1. Dépendances

| Contrôle | Résultat |
|---|---|
| `node scripts/audit-ci.js` — audit complet, tous niveaux LOW→CRITICAL, dev et optional inclus, **sans dérogation** | **OK** |
| `scripts/check-desktop-runtime-audit.mjs` — audit du runtime desktop empaqueté (Electron), que `--omit=dev` ignore | **OK** |
| `npm run test:audit` | **23/23** |
| `tests/critical-dependency-regressions.test.cjs` | inclus dans les 23 |

Les `overrides` du `package.json` (braces vendorisé borné, `postcss-selector-parser`, `brace-expansion`, `picomatch`, `fflate`, `js-yaml`, `browserslist`, `global-agent`…) sont inchangés. Aucun `npm audit fix --force`. Le `package-lock.json` n'a pas été modifié : l'installation a été faite par `npm ci`.

## 2. Secrets

Voir `GITLEAKS_FINAL.md` pour le détail. Synthèse :

| Contrôle | Périmètre | Résultat |
|---|---|---|
| `gitleaks dir` (working tree) | 133,53 Mo | 7 findings — **0 secret exploitable** |
| `gitleaks git --log-opts=--all` (historique) | 124,38 Mo, 1 commit | 6 findings — les mêmes, moins `.env` |
| scan du système de fichiers avec le détecteur du produit | 2 715 fichiers texte | **0 matière de clé privée**, **0 fichier `.pem`/`.key`/`.p12`/`.pfx`** |
| `check:artifact-secrets` | `win-unpacked` 2 885 fichiers + `Setup.exe` | aucune clé privée, aucune valeur de secret |
| `scripts/verify-rotation.mjs` (sur le `.env` réel) | secrets racine | **OK** — aucune valeur compromise |
| `npm run test:secret-scan` (Python, OCR réel) | 39 tests | **39/39** |

Les 6 findings versionnés sont des **fixtures de test et des entrées de détecteur** : deux d'entre eux sont des blocs `BEGIN PRIVATE KEY` dont le corps est le base64 d'une phrase en clair, précisément pour prouver que le détecteur ne les confond pas avec des clés.

`.gitleaksignore` **n'a pas été modifié** : `tests/secret-scan-policy.test.cjs` le verrouille au fingerprint près et exige un reçu de triage verrouillé par SHA-256 pour chaque suppression. Ajouter des entrées hors de ce processus aurait affaibli un contrôle pour obtenir un vert.

## 3. Cryptographie des licences

Voir `LICENCES_CRYPTO_FINAL.md`. Synthèse : ECDSA **P-256** (`prime256v1`), SHA-256, clé publique d'empreinte `b16d2e1bf6b9662f…`, 3 ancrages alignés, 2 consommateurs internes alignés, HWID V1 identique entre Node et Python sur les 5 vecteurs committés, **19/19** contrôles de résistance à la contrefaçon (licence altérée, clé étrangère, expiration, `exp` absent, version non gérée, substitution d'algorithme, courbe incorrecte, échec fermé sur divergence d'ancrage, aucun jeton émis ni base écrite en cas de divergence).

## 4. En-têtes de sécurité HTTP — mesurés, pas déclarés

Relevés sur le **serveur autonome de production local** et sur **`https://app.garageflows.fr`** :

| En-tête | Valeur |
|---|---|
| `Content-Security-Policy` | `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self' data:; media-src 'self' blob:; object-src 'none'; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'` |
| `unsafe-eval` en production | **absent** — correctement restreint au développement |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains` (2 ans) |
| `X-Frame-Options` | `DENY` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` |

`'unsafe-inline'` sur `script-src` reste l'exception documentée (scripts d'hydratation App Router sans nonce) ; le durcissement par nonce est le chemin prévu, non réalisé.

## 5. Démarrage de production *fail-closed* — confirmé

L'instrumentation **refuse** de démarrer avec un environnement incomplet, et nomme ce qui manque :

```
Démarrage refusé — variables d'environnement invalides :
  UPSTASH_REDIS_REST_URL (doit être l'URL REST https:// (…upstash.io) — pas rediss:// ni une valeur malformée),
  TRUST_PROXY_HEADERS (proxy de confiance non déclaré en production PWA — définissez TRUST_PROXY_HEADERS=1
    sinon les limites de débit s'effondrent en un seul bucket).
```

Un déploiement PWA sans limiteur de débit distribué valide ne peut donc pas servir de trafic. Mesuré, pas supposé.

## 6. Contrôle d'accès vérifié par les API réelles

| Contrôle | Mesure |
|---|---|
| API privée sans session (`GET /api/clients`) | **401** sur le serveur autonome de production |
| identifiant d'une autre organisation (`GET /api/clients/<id étranger>`) | **404** — pas de fuite inter-tenant |
| porte de licence côté serveur | toujours active en production (`licenseEnforcementEnabled()` renvoie `true` si `NODE_ENV === 'production'`, sans échappatoire) |
| matrice de droits appliquée **côté serveur** | `invoice:manage` pour la facturation, `stock:manage` pour le stock — un `RECEPTIONIST` est refusé en 403 |
| anti-IDOR sur les clés étrangères | `clientId`, `vehicleId`, `jobId` et chaque `partId` revérifiés comme appartenant au garage de la session **avant toute écriture** |
| statuts hors canon | refusés en 400 (intervention et facture) |

Preuve : `MASTER5_EVIDENCE/logs/35-audit-fonctionnel-api.txt`, `37-standalone-http.txt`.

## 7. Durcissement de l'artefact Windows

| Contrôle | Résultat |
|---|---|
| 9 fusibles Electron | conformes au plan (`RunAsNode=false`, `OnlyLoadAppFromAsar=true`, `EnableEmbeddedAsarIntegrityValidation=true`, inspection Node désactivée…) |
| manifeste d'intégrité | **540 fichiers critiques** signés, et validation **observée à l'exécution** : `[integrity] OK — 540 fichiers critiques vérifiés` |
| secrets dans l'artefact | aucun |
| élévation | `requestedExecutionLevel: asInvoker`, `perMachine: false`, `allowElevation: false` |
| démarrage sans outils de développement | prouvé : PATH réduit à Windows, répertoire courant vide, l'application démarre |

## 8. SMTP — chiffrement au repos et envoi réel vérifiés

L'architecture ne porte **aucune** variable `SMTP_*` : les identifiants sont des données **par garage**, chiffrées au repos en AES-256-GCM (enveloppe `GFSEC1:`) avec `GF_SMTP_CIPHER_KEY`.

Une sonde jetable a exercé le **vrai** code d'envoi du produit (`src/lib/mail/send-garage-mail.ts`) contre un **serveur SMTP réel démarré en mémoire sur la boucle locale** — aucun courriel ne quitte la machine :

| Contrôle | Résultat |
|---|---|
| mot de passe stocké chiffré (enveloppe `GFSEC1:`), valeur en clair absente du champ | **PASS** |
| message réellement transmis (enveloppe `MAIL FROM`/`RCPT TO`, en-têtes `From`/`To`/`Subject`) | **PASS** |
| authentification réellement présentée, avec le mot de passe **déchiffré** | **PASS** |
| configuration incomplète → `SMTP_NOT_CONFIGURED`, sans exception | **PASS** |
| refus du serveur (554) → `SMTP_SEND_FAILED`, **jamais présenté comme un succès**, aucun secret dans le résultat | **PASS** |
| clé de chiffrement modifiée → `SMTP_SECRET_UNREADABLE` et **aucun envoi** avec un mot de passe vide | **PASS** |

**5/5.** Preuve : `MASTER5_EVIDENCE/logs/33-smtp-reel.txt`.

**Non vérifié** : l'acheminement externe réel — SPF, DKIM, DMARC, réputation d'expéditeur, réception dans une boîte réelle. Cela exige un serveur SMTP de test autorisé, qui n'a pas été fourni.

## 9. Limites de sécurité restantes

1. **Aucune signature Authenticode** sur `GarageFlows-Setup.exe` ni sur `GarageFlows.exe` (`Status: NotSigned`, mesuré). SmartScreen avertira l'utilisateur final. Exige un certificat de signature de code OV ou EV.
2. **Clé privée d'émission de licences introuvable** : ni `keys/private.pem` localement, ni `GF_PRIVATE_KEY` dans les variables Vercel de production. La route `/api/admin/licenses/generate` est donc inopérante côté serveur, et aucune licence de test ne peut être signée (ce qui bloque 90 tests Playwright et 6 tests Vitest).
3. **Historique du dépôt amont non scanné** : `supremperf/GarageFlowsV2` n'est pas présent sur ce poste. Le scan Gitleaks d'historique n'a porté que sur le commit de référence créé localement.
4. **Six composants tiers distribués sans notice** dans l'installateur Windows (voir `BUILD_WINDOWS_FINAL.md §9`) — question de conformité de licence, pas de vulnérabilité.
5. **CSP avec `'unsafe-inline'`** sur `script-src` : exception documentée, durcissement par nonce non réalisé.
