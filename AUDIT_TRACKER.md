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
| 3 | `.gitattributes` | Config | à faire | — |
| 4 | `.github/workflows/ci.yml` | Config | OK (revue perso) | — |
| 5 | `.gitignore` | Config | à faire | — |
| 6 | `.gitleaks.toml` | Config | anomalie C2 | — |
| 7 | `.vercelignore` | Config | à faire | — |
| 8 | `CHANGELOG.md` | Autre | à faire | — |
| 9 | `CONFIGURER-GARAGEFLOW.cmd` | Config | à faire | — |
| 10 | `README.md` | Autre | à faire | — |
| 11 | `docs/AUDIT_FINALISATION_2026-08.md` | Doc | à faire | — |
| 12 | `docs/CATALOG.md` | Doc | à faire | — |
| 13 | `docs/CONFIGURATION.md` | Doc | à faire | — |
| 14 | `docs/CONFIGURATION_ENVIRONNEMENT.md` | Doc | à faire | — |
| 15 | `docs/CONSOLIDATION_REPORT.md` | Doc | à faire | — |
| 16 | `docs/CONTROL_PLANE_CLIENT.md` | Doc | à faire | — |
| 17 | `docs/COPILOT.md` | Doc | à faire | — |
| 18 | `docs/COPILOT_LLM.md` | Doc | à faire | — |
| 19 | `docs/DASHBOARD.md` | Doc | à faire | — |
| 20 | `docs/DATABASE_ARCHITECTURE.md` | Doc | anomalie A45 — CORRIGÉ | — |
| 21 | `docs/DELIVERY_STATUS.md` | Doc | à faire | — |
| 22 | `docs/DIAGNOSTIC.md` | Doc | à faire | — |
| 23 | `docs/ENTERPRISE_AUDIT.md` | Doc | à faire | — |
| 24 | `docs/ENVIRONMENT.md` | Doc | à faire | — |
| 25 | `docs/FORECAST.md` | Doc | à faire | — |
| 26 | `docs/FORGOTTEN_PARTS.md` | Doc | à faire | — |
| 27 | `docs/GAMIFICATION.md` | Doc | à faire | — |
| 28 | `docs/LICENSE_DEVICE_SECURITY.md` | Doc | à faire | — |
| 29 | `docs/MEMORY.md` | Doc | à faire | — |
| 30 | `docs/MIGRATION-MONEY.md` | Doc | à faire | — |
| 31 | `docs/NOTIFICATIONS.md` | Doc | à faire | — |
| 32 | `docs/OCR.md` | Doc | à faire | — |
| 33 | `docs/PRICING.md` | Doc | à faire | — |
| 34 | `docs/PRIVACY-CRASH-REPORTING.md` | Doc | à faire | — |
| 35 | `docs/PROACTIVE.md` | Doc | à faire | — |
| 36 | `docs/PRODUCTION_DEPLOYMENT.md` | Doc | à faire | — |
| 37 | `docs/PROFITABILITY.md` | Doc | à faire | — |
| 38 | `docs/PWA.md` | Doc | à faire | — |
| 39 | `docs/PWA_MULTITENANT_LICENSING.md` | Doc | à faire | — |
| 40 | `docs/QUOTE_GENERATION.md` | Doc | à faire | — |
| 41 | `docs/REINITIALISATION_GARAGEFLOW.md` | Doc | à faire | — |
| 42 | `docs/REPORTS.md` | Doc | à faire | — |
| 43 | `docs/RESPONSIVE.md` | Doc | à faire | — |
| 44 | `docs/RESTAURATION_GARAGEFLOW.md` | Doc | à faire | — |
| 45 | `docs/ROTATION_SECRETS.md` | Doc | à faire | — |
| 46 | `docs/SCHEDULING.md` | Doc | à faire | — |
| 47 | `docs/SECRETS_ROTATION.md` | Doc | à faire | — |
| 48 | `docs/SECURITY-HARDENING.md` | Doc | à faire | — |
| 49 | `docs/SECURITY.md` | Doc | anomalie A46 — CORRIGÉ | — |
| 50 | `docs/SIGNATURE.md` | Doc | à faire | — |
| 51 | `docs/STOCK_FORECAST.md` | Doc | à faire | — |
| 52 | `docs/SUPPLIERS.md` | Doc | à faire | — |
| 53 | `docs/VARIABLES_ENVIRONNEMENT.md` | Doc | à faire | — |
| 54 | `docs/VIN_DECODER.md` | Doc | à faire | — |
| 55 | `e2e/README.md` | Autre | à faire | — |
| 56 | `e2e/audit.mjs` | Config | à faire | — |
| 57 | `e2e/responsive.spec.ts` | Test | à faire | — |
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
| 69 | `icon.ico` | Binaire/asset | à faire | — |
| 70 | `icon.png` | Binaire/asset | à faire | — |
| 71 | `icon.svg` | Binaire/asset | à faire | — |
| 72 | `next.config.mjs` | Config | OK (agent C) | — |
| 73 | `package-lock.json` | Config | à faire | — |
| 74 | `package.json` | Config | OK (revue perso) | — |
| 75 | `playwright.config.ts` | Config | à faire | — |
| 76 | `postcss.config.js` | Config | à faire | — |
| 77 | `prisma/garageflow-template.db` | Prisma | à faire | — |
| 78 | `prisma/migrations/20260424000000_add_record_mac/migration.sql` | Prisma | OK (agent C) — vestigial | — |
| 79 | `prisma/migrations/20260425000000_add_audit_log_and_indexes/migration.sql` | Prisma | OK (agent C) — vestigial | — |
| 80 | `prisma/schema.prisma` | Prisma | A43 CORRIGÉ(comment); A47,A48 recommandé | — |
| 81 | `prisma/seed.ts` | Prisma | à faire | — |
| 82 | `prisma/server/migrations/20260730120000_init_server/migration.sql` | Prisma | OK (agent C) — 37/37 tables | — |
| 83 | `prisma/server/migrations/20260730160000_link_license_garage/migration.sql` | Prisma | OK (agent C) | — |
| 84 | `prisma/server/migrations/20260730180000_premium_modules/migration.sql` | Prisma | OK (agent C) | — |
| 85 | `prisma/server/migrations/20260730200000_enterprise_portal/migration.sql` | Prisma | OK (agent C) | — |
| 86 | `prisma/server/migrations/migration_lock.toml` | Prisma | OK (agent C) | — |
| 87 | `prisma/server/schema.prisma` | Prisma | A43 CORRIGÉ(comment); A47,A48 recommandé | — |
| 88 | `public/icons/apple-touch-icon.png` | Binaire/asset | à faire | — |
| 89 | `public/icons/icon-192.png` | Binaire/asset | à faire | — |
| 90 | `public/icons/icon-512.png` | Binaire/asset | à faire | — |
| 91 | `public/icons/maskable-192.png` | Binaire/asset | à faire | — |
| 92 | `public/icons/maskable-512.png` | Binaire/asset | à faire | — |
| 93 | `public/manifest.webmanifest` | Config | à faire | — |
| 94 | `public/offline.html` | Autre | à faire | — |
| 95 | `public/site.webmanifest` | Config | à faire | — |
| 96 | `public/sw.js` | Autre | à faire | — |
| 97 | `scripts/RESET-GARAGEFLOW-V185.cmd` | Script | à faire | — |
| 98 | `scripts/RESET-GARAGEFLOW.cmd` | Script | à faire | — |
| 99 | `scripts/afterPack.js` | Script | anomalie A17 | — |
| 100 | `scripts/audit-ci.js` | Script | OK (revue perso) | — |
| 101 | `scripts/check-version.js` | Script | à faire | — |
| 102 | `scripts/configurer-api-garageflow.ps1` | Script | à faire | — |
| 103 | `scripts/garageflow-env-manifest.json` | Script | à faire | — |
| 104 | `scripts/generate-icons.js` | Script | à faire | — |
| 105 | `scripts/installer.nsh` | Script | à faire | — |
| 106 | `scripts/keygen.py` | Script | OK (agent E) | — |
| 107 | `scripts/keygen_core.py` | Script | OK (agent E) | — |
| 108 | `scripts/keygen_db.py` | Script | à faire | — |
| 109 | `scripts/keygen_ui.py` | Script | à faire | — |
| 110 | `scripts/post-build.js` | Script | à faire | — |
| 111 | `scripts/protect-resources.js` | Script | OK (agent E) | — |
| 112 | `scripts/reset-garageflow-v185.ps1` | Script | OK (agent E) | — |
| 113 | `scripts/reset-garageflow.ps1` | Script | OK (agent E) | — |
| 114 | `scripts/restore.js` | Script | anomalie A22 | — |
| 115 | `scripts/secrets.js` | Script | OK (agent E) | — |
| 116 | `scripts/setup-dev.js` | Script | à faire | — |
| 117 | `scripts/validate-server-db.js` | Script | à faire | — |
| 118 | `src/__tests__/middleware.test.ts` | Test | à faire | — |
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
| 133 | `src/app/api/analytics/health/route.ts` | API route | à faire | — |
| 134 | `src/app/api/appointments/[id]/route.ts` | API route | OK (agent A) | — |
| 135 | `src/app/api/appointments/route.ts` | API route | OK (agent A) | — |
| 136 | `src/app/api/auth/[...nextauth]/route.ts` | API route | anomalie A3 | — |
| 137 | `src/app/api/catalog/route.ts` | API route | OK (agent A) | — |
| 138 | `src/app/api/clients/route.ts` | API route | OK (agent A) | — |
| 139 | `src/app/api/copilot/report/route.ts` | API route | à faire | — |
| 140 | `src/app/api/copilot/reports/[id]/export/route.ts` | API route | à faire | — |
| 141 | `src/app/api/copilot/reports/route.ts` | API route | à faire | — |
| 142 | `src/app/api/copilot/route.ts` | API route | à faire | — |
| 143 | `src/app/api/dashboard/route.ts` | API route | à faire | — |
| 144 | `src/app/api/diagnostic/route.ts` | API route | à faire | — |
| 145 | `src/app/api/email/route.ts` | API route | à faire | — |
| 146 | `src/app/api/estimate/route.ts` | API route | anomalie A10 — CORRIGÉ | — |
| 147 | `src/app/api/export/fec/route.ts` | API route | anomalie A28 | — |
| 148 | `src/app/api/finance/route.ts` | API route | anomalie A27 | — |
| 149 | `src/app/api/forecast/route.ts` | API route | à faire | — |
| 150 | `src/app/api/forgotten-parts/route.ts` | API route | à faire | — |
| 151 | `src/app/api/gamification/route.ts` | API route | à faire | — |
| 152 | `src/app/api/garages/route.ts` | API route | anomalie A11 — CORRIGÉ | — |
| 153 | `src/app/api/health/route.ts` | API route | à faire | — |
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
| 180 | `src/app/api/memory/route.ts` | API route | à faire | — |
| 181 | `src/app/api/notifications/dispatch/route.ts` | API route | à faire | — |
| 182 | `src/app/api/ocr/route.ts` | API route | à faire | — |
| 183 | `src/app/api/parts/[id]/route.ts` | API route | anomalie A12 | — |
| 184 | `src/app/api/parts/low-stock/route.ts` | API route | OK (agent A) | — |
| 185 | `src/app/api/parts/route.ts` | API route | anomalie A12 | — |
| 186 | `src/app/api/photos/[...path]/route.ts` | API route | à faire | — |
| 187 | `src/app/api/ping/route.ts` | API route | à faire | — |
| 188 | `src/app/api/plate-lookup/route.ts` | API route | à faire | — |
| 189 | `src/app/api/plate-ocr/route.ts` | API route | à faire | — |
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
| 210 | `src/app/api/pricing/route.ts` | API route | à faire | — |
| 211 | `src/app/api/proactive/route.ts` | API route | à faire | — |
| 212 | `src/app/api/profitability/route.ts` | API route | à faire | — |
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
| 224 | `src/app/api/reports/route.ts` | API route | à faire | — |
| 225 | `src/app/api/scheduling/route.ts` | API route | à faire | — |
| 226 | `src/app/api/signatures/route.ts` | API route | OK (agent A) | — |
| 227 | `src/app/api/stats/route.ts` | API route | anomalie A30 | — |
| 228 | `src/app/api/stock-forecast/route.ts` | API route | OK (agent M) | — |
| 229 | `src/app/api/suggestions/route.ts` | API route | à faire | — |
| 230 | `src/app/api/suppliers/route.ts` | API route | OK (agent A) | — |
| 231 | `src/app/api/tickets/[id]/route.ts` | API route | OK (agent A) | — |
| 232 | `src/app/api/tickets/route.ts` | API route | OK (agent A) | — |
| 233 | `src/app/api/users/route.ts` | API route | anomalie A15 | — |
| 234 | `src/app/api/vehicles/[id]/route.ts` | API route | anomalie A8 — CORRIGÉ | — |
| 235 | `src/app/api/vehicles/[id]/timeline/route.ts` | API route | OK (agent A) | — |
| 236 | `src/app/api/vehicles/ct-alerts/route.ts` | API route | OK (agent A) | — |
| 237 | `src/app/api/vehicles/route.ts` | API route | OK (agent A) | — |
| 238 | `src/app/api/vin/route.ts` | API route | à faire | — |
| 239 | `src/app/api/warranties/[id]/route.ts` | API route | OK (agent A) | — |
| 240 | `src/app/api/warranties/alerts/route.ts` | API route | OK (agent A) | — |
| 241 | `src/app/api/warranties/route.ts` | API route | OK (agent A) | — |
| 242 | `src/app/api/work-orders/[id]/route.ts` | API route | OK (agent A) | — |
| 243 | `src/app/api/work-orders/[id]/sign/route.ts` | API route | OK (agent A) | — |
| 244 | `src/app/api/work-orders/route.ts` | API route | OK (agent A) | — |
| 245 | `src/app/copilot/page.tsx` | React page | OK (agent R) | — |
| 246 | `src/app/favicon.ico` | Binaire/asset | à faire | — |
| 247 | `src/app/globals.css` | Autre | à faire | — |
| 248 | `src/app/layout.tsx` | React page | à faire | — |
| 249 | `src/app/license/page.tsx` | React page | OK (agent R) | — |
| 250 | `src/app/login/page.tsx` | React page | OK (agent R) | — |
| 251 | `src/app/monitoring/page.tsx` | React page | OK (agent R) | — |
| 252 | `src/app/page.tsx` | React page | à faire | — |
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
| 320 | `src/config/app.ts` | Config | à faire | — |
| 321 | `src/config/database.ts` | Config | à faire | — |
| 322 | `src/config/license.ts` | Config | anomalie A20 — CORRIGÉ | — |
| 323 | `src/hooks/useKeyboardShortcuts.ts` | Autre | anomalie A40 | — |
| 324 | `src/hooks/useMediaQuery.ts` | Autre | OK (agent R) | — |
| 325 | `src/hooks/useWorkOrders.ts` | Autre | OK (agent R) | — |
| 326 | `src/instrumentation.ts` | Autre | à faire | — |
| 327 | `src/integration/catalog.test.ts` | Test | à faire | — |
| 328 | `src/integration/copilot.test.ts` | Test | à faire | — |
| 329 | `src/integration/dashboard.test.ts` | Test | à faire | — |
| 330 | `src/integration/ocr.test.ts` | Test | à faire | — |
| 331 | `src/integration/quotes-generate.test.ts` | Test | à faire | — |
| 332 | `src/integration/suppliers.test.ts` | Test | à faire | — |
| 333 | `src/lib/__tests__/auth-authorize.test.ts` | Test | à faire | — |
| 334 | `src/lib/__tests__/auth-secret.test.ts` | Test | à faire | — |
| 335 | `src/lib/__tests__/business-logic.test.ts` | Test | à faire | — |
| 336 | `src/lib/__tests__/check-route-policy.test.ts` | Test | à faire | — |
| 337 | `src/lib/__tests__/client-policy.test.ts` | Test | à faire | — |
| 338 | `src/lib/__tests__/control-plane.test.ts` | Test | à faire | — |
| 339 | `src/lib/__tests__/crash-redaction.test.ts` | Test | à faire | — |
| 340 | `src/lib/__tests__/document-numbering.test.ts` | Test | à faire | — |
| 341 | `src/lib/__tests__/electron-loopback.test.ts` | Test | à faire | — |
| 342 | `src/lib/__tests__/electron-secret.test.ts` | Test | à faire | — |
| 343 | `src/lib/__tests__/env.test.ts` | Test | à faire | — |
| 344 | `src/lib/__tests__/hwid-verify.test.ts` | Test | à faire | — |
| 345 | `src/lib/__tests__/license-activate.test.ts` | Test | à faire | — |
| 346 | `src/lib/__tests__/license-devices-unit.test.ts` | Test | à faire | — |
| 347 | `src/lib/__tests__/license-devices.postgres.int.test.ts` | Test | à faire | — |
| 348 | `src/lib/__tests__/licensed-session.postgres.int.test.ts` | Test | à faire | — |
| 349 | `src/lib/__tests__/licensed-session.test.ts` | Test | à faire | — |
| 350 | `src/lib/__tests__/migrations-unique-index.test.ts` | Test | à faire | — |
| 351 | `src/lib/__tests__/money-document-consistency.test.ts` | Test | à faire | — |
| 352 | `src/lib/__tests__/money.test.ts` | Test | OK — tests A24/A25/A26 ajoutés | — |
| 353 | `src/lib/__tests__/pwa.test.ts` | Test | à faire | — |
| 354 | `src/lib/__tests__/rate-limit-multi-instance.int.test.ts` | Test | à faire | — |
| 355 | `src/lib/__tests__/redact.test.ts` | Test | à faire | — |
| 356 | `src/lib/__tests__/require-session-enforcement.test.ts` | Test | à faire | — |
| 357 | `src/lib/__tests__/revoke-by-key-route.test.ts` | Test | à faire | — |
| 358 | `src/lib/__tests__/secrets.test.ts` | Test | à faire | — |
| 359 | `src/lib/__tests__/security-rate-limit.test.ts` | Test | à faire | — |
| 360 | `src/lib/__tests__/stock-parts.test.ts` | Test | à faire | — |
| 361 | `src/lib/__tests__/tenant-guard.test.ts` | Test | à faire | — |
| 362 | `src/lib/__tests__/tenant-isolation.test.ts` | Test | à faire | — |
| 363 | `src/lib/__tests__/tva.test.ts` | Test | à faire | — |
| 364 | `src/lib/__tests__/update-verify.test.ts` | Test | à faire | — |
| 365 | `src/lib/__tests__/utils.test.ts` | Test | à faire | — |
| 366 | `src/lib/__tests__/verify.test.ts` | Test | à faire | — |
| 367 | `src/lib/ai-engine.ts` | Lib | à faire | — |
| 368 | `src/lib/analytics/__tests__/analytics.test.ts` | Test | à faire | — |
| 369 | `src/lib/analytics/__tests__/report-export.test.ts` | Test | à faire | — |
| 370 | `src/lib/analytics/collect.ts` | Lib | à faire | — |
| 371 | `src/lib/analytics/health-score.ts` | Lib | OK (agent M) | — |
| 372 | `src/lib/analytics/insights.ts` | Lib | à faire | — |
| 373 | `src/lib/analytics/metrics.ts` | Lib | OK (agent M) | — |
| 374 | `src/lib/analytics/report-export.ts` | Lib | à faire | — |
| 375 | `src/lib/analytics/types.ts` | Lib | à faire | — |
| 376 | `src/lib/api-helpers.ts` | Lib | OK (revue perso) | — |
| 377 | `src/lib/audit.ts` | Lib | à faire | — |
| 378 | `src/lib/auth-secret.ts` | Lib | à faire | — |
| 379 | `src/lib/auth.ts` | Lib | anomalie A3 — CORRIGÉ | — |
| 380 | `src/lib/backup/__tests__/crypto.test.ts` | Test | à faire | — |
| 381 | `src/lib/backup/__tests__/snapshot.test.ts` | Test | à faire | — |
| 382 | `src/lib/backup/crypto.ts` | Lib | à faire | — |
| 383 | `src/lib/backup/service.ts` | Lib | à faire | — |
| 384 | `src/lib/backup/snapshot.ts` | Lib | à faire | — |
| 385 | `src/lib/billing.ts` | Lib | OK (agent M) | — |
| 386 | `src/lib/car-database.ts` | Lib | à faire | — |
| 387 | `src/lib/catalog/__tests__/catalog.test.ts` | Test | à faire | — |
| 388 | `src/lib/catalog/categories.ts` | Lib | à faire | — |
| 389 | `src/lib/catalog/crossref.ts` | Lib | à faire | — |
| 390 | `src/lib/catalog/engine.ts` | Lib | à faire | — |
| 391 | `src/lib/catalog/fitment.ts` | Lib | à faire | — |
| 392 | `src/lib/catalog/index.ts` | Lib | à faire | — |
| 393 | `src/lib/catalog/normalize.ts` | Lib | à faire | — |
| 394 | `src/lib/catalog/providers.ts` | Lib | à faire | — |
| 395 | `src/lib/catalog/search.ts` | Lib | à faire | — |
| 396 | `src/lib/catalog/seed.ts` | Lib | à faire | — |
| 397 | `src/lib/catalog/types.ts` | Lib | à faire | — |
| 398 | `src/lib/client-memory.ts` | Lib | à faire | — |
| 399 | `src/lib/copilot-llm/__tests__/copilot-llm.test.ts` | Test | à faire | — |
| 400 | `src/lib/copilot-llm/classify.ts` | Lib | à faire | — |
| 401 | `src/lib/copilot-llm/ground.ts` | Lib | à faire | — |
| 402 | `src/lib/copilot-llm/index.ts` | Lib | à faire | — |
| 403 | `src/lib/copilot-llm/phrase.ts` | Lib | à faire | — |
| 404 | `src/lib/copilot-llm/prompts.ts` | Lib | à faire | — |
| 405 | `src/lib/copilot-llm/provider.ts` | Lib | à faire | — |
| 406 | `src/lib/copilot-llm/timeout.ts` | Lib | à faire | — |
| 407 | `src/lib/copilot-llm/types.ts` | Lib | à faire | — |
| 408 | `src/lib/copilot/__tests__/copilot.test.ts` | Test | à faire | — |
| 409 | `src/lib/copilot/actions.ts` | Lib | à faire | — |
| 410 | `src/lib/copilot/engine.ts` | Lib | à faire | — |
| 411 | `src/lib/copilot/index.ts` | Lib | à faire | — |
| 412 | `src/lib/copilot/intents.ts` | Lib | à faire | — |
| 413 | `src/lib/copilot/router.ts` | Lib | à faire | — |
| 414 | `src/lib/copilot/types.ts` | Lib | à faire | — |
| 415 | `src/lib/dashboard/__tests__/dashboard.test.ts` | Test | à faire | — |
| 416 | `src/lib/dashboard/build.ts` | Lib | à faire | — |
| 417 | `src/lib/dashboard/index.ts` | Lib | à faire | — |
| 418 | `src/lib/dashboard/types.ts` | Lib | à faire | — |
| 419 | `src/lib/db.ts` | Lib | à faire | — |
| 420 | `src/lib/diagnostic/__tests__/diagnostic.test.ts` | Test | à faire | — |
| 421 | `src/lib/diagnostic/engine.ts` | Lib | à faire | — |
| 422 | `src/lib/diagnostic/index.ts` | Lib | à faire | — |
| 423 | `src/lib/diagnostic/knowledge.ts` | Lib | à faire | — |
| 424 | `src/lib/diagnostic/obd.ts` | Lib | à faire | — |
| 425 | `src/lib/diagnostic/types.ts` | Lib | à faire | — |
| 426 | `src/lib/entitlements.tsx` | Lib | à faire | — |
| 427 | `src/lib/env.ts` | Lib | OK (agent C) | — |
| 428 | `src/lib/forecast/__tests__/forecast.test.ts` | Test | à faire | — |
| 429 | `src/lib/forecast/forecast.ts` | Lib | OK (agent M) | — |
| 430 | `src/lib/forecast/index.ts` | Lib | à faire | — |
| 431 | `src/lib/forecast/stats.ts` | Lib | OK (agent M) | — |
| 432 | `src/lib/forecast/types.ts` | Lib | à faire | — |
| 433 | `src/lib/forgotten-parts/__tests__/forgotten-parts.test.ts` | Test | à faire | — |
| 434 | `src/lib/forgotten-parts/engine.ts` | Lib | à faire | — |
| 435 | `src/lib/forgotten-parts/index.ts` | Lib | à faire | — |
| 436 | `src/lib/forgotten-parts/rules.ts` | Lib | à faire | — |
| 437 | `src/lib/forgotten-parts/types.ts` | Lib | à faire | — |
| 438 | `src/lib/gamification/__tests__/gamification.test.ts` | Test | à faire | — |
| 439 | `src/lib/gamification/badges.ts` | Lib | à faire | — |
| 440 | `src/lib/gamification/engine.ts` | Lib | à faire | — |
| 441 | `src/lib/gamification/index.ts` | Lib | à faire | — |
| 442 | `src/lib/gamification/levels.ts` | Lib | à faire | — |
| 443 | `src/lib/gamification/scoring.ts` | Lib | OK (agent M) | — |
| 444 | `src/lib/gamification/types.ts` | Lib | à faire | — |
| 445 | `src/lib/i18n.tsx` | Lib | à faire | — |
| 446 | `src/lib/i18n/date-locale.ts` | Lib | à faire | — |
| 447 | `src/lib/i18n/labels.ts` | Lib | à faire | — |
| 448 | `src/lib/i18n/translations.ts` | Lib | à faire | — |
| 449 | `src/lib/i18n/ui.ts` | Lib | à faire | — |
| 450 | `src/lib/internal-auth.ts` | Lib | anomalie A7 | — |
| 451 | `src/lib/labor-defaults.ts` | Lib | à faire | — |
| 452 | `src/lib/license/__tests__/public-key-consistency.test.ts` | Test | à faire | — |
| 453 | `src/lib/license/client-policy.ts` | Lib | OK (agent E) | — |
| 454 | `src/lib/license/devices.ts` | Lib | à faire | — |
| 455 | `src/lib/license/hwid.ts` | Lib | OK (agent E) | — |
| 456 | `src/lib/license/protection.ts` | Lib | OK (agent E) | — |
| 457 | `src/lib/license/public-key.ts` | Lib | OK (agent E) | — |
| 458 | `src/lib/license/record-mac.ts` | Lib | anomalie A21,A44 | — |
| 459 | `src/lib/license/session.ts` | Lib | anomalie A19 | — |
| 460 | `src/lib/license/verify.ts` | Lib | OK (agent E) | — |
| 461 | `src/lib/logger.ts` | Lib | à faire | — |
| 462 | `src/lib/memory/__tests__/memory.test.ts` | Test | à faire | — |
| 463 | `src/lib/memory/analyze.ts` | Lib | à faire | — |
| 464 | `src/lib/memory/index.ts` | Lib | à faire | — |
| 465 | `src/lib/memory/types.ts` | Lib | à faire | — |
| 466 | `src/lib/migrations.ts` | Lib | à faire | — |
| 467 | `src/lib/money.ts` | Lib | A24,A25,A26 — CORRIGÉ (+tests) | — |
| 468 | `src/lib/monitoring/__tests__/metrics.test.ts` | Test | à faire | — |
| 469 | `src/lib/monitoring/metrics.ts` | Lib | à faire | — |
| 470 | `src/lib/notifications/__tests__/notifications.test.ts` | Test | à faire | — |
| 471 | `src/lib/notifications/channels.ts` | Lib | à faire | — |
| 472 | `src/lib/notifications/engine.ts` | Lib | à faire | — |
| 473 | `src/lib/notifications/index.ts` | Lib | à faire | — |
| 474 | `src/lib/notifications/template.ts` | Lib | à faire | — |
| 475 | `src/lib/notifications/templates.ts` | Lib | à faire | — |
| 476 | `src/lib/notifications/triggers.ts` | Lib | à faire | — |
| 477 | `src/lib/notifications/types.ts` | Lib | à faire | — |
| 478 | `src/lib/ocr/__tests__/ocr.test.ts` | Test | à faire | — |
| 479 | `src/lib/ocr/classify.ts` | Lib | à faire | — |
| 480 | `src/lib/ocr/engine.ts` | Lib | à faire | — |
| 481 | `src/lib/ocr/extract.ts` | Lib | à faire | — |
| 482 | `src/lib/ocr/index.ts` | Lib | à faire | — |
| 483 | `src/lib/ocr/normalize.ts` | Lib | à faire | — |
| 484 | `src/lib/ocr/plate-scan.ts` | Lib | à faire | — |
| 485 | `src/lib/ocr/providers.ts` | Lib | à faire | — |
| 486 | `src/lib/ocr/types.ts` | Lib | à faire | — |
| 487 | `src/lib/ocr/vin-scan.ts` | Lib | à faire | — |
| 488 | `src/lib/photo-store.ts` | Lib | à faire | — |
| 489 | `src/lib/portal-secret.ts` | Lib | à faire | — |
| 490 | `src/lib/portal/__tests__/auth-core.test.ts` | Test | à faire | — |
| 491 | `src/lib/portal/__tests__/repair-timeline.test.ts` | Test | à faire | — |
| 492 | `src/lib/portal/__tests__/session.test.ts` | Test | à faire | — |
| 493 | `src/lib/portal/__tests__/tickets-appointments.test.ts` | Test | à faire | — |
| 494 | `src/lib/portal/appointments.ts` | Lib | anomalie A31 | — |
| 495 | `src/lib/portal/auth-helpers.ts` | Lib | à faire | — |
| 496 | `src/lib/portal/backup-codes.ts` | Lib | à faire | — |
| 497 | `src/lib/portal/lockout.ts` | Lib | à faire | — |
| 498 | `src/lib/portal/repair-timeline.ts` | Lib | à faire | — |
| 499 | `src/lib/portal/session.ts` | Lib | à faire | — |
| 500 | `src/lib/portal/tickets.ts` | Lib | à faire | — |
| 501 | `src/lib/portal/totp.ts` | Lib | à faire | — |
| 502 | `src/lib/pricing/__tests__/pricing.test.ts` | Test | à faire | — |
| 503 | `src/lib/pricing/index.ts` | Lib | OK (agent M) | — |
| 504 | `src/lib/pricing/optimize.ts` | Lib | OK (agent M) | — |
| 505 | `src/lib/pricing/types.ts` | Lib | à faire | — |
| 506 | `src/lib/proactive/__tests__/proactive.test.ts` | Test | à faire | — |
| 507 | `src/lib/proactive/engine.ts` | Lib | à faire | — |
| 508 | `src/lib/proactive/index.ts` | Lib | à faire | — |
| 509 | `src/lib/proactive/types.ts` | Lib | à faire | — |
| 510 | `src/lib/profitability/__tests__/profitability.test.ts` | Test | à faire | — |
| 511 | `src/lib/profitability/analyze.ts` | Lib | OK (agent M) | — |
| 512 | `src/lib/profitability/index.ts` | Lib | à faire | — |
| 513 | `src/lib/profitability/types.ts` | Lib | à faire | — |
| 514 | `src/lib/pwa-install-id.ts` | Lib | à faire | — |
| 515 | `src/lib/quote-gen/__tests__/quote-gen.test.ts` | Test | à faire | — |
| 516 | `src/lib/quote-gen/generate.ts` | Lib | OK (agent M) | — |
| 517 | `src/lib/quote-gen/index.ts` | Lib | à faire | — |
| 518 | `src/lib/quote-gen/types.ts` | Lib | à faire | — |
| 519 | `src/lib/redact.ts` | Lib | à faire | — |
| 520 | `src/lib/reports/__tests__/reports.test.ts` | Test | à faire | — |
| 521 | `src/lib/reports/builder.ts` | Lib | à faire | — |
| 522 | `src/lib/reports/csv.ts` | Lib | à faire | — |
| 523 | `src/lib/reports/index.ts` | Lib | à faire | — |
| 524 | `src/lib/reports/sources.ts` | Lib | à faire | — |
| 525 | `src/lib/reports/types.ts` | Lib | à faire | — |
| 526 | `src/lib/scheduling/__tests__/scheduling.test.ts` | Test | à faire | — |
| 527 | `src/lib/scheduling/index.ts` | Lib | à faire | — |
| 528 | `src/lib/scheduling/optimize.ts` | Lib | OK (agent M) | — |
| 529 | `src/lib/scheduling/types.ts` | Lib | à faire | — |
| 530 | `src/lib/schemas/index.ts` | Lib | à faire | — |
| 531 | `src/lib/security/rate-limit.ts` | Lib | anomalie A6 | — |
| 532 | `src/lib/seed-data.ts` | Lib | à faire | — |
| 533 | `src/lib/session-secret.ts` | Lib | à faire | — |
| 534 | `src/lib/signature/__tests__/signature.test.ts` | Test | à faire | — |
| 535 | `src/lib/signature/canonicalize.ts` | Lib | à faire | — |
| 536 | `src/lib/signature/document.ts` | Lib | à faire | — |
| 537 | `src/lib/signature/index.ts` | Lib | à faire | — |
| 538 | `src/lib/signature/key.ts` | Lib | à faire | — |
| 539 | `src/lib/signature/seal.ts` | Lib | à faire | — |
| 540 | `src/lib/signature/types.ts` | Lib | à faire | — |
| 541 | `src/lib/stock-forecast/__tests__/stock-forecast.test.ts` | Test | à faire | — |
| 542 | `src/lib/stock-forecast/index.ts` | Lib | à faire | — |
| 543 | `src/lib/stock-forecast/plan.ts` | Lib | anomalie A29 — CORRIGÉ | — |
| 544 | `src/lib/stock-forecast/types.ts` | Lib | à faire | — |
| 545 | `src/lib/suppliers/__tests__/suppliers.test.ts` | Test | à faire | — |
| 546 | `src/lib/suppliers/compare.ts` | Lib | OK (agent M) | — |
| 547 | `src/lib/suppliers/connectors.ts` | Lib | à faire | — |
| 548 | `src/lib/suppliers/engine.ts` | Lib | à faire | — |
| 549 | `src/lib/suppliers/index.ts` | Lib | à faire | — |
| 550 | `src/lib/suppliers/order.ts` | Lib | OK (agent M) | — |
| 551 | `src/lib/suppliers/types.ts` | Lib | à faire | — |
| 552 | `src/lib/tenant.ts` | Lib | OK (revue perso) | — |
| 553 | `src/lib/types.ts` | Lib | à faire | — |
| 554 | `src/lib/utils.ts` | Lib | à faire | — |
| 555 | `src/lib/vin/__tests__/vin.test.ts` | Test | à faire | — |
| 556 | `src/lib/vin/constants.ts` | Lib | à faire | — |
| 557 | `src/lib/vin/decode.ts` | Lib | à faire | — |
| 558 | `src/lib/vin/engine.ts` | Lib | à faire | — |
| 559 | `src/lib/vin/index.ts` | Lib | à faire | — |
| 560 | `src/lib/vin/providers.ts` | Lib | à faire | — |
| 561 | `src/lib/vin/types.ts` | Lib | à faire | — |
| 562 | `src/lib/vin/validate.ts` | Lib | à faire | — |
| 563 | `src/middleware.ts` | Autre | OK (revue perso) | — |
| 564 | `src/store/schedule-store.ts` | Autre | anomalie A42 | — |
| 565 | `src/types/images.d.ts` | Autre | à faire | — |
| 566 | `src/types/next-auth.d.ts` | Autre | à faire | — |
| 567 | `src/types/node-sqlite.d.ts` | Autre | à faire | — |
| 568 | `tailwind.config.ts` | Config | à faire | — |
| 569 | `tsconfig.json` | Config | OK (agent C) | — |
| 570 | `tsconfig.seed.json` | Config | OK (agent C) | — |
| 571 | `vitest.config.ts` | Config | à faire | — |
