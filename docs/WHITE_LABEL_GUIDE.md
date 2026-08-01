# White-Label Guide — GarageFlow (Desktop / GarageFlowsV2)

> Audience: an acquirer or partner who wants to ship GarageFlow under their own
> brand (name, logo, colours, domains, legal entity) without forking the code.

This guide documents **exactly** what is centralised today, how to override it,
and — honestly — which surfaces still carry inline brand strings and how to
change them. Nothing here is aspirational: every path and variable below exists
in the repository.

---

## 1. TL;DR — the fastest rebrand

1. Create a `brand.config.json` at the project root (see the full template in
   §4) **or** set `GF_BRAND_*` environment variables (§3).
2. Replace the brand image assets (§5).
3. Patch the Windows packaging metadata in `package.json` for the installer (§6).
4. Rebuild: `npm run build` (web/PWA) and `npm run dist` (Windows installer).

Runtime identity (product name, colours, domains, e-mail, legal URLs) flows from
a single validated source: **`src/config/brand.ts`**. Packaging identity
(installer name, appId) is read by `electron-builder` from `package.json` at
build time and is patched separately (§6).

---

## 2. The single source of truth: `src/config/brand.ts`

`src/config/brand.ts` exports a **Zod-validated** `BRAND` object. It is resolved
once at module load from three layers, highest priority first:

1. **Environment variables** — `GF_BRAND_*` (CI/CD-friendly, no file edits).
2. **JSON file** — `brand.config.json` at the project root, or the path/inline
   JSON in `GF_BRAND_CONFIG`. Deep-merged over the defaults (partial overrides
   are fine).
3. **Typed defaults** — the current GarageFlow identity.

**Safety contract (tested):** if any override is malformed (bad hex colour,
invalid e-mail, broken JSON), the loader logs **one** warning and falls back to
the validated defaults. It never throws, so a bad brand file can never break a
build or a running app. See `src/config/__tests__/brand.test.ts` (8 tests).

`src/config/app.ts` consumes `BRAND.productName` as `APP_CONFIG.name`, so the
product name has exactly one origin.

### Fields

| Group | Keys | Used for |
|-------|------|----------|
| Identity | `productName`, `shortName`, `companyName`, `companyLegalName`, `tagline` | UI, window titles, documents, legal pages |
| Wordmark | `wordmark.primary`, `wordmark.secondary` | Two-part logo lockup (e.g. "Garage"+"Flow") |
| Colours | `colors.primary`, `colors.primaryDark`, `colors.accent` | Buttons, links, accents (hex) |
| Domains | `domains.marketing`, `domains.app`, `domains.docs` | Links, canonical URLs |
| Support | `support.email`, `support.phone`, `support.url` | Help/contact surfaces |
| E-mail | `mail.fromName`, `mail.fromAddress`, `mail.replyTo` | Transactional e-mail identity |
| Legal | `legal.entity`, `legal.siren`, `legal.address`, `legal.termsUrl`, `legal.privacyUrl`, `legal.legalNoticeUrl` | Legal notice, CGU, privacy |
| Assets | `assets.logoLight`, `assets.logoDark`, `assets.favicon`, `assets.windowsIcon` | Image references |
| Packaging | `packaging.productName`, `packaging.appId`, `packaging.executableName` | Windows metadata (informational mirror; see §6) |
| Commercial | `commercial.email`, `commercial.url` | Buyer package / footers |

---

## 3. Rebrand via environment variables

Every discrete override key (all optional):

```bash
GF_BRAND_PRODUCT_NAME="AtelierPro"
GF_BRAND_SHORT_NAME="AtelierPro"
GF_BRAND_COMPANY="Atelier Software SAS"
GF_BRAND_COMPANY_LEGAL="Atelier Software SAS"
GF_BRAND_TAGLINE="La gestion d'atelier, simplifiée"
GF_BRAND_WORDMARK_PRIMARY="Atelier"
GF_BRAND_WORDMARK_SECONDARY="Pro"
GF_BRAND_PRIMARY_COLOR="#111827"
GF_BRAND_PRIMARY_DARK_COLOR="#0b1220"
GF_BRAND_ACCENT_COLOR="#38bdf8"
GF_BRAND_MARKETING_DOMAIN="atelierpro.example"
GF_BRAND_APP_DOMAIN="app.atelierpro.example"
GF_BRAND_DOCS_DOMAIN="atelierpro.example/aide"
GF_BRAND_SUPPORT_EMAIL="aide@atelierpro.example"
GF_BRAND_SUPPORT_PHONE="+33 1 23 45 67 89"
GF_BRAND_SUPPORT_URL="https://atelierpro.example/aide"
GF_BRAND_MAIL_FROM_NAME="AtelierPro"
GF_BRAND_MAIL_FROM="no-reply@atelierpro.example"
GF_BRAND_MAIL_REPLY_TO="aide@atelierpro.example"
GF_BRAND_LEGAL_ENTITY="Atelier Software SAS"
GF_BRAND_LEGAL_SIREN="000000000"
GF_BRAND_LEGAL_ADDRESS="1 rue de l'Atelier, 75000 Paris"
GF_BRAND_EXE_PRODUCT_NAME="AtelierPro"
GF_BRAND_APP_ID="com.ateliersoftware.pro"
GF_BRAND_EXECUTABLE_NAME="AtelierPro"
GF_BRAND_COMMERCIAL_EMAIL="sales@atelierpro.example"
GF_BRAND_COMMERCIAL_URL="https://atelierpro.example"
```

A full brand can also be injected as inline JSON:
`GF_BRAND_CONFIG='{"productName":"AtelierPro", ...}'`.

---

## 4. Rebrand via `brand.config.json`

Drop this file at the project root (it is git-ignored friendly — treat it as
environment config). Partial files are valid; unspecified keys keep the default.

```json
{
  "productName": "AtelierPro",
  "shortName": "AtelierPro",
  "companyName": "Atelier Software SAS",
  "companyLegalName": "Atelier Software SAS",
  "tagline": "La gestion d'atelier, simplifiée",
  "wordmark": { "primary": "Atelier", "secondary": "Pro" },
  "colors": { "primary": "#111827", "primaryDark": "#0b1220", "accent": "#38bdf8" },
  "domains": {
    "marketing": "atelierpro.example",
    "app": "app.atelierpro.example",
    "docs": "atelierpro.example/aide"
  },
  "support": { "email": "aide@atelierpro.example", "phone": "", "url": "https://atelierpro.example/aide" },
  "mail": { "fromName": "AtelierPro", "fromAddress": "no-reply@atelierpro.example", "replyTo": "aide@atelierpro.example" },
  "legal": {
    "entity": "Atelier Software SAS",
    "termsUrl": "https://atelierpro.example/conditions",
    "privacyUrl": "https://atelierpro.example/rgpd",
    "legalNoticeUrl": "https://atelierpro.example/mentions-legales"
  },
  "commercial": { "email": "sales@atelierpro.example", "url": "https://atelierpro.example" }
}
```

---

## 5. Image assets to replace

| Asset | Path | Notes |
|-------|------|-------|
| Logo mark (UI) | `src/components/brand/logo-mark.png` | Imported by `GarageFlowLogo.tsx` |
| App icon (PNG/SVG) | `icon.png`, `icon.svg` | Source icons; `npm run icons` regenerates derivatives |
| Windows installer icon | `icon.ico` | Referenced by `electron-builder` (`win.icon`, `nsis.installerIcon`) |
| PWA / favicon | `public/` (icons, `favicon.ico`) + `src/app/icon.png` | Next.js metadata icons |

Keep the same file names to avoid touching imports, or update the paths in
`assets.*` and the importing components.

---

## 6. Windows packaging metadata (build-time)

`electron-builder` reads `package.json` at build time — it does **not** read
`brand.ts`. To rebrand the installer, change these `package.json` keys:

```jsonc
{
  "name": "garageflow",            // npm package id (lowercase)
  "productName": "GarageFlow",     // shown during install / in Windows
  "author": "GarageFlow",
  "build": {
    "appId": "com.garageflow.app",         // reverse-DNS id
    "productName": "GarageFlow",
    "copyright": "Copyright © 2026 GarageFlow",
    "win": { "icon": "icon.ico" },
    "nsis": { "installerIcon": "icon.ico", "uninstallerIcon": "icon.ico" }
  }
}
```

**This is now automated.** `scripts/apply-brand.js` reads `brand.config.json`
(or `GF_BRAND_*` env) and patches all of the above **plus**
`app.setAppUserModelId(...)` in `electron/main.js`, from one source:

```bash
npm run brand:apply     # patch package.json + electron/main.js from the brand
npm run brand:check     # dry-run; exits 1 if packaging is out of sync (CI-friendly)
```

`predist` runs `apply-brand` automatically, so `npm run dist` always builds the
installer with the active brand. The transform is idempotent and its pure
functions are unit-tested (`src/lib/__tests__/apply-brand.test.ts`). Example
round-trip: with `brand.config.json = {"productName":"AtelierPro","companyName":
"Atelier SAS","packaging":{"appId":"com.atelier.pro","productName":"AtelierPro"}}`,
`npm run brand:apply` sets `name→atelierpro`, `productName→AtelierPro`,
`author→Atelier SAS`, `build.appId→com.atelier.pro`, `build.copyright→…Atelier
SAS`, and the Electron app-user-model id — no manual edits.

---

## 7. What is already centralised vs. still inline (honest inventory)

**Centralised now (change once, applies everywhere):**
- Product name (`APP_CONFIG.name` → `BRAND.productName`).
- All identity/colour/domain/support/mail/legal/commercial values available to
  any server component or module that imports `BRAND`.

**Now wired (done):**
- `src/components/GarageFlowLogo.tsx` reads the wordmark **and accent colour**
  from the client brand (`CLIENT_BRAND.wordmark` / `.colors`) — the logo lockup
  and the two-word wordmark rebrand from configuration.
- `src/app/layout.tsx` metadata (`title`, `applicationName`, Apple web-app title,
  description) derive from the server `BRAND`.
- `src/config/app.ts` `APP_CONFIG.name` derives from `BRAND.productName`.
- **Client-safe brand layer** `src/config/brand.client.ts`: a `use client`
  component can import `CLIENT_BRAND` (fs-free) — values come from the shared
  defaults (`brand.defaults.ts`) overridden by `NEXT_PUBLIC_GF_BRAND_*` (below).
  A test guards against drift between client and server defaults.

**Client-side override variables** (inlined at build by Next.js — the browser only
ever sees `NEXT_PUBLIC_*`): `NEXT_PUBLIC_GF_BRAND_PRODUCT_NAME`,
`…_SHORT_NAME`, `…_TAGLINE`, `…_WORDMARK_PRIMARY`, `…_WORDMARK_SECONDARY`,
`…_PRIMARY_COLOR`, `…_PRIMARY_DARK_COLOR`, `…_ACCENT_COLOR`, `…_SUPPORT_URL`,
`…_MARKETING_DOMAIN`. Set these at build time to rebrand the client UI; use the
`GF_BRAND_*` / `brand.config.json` layer (§3-4) for the server side.

**Two distinct brands from one codebase (demo):** build once with the GarageFlow
defaults, and once with e.g. `NEXT_PUBLIC_GF_BRAND_PRODUCT_NAME=AtelierPro
NEXT_PUBLIC_GF_BRAND_WORDMARK_PRIMARY=Atelier
NEXT_PUBLIC_GF_BRAND_WORDMARK_SECONDARY=Pro
NEXT_PUBLIC_GF_BRAND_ACCENT_COLOR=#38bdf8` — the logo wordmark, accent colour and
window/tab title all change with **no code edit**.

**User-facing product name — now swept (done):** the ~38 inline "GarageFlow"
display strings across components/pages (login, licence, portal, dashboard,
licence/crash/update modals, admin) and server routes (test e-mail, TOTP issuer,
default SMTP sender, installer file name) now derive from the brand config
(`CLIENT_BRAND.productName` client-side, `BRAND` server-side). Verify with
`grep -rn 'GarageFlow' src/components src/app` — the only remaining hit is a
non-visible JSX comment. Product-name literals: ~38 → 0.

**Still inline today (documented, not yet wired to `BRAND`):**
- 16 references to `garageflows.fr` / `garageflow.app` domains in `src` and
  `electron`. The `electron/main.js` default update server
  (`https://app.garageflows.fr`) is env-overridable via `GF_UPDATE_SERVER` /
  `GF_LICENSE_SERVER` and does **not** require a code edit.
- E-mail templates and legal pages (`/conditions`, `/rgpd`) contain inline
  brand copy on the marketing site (`garagesite3`).

**Why this split:** `brand.ts` gives an acquirer a validated, testable control
point today, and this section is the precise backlog to reach 100% coverage —
estimated at well under a day of mechanical edits, all guarded by TypeScript.

---

## 8. Recommended next steps to reach full coverage

1. ~~Wire `GarageFlowLogo.tsx` to brand~~ **done** (`CLIENT_BRAND.wordmark`/`.colors`).
2. ~~Sweep the remaining literal "GarageFlow" strings~~ **done** (product-name
   literals ~38 → 0; only a JSX comment remains).
3. ~~Add a `scripts/apply-brand.js` build step~~ **done** — `npm run brand:apply`
   / `brand:check`, wired via `predist` (see §6).
4. Migrate the remaining hard-coded `garageflows.fr` domains to `BRAND.domains`
   where they are not already env-overridable. *(still to do)*
5. Add a Tailwind theme bridge so `colors.primary` drives CSS variables. *(still to do)*

Each step is independently testable and does not change behaviour — only the
brand surface.
