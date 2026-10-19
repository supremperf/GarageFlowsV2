# CodeQL — registre de revue des 17 emplacements initiaux

Numéros GitHub : **indisponibles (API officielle 403)**. Les IDs ci-dessous sont locaux. Les flows complets, fingerprints et limites sont dans `codeql-alert-review.json` ; aucun résultat supprimé/dismissed. Les lignes du tableau sont les emplacements **historiques**, pas les numéros de lignes courants après patch.

| Revue | Fichier:ligne initiale | Règle | Gravité initiale | État de revue (pas état GitHub) |
|---|---|---|---|---|
| P6-CQ-01 | `scripts/materialize-build-public-key.cjs:32` | `js/file-system-race` | high | FIXED_TARGET_DESCRIPTOR_RACE_NOT_DISMISSED |
| P6-CQ-02 | `scripts/config-core.cjs:97` | `js/incomplete-sanitization` | high | NEXT_INJECTION_NOT_REPRODUCED_DESKTOP_COMPATIBILITY_DEFECT_FIXED |
| P6-CQ-03 | `docs/audit/resumption-2026-10-14/run-command.cjs:11` | `js/file-system-race` | high | OPEN_UNACCEPTED_HISTORICAL_LOCAL_TOCTOU |
| P6-CQ-04 | `docs/audit/resumption-2026-10-14/publication-preflight.cjs:8` | `js/file-system-race` | high | OPEN_UNACCEPTED_HISTORICAL_LOCAL_TOCTOU |
| P6-CQ-05 | `docs/audit/resumption-2026-10-14/investigation-2026-10-14/run-command.cjs:11` | `js/file-system-race` | high | OPEN_UNACCEPTED_HISTORICAL_LOCAL_TOCTOU |
| P6-CQ-06 | `docs/audit/resumption-2026-10-14/closure-2026-10-14/run-command.cjs:11` | `js/file-system-race` | high | DISPROVED_EXCLUSIVE_CREATION_NOT_DISMISSED |
| P6-CQ-07 | `docs/audit/followup-2026-10-14/build-review-ledger.cjs:61` | `js/file-system-race` | high | OPEN_UNACCEPTED_HISTORICAL_LOCAL_TOCTOU |
| P6-CQ-08 | `electron/main.js:642` | `js/http-to-file-access` | autre annotation | CONFIRMED_DIAGNOSTIC_DISCLOSURE_FIXED_LOCALLY_FLOW_STILL_REPORTED |
| P6-CQ-09 | `electron/main.js:1565` | `js/file-access-to-http` | autre annotation | PARTIALLY_FIXED_REVOKED_CRASH_CONSENT_INTENDED_TRANSFER |
| P6-CQ-10 | `electron/main.js:2106` | `js/http-to-file-access` | autre annotation | INTENDED_SIGNED_LICENSE_STATE_PERSISTENCE_NOT_FULLY_VALIDATED |
| P6-CQ-11 | `scripts/config-services.cjs:136` | `js/file-access-to-http` | autre annotation | INTENDED_EXPLICIT_AUTHORIZED_VENDOR_CREDENTIAL_TRANSFER |
| P6-CQ-12 | `src/lib/einvoicing/__tests__/formats.test.ts:28` | `js/identity-replacement` | autre annotation | DISPROVED_NON_SECURITY_LITERAL_FIXTURE_NOOP_NOT_DISMISSED |
| P6-CQ-13 | `src/lib/photo-store.ts:89` | `js/http-to-file-access` | autre annotation | OPEN_UNACCEPTED_FILESYSTEM_TRUST_AND_FORMAT_LIMITS |
| P6-CQ-14 | `src/lib/sync/cloud-client.ts:76` | `js/file-access-to-http` | autre annotation | PARTIALLY_FIXED_REDIRECT_DISCLOSURE_INTENDED_AVATAR_SYNC |
| P6-CQ-15 | `src/middleware.ts:95` | `js/log-injection` | autre annotation | FIXED_STATIC_AUTH_DIAGNOSTICS_NOT_DISMISSED |
| P6-CQ-16 | `src/middleware.ts:124` | `js/log-injection` | autre annotation | FIXED_STATIC_AUTH_DIAGNOSTICS_NOT_DISMISSED |
| P6-CQ-17 | `src/middleware.ts:204` | `js/log-injection` | autre annotation | FIXED_STATIC_AUTH_DIAGNOSTICS_NOT_DISMISSED |

Le premier ruleId (`build key`) est une correspondance de famille/titre documentée, car le SARIF historique exact de ce résultat disparu n’a pas été obtenu. Les 16 autres règles sont identifiées dans le SARIF courant/3eb7c5f.

Résultat supplémentaire séparé : `js/biased-cryptographic-random`, `src/lib/portal/backup-codes.ts:29`, security-severity 7.5. Alphabet exact 32 / 256 : huit préimages par symbole ; preuve finie P12/P17/P27. Ni nouveau numéro d’alerte inventé, ni certitude que ce soit une régression GitHub.

**Quatre courses locales historiques restent ouvertes sans acceptation ; photo-store et plusieurs transferts n’ont qu’une validation bornée. Le dossier ne conclut pas à la production.**
