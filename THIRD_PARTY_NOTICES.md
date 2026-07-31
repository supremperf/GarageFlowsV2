# Third-Party Notices — GarageFlow

This document lists the notable open-source software (OSS) dependencies distributed with or used to build the two GarageFlow codebases:

- **Desktop** — `GarageFlowsV2` (Electron + Next.js 14 + SQLite/Prisma)
- **Cloud control-plane** — `garagesite3` (Next.js 15 + PostgreSQL/Prisma)

Versions and licenses below were read directly from the installed `node_modules/*/package.json` and the committed `package.json` / `package-lock.json` of each repository on 2026-07-31. This is an informational notices file generated from package manifests; it is **not** a signed CycloneDX/SPDX artifact (see `docs/SBOM.md`).

> Where a package declares an SPDX expression (e.g. dual-licensing), it is reproduced verbatim. `MIT-0` is the MIT No Attribution variant (nodemailer).

---

## Desktop — `GarageFlowsV2` — direct runtime dependencies

| Component | Version | License | Notes |
|---|---|---|---|
| next | 14.2.35 | MIT | Application framework (App Router, standalone output) |
| react | 18.3.1 | MIT | UI runtime |
| react-dom | 18.3.1 | MIT | UI runtime |
| next-auth | 4.24.15 | ISC | Authentication |
| @prisma/client | 5.22.0 | Apache-2.0 | ORM client (SQLite) |
| prisma | 5.22.0 | Apache-2.0 | ORM CLI / engine |
| @anthropic-ai/sdk | 0.79.0 | MIT | Copilot / LLM assist client |
| @dnd-kit/core | 6.3.1 | MIT | Drag-and-drop (planning board) |
| @dnd-kit/sortable | 8.0.0 | MIT | Drag-and-drop sorting |
| @dnd-kit/utilities | 3.2.2 | MIT | Drag-and-drop helpers |
| bcryptjs | 2.4.3 | MIT | Password hashing |
| clsx | 2.1.1 | MIT | Class-name utility |
| date-fns | 3.6.0 | MIT | Date utilities |
| framer-motion | 11.18.2 | MIT | Animations |
| html2canvas | 1.4.1 | MIT | DOM-to-canvas (PDF/print) |
| immer | 10.2.0 | MIT | Immutable state |
| jspdf | 4.2.1 | MIT | PDF generation (invoices/quotes) |
| lucide-react | 0.400.0 | ISC | Icon set |
| nodemailer | 7.0.13 | MIT-0 | Email delivery |
| qrcode | 1.5.4 | MIT | QR code generation |
| react-hot-toast | 2.6.0 | MIT | Toast notifications |
| tailwind-merge | 2.6.1 | MIT | Tailwind class merge |
| uuid | 10.0.0 | MIT | Identifier generation |
| zod | 4.3.6 | MIT | Schema validation |
| zustand | 4.5.7 | MIT | Client state store |

### Desktop — notable build / dev dependencies (not distributed to end users)

| Component | Version | License | Notes |
|---|---|---|---|
| electron | 31.7.7 | MIT | Desktop shell (redistributed at runtime as the app binary) |
| electron-builder | 24.13.3 | MIT | Packaging / NSIS installer |
| typescript | 5.9.3 | Apache-2.0 | Compiler (build-time) |
| tailwindcss | 3.4.19 | MIT | CSS framework (build-time) |
| autoprefixer | 10.x | MIT | PostCSS plugin (build-time) |
| postcss | 8.x | MIT | CSS tooling (build-time) |
| eslint | 8.57.1 | MIT | Linting (build-time) |
| eslint-config-next | 14.2.35 | MIT | Lint config (build-time) |
| vitest | 4.1.5 | MIT | Test runner (build-time) |
| @vitest/coverage-v8 | 4.1.x | MIT | Coverage (build-time) |
| cross-env | 7.0.3 | MIT | Env helper (build-time) |
| ts-node | 10.9.2 | MIT | Seed script runner (build-time) |
| **sharp** | **0.33.5** | **Apache-2.0** (bundles **libvips → LGPL-3.0-or-later**) | Icon generation only (`scripts/generate-icons.js`), build-time. See copyleft note below. |

> **Note — Electron redistribution:** although `electron` is a devDependency, the Electron runtime is packaged into and shipped as the distributed Windows binary. Electron is MIT-licensed; it in turn embeds Chromium and Node.js, which carry their own OSS licenses (BSD-style, MIT, and others) reproduced in the Electron distribution.

---

## Cloud control-plane — `garagesite3` — direct runtime dependencies

| Component | Version | License | Notes |
|---|---|---|---|
| next | 15.5.20 | MIT | Application framework |
| react | 18.3.1 | MIT | UI runtime |
| react-dom | 18.3.1 | MIT | UI runtime |
| @prisma/client | 5.22.0 | Apache-2.0 | ORM client (PostgreSQL) |
| prisma | 5.22.0 | Apache-2.0 | ORM CLI / engine |
| @vercel/blob | 2.6.1 | Apache-2.0 | Installer/blob storage client |
| framer-motion | 11.18.2 | MIT | Animations |
| nodemailer | 6.10.1 | MIT-0 | Email delivery |
| react-icons | 5.7.0 | MIT | Icon set |
| zod | 3.25.76 | MIT | Schema validation |

### Cloud — notable build / dev dependencies (not distributed)

| Component | Version | License | Notes |
|---|---|---|---|
| typescript | 5.9.3 | Apache-2.0 | Compiler (build-time) |
| tailwindcss | 3.4.19 | MIT | CSS framework (build-time) |
| autoprefixer | 10.5.4 | MIT | PostCSS plugin (build-time) |
| postcss | 8.5.21 | MIT | CSS tooling (build-time) |
| eslint | 8.57.1 | MIT | Linting (build-time) |
| eslint-config-next | 15.1.6 | MIT | Lint config (build-time) |
| vitest | 2.1.9 | MIT | Test runner (build-time) |

---

## Copyleft components present (transitive) — disclosure

The following non-permissive licenses appear in the installed dependency trees. None are GPL/AGPL/SSPL, and none impose source-disclosure obligations on GarageFlow's proprietary code under the way they are used (see `docs/OPEN_SOURCE_LICENSE_AUDIT.md` for the full analysis):

| Component | License | Type | How used |
|---|---|---|---|
| @img/sharp-libvips-* (libvips) | LGPL-3.0-or-later | Weak copyleft | Native library bundled by `sharp`; used only as build-time image tooling; dynamically loaded, unmodified. |
| lightningcss (+ platform binaries) | MPL-2.0 | File-level copyleft | Transitive CSS tooling (Tailwind/Next build chain); unmodified, build-time only. |
| axe-core | MPL-2.0 | File-level copyleft | Transitive accessibility/testing tooling; not shipped in the product. |
| dompurify | MPL-2.0 OR Apache-2.0 | Dual-licensed | GarageFlow elects **Apache-2.0**; no copyleft obligation. Transitive (via jspdf). |

---

Full attribution texts are retained inside each package's `node_modules/<pkg>/LICENSE` file in the respective repository. Reproduction of the complete license texts should accompany any binary distribution.

---
Voir aussi : `docs/ACQUISITION_READINESS_AUDIT.md`.
