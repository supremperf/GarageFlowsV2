---
doc-numbers: journal
---

# LICENCES, HWID ET CLÉS ECC — état final MASTER 5

**Verdict : PRÉSERVÉ ET VÉRIFIÉ.** Le système n'a pas été réécrit. Aucune clé n'a été régénérée, aucun ancrage déplacé, aucune licence existante invalidée. Une limite est nommée : **la clé privée d'émission n'est pas sur ce poste**, et elle n'est pas non plus dans les variables de production Vercel.

## 1. Clé publique de licence — inchangée

```
$ node -e "… createPublicKey(keys/public.pem) …"
type   : ec
courbe : prime256v1          (= NIST P-256 / secp256r1)
SHA-256 du SPKI : b16d2e1bf6b9662f9748e009c0cf88770ab602233ee546895ac352f808bc3d9d
```

C'est l'empreinte que le produit vérifie. `keys/public.pem` est **gitignoré** : il n'est pas committé, il est **matérialisé au build** depuis les ancrages présents dans les sources, par `scripts/materialize-build-public-key.cjs`, puis contrôlé contre `REFERENCE_FP`.

```
$ npm run keys:check
✅ sync:public-key — 3 ancrages déjà alignés sur keys/public.pem (b16d2e1bf6b9662f…)
$ npm run check:public-key
✅ check:public-key — 2 consommateurs internes alignés sur keys/public.pem (b16d2e1bf6b9662f…)
```

Les trois ancrages sont `electron/main.js` (`_PK`), `src/lib/license/public-key.ts` (`_LINES`) et `REFERENCE_FP` dans `src/lib/license/__tests__/public-key-consistency.test.ts`.

**`npm run keys:sync` n'a PAS été exécuté.** C'est l'outil qui déplace les trois ancrages ensemble lors d'une rotation ; l'utiliser ici aurait remplacé l'autorité de production par une clé locale et invalidé toutes les licences déjà émises.
Preuve : `MASTER5_EVIDENCE/logs/26-hwid-licence-cles.txt`.

## 2. HWID V1 — algorithme intact, identité inter-langages prouvée

`src/lib/license/hwid-v1.ts` est inchangé. L'algorithme vérifié sur place :

1. clés canoniques **triées et figées** : `cpu, diskSerial, mac, machineId, platform` ;
2. normalisation de chaque valeur : **NFC** → compression des espaces → `trim` → **minuscules** ;
3. sérialisation `clé=valeur` jointe par LF, préfixée du tag de séparation de domaine **`GF-HWID-V1\n`** (toutes les clés toujours présentes, vides si absentes) ;
4. **SHA-256** UTF-8 → hex, sortie **`HWID1-<hex>`**.

Vérifications exécutées :

| Contrôle | Résultat |
|---|---|
| vecteurs committés `tests/fixtures/hwid-v1-vectors.json` (jeu v1, 5 vecteurs) rejoués par `scripts/hwid_v1.py` | **5/5 identiques** |
| suites Node `hwid-v1.test.ts` + `hwid-verify.test.ts` | **23/23 réussis** |
| `collectHwidFieldsV1` / `getHwidV1` / préfixe / normalisation / format | inchangés |
| `security.hwid_source` (contrôle readiness) | inchangé depuis MASTER 4 |

L'identité **octet pour octet entre Node et Python** est donc démontrée, ce qui est la propriété qui garantit qu'une licence liée au matériel valide quel que soit l'outil ayant produit le HWID.

## 3. Chaîne de signature ECDSA P-256 — 19 contrôles réels

`scripts/reproduce-keygen-roundtrip.mjs` exerce le **vrai** générateur Python (`scripts/keygen_core.py`, `keygen_trust.py`, `keygen_ui.py`) contre le **vrai** vérificateur TypeScript (`diagnoseToken`), avec une paire de clés **de fixtures générée à l'exécution** dans un dossier temporaire — jamais la clé de production.

```
ok     : true
scope  : FIXTURES_ONLY; no deployed keys/runtime, DB or GUI rendering verified
```

| # | Contrôle | Attendu | Obtenu |
|---:|---|---|---|
| 1 | diagnostic GUI sans interface : clé privée / PEM / PWA / Electron cohérents | 0 | 0 |
| 2 | le diagnostic n'expose aucune clé privée | false | false |
| 3 | générateur garage Python → vérificateur TS (Unicode, DER) | `VERIFIED` | `VERIFIED` |
| 4 | générateur mécanicien Python → vérificateur TS | `VERIFIED` | `VERIFIED` |
| 5 | même jeton, clé publique de vérification différente | `SIGNATURE_INVALID` | `SIGNATURE_INVALID` |
| 6 | charge utile modifiée sans re-signature | `SIGNATURE_INVALID` | `SIGNATURE_INVALID` |
| 7 | format de jeton non reconnu | `FORMAT_INVALID` | `FORMAT_INVALID` |
| 8 | signature correcte mais **expiration** dépassée | `EXPIRED` | `EXPIRED` |
| 9 | signature correcte mais `exp` **absent** | `PAYLOAD_FIELDS_INVALID` | `PAYLOAD_FIELDS_INVALID` |
| 10 | signature correcte mais version non gérée | `VERSION_UNSUPPORTED` | `VERSION_UNSUPPORTED` |
| 11 | **substitution d'algorithme** rejetée AVANT vérification de signature | `HEADER_UNSUPPORTED` | `HEADER_UNSUPPORTED` |
| 12 | ancrage Electron divergent → diagnostic GUI en échec fermé | 1 | 1 |
| 13 | même frontière de chargement de clé bloque l'émission sur divergence | 1 | 1 |
| 14 | **aucun jeton émis** en cas de divergence | false | false |
| 15 | **aucune base de licences écrite** | false | false |
| 16 | PEM cible opérateur discordant non contournable par des ancrages locaux concordants | 1 | 1 |
| 17 | PEM local absent → échec fermé | 1 | 1 |
| 18 | PEM privé chiffré : ne se charge qu'avec la phrase de passe | `KEY_MATCH` | `KEY_MATCH` |
| 19 | **courbe de signature incorrecte** rejetée | `P256_REQUIRED` | `P256_REQUIRED` |

**19/19.** Preuve : `MASTER5_EVIDENCE/logs/17-keygen-roundtrip-ecdsa.txt`.

Les cas exigés par le mandat — licence valide, licence modifiée, signature incorrecte, licence expirée, HWID différent, activation, vérification hors ligne — sont couverts ici (1-19) et par les suites Vitest du module licence (`state-machine`, `verify`, `hwid-verify`, `license-admin-state-machine`, `licence-emission-bornee`, `licence-changement-contrat`, `keygen-api-contract`, `license-crosslang-format`, `devices`, `record-mac`), soit **156 tests dont 150 exécutés** dans le parcours « licence » du rapport métier.

## 4. Suite Python du keygen

```
$ npm run test:keygen        (test_keygen.py + test_keygen_hwid_binding.py
                              + test_keygen_v2.py + test_secret_scan.py)
Ran 39 tests — OK (skipped=0)
```

Le dernier test ignoré de MASTER 4 (`test_ocr_reel_tesseract`, « Tesseract absent ») a été débloqué par l'installation de **Tesseract 5.4.0** : il s'exécute et passe.
Preuve : `MASTER5_EVIDENCE/logs/28-ocr-secret-scan.txt`.

## 5. LIMITE — la clé privée d'émission n'est pas disponible

| Fait | Constat |
|---|---|
| `keys/private.pem` | **absent** de ce poste |
| `GF_PRIVATE_KEY` dans les variables Vercel **Production** | **absente** (16 variables listées, aucune n'est `GF_PRIVATE_KEY`) |
| route `/api/admin/licenses/generate` | dépend de `loadIssuerPrivateKey()` → renverra « Clé privée d'émission introuvable : définissez GF_PRIVATE_KEY (PEM en base64) sur le serveur » |

Conséquences, à arbitrer :

1. **aucune licence ne peut être émise** depuis le serveur de production en l'état ; l'émission doit donc passer par l'outil hors ligne (`scripts/keygen.py`) sur le poste qui détient la clé ;
2. les **90 tests Playwright authentifiés** et les **6 tests Vitest** qui exigent un jeton GF2 réel restent BLOQUÉS (voir `PLAYWRIGHT_FINAL.md`, `VITEST_FINAL.md`) ;
3. le parcours « activation d'une licence de test existante » sur poste Windows ne peut pas être joué.

Ce qui a été refusé : générer une nouvelle paire pour débloquer les tests. La clé publique `b16d2e1b…` est l'autorité que vérifient les clients déjà déployés ; la remplacer invaliderait les licences en circulation. La localisation ou la restauration de la clé privée autorisée est consignée dans `ACTIONS_MANUELLES_RESTANTES.md`.

## 6. Préservation vérifiée des données et des artefacts sensibles

| Élément | État |
|---|---|
| `prisma/dev.db` | non réinitialisée (créée depuis le modèle committé, jamais `--force-reset`) |
| base utilisateur réelle `%APPDATA%\GarageFlow\garageflow.db` | **inchangée** — 1 241 088 octets, SHA-256 `7CAF2ADB…B76E4DCF` identique avant et après les deux démarrages de l'application empaquetée |
| `keys/*.pem` | gitignoré, jamais committé ; `keys/public.pem` matérialisé au build puis embarqué (clé publique, sûre à distribuer) |
| `Setup.exe` et `win-unpacked` | `check:artifact-secrets` : aucune clé privée, aucune valeur de secret (2 885 fichiers + installeur inspectés) |
| ancrages de clé publique | 3/3 alignés, aucun déplacement |
