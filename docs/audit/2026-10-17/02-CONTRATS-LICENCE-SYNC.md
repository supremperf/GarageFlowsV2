# Contrats HTTP — licence et synchronisation

État du code audité le 17 octobre 2026. Ces contrats ne constituent pas une recette production. Les sources de chaque route sont `src/app/api/<chemin>/route.ts`. La matrice de tests `incident-sync-contracts.test.ts` appelle chacun des 13 handlers, sans passer par un serveur réel.

## Règles communes

- `licenseApiBoundary` entoure **tout** le handler, notamment l'authentification qui se trouvait précédemment hors des try/catch.
- Exception Prisma de connexion/initialisation, code P10xx/P2024/P2037 ou `kind: Closed` reconnu : **503**, `{ok:false,code:"DB_UNAVAILABLE",reason,requestId}`, `Retry-After:60`.
- Configuration de session, pepper requis, secret MAC requis ou ancre publique inutilisable : **500**, même enveloppe avec `SERVER_MISCONFIGURED`. Aucun secret, aucune stack ni message d'exception brut retourné/journalisé par cette frontière.
- Exception inconnue : **500 INTERNAL_ERROR**, pas une panne DB présumée, jamais `LICENSE_INVALID`.
- Limiteur : **429 RATE_LIMITED** ou **503 SERVICE_UNAVAILABLE** si backend obligatoire indisponible. `Retry-After` fourni. Ce dernier code désigne le limiteur, pas une décision de licence.
- JSON sync non objet (dont `null` et tableau) : **400 BAD_REQUEST**.
- Refus d'authentification sync : `{ok:false,code}` ; `MISSING_LICENSE` → 400 ; `LICENSE_INVALID`, `LICENSE_TAMPERED`, `NOT_A_GARAGE_LICENSE`, `LICENSE_UNKNOWN`, `LICENSE_REVOKED`, `LICENSE_SUSPENDED`, `LICENSE_EXPIRED`, `GARAGE_MISMATCH` → 403 ; `GARAGE_ALREADY_CLAIMED` et `LICENSE_NOT_BOUND` → 409.
- `LICENSE_TAMPERED` constate l'échec du contrôle MAC sous la configuration courante. Il ne prouve PAS à lui seul une attaque : une clé MAC erronée mais syntaxiquement valide produit aussi un échec. Une clé publique valide mais différente de celle de l'émetteur ne peut pas être distinguée cryptographiquement d'une signature réellement invalide sans attestation externe.

## Décision de compatibilité : ne pas harmoniser aveuglément les HTTP

Le heartbeat est une **consultation d'état** : HTTP 200 signifie « état obtenu », et NON « accès accordé ». Les refus métier restent `allowed:false` en 200. La synchronisation est une **opération protégée** : un refus d'autorisation donne 403. Ce choix explicite préserve les clients existants qui lisent `allowed`/`status`. Les erreurs techniques ne sont jamais des refus métier en 200.

Les tests verrouillent 200 + `allowed:false,status:revoked` sur **check et status**, 403 `LICENSE_INVALID` / `LICENSE_TAMPERED` et 500/503 techniques sur **chaque handler sync**. Ils ne couvrent pas encore toutes les branches de succès métier de chaque action ; les intégrations DB et E2E restent nécessaires.

## Routes licence

| Route / méthode | Entrée et réponse | HTTP et particularités |
|---|---|---|
| `/api/license/activate` POST | `{license,hwid?,installId?,version?,os?,arch?,name?}` ; succès `{ok:true,isAdmin,licenseType,expiryAt,seats?,deviceToken?,deviceId?,redirect?,garageId?,mechanicId?}` + cookies | 200 succès ; refus garage historiques (signature, révocation/suspension/expiration/MAC) en 200 `{ok:false,code,reason}` ; clé mécanicien/siège/HWID refusés 403, entrée/appareil requis 400. L'appelant DOIT exiger HTTP réussi ET `ok===true`. Aucune session sur exception DB/appareil/config, Electron compris. Exemption de siège admin préexistante conservée ; non-admin/mécanicien exigent un appareil. |
| `/api/license/check` POST | `{deviceToken?,licenseId?,hwid?,installId?,platform?,version?}` ; `{allowed,status,reason?,deviceRequired?,code?}` | 200 refus métier (revoked/suspended/expired/tampered/device_revoked/device_hwid_mismatch/device_required), 400 requête invalide, 426 UPGRADE_REQUIRED. Absence de licence/appareil connue peut rester `unknown,deviceRequired:true` selon politique historique. Ce n'est pas une preuve d'accès et ne lève aucun blocage client. |
| `/api/license/status` GET | Cookie signé `gf_session` ; `{allowed,status,reason?,code?}` | 200 état actif/refus métier ; absence de session/JWT invalide/record absent : `allowed:true,status:unknown` de télémétrie, PAS un contrôle d'accès. Secret indisponible → 500 ; DB indisponible → 503 sur les deux plateformes. |
| `/api/license/devices` GET | `gf_session` ; `{ok:true,seats,activeCount,devices}` (pas de hachés d'appareil) | 200 liste ; 401 session manquante/invalide, 404 licence inconnue ; DB/config via frontière. |
| `/api/license/deactivate` POST | `{deviceToken}` ; `{ok:true}` | 200 identique pour jeton inconnu/déjà inactif (pas d'oracle) ; 400 entrée invalide ; aucune fausse réussite Electron sur exception. |
| `/api/license/type` GET | Indicateur `gf_license_type` ; `{licenseType}` | 200 métadonnée UI non fiable par conception, défaut trial. Jamais utilisé comme preuve d'autorisation. |

La clé **privée** n'est pas requise pour vérifier/activer une licence : seule l'ancre **publique** l'est. Introduire une dépendance à GF_PRIVATE_KEY sur ces routes serait une régression et exposerait inutilement le secret émetteur. Le test « clé privée absente → erreur » ne s'applique donc pas aux opérations de vérification ; les opérations d'émission/signature sont un périmètre distinct, non certifié ici.

## Routes sync (toutes POST)

Toutes portent `garageLicense`. Autres entrées et réponses ci-dessous ; refus communs décrits plus haut. Tests de panne d'auth réels au niveau des exports de route pour chaque ligne.

| Route | Entrées principales / résultat HTTP 200 | Autres refus explicites |
|---|---|---|
| `appointments` | mode pull : `{ok:true,appointments}` ; réponse : `{ok:true,status}` | 400 UNKNOWN_MODE/BAD_REQUEST, 404 NOT_FOUND, 409 TRANSITION_REFUSEE |
| `einvoicing` | action : flags, liste/configuration/suppression connexion, test connexion, soumission/poll/historique ; résultats des services conservés | 400 UNKNOWN_ACTION/BAD_REQUEST ; 409 fonctionnalités/connexion désactivées, facture non publiée ou transition interdite ; 404 garage ; erreurs service selon STATUT_ENVOI (dont 502). Auth/DB/config ne sont pas des refus de licence. |
| `invoice` | tableau invoices ; `{ok:true,applied:[],rejected:[]}` ; refus par document dans rejected | 422 TOO_MANY_INVOICES ; rejected : BAD_REQUEST/TOO_MANY_LINES/INVOICE_FOREIGN_GARAGE/INVOICE_NUMBER_TAKEN |
| `job-photo` | garageId,photoId ; `{ok:true,photo}` avec base64 | 404 NOT_FOUND, 409 NO_INLINE_DATA |
| `jobs` | garageId,window,jobs,cursors,deletedIds ; `{ok:true,applied,deleted,deletedApplied,deletedExplicit,executionKept,rejected,changes,syncedAt}` | 413 TOO_MANY_JOBS ; 409 GARAGE_NOT_MIRRORED ; rejected MECHANIC_UNKNOWN |
| `mechanic-assignment` | garage,mechanic,mechanicLicense ; `{ok:true,...}` identité de l'attribution | 403 MECHANIC_LICENSE_INVALID/PARENT_MISMATCH ; 409 conflits transactionnels |
| `mechanic-avatar` | garage,mechanic,image,updatedAt ; avatarUrl ou skipped STALE/ALREADY_EMPTY/UNCHANGED | 409 MECHANIC_NOT_MIRRORED/LICENSE_NOT_BOUND ; 501 PHOTO_STORAGE_DISABLED ; 400 INVALID_IMAGE ; 500 STORAGE_FAILED |
| `mechanic-status` | mechanicLicense,status ; `{ok:true,licenseId,status,syncedAt}` | 403 MECHANIC_LICENSE_INVALID/PARENT_MISMATCH ; 409 MECHANIC_KEY_UNKNOWN/REVOKED_IS_FINAL |
| `portal-account` | account ; `{ok:true,id}` | 409 EMAIL_TAKEN_CLOUD |
| `portal` | garageId,jobId,payload ; `{ok:true,token,path,url,expiresAt}` | 413 PAYLOAD_TOO_LARGE ; 409 GARAGE_ALREADY_CLAIMED |
| `quote-return` | since ; `{ok:true,...}` preuves/signatures et état courant des devis | Refus communs ; DB 503 distincte |
| `quote` | quote,lines ; `{ok:true,...}` publication signable et URL | 409 QUOTE_NOT_SIGNABLE/QUOTE_FOREIGN_GARAGE/QUOTE_NUMBER_TAKEN ; 422 TOO_MANY_LINES |
| `tickets` | pull : `{ok:true,tickets}` ; answer : `{ok:true,status}` | 404 NOT_FOUND ; 400 MESSAGE_REQUIS/UNKNOWN_MODE ; 413 MESSAGE_TROP_LONG ; 409 TICKET_CLOTURE |

Les champs détaillés propres à la facturation électronique sont définis dans les types des services et docs/EINVOICING_*.md ; leur conformité exhaustive n'est pas certifiée par cet audit ciblé.

## Administration retirée

`POST /api/admin/licenses/revoke-by-key` : **404**, `{ok:false,code:"ENDPOINT_DISABLED",requestId}` quelle que soit la présence d'une clé/flag, y compris en développement. **Aucun flag ne la réactive.** Aucun corps lu, aucune DB écrite, aucun no-op en 200 ambigu. Le refus est indépendant de la disponibilité d'un limiteur. Trace : requestId généré serveur, IP selon proxy de confiance, UA borné, acteur `unauthenticated`, timestamp, action et outcome. Hors proxy de confiance, l'IP réelle n'est pas attestable par ce handler ; collecte SIEM non vérifiée.

Le keygen affiche le retrait en cas de 404. L'ancien reset refuse sa validation admin au lieu de certifier un faux succès : une nouvelle recette authentifiée doit être conçue avant toute promotion. La réactivation éventuelle exige une conception approuvée (identité admin forte/MFA, autorisation, limiteur fail-closed, audit transactionnel, résultat changed/noop) ; ne PAS restaurer la clé partagée ni l'ancien contournement Upstash.
