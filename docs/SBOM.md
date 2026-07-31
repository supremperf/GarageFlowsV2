# Software Bill of Materials (SBOM) — GarageFlow

**Scope:** two codebases — **Desktop** (`GarageFlowsV2`, Electron + Next.js 14 + SQLite/Prisma) and **Cloud control-plane** (`garagesite3`, Next.js 15 + PostgreSQL/Prisma).

**Generated:** 2026-07-31, from the committed `package.json` / `package-lock.json` and the installed `node_modules/*/package.json` of each repository (`npm ls --prod --depth=0` for the resolved runtime tree; license fields read per package).

> **Provenance / integrity notice.** This SBOM is **derived from package manifests**. It is **not** a signed CycloneDX or SPDX artifact and carries no cryptographic attestation. For a machine-verifiable supply-chain document, generate a signed CycloneDX SBOM in CI (e.g. `cyclonedx-npm`) before closing. Transitive components are represented by the notable copyleft/licensing-relevant ones rather than exhaustively; the resolved lockfiles remain the source of truth for the full transitive graph.

**Legend — Type:** `Direct-runtime` = direct dependency shipped/used at runtime · `Direct-build` = direct devDependency (build/test/packaging only) · `Transitive` = pulled in indirectly.

---

## Desktop — `GarageFlowsV2`

| Component | Version | License | Type |
|---|---|---|---|
| next | 14.2.35 | MIT | Direct-runtime |
| react | 18.3.1 | MIT | Direct-runtime |
| react-dom | 18.3.1 | MIT | Direct-runtime |
| next-auth | 4.24.15 | ISC | Direct-runtime |
| @prisma/client | 5.22.0 | Apache-2.0 | Direct-runtime |
| prisma | 5.22.0 | Apache-2.0 | Direct-runtime |
| @anthropic-ai/sdk | 0.79.0 | MIT | Direct-runtime |
| @dnd-kit/core | 6.3.1 | MIT | Direct-runtime |
| @dnd-kit/sortable | 8.0.0 | MIT | Direct-runtime |
| @dnd-kit/utilities | 3.2.2 | MIT | Direct-runtime |
| bcryptjs | 2.4.3 | MIT | Direct-runtime |
| clsx | 2.1.1 | MIT | Direct-runtime |
| date-fns | 3.6.0 | MIT | Direct-runtime |
| framer-motion | 11.18.2 | MIT | Direct-runtime |
| html2canvas | 1.4.1 | MIT | Direct-runtime |
| immer | 10.2.0 | MIT | Direct-runtime |
| jspdf | 4.2.1 | MIT | Direct-runtime |
| lucide-react | 0.400.0 | ISC | Direct-runtime |
| nodemailer | 7.0.13 | MIT-0 | Direct-runtime |
| qrcode | 1.5.4 | MIT | Direct-runtime |
| react-hot-toast | 2.6.0 | MIT | Direct-runtime |
| tailwind-merge | 2.6.1 | MIT | Direct-runtime |
| uuid | 10.0.0 | MIT | Direct-runtime |
| zod | 4.3.6 | MIT | Direct-runtime |
| zustand | 4.5.7 | MIT | Direct-runtime |
| @types/nodemailer | 7.0.11 | MIT | Direct-runtime (types) |
| @types/qrcode | 1.5.6 | MIT | Direct-runtime (types) |
| electron | 31.7.7 | MIT | Direct-build (redistributed in binary) |
| electron-builder | 24.13.3 | MIT | Direct-build |
| typescript | 5.9.3 | Apache-2.0 | Direct-build |
| tailwindcss | 3.4.19 | MIT | Direct-build |
| autoprefixer | 10.x | MIT | Direct-build |
| postcss | 8.x | MIT | Direct-build |
| eslint | 8.57.1 | MIT | Direct-build |
| eslint-config-next | 14.2.35 | MIT | Direct-build |
| vitest | 4.1.5 | MIT | Direct-build |
| @vitest/coverage-v8 | 4.1.x | MIT | Direct-build |
| cross-env | 7.0.3 | MIT | Direct-build |
| ts-node | 10.9.2 | MIT | Direct-build |
| sharp | 0.33.5 | Apache-2.0 | Direct-build (icon generation) |
| @img/sharp-libvips-* (libvips) | (bundled by sharp 0.33.5) | LGPL-3.0-or-later | Transitive (native, build-time) |
| lightningcss (+ platform binaries) | (Tailwind/Next chain) | MPL-2.0 | Transitive (build-time) |
| axe-core | (tooling) | MPL-2.0 | Transitive (build-time) |
| dompurify | (via jspdf) | MPL-2.0 OR Apache-2.0 → Apache-2.0 elected | Transitive (runtime) |

**Runtime engines redistributed inside the Electron binary:** Chromium (BSD-style + third-party) and Node.js (MIT + third-party), via `electron` (MIT). Their bundled license texts ship with the Electron distribution.

---

## Cloud control-plane — `garagesite3`

| Component | Version | License | Type |
|---|---|---|---|
| next | 15.5.20 | MIT | Direct-runtime |
| react | 18.3.1 | MIT | Direct-runtime |
| react-dom | 18.3.1 | MIT | Direct-runtime |
| @prisma/client | 5.22.0 | Apache-2.0 | Direct-runtime |
| prisma | 5.22.0 | Apache-2.0 | Direct-runtime |
| @vercel/blob | 2.6.1 | Apache-2.0 | Direct-runtime |
| framer-motion | 11.18.2 | MIT | Direct-runtime |
| nodemailer | 6.10.1 | MIT-0 | Direct-runtime |
| react-icons | 5.7.0 | MIT | Direct-runtime |
| zod | 3.25.76 | MIT | Direct-runtime |
| typescript | 5.9.3 | Apache-2.0 | Direct-build |
| tailwindcss | 3.4.19 | MIT | Direct-build |
| autoprefixer | 10.5.4 | MIT | Direct-build |
| postcss | 8.5.21 | MIT | Direct-build |
| eslint | 8.57.1 | MIT | Direct-build |
| eslint-config-next | 15.1.6 | MIT | Direct-build |
| vitest | 2.1.9 | MIT | Direct-build |
| @types/node | 20.x | MIT | Direct-build (types) |
| @types/react | 18.x | MIT | Direct-build (types) |
| @types/react-dom | 18.x | MIT | Direct-build (types) |
| @types/nodemailer | 6.4.x | MIT | Direct-build (types) |
| @img/sharp-libvips-* (libvips) | (transitive via sharp / Next image) | LGPL-3.0-or-later | Transitive (native) |
| axe-core | (tooling) | MPL-2.0 | Transitive (build-time) |

---

## License distribution summary

| License | Character | Present in |
|---|---|---|
| MIT / MIT-0 | Permissive | Both repos (majority) |
| ISC | Permissive | Desktop (next-auth, lucide-react) |
| Apache-2.0 | Permissive | Both (Prisma, TypeScript, @vercel/blob, sharp) |
| LGPL-3.0-or-later | Weak copyleft (library) | Both — libvips, transitive, dynamically linked, unmodified |
| MPL-2.0 | File-level copyleft | Both — lightningcss/axe-core (build tooling), unmodified |
| MPL-2.0 OR Apache-2.0 | Dual-licensed | Desktop — dompurify (Apache-2.0 elected) |
| **GPL / AGPL / SSPL** | **Strong copyleft** | **None found in either repo** |

**Proprietary-sale compatibility:** no strong copyleft present; copyleft components are transitive and used in ways that impose attribution obligations only. Full analysis in `docs/OPEN_SOURCE_LICENSE_AUDIT.md`; attribution list in `../THIRD_PARTY_NOTICES.md`.

---
Voir aussi : `docs/ACQUISITION_READINESS_AUDIT.md`.
