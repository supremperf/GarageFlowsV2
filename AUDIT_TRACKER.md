<!-- doc-status: historique -->
> **⚠️ DOCUMENT HISTORIQUE — instantané daté, ne fait plus foi.**
> Ne pas utiliser comme source de vérité pour un déploiement actuel.
> Source de vérité : **[docs/PRODUCTION-READINESS.md](docs/PRODUCTION-READINESS.md)**.

# AUDIT_TRACKER — GarageFlow V2

Généré le 2026-08-03. Total: 571 fichiers suivis (git ls-files).

Statut: `à faire` / `en cours` / `OK` / `anomalie N°X`. Mis à jour au fil des lots.

## Répartition par type

| Type | Nombre |
|---|---|
| Lib | 165 |
| API route | 125 |
| Test | 73 |
| React composant | 60 |
| Doc | 44 |
| Config | 23 |
| Script | 21 |
| Autre | 16 |
| React page | 13 |
| Electron | 11 |
| Prisma | 11 |
| Binaire/asset | 9 |

## Tableau de suivi

| # | Fichier | Type | Statut | Anomalies liées |
|---|---|---|---|---|
| 1 | `.env.example` | Config | anomalie A44 — CORRIGÉ | — |
| 2 | `.eslintrc.json` | Config | anomalie C1 | — |
| 3 | `.gitattributes` | Config | Config — non audité (git attrs) | — |
| 4 | `.github/workflows/ci.yml` | Config | OK (revue perso) | — |
| 5 | `.gitignore` | Config | Config — vérifié (agent C: couvre .env/keys/pem) | — |
| 6 | `.gitleaks.toml` | Config | anomalie C2 | — |
| 7 | `.vercelignore` | Config | Config — vérifié (agent C) | — |
| 8 | `CHANGELOG.md` | Autre | Doc — non lu intégralement | — |
| 9 | `CONFIGURER-GARAGEFLOW.cmd` | Config | Script — non lu intégralement (wrapper) | — |
| 10 | `README.md` | Autre | Doc — non lu intégralement | — |
| 11 | `docs/AUDIT_FINALISATION_2026-08.md` | Doc | Doc — échantillon vérifié (agent C), non lu intégralement | — |
| 12 | `docs/CATALOG.md` | Doc | Doc — échantillon vérifié (agent C), non lu intégralement | — |
| 13 | `docs/CONFIGURATION.md` | Doc | Doc — échantillon vérifié (agent C), non lu intégralement | — |
| 14 | `docs/CONFIGURATION_ENVIRONNEMENT.md` | Doc | Doc — échantillon vérifié (agent C), non lu intégralement | — |
| 15 | `docs/CONSOLIDATION_REPORT.md` | Doc | Doc — échantillon vérifié (agent C), non lu intégralement | — |
| 16 | `docs/CONTROL_PLANE_CLIENT.md` | Doc | Doc — échantillon vérifié (agent C), non lu intégralement | — |
| 17 | `docs/COPILOT.md` | Doc | Doc — échantillon vérifié (agent C), non lu intégralement | — |
| 18 | `docs/COPILOT_LLM.md` | Doc | Doc — échantillon vérifié (agent C), non lu intégralement | — |
| 19 | `docs/DASHBOARD.md` | Doc | Doc — échantillon vérifié (agent C), non lu intégralement | — |
| 20 | `docs/DATABASE_ARCHITECTURE.md` | Doc | anomalie A45 — CORRIGÉ | — |
| 21 | `docs/DELIVERY_STATUS.md` | Doc | Doc — échantillon vérifié (agent C), non lu intégralement | — |
| 22 | `docs/DIAGNOSTIC.md` | Doc | Doc — échantillon vérifié (agent C), non lu intégralement | — |
| 23 | `docs/ENTERPRISE_AUDIT.md` | Doc | Doc — échantillon vérifié (agent C), non lu intégralement | — |
| 24 | `docs/ENVIRONMENT.md` | Doc | Doc — échantillon vérifié (agent C), non lu intégralement | — |
| 25 | `docs/FORECAST.md` | Doc | Doc — échantillon vérifié (agent C), non lu intégralement | — |
| 26 | `docs/FORGOTTEN_PARTS.md` | Doc | Doc — échantillon vérifié (agent C), non lu intégralement | — |
| 27 | `docs/GAMIFICATION.md` | Doc | Doc — échantillon vérifié (agent C), non lu intégralement | — |
| 28 | `docs/LICENSE_DEVICE_SECURITY.md` | Doc | Doc — échantillon vérifié (agent C), non lu intégralement | — |
| 29 | `docs/MEMORY.md` | Doc | Doc — échantillon vérifié (agent C), non lu intégralement | — |
| 30 | `docs/MIGRATION-MONEY.md` | Doc | Doc — échantillon vérifié (agent C), non lu intégralement | — |
| 31 | `docs/NOTIFICATIONS.md` | Doc | Doc — échantillon vérifié (agent C), non lu intégralement | — |
| 32 | `docs/OCR.md` | Doc | Doc — échantillon vérifié (agent C), non lu intégralement | — |
| 33 | `docs/PRICING.md` | Doc | Doc — échantillon vérifié (agent C), non lu intégralement | — |
| 34 | `docs/PRIVACY-CRASH-REPORTING.md` | Doc | Doc — échantillon vérifié (agent C), non lu intégralement | — |
| 35 | `docs/PROACTIVE.md` | Doc | Doc — échantillon vérifié (agent C), non lu intégralement | — |
| 36 | `docs/PRODUCTION_DEPLOYMENT.md` | Doc | Doc — échantillon vérifié (agent C), non lu intégralement | — |
| 37 | `docs/PROFITABILITY.md` | Doc | Doc — échantillon vérifié (agent C), non lu intégralement | — |
| 38 | `docs/PWA.md` | Doc | Doc — échantillon vérifié (agent C), non lu intégralement | — |
| 39 | `docs/PWA_MULTITENANT_LICENSING.md` | Doc | Doc — échantillon vérifié (agent C), non lu intégralement | — |
| 40 | `docs/QUOTE_GENERATION.md` | Doc | Doc — échantillon vérifié (agent C), non lu intégralement | — |
| 41 | `docs/REINITIALISATION_GARAGEFLOW.md` | Doc | Doc — échantillon vérifié (agent C), non lu intégralement | — |
| 42 | `docs/REPORTS.md` | Doc | Doc — échantillon vérifié (agent C), non lu intégralement | — |
| 43 | `docs/RESPONSIVE.md` | Doc | Doc — échantillon vérifié (agent C), non lu intégralement | — |
| 44 | `docs/RESTAURATION_GARAGEFLOW.md` | Doc | Doc — échantillon vérifié (agent C), non lu intégralement | — |
| 45 | `docs/ROTATION_SECRETS.md` | Doc | Doc — échantillon vérifié (agent C), non lu intégralement | — |
| 46 | `docs/SCHEDULING.md` | Doc | Doc — échantillon vérifié (agent C), non lu intégralement | — |
| 47 | `docs/SECRETS_ROTATION.md` | Doc | Doc — échantillon vérifié (agent C), non lu intégralement | — |
| 48 | `docs/SECURITY-HARDENING.md` | Doc | Doc — échantillon vérifié (agent C), non lu intégralement | — |
| 49 | `docs/SECURITY.md` | Doc | anomalie A46 — CORRIGÉ | — |
| 50 | `docs/SIGNATURE.md` | Doc | Doc — échantillon vérifié (agent C), non lu intégralement | — |
| 51 | `docs/STOCK_FORECAST.md` | Doc | Doc — échantillon vérifié (agent C), non lu intégralement | — |
| 52 | `docs/SUPPLIERS.md` | Doc | Doc — échantillon vérifié (agent C), non lu intégralement | — |
| 53 | `docs/VARIABLES_ENVIRONNEMENT.md` | Doc | Doc — échantillon vérifié (agent C), non lu intégralement | — |
| 54 | `docs/VIN_DECODER.md` | Doc | Doc — échantillon vérifié (agent C), non lu intégralement | — |
| 55 | `e2e/README.md` | Autre | Test e2e — non exécuté ici (rapport §7) | — |
| 56 | `e2e/audit.mjs` | Config | Test e2e — non exécuté ici (rapport §7) | — |
| 57 | `e2e/responsive.spec.ts` | Test | Test — vitest OK (764), non lu ligne à ligne | — |
| 58 | `electron/control-plane.js` | Electron | OK (agent E) | — |
| 59 | `electron/integrity.js` | Electron | anomalie A17 | — |
| 60 | `electron/license.html` | Electron | anomalie A23 | — |
| 61 | `electron/main.js` | Electron | A16 CORRIGÉ; A17,A18 recommandé | — |
| 62 | `electron/preload.js` | Electron | OK (agent E) | — |
| 63 | `electron/secret.js` | Electron | OK (agent E) | — |
| 64 | `electron/secure-key.js` | Electron | OK (agent E) | — |
| 65 | `electron/secure-resources.js` | Electron | OK (agent E) | — |
| 66 | `electron/semver.js` | Electron | OK (agent E) | — |
| 67 | `electron/splash.html` | Electron | anomalie A23 | — |
| 68 | `electron/update-verify.js` | Electron | OK (agent E) — signature MAJ solide | — |
| 69 | `icon.ico` | Binaire/asset | Binaire — référencé, build OK | — |
| 70 | `icon.png` | Binaire/asset | Binaire — référencé, build OK | — |
| 71 | `icon.svg` | Binaire/asset | Binaire — référencé, build OK | — |
| 72 | `next.config.mjs` | Config | OK (agent C) | — |
| 73 | `package-lock.json` | Config | Lockfile — npm ci OK, audit §2 | — |
| 74 | `package.json` | Config | OK (revue perso) | — |
| 75 | `playwright.config.ts` | Config | Config test — non exécuté ici (§7) | — |
| 76 | `postcss.config.js` | Config | Config build — trivial | — |
| 77 | `prisma/garageflow-template.db` | Prisma | Binaire — référencé, build OK | — |
| 78 | `prisma/migrations/20260424000000_add_record_mac/migration.sql` | Prisma | OK (agent C) — vestigial | — |
| 79 | `prisma/migrations/20260425000000_add_audit_log_and_indexes/migration.sql` | Prisma | OK (agent C) — vestigial | — |
| 80 | `prisma/schema.prisma` | Prisma | A43 CORRIGÉ(comment); A47,A48 recommandé | — |
| 81 | `prisma/seed.ts` | Prisma | Seed — non lu intégralement (données démo) | — |
| 82 | `prisma/server/migrations/20260730120000_init_server/migration.sql` | Prisma | OK (agent C) — 37/37 tables | — |
| 83 | `prisma/server/migrations/20260730160000_link_license_garage/migration.sql` | Prisma | OK (agent C) | — |
| 84 | `prisma/server/migrations/20260730180000_premium_modules/migration.sql` | Prisma | OK (agent C) | — |
| 85 | `prisma/server/migrations/20260730200000_enterprise_portal/migration.sql` | Prisma | OK (agent C) | — |
| 86 | `prisma/server/migrations/migration_lock.toml` | Prisma | OK (agent C) | — |
| 87 | `prisma/server/schema.prisma` | Prisma | A43 CORRIGÉ(comment); A47,A48 recommandé | — |
| 88 | `public/icons/apple-touch-icon.png` | Binaire/asset | Binaire — référencé, build OK | — |
| 89 | `public/icons/icon-192.png` | Binaire/asset | Binaire — référencé, build OK | — |
| 90 | `public/icons/icon-512.png` | Binaire/asset | Binaire — référencé, build OK | — |
| 91 | `public/icons/maskable-192.png` | Binaire/asset | Binaire — référencé, build OK | — |
| 92 | `public/icons/maskable-512.png` | Binaire/asset | Binaire — référencé, build OK | — |
| 93 | `public/manifest.webmanifest` | Config | Asset PWA — référencé, build OK | — |
| 94 | `public/offline.html` | Autre | Asset PWA — référencé, build OK | — |
| 95 | `public/site.webmanifest` | Config | Asset PWA — référencé, build OK | — |
| 96 | `public/sw.js` | Autre | Asset PWA — référencé, build OK | — |
| 97 | `scripts/RESET-GARAGEFLOW-V185.cmd` | Script | Script — non lu intégralement (wrapper reset) | — |
| 98 | `scripts/RESET-GARAGEFLOW.cmd` | Script | Script — non lu intégralement (wrapper reset) | — |
| 99 | `scripts/afterPack.js` | Script | anomalie A17 | — |
| 100 | `scripts/audit-ci.js` | Script | OK (revue perso) | — |
| 101 | `scripts/check-version.js` | Script | Script — non lu intégralement (CI SemVer, passe) | — |
| 102 | `scripts/configurer-api-garageflow.ps1` | Script | Script — non lu intégralement (infra PS) | — |
| 103 | `scripts/garageflow-env-manifest.json` | Script | Manifest env — référencé (agent C) | — |
| 104 | `scripts/generate-icons.js` | Script | Script — non lu intégralement (build icônes) | — |
| 105 | `scripts/installer.nsh` | Script | Script — non lu intégralement (NSIS installer) | — |
| 106 | `scripts/keygen.py` | Script | OK (agent E) | — |
| 107 | `scripts/keygen_core.py` | Script | OK (agent E) | — |
| 108 | `scripts/keygen_db.py` | Script | Script — suite keygen (keygen_core.py revu agent E) | — |
| 109 | `scripts/keygen_ui.py` | Script | Script — suite keygen (keygen_core.py revu agent E) | — |
| 110 | `scripts/post-build.js` | Script | Script — non lu intégralement (build electron) | — |
| 111 | `scripts/protect-resources.js` | Script | OK (agent E) | — |
| 112 | `scripts/reset-garageflow-v185.ps1` | Script | OK (agent E) | — |
| 113 | `scripts/reset-garageflow.ps1` | Script | OK (agent E) | — |
| 114 | `scripts/restore.js` | Script | anomalie A22 | — |
| 115 | `scripts/secrets.js` | Script | OK (agent E) | — |
| 116 | `scripts/setup-dev.js` | Script | Script — non lu intégralement (postinstall dev) | — |
| 117 | `scripts/validate-server-db.js` | Script | OK (revue perso) | — |
| 118 | `src/__tests__/middleware.test.ts` | Test | Test — vitest OK (764), non lu ligne à ligne | — |
| 119 | `src/app/admin/licenses/page.tsx` | React page | OK (agent R) | — |
| 120 | `src/app/api/admin/backups/[id]/download/route.ts` | API route | anomalie A2 | — |
| 121 | `src/app/api/admin/backups/[id]/restore/route.ts` | API route | anomalie A2 | — |
| 122 | `src/app/api/admin/backups/[id]/verify/route.ts` | API route | anomalie A2 | — |
| 123 | `src/app/api/admin/backups/route.ts` | API route | anomalie A2 | — |
| 124 | `src/app/api/admin/licenses/[id]/devices/[deviceId]/route.ts` | API route | OK (agent B) | — |
| 125 | `src/app/api/admin/licenses/[id]/devices/route.ts` | API route | OK (agent B) | — |
| 126 | `src/app/api/admin/licenses/[id]/route.ts` | API route | OK (agent B) | — |
| 127 | `src/app/api/admin/licenses/generate/route.ts` | API route | OK (agent B) | — |
| 128 | `src/app/api/admin/licenses/revoke-by-key/route.ts` | API route | OK (agent B) | — |
| 129 | `src/app/api/admin/licenses/route.ts` | API route | OK (agent B) | — |
| 130 | `src/app/api/admin/monitoring/route.ts` | API route | anomalie A1 | — |
| 131 | `src/app/api/admin/updates/file/[name]/route.ts` | API route | OK (agent B) | — |
| 132 | `src/app/api/admin/updates/route.ts` | API route | OK (agent B) | — |
| 133 | `src/app/api/analytics/health/route.ts` | API route | OK (agent 7) | — |
| 134 | `src/app/api/appointments/[id]/route.ts` | API route | OK (agent A) | — |
| 135 | `src/app/api/appointments/route.ts` | API route | OK (agent A) | — |
| 136 | `src/app/api/auth/[...nextauth]/route.ts` | API route | anomalie A3 | — |
| 137 | `src/app/api/catalog/route.ts` | API route | OK (agent A) | — |
| 138 | `src/app/api/clients/route.ts` | API route | OK (agent A) | — |
| 139 | `src/app/api/copilot/report/route.ts` | API route | OK (agent 7) | — |
| 140 | `src/app/api/copilot/reports/[id]/export/route.ts` | API route | A52 — CORRIGÉ (sink report-export) | — |
| 141 | `src/app/api/copilot/reports/route.ts` | API route | OK (agent 7) | — |
| 142 | `src/app/api/copilot/route.ts` | API route | OK (agent 7) | — |
| 143 | `src/app/api/dashboard/route.ts` | API route | OK (agent 7) | — |
| 144 | `src/app/api/diagnostic/route.ts` | API route | OK (agent 7) | — |
| 145 | `src/app/api/email/route.ts` | API route | anomalie A54,A43 | — |
| 146 | `src/app/api/estimate/route.ts` | API route | anomalie A10 — CORRIGÉ | — |
| 147 | `src/app/api/export/fec/route.ts` | API route | anomalie A28 | — |
| 148 | `src/app/api/finance/route.ts` | API route | anomalie A27 | — |
| 149 | `src/app/api/forecast/route.ts` | API route | OK (agent 7) | — |
| 150 | `src/app/api/forgotten-parts/route.ts` | API route | OK (agent 7) | — |
| 151 | `src/app/api/gamification/route.ts` | API route | OK (agent 7) | — |
| 152 | `src/app/api/garages/route.ts` | API route | anomalie A11 — CORRIGÉ | — |
| 153 | `src/app/api/health/route.ts` | API route | OK (agent 7) | — |
| 154 | `src/app/api/inspections/[id]/route.ts` | API route | OK (agent A) | — |
| 155 | `src/app/api/inspections/route.ts` | API route | OK (agent A) | — |
| 156 | `src/app/api/internal/export/route.ts` | API route | OK (agent B) | — |
| 157 | `src/app/api/internal/migrate/route.ts` | API route | OK (agent B) | — |
| 158 | `src/app/api/invoices/[id]/route.ts` | API route | OK (agent A) | — |
| 159 | `src/app/api/invoices/route.ts` | API route | OK (agent A) | — |
| 160 | `src/app/api/jobs/[id]/parts/route.ts` | API route | OK (agent A) | — |
| 161 | `src/app/api/jobs/[id]/photos/route.ts` | API route | OK (agent A) | — |
| 162 | `src/app/api/jobs/[id]/route.ts` | API route | anomalie A9 — CORRIGÉ | — |
| 163 | `src/app/api/jobs/[id]/timer/route.ts` | API route | OK (agent A) | — |
| 164 | `src/app/api/jobs/route.ts` | API route | OK (agent A) | — |
| 165 | `src/app/api/labor-operations/[id]/route.ts` | API route | OK (agent A) | — |
| 166 | `src/app/api/labor-operations/bulk-import/route.ts` | API route | anomalie A13 | — |
| 167 | `src/app/api/labor-operations/route.ts` | API route | OK (agent A) | — |
| 168 | `src/app/api/license/activate/route.ts` | API route | OK (agent B) | — |
| 169 | `src/app/api/license/check/route.ts` | API route | OK (agent B) | — |
| 170 | `src/app/api/license/deactivate/route.ts` | API route | OK (agent B) | — |
| 171 | `src/app/api/license/devices/route.ts` | API route | OK (agent B) | — |
| 172 | `src/app/api/license/status/route.ts` | API route | OK (agent B) | — |
| 173 | `src/app/api/license/type/route.ts` | API route | OK (agent B) | — |
| 174 | `src/app/api/loaner-reservations/[id]/route.ts` | API route | OK (agent A) | — |
| 175 | `src/app/api/loaner-reservations/route.ts` | API route | OK (agent A) | — |
| 176 | `src/app/api/loaner-vehicles/[id]/route.ts` | API route | OK (agent A) | — |
| 177 | `src/app/api/loaner-vehicles/route.ts` | API route | OK (agent A) | — |
| 178 | `src/app/api/mechanics/[id]/route.ts` | API route | OK (agent A) | — |
| 179 | `src/app/api/mechanics/route.ts` | API route | OK (agent A) | — |
| 180 | `src/app/api/memory/route.ts` | API route | OK (agent 7) | — |
| 181 | `src/app/api/notifications/dispatch/route.ts` | API route | anomalie A53 | — |
| 182 | `src/app/api/ocr/route.ts` | API route | OK (agent 7) | — |
| 183 | `src/app/api/parts/[id]/route.ts` | API route | anomalie A12 | — |
| 184 | `src/app/api/parts/low-stock/route.ts` | API route | OK (agent A) | — |
| 185 | `src/app/api/parts/route.ts` | API route | anomalie A12 | — |
| 186 | `src/app/api/photos/[...path]/route.ts` | API route | OK (agent 7) | — |
| 187 | `src/app/api/ping/route.ts` | API route | OK (agent 7) | — |
| 188 | `src/app/api/plate-lookup/route.ts` | API route | A51 — CORRIGÉ | — |
| 189 | `src/app/api/plate-ocr/route.ts` | API route | OK (agent 7) | — |
| 190 | `src/app/api/portal/[token]/route.ts` | API route | OK (agent B) | — |
| 191 | `src/app/api/portal/appointments/[id]/route.ts` | API route | OK (agent B) | — |
| 192 | `src/app/api/portal/appointments/route.ts` | API route | anomalie A5 — CORRIGÉ | — |
| 193 | `src/app/api/portal/auth/2fa/disable/route.ts` | API route | OK (agent B) | — |
| 194 | `src/app/api/portal/auth/2fa/enable/route.ts` | API route | OK (agent B) | — |
| 195 | `src/app/api/portal/auth/2fa/setup/route.ts` | API route | OK (agent B) | — |
| 196 | `src/app/api/portal/auth/2fa/verify/route.ts` | API route | OK (agent B) | — |
| 197 | `src/app/api/portal/auth/devices/route.ts` | API route | OK (agent B) | — |
| 198 | `src/app/api/portal/auth/login/route.ts` | API route | OK (agent B) | — |
| 199 | `src/app/api/portal/auth/logout/route.ts` | API route | OK (agent B) | — |
| 200 | `src/app/api/portal/auth/me/route.ts` | API route | OK (agent B) | — |
| 201 | `src/app/api/portal/auth/register/route.ts` | API route | anomalie A4 | — |
| 202 | `src/app/api/portal/auth/verify-email/route.ts` | API route | OK (agent B) | — |
| 203 | `src/app/api/portal/generate/route.ts` | API route | OK (agent B) | — |
| 204 | `src/app/api/portal/me/dashboard/route.ts` | API route | OK (agent B) | — |
| 205 | `src/app/api/portal/quote/[token]/route.ts` | API route | OK (agent B) | — |
| 206 | `src/app/api/portal/tickets/[id]/close/route.ts` | API route | OK (agent B) | — |
| 207 | `src/app/api/portal/tickets/[id]/route.ts` | API route | OK (agent B) | — |
| 208 | `src/app/api/portal/tickets/route.ts` | API route | anomalie A5 — CORRIGÉ | — |
| 209 | `src/app/api/portal/token/route.ts` | API route | OK (agent B) | — |
| 210 | `src/app/api/pricing/route.ts` | API route | OK (agent 7) | — |
| 211 | `src/app/api/proactive/route.ts` | API route | OK (agent 7) | — |
| 212 | `src/app/api/profitability/route.ts` | API route | OK (agent 7) | — |
| 213 | `src/app/api/purchase-orders/[id]/receive/route.ts` | API route | OK (agent A) | — |
| 214 | `src/app/api/purchase-orders/[id]/route.ts` | API route | OK (agent A) | — |
| 215 | `src/app/api/purchase-orders/route.ts` | API route | OK (agent A) | — |
| 216 | `src/app/api/quotes/[id]/convert/route.ts` | API route | OK (agent A) | — |
| 217 | `src/app/api/quotes/[id]/route.ts` | API route | OK (agent A) | — |
| 218 | `src/app/api/quotes/[id]/signature-token/route.ts` | API route | OK (agent A) | — |
| 219 | `src/app/api/quotes/generate/route.ts` | API route | OK (agent A) | — |
| 220 | `src/app/api/quotes/route.ts` | API route | OK (agent A) | — |
| 221 | `src/app/api/reminders/route.ts` | API route | OK (agent A) | — |
| 222 | `src/app/api/reminders/send/route.ts` | API route | OK (agent A) | — |
| 223 | `src/app/api/reminders/suggestions/route.ts` | API route | OK (agent A) | — |
| 224 | `src/app/api/reports/route.ts` | API route | A50 — CORRIGÉ (sink csv.ts) | — |
| 225 | `src/app/api/scheduling/route.ts` | API route | OK (agent 7) | — |
| 226 | `src/app/api/signatures/route.ts` | API route | OK (agent A) | — |
| 227 | `src/app/api/stats/route.ts` | API route | anomalie A30 | — |
| 228 | `src/app/api/stock-forecast/route.ts` | API route | OK (agent M) | — |
| 229 | `src/app/api/suggestions/route.ts` | API route | OK (agent 7) | — |
| 230 | `src/app/api/suppliers/route.ts` | API route | OK (agent A) | — |
| 231 | `src/app/api/tickets/[id]/route.ts` | API route | OK (agent A) | — |
| 232 | `src/app/api/tickets/route.ts` | API route | OK (agent A) | — |
| 233 | `src/app/api/users/route.ts` | API route | anomalie A15 | — |
| 234 | `src/app/api/vehicles/[id]/route.ts` | API route | anomalie A8 — CORRIGÉ | — |
| 235 | `src/app/api/vehicles/[id]/timeline/route.ts` | API route | OK (agent A) | — |
| 236 | `src/app/api/vehicles/ct-alerts/route.ts` | API route | OK (agent A) | — |
| 237 | `src/app/api/vehicles/route.ts` | API route | OK (agent A) | — |
| 238 | `src/app/api/vin/route.ts` | API route | OK (agent 7) | — |
| 239 | `src/app/api/warranties/[id]/route.ts` | API route | OK (agent A) | — |
| 240 | `src/app/api/warranties/alerts/route.ts` | API route | OK (agent A) | — |
| 241 | `src/app/api/warranties/route.ts` | API route | OK (agent A) | — |
| 242 | `src/app/api/work-orders/[id]/route.ts` | API route | OK (agent A) | — |
| 243 | `src/app/api/work-orders/[id]/sign/route.ts` | API route | OK (agent A) | — |
| 244 | `src/app/api/work-orders/route.ts` | API route | OK (agent A) | — |
| 245 | `src/app/copilot/page.tsx` | React page | OK (agent R) | — |
| 246 | `src/app/favicon.ico` | Binaire/asset | Binaire — référencé, build OK | — |
| 247 | `src/app/globals.css` | Autre | Style CSS — non audité (pas de logique) | — |
| 248 | `src/app/layout.tsx` | React page | OK (agent R) | — |
| 249 | `src/app/license/page.tsx` | React page | OK (agent R) | — |
| 250 | `src/app/login/page.tsx` | React page | OK (agent R) | — |
| 251 | `src/app/monitoring/page.tsx` | React page | OK (agent R) | — |
| 252 | `src/app/page.tsx` | React page | OK (agent R) — orchestrateur | — |
| 253 | `src/app/portal/[token]/page.tsx` | React page | OK (agent R) | — |
| 254 | `src/app/portal/account/page.tsx` | React page | OK (agent R) | — |
| 255 | `src/app/portal/login/page.tsx` | React page | OK (agent R) | — |
| 256 | `src/app/portal/quote/[token]/page.tsx` | React page | OK (agent R) | — |
| 257 | `src/app/portal/register/page.tsx` | React page | OK (agent R) | — |
| 258 | `src/app/providers.tsx` | Autre | OK (agent R) | — |
| 259 | `src/app/register/page.tsx` | React page | OK (agent R) | — |
| 260 | `src/components/BillingPanel.tsx` | React composant | OK (agent R) | — |
| 261 | `src/components/CatalogPanel.tsx` | React composant | OK (agent R) | — |
| 262 | `src/components/CompanySetup.tsx` | React composant | OK (agent R) | — |
| 263 | `src/components/CopilotPanel.tsx` | React composant | OK (agent R) | — |
| 264 | `src/components/CrashConsentModal.tsx` | React composant | OK (agent R) | — |
| 265 | `src/components/Dashboard.tsx` | React composant | OK (agent R) | — |
| 266 | `src/components/DateField.tsx` | React composant | OK (agent R) | — |
| 267 | `src/components/FinancialDashboard.tsx` | React composant | anomalie A41 | — |
| 268 | `src/components/GarageFlowLogo.tsx` | React composant | OK (agent R) | — |
| 269 | `src/components/GfDrawer.tsx` | React composant | OK (agent R) | — |
| 270 | `src/components/Header.tsx` | React composant | anomalie A38 | — |
| 271 | `src/components/InspectionModal.tsx` | React composant | anomalie A35 | — |
| 272 | `src/components/InvoiceModal.tsx` | React composant | OK (agent R) | — |
| 273 | `src/components/JobCard.tsx` | React composant | OK (agent R) | — |
| 274 | `src/components/JobModal.tsx` | React composant | anomalie A33,A40 | — |
| 275 | `src/components/JobPhotos.tsx` | React composant | anomalie A38,A39 | — |
| 276 | `src/components/JobQRCode.tsx` | React composant | OK (agent R) | — |
| 277 | `src/components/LaborCatalogPanel.tsx` | React composant | OK (agent R) | — |
| 278 | `src/components/LanguageSelector.tsx` | React composant | OK (agent R) | — |
| 279 | `src/components/LicenseChangeModal.tsx` | React composant | OK (agent R) | — |
| 280 | `src/components/LicenseRevokedOverlay.tsx` | React composant | OK (agent R) | — |
| 281 | `src/components/LoanerPanel.tsx` | React composant | A34 CORRIGÉ; A42 recommandé | — |
| 282 | `src/components/MobileNav.tsx` | React composant | OK (agent R) | — |
| 283 | `src/components/NotificationCenter.tsx` | React composant | anomalie A40 | — |
| 284 | `src/components/OcrPanel.tsx` | React composant | OK (agent R) | — |
| 285 | `src/components/PwaRegister.tsx` | React composant | anomalie A40 | — |
| 286 | `src/components/QuoteInvoiceModal.tsx` | React composant | anomalie A36,A38 | — |
| 287 | `src/components/ReceptionBoard.tsx` | React composant | anomalie A38,A41 | — |
| 288 | `src/components/ReminderPanel.tsx` | React composant | anomalie A38,A39 | — |
| 289 | `src/components/ScheduleBoard.tsx` | React composant | OK (agent R) | — |
| 290 | `src/components/SettingsModal.tsx` | React composant | OK (agent R) | — |
| 291 | `src/components/StockPanel.tsx` | React composant | anomalie A38,A39 | — |
| 292 | `src/components/SuggestionPanel.tsx` | React composant | anomalie A41 | — |
| 293 | `src/components/SuppliersPanel.tsx` | React composant | OK (agent R) | — |
| 294 | `src/components/UpdateModal.tsx` | React composant | OK (agent R) | — |
| 295 | `src/components/VehicleHistoryModal.tsx` | React composant | OK (agent R) | — |
| 296 | `src/components/VehicleModal.tsx` | React composant | anomalie A38 | — |
| 297 | `src/components/WarrantyPanel.tsx` | React composant | OK (agent R) | — |
| 298 | `src/components/WeekView.tsx` | React composant | OK (agent R) | — |
| 299 | `src/components/WindowControls.tsx` | React composant | OK (agent R) | — |
| 300 | `src/components/WorkOrderModal.tsx` | React composant | anomalie A37 | — |
| 301 | `src/components/brand/logo-mark.png` | React composant | OK (agent R) | — |
| 302 | `src/components/dashboard/DashboardCharts.tsx` | React composant | OK (agent R) | — |
| 303 | `src/components/dashboard/DashboardSections.tsx` | React composant | anomalie A41 | — |
| 304 | `src/components/dashboard/DecisionSection.tsx` | React composant | OK (agent R) | — |
| 305 | `src/components/job-modal/AIEstimationCard.tsx` | React composant | OK (agent R) | — |
| 306 | `src/components/job-modal/JobDefaultPartsSuggestion.tsx` | React composant | OK (agent R) | — |
| 307 | `src/components/job-modal/JobModalFooter.tsx` | React composant | OK (agent R) | — |
| 308 | `src/components/job-modal/JobScheduleSection.tsx` | React composant | OK (agent R) | — |
| 309 | `src/components/job-modal/PlateSearchField.tsx` | React composant | OK (agent R) | — |
| 310 | `src/components/job-modal/VehicleAutocompleteField.tsx` | React composant | OK (agent R) | — |
| 311 | `src/components/job-modal/VehicleHistoryCard.tsx` | React composant | OK (agent R) | — |
| 312 | `src/components/settings/CompanyTab.tsx` | React composant | OK (agent R) | — |
| 313 | `src/components/settings/EmailTab.tsx` | React composant | OK (agent R) | — |
| 314 | `src/components/settings/FeaturesTab.tsx` | React composant | OK (agent R) | — |
| 315 | `src/components/settings/LanguageTab.tsx` | React composant | OK (agent R) | — |
| 316 | `src/components/settings/MechanicsTab.tsx` | React composant | OK (agent R) | — |
| 317 | `src/components/settings/ThemeTab.tsx` | React composant | OK (agent R) | — |
| 318 | `src/components/settings/UpdatesTab.tsx` | React composant | OK (agent R) | — |
| 319 | `src/components/settings/types.ts` | React composant | OK (agent R) | — |
| 320 | `src/config/app.ts` | Config | OK (revue perso) — note A49 | — |
| 321 | `src/config/database.ts` | Config | OK (revue perso) | — |
| 322 | `src/config/license.ts` | Config | anomalie A20 — CORRIGÉ | — |
| 323 | `src/hooks/useKeyboardShortcuts.ts` | Autre | anomalie A40 | — |
| 324 | `src/hooks/useMediaQuery.ts` | Autre | OK (agent R) | — |
| 325 | `src/hooks/useWorkOrders.ts` | Autre | OK (agent R) | — |
| 326 | `src/instrumentation.ts` | Autre | OK (revue perso) | — |
| 327 | `src/integration/catalog.test.ts` | Test | Test — vitest OK (764), non lu ligne à ligne | — |
| 328 | `src/integration/copilot.test.ts` | Test | Test — vitest OK (764), non lu ligne à ligne | — |
| 329 | `src/integration/dashboard.test.ts` | Test | Test — vitest OK (764), non lu ligne à ligne | — |
| 330 | `src/integration/ocr.test.ts` | Test | Test — vitest OK (764), non lu ligne à ligne | — |
| 331 | `src/integration/quotes-generate.test.ts` | Test | Test — vitest OK (764), non lu ligne à ligne | — |
| 332 | `src/integration/suppliers.test.ts` | Test | Test — vitest OK (764), non lu ligne à ligne | — |
| 333 | `src/lib/__tests__/auth-authorize.test.ts` | Test | Test — vitest OK (764), non lu ligne à ligne | — |
| 334 | `src/lib/__tests__/auth-secret.test.ts` | Test | Test — vitest OK (764), non lu ligne à ligne | — |
| 335 | `src/lib/__tests__/business-logic.test.ts` | Test | Test — vitest OK (764), non lu ligne à ligne | — |
| 336 | `src/lib/__tests__/check-route-policy.test.ts` | Test | Test — vitest OK (764), non lu ligne à ligne | — |
| 337 | `src/lib/__tests__/client-policy.test.ts` | Test | Test — vitest OK (764), non lu ligne à ligne | — |
| 338 | `src/lib/__tests__/control-plane.test.ts` | Test | Test — vitest OK (764), non lu ligne à ligne | — |
| 339 | `src/lib/__tests__/crash-redaction.test.ts` | Test | Test — vitest OK (764), non lu ligne à ligne | — |
| 340 | `src/lib/__tests__/document-numbering.test.ts` | Test | Test — vitest OK (764), non lu ligne à ligne | — |
| 341 | `src/lib/__tests__/electron-loopback.test.ts` | Test | Test — vitest OK (764), non lu ligne à ligne | — |
| 342 | `src/lib/__tests__/electron-secret.test.ts` | Test | Test — vitest OK (764), non lu ligne à ligne | — |
| 343 | `src/lib/__tests__/env.test.ts` | Test | Test — vitest OK (764), non lu ligne à ligne | — |
| 344 | `src/lib/__tests__/hwid-verify.test.ts` | Test | Test — vitest OK (764), non lu ligne à ligne | — |
| 345 | `src/lib/__tests__/license-activate.test.ts` | Test | Test — vitest OK (764), non lu ligne à ligne | — |
| 346 | `src/lib/__tests__/license-devices-unit.test.ts` | Test | Test — vitest OK (764), non lu ligne à ligne | — |
| 347 | `src/lib/__tests__/license-devices.postgres.int.test.ts` | Test | Test — vitest OK (764), non lu ligne à ligne | — |
| 348 | `src/lib/__tests__/licensed-session.postgres.int.test.ts` | Test | Test — vitest OK (764), non lu ligne à ligne | — |
| 349 | `src/lib/__tests__/licensed-session.test.ts` | Test | Test — vitest OK (764), non lu ligne à ligne | — |
| 350 | `src/lib/__tests__/migrations-unique-index.test.ts` | Test | Test — vitest OK (764), non lu ligne à ligne | — |
| 351 | `src/lib/__tests__/money-document-consistency.test.ts` | Test | Test — vitest OK (764), non lu ligne à ligne | — |
| 352 | `src/lib/__tests__/money.test.ts` | Test | OK — tests A24/A25/A26 ajoutés | — |
| 353 | `src/lib/__tests__/pwa.test.ts` | Test | Test — vitest OK (764), non lu ligne à ligne | — |
| 354 | `src/lib/__tests__/rate-limit-multi-instance.int.test.ts` | Test | Test — vitest OK (764), non lu ligne à ligne | — |
| 355 | `src/lib/__tests__/redact.test.ts` | Test | Test — vitest OK (764), non lu ligne à ligne | — |
| 356 | `src/lib/__tests__/require-session-enforcement.test.ts` | Test | Test — vitest OK (764), non lu ligne à ligne | — |
| 357 | `src/lib/__tests__/revoke-by-key-route.test.ts` | Test | Test — vitest OK (764), non lu ligne à ligne | — |
| 358 | `src/lib/__tests__/secrets.test.ts` | Test | Test — vitest OK (764), non lu ligne à ligne | — |
| 359 | `src/lib/__tests__/security-rate-limit.test.ts` | Test | Test — vitest OK (764), non lu ligne à ligne | — |
| 360 | `src/lib/__tests__/stock-parts.test.ts` | Test | Test — vitest OK (764), non lu ligne à ligne | — |
| 361 | `src/lib/__tests__/tenant-guard.test.ts` | Test | Test — vitest OK (764), non lu ligne à ligne | — |
| 362 | `src/lib/__tests__/tenant-isolation.test.ts` | Test | Test — vitest OK (764), non lu ligne à ligne | — |
| 363 | `src/lib/__tests__/tva.test.ts` | Test | Test — vitest OK (764), non lu ligne à ligne | — |
| 364 | `src/lib/__tests__/update-verify.test.ts` | Test | Test — vitest OK (764), non lu ligne à ligne | — |
| 365 | `src/lib/__tests__/utils.test.ts` | Test | Test — vitest OK (764), non lu ligne à ligne | — |
| 366 | `src/lib/__tests__/verify.test.ts` | Test | Test — vitest OK (764), non lu ligne à ligne | — |
| 367 | `src/lib/ai-engine.ts` | Lib | OK (agent 8) | — |
| 368 | `src/lib/analytics/__tests__/analytics.test.ts` | Test | Test — vitest OK (764), non lu ligne à ligne | — |
| 369 | `src/lib/analytics/__tests__/report-export.test.ts` | Test | Test — vitest OK (764), non lu ligne à ligne | — |
| 370 | `src/lib/analytics/collect.ts` | Lib | OK (agent 8) | — |
| 371 | `src/lib/analytics/health-score.ts` | Lib | OK (agent M) | — |
| 372 | `src/lib/analytics/insights.ts` | Lib | OK (agent 8) | — |
| 373 | `src/lib/analytics/metrics.ts` | Lib | OK (agent M) | — |
| 374 | `src/lib/analytics/report-export.ts` | Lib | A52 CORRIGE | — |
| 375 | `src/lib/analytics/types.ts` | Lib | OK (agent 8) | — |
| 376 | `src/lib/api-helpers.ts` | Lib | OK (revue perso) | — |
| 377 | `src/lib/audit.ts` | Lib | anomalie A60 | — |
| 378 | `src/lib/auth-secret.ts` | Lib | OK (agent 8) | — |
| 379 | `src/lib/auth.ts` | Lib | OK (agent 8) | — |
| 380 | `src/lib/backup/__tests__/crypto.test.ts` | Test | Test — vitest OK (764), non lu ligne à ligne | — |
| 381 | `src/lib/backup/__tests__/snapshot.test.ts` | Test | Test — vitest OK (764), non lu ligne à ligne | — |
| 382 | `src/lib/backup/crypto.ts` | Lib | OK (agent 7) | — |
| 383 | `src/lib/backup/service.ts` | Lib | OK (agent 7) | — |
| 384 | `src/lib/backup/snapshot.ts` | Lib | OK (agent 7) | — |
| 385 | `src/lib/billing.ts` | Lib | OK (agent M) | — |
| 386 | `src/lib/car-database.ts` | Lib | OK (agent 8) | — |
| 387 | `src/lib/catalog/__tests__/catalog.test.ts` | Test | Test — vitest OK (764), non lu ligne à ligne | — |
| 388 | `src/lib/catalog/categories.ts` | Lib | OK (agent 8) | — |
| 389 | `src/lib/catalog/crossref.ts` | Lib | OK (agent 8) | — |
| 390 | `src/lib/catalog/engine.ts` | Lib | OK (agent 8) | — |
| 391 | `src/lib/catalog/fitment.ts` | Lib | OK (agent 8) | — |
| 392 | `src/lib/catalog/index.ts` | Lib | OK (agent 8) | — |
| 393 | `src/lib/catalog/normalize.ts` | Lib | OK (agent 8) | — |
| 394 | `src/lib/catalog/providers.ts` | Lib | OK (agent 8) | — |
| 395 | `src/lib/catalog/search.ts` | Lib | OK (agent 8) | — |
| 396 | `src/lib/catalog/seed.ts` | Lib | OK (agent 8) | — |
| 397 | `src/lib/catalog/types.ts` | Lib | OK (agent 8) | — |
| 398 | `src/lib/client-memory.ts` | Lib | OK (agent 7) | — |
| 399 | `src/lib/copilot-llm/__tests__/copilot-llm.test.ts` | Test | Test — vitest OK (764), non lu ligne à ligne | — |
| 400 | `src/lib/copilot-llm/classify.ts` | Lib | OK (agent 7) | — |
| 401 | `src/lib/copilot-llm/ground.ts` | Lib | OK (agent 7) | — |
| 402 | `src/lib/copilot-llm/index.ts` | Lib | OK (agent 7) | — |
| 403 | `src/lib/copilot-llm/phrase.ts` | Lib | OK (agent 7) | — |
| 404 | `src/lib/copilot-llm/prompts.ts` | Lib | OK (agent 7) | — |
| 405 | `src/lib/copilot-llm/provider.ts` | Lib | OK (agent 7) | — |
| 406 | `src/lib/copilot-llm/timeout.ts` | Lib | OK (agent 7) | — |
| 407 | `src/lib/copilot-llm/types.ts` | Lib | OK (agent 7) | — |
| 408 | `src/lib/copilot/__tests__/copilot.test.ts` | Test | Test — vitest OK (764), non lu ligne à ligne | — |
| 409 | `src/lib/copilot/actions.ts` | Lib | OK (agent 7) | — |
| 410 | `src/lib/copilot/engine.ts` | Lib | OK (agent 7) | — |
| 411 | `src/lib/copilot/index.ts` | Lib | OK (agent 7) | — |
| 412 | `src/lib/copilot/intents.ts` | Lib | OK (agent 7) | — |
| 413 | `src/lib/copilot/router.ts` | Lib | OK (agent 7) | — |
| 414 | `src/lib/copilot/types.ts` | Lib | OK (agent 7) | — |
| 415 | `src/lib/dashboard/__tests__/dashboard.test.ts` | Test | Test — vitest OK (764), non lu ligne à ligne | — |
| 416 | `src/lib/dashboard/build.ts` | Lib | OK (agent 8) | — |
| 417 | `src/lib/dashboard/index.ts` | Lib | OK (agent 8) | — |
| 418 | `src/lib/dashboard/types.ts` | Lib | OK (agent 8) | — |
| 419 | `src/lib/db.ts` | Lib | OK (agent 8) | — |
| 420 | `src/lib/diagnostic/__tests__/diagnostic.test.ts` | Test | Test — vitest OK (764), non lu ligne à ligne | — |
| 421 | `src/lib/diagnostic/engine.ts` | Lib | OK (agent 7) | — |
| 422 | `src/lib/diagnostic/index.ts` | Lib | OK (agent 7) | — |
| 423 | `src/lib/diagnostic/knowledge.ts` | Lib | OK (agent 7) | — |
| 424 | `src/lib/diagnostic/obd.ts` | Lib | OK (agent 7) | — |
| 425 | `src/lib/diagnostic/types.ts` | Lib | OK (agent 7) | — |
| 426 | `src/lib/entitlements.tsx` | Lib | OK (agent 8) | — |
| 427 | `src/lib/env.ts` | Lib | OK (agent C) | — |
| 428 | `src/lib/forecast/__tests__/forecast.test.ts` | Test | Test — vitest OK (764), non lu ligne à ligne | — |
| 429 | `src/lib/forecast/forecast.ts` | Lib | OK (agent M) | — |
| 430 | `src/lib/forecast/index.ts` | Lib | OK (agent 8) | — |
| 431 | `src/lib/forecast/stats.ts` | Lib | OK (agent M) | — |
| 432 | `src/lib/forecast/types.ts` | Lib | OK (agent 8) | — |
| 433 | `src/lib/forgotten-parts/__tests__/forgotten-parts.test.ts` | Test | Test — vitest OK (764), non lu ligne à ligne | — |
| 434 | `src/lib/forgotten-parts/engine.ts` | Lib | OK (agent 8) | — |
| 435 | `src/lib/forgotten-parts/index.ts` | Lib | OK (agent 8) | — |
| 436 | `src/lib/forgotten-parts/rules.ts` | Lib | OK (agent 8) | — |
| 437 | `src/lib/forgotten-parts/types.ts` | Lib | OK (agent 8) | — |
| 438 | `src/lib/gamification/__tests__/gamification.test.ts` | Test | Test — vitest OK (764), non lu ligne à ligne | — |
| 439 | `src/lib/gamification/badges.ts` | Lib | OK (agent 8) | — |
| 440 | `src/lib/gamification/engine.ts` | Lib | OK (agent 8) | — |
| 441 | `src/lib/gamification/index.ts` | Lib | OK (agent 8) | — |
| 442 | `src/lib/gamification/levels.ts` | Lib | OK (agent 8) | — |
| 443 | `src/lib/gamification/scoring.ts` | Lib | OK (agent M) | — |
| 444 | `src/lib/gamification/types.ts` | Lib | OK (agent 8) | — |
| 445 | `src/lib/i18n.tsx` | Lib | OK (agent 8) | — |
| 446 | `src/lib/i18n/date-locale.ts` | Lib | OK (agent 8) | — |
| 447 | `src/lib/i18n/labels.ts` | Lib | OK (agent 8) | — |
| 448 | `src/lib/i18n/translations.ts` | Lib | OK (agent 8) | — |
| 449 | `src/lib/i18n/ui.ts` | Lib | OK (agent 8) | — |
| 450 | `src/lib/internal-auth.ts` | Lib | anomalie A7 | — |
| 451 | `src/lib/labor-defaults.ts` | Lib | OK (agent 8) | — |
| 452 | `src/lib/license/__tests__/public-key-consistency.test.ts` | Test | Test — vitest OK (764), non lu ligne à ligne | — |
| 453 | `src/lib/license/client-policy.ts` | Lib | OK (agent E) | — |
| 454 | `src/lib/license/devices.ts` | Lib | OK (agent 8) | — |
| 455 | `src/lib/license/hwid.ts` | Lib | OK (agent E) | — |
| 456 | `src/lib/license/protection.ts` | Lib | OK (agent E) | — |
| 457 | `src/lib/license/public-key.ts` | Lib | OK (agent E) | — |
| 458 | `src/lib/license/record-mac.ts` | Lib | anomalie A21,A44 | — |
| 459 | `src/lib/license/session.ts` | Lib | anomalie A19 | — |
| 460 | `src/lib/license/verify.ts` | Lib | OK (agent E) | — |
| 461 | `src/lib/logger.ts` | Lib | OK (agent 8) | — |
| 462 | `src/lib/memory/__tests__/memory.test.ts` | Test | Test — vitest OK (764), non lu ligne à ligne | — |
| 463 | `src/lib/memory/analyze.ts` | Lib | OK (agent 7) | — |
| 464 | `src/lib/memory/index.ts` | Lib | OK (agent 7) | — |
| 465 | `src/lib/memory/types.ts` | Lib | OK (agent 7) | — |
| 466 | `src/lib/migrations.ts` | Lib | anomalie A65 | — |
| 467 | `src/lib/money.ts` | Lib | A24,A25,A26 — CORRIGÉ (+tests) | — |
| 468 | `src/lib/monitoring/__tests__/metrics.test.ts` | Test | Test — vitest OK (764), non lu ligne à ligne | — |
| 469 | `src/lib/monitoring/metrics.ts` | Lib | OK (agent 8) | — |
| 470 | `src/lib/notifications/__tests__/notifications.test.ts` | Test | Test — vitest OK (764), non lu ligne à ligne | — |
| 471 | `src/lib/notifications/channels.ts` | Lib | OK (agent 7) | — |
| 472 | `src/lib/notifications/engine.ts` | Lib | OK (agent 7) | — |
| 473 | `src/lib/notifications/index.ts` | Lib | OK (agent 7) | — |
| 474 | `src/lib/notifications/template.ts` | Lib | OK (agent 7) | — |
| 475 | `src/lib/notifications/templates.ts` | Lib | OK (agent 7) | — |
| 476 | `src/lib/notifications/triggers.ts` | Lib | OK (agent 7) | — |
| 477 | `src/lib/notifications/types.ts` | Lib | OK (agent 7) | — |
| 478 | `src/lib/ocr/__tests__/ocr.test.ts` | Test | Test — vitest OK (764), non lu ligne à ligne | — |
| 479 | `src/lib/ocr/classify.ts` | Lib | OK (agent 7) | — |
| 480 | `src/lib/ocr/engine.ts` | Lib | OK (agent 7) | — |
| 481 | `src/lib/ocr/extract.ts` | Lib | OK (agent 7) | — |
| 482 | `src/lib/ocr/index.ts` | Lib | OK (agent 7) | — |
| 483 | `src/lib/ocr/normalize.ts` | Lib | OK (agent 7) | — |
| 484 | `src/lib/ocr/plate-scan.ts` | Lib | OK (agent 7) | — |
| 485 | `src/lib/ocr/providers.ts` | Lib | OK (agent 7) | — |
| 486 | `src/lib/ocr/types.ts` | Lib | OK (agent 7) | — |
| 487 | `src/lib/ocr/vin-scan.ts` | Lib | OK (agent 7) | — |
| 488 | `src/lib/photo-store.ts` | Lib | anomalie A63 | — |
| 489 | `src/lib/portal-secret.ts` | Lib | OK (agent 8) | — |
| 490 | `src/lib/portal/__tests__/auth-core.test.ts` | Test | Test — vitest OK (764), non lu ligne à ligne | — |
| 491 | `src/lib/portal/__tests__/repair-timeline.test.ts` | Test | Test — vitest OK (764), non lu ligne à ligne | — |
| 492 | `src/lib/portal/__tests__/session.test.ts` | Test | Test — vitest OK (764), non lu ligne à ligne | — |
| 493 | `src/lib/portal/__tests__/tickets-appointments.test.ts` | Test | Test — vitest OK (764), non lu ligne à ligne | — |
| 494 | `src/lib/portal/appointments.ts` | Lib | anomalie A31 | — |
| 495 | `src/lib/portal/auth-helpers.ts` | Lib | OK (agent 8) | — |
| 496 | `src/lib/portal/backup-codes.ts` | Lib | OK (agent 7) | — |
| 497 | `src/lib/portal/lockout.ts` | Lib | A64 CORRIGE | — |
| 498 | `src/lib/portal/repair-timeline.ts` | Lib | OK (agent 8) | — |
| 499 | `src/lib/portal/session.ts` | Lib | OK (agent 8) | — |
| 500 | `src/lib/portal/tickets.ts` | Lib | OK (agent 8) | — |
| 501 | `src/lib/portal/totp.ts` | Lib | OK (agent 8) | — |
| 502 | `src/lib/pricing/__tests__/pricing.test.ts` | Test | Test — vitest OK (764), non lu ligne à ligne | — |
| 503 | `src/lib/pricing/index.ts` | Lib | OK (agent M) | — |
| 504 | `src/lib/pricing/optimize.ts` | Lib | OK (agent M) | — |
| 505 | `src/lib/pricing/types.ts` | Lib | OK (agent 8) | — |
| 506 | `src/lib/proactive/__tests__/proactive.test.ts` | Test | Test — vitest OK (764), non lu ligne à ligne | — |
| 507 | `src/lib/proactive/engine.ts` | Lib | OK (agent 8) | — |
| 508 | `src/lib/proactive/index.ts` | Lib | OK (agent 8) | — |
| 509 | `src/lib/proactive/types.ts` | Lib | OK (agent 8) | — |
| 510 | `src/lib/profitability/__tests__/profitability.test.ts` | Test | Test — vitest OK (764), non lu ligne à ligne | — |
| 511 | `src/lib/profitability/analyze.ts` | Lib | OK (agent M) | — |
| 512 | `src/lib/profitability/index.ts` | Lib | OK (agent 8) | — |
| 513 | `src/lib/profitability/types.ts` | Lib | OK (agent 8) | — |
| 514 | `src/lib/pwa-install-id.ts` | Lib | OK (agent 8) | — |
| 515 | `src/lib/quote-gen/__tests__/quote-gen.test.ts` | Test | Test — vitest OK (764), non lu ligne à ligne | — |
| 516 | `src/lib/quote-gen/generate.ts` | Lib | OK (agent M) | — |
| 517 | `src/lib/quote-gen/index.ts` | Lib | OK (agent 8) | — |
| 518 | `src/lib/quote-gen/types.ts` | Lib | OK (agent 8) | — |
| 519 | `src/lib/redact.ts` | Lib | anomalie A61 | — |
| 520 | `src/lib/reports/__tests__/reports.test.ts` | Test | Test — vitest OK (764), non lu ligne à ligne | — |
| 521 | `src/lib/reports/builder.ts` | Lib | A57 FAUX POSITIF (separateur x01 reel) | — |
| 522 | `src/lib/reports/csv.ts` | Lib | A50 CORRIGE (+test) | — |
| 523 | `src/lib/reports/index.ts` | Lib | OK (agent 8) | — |
| 524 | `src/lib/reports/sources.ts` | Lib | OK (agent 8) | — |
| 525 | `src/lib/reports/types.ts` | Lib | OK (agent 8) | — |
| 526 | `src/lib/scheduling/__tests__/scheduling.test.ts` | Test | Test — vitest OK (764), non lu ligne à ligne | — |
| 527 | `src/lib/scheduling/index.ts` | Lib | OK (agent 8) | — |
| 528 | `src/lib/scheduling/optimize.ts` | Lib | OK (agent M) | — |
| 529 | `src/lib/scheduling/types.ts` | Lib | OK (agent 8) | — |
| 530 | `src/lib/schemas/index.ts` | Lib | A55,A62 CORRIGE | — |
| 531 | `src/lib/security/rate-limit.ts` | Lib | anomalie A6 | — |
| 532 | `src/lib/seed-data.ts` | Lib | OK (agent 8) | — |
| 533 | `src/lib/session-secret.ts` | Lib | A56 CORRIGE (securite) | — |
| 534 | `src/lib/signature/__tests__/signature.test.ts` | Test | Test — vitest OK (764), non lu ligne à ligne | — |
| 535 | `src/lib/signature/canonicalize.ts` | Lib | OK (agent 7) | — |
| 536 | `src/lib/signature/document.ts` | Lib | OK (agent 7) | — |
| 537 | `src/lib/signature/index.ts` | Lib | OK (agent 7) | — |
| 538 | `src/lib/signature/key.ts` | Lib | OK (agent 7) | — |
| 539 | `src/lib/signature/seal.ts` | Lib | OK (agent 7) | — |
| 540 | `src/lib/signature/types.ts` | Lib | OK (agent 7) | — |
| 541 | `src/lib/stock-forecast/__tests__/stock-forecast.test.ts` | Test | Test — vitest OK (764), non lu ligne à ligne | — |
| 542 | `src/lib/stock-forecast/index.ts` | Lib | OK (agent 8) | — |
| 543 | `src/lib/stock-forecast/plan.ts` | Lib | anomalie A29 — CORRIGÉ | — |
| 544 | `src/lib/stock-forecast/types.ts` | Lib | OK (agent 8) | — |
| 545 | `src/lib/suppliers/__tests__/suppliers.test.ts` | Test | Test — vitest OK (764), non lu ligne à ligne | — |
| 546 | `src/lib/suppliers/compare.ts` | Lib | OK (agent M) | — |
| 547 | `src/lib/suppliers/connectors.ts` | Lib | OK (agent 8) | — |
| 548 | `src/lib/suppliers/engine.ts` | Lib | OK (agent 8) | — |
| 549 | `src/lib/suppliers/index.ts` | Lib | OK (agent 8) | — |
| 550 | `src/lib/suppliers/order.ts` | Lib | OK (agent M) | — |
| 551 | `src/lib/suppliers/types.ts` | Lib | OK (agent 8) | — |
| 552 | `src/lib/tenant.ts` | Lib | OK (revue perso) | — |
| 553 | `src/lib/types.ts` | Lib | OK (agent 8) | — |
| 554 | `src/lib/utils.ts` | Lib | A58 CORRIGE; A59 recommande | — |
| 555 | `src/lib/vin/__tests__/vin.test.ts` | Test | Test — vitest OK (764), non lu ligne à ligne | — |
| 556 | `src/lib/vin/constants.ts` | Lib | OK (agent 7) | — |
| 557 | `src/lib/vin/decode.ts` | Lib | OK (agent 7) | — |
| 558 | `src/lib/vin/engine.ts` | Lib | OK (agent 7) | — |
| 559 | `src/lib/vin/index.ts` | Lib | OK (agent 7) | — |
| 560 | `src/lib/vin/providers.ts` | Lib | OK (agent 7) | — |
| 561 | `src/lib/vin/types.ts` | Lib | OK (agent 7) | — |
| 562 | `src/lib/vin/validate.ts` | Lib | OK (agent 7) | — |
| 563 | `src/middleware.ts` | Autre | OK (revue perso) | — |
| 564 | `src/store/schedule-store.ts` | Autre | anomalie A42 | — |
| 565 | `src/types/images.d.ts` | Autre | OK — déclaration de types (trivial) | — |
| 566 | `src/types/next-auth.d.ts` | Autre | OK — déclaration de types (trivial) | — |
| 567 | `src/types/node-sqlite.d.ts` | Autre | OK — déclaration de types (trivial) | — |
| 568 | `tailwind.config.ts` | Config | Config build — trivial | — |
| 569 | `tsconfig.json` | Config | OK (agent C) | — |
| 570 | `tsconfig.seed.json` | Config | OK (agent C) | — |
| 571 | `vitest.config.ts` | Config | Config test — vitest OK | — |
