# 10 — Dépendances tierces

> Ce document peut être présenté en anglais/tabulaire (voir aussi `docs/SBOM.md` et `docs/OPEN_SOURCE_LICENSE_AUDIT.md`). Résultats issus d'un scan de licences complet des deux arbres `node_modules`.

## 1. Executive summary

Dependency and license posture is **clean for a sale**: **all DIRECT dependencies** in both repos are **permissive** (MIT / ISC / Apache-2.0 / BSD). **No strong copyleft** (GPL / AGPL / SSPL) anywhere. Copyleft is limited to **low-risk transitive** components. Main transferability caveats are maintenance-related (framework version split, Electron behind current) rather than licensing blockers.

## 2. Repositories & core stacks

| Repo | Role | Framework | Key runtime deps |
|---|---|---|---|
| `GarageFlowsV2` | Electron desktop app + PWA | Next.js ^14.2.35, Electron ^31.7.7 | Prisma 5, next-auth ^4.24.15, @anthropic-ai/sdk ^0.79.0, react 18, tailwind 3, zod, framer-motion 11 |
| `garagesite3` | Cloud control-plane + site | Next.js ^15.1.6 | Prisma 5, @vercel/blob, nodemailer, react-icons, zod |

Installed versions verified: electron 31.7.7, @anthropic-ai/sdk 0.79.0, next-auth 4.24.15 (ISC), bcryptjs 2.4.3 (MIT), html2canvas 1.4.1 (MIT), jspdf 4.2.1 (MIT).

## 3. License posture

| Category | Finding |
|---|---|
| Direct dependencies (both repos) | **All permissive** (MIT/ISC/Apache-2.0/BSD) — no sale-blocking copyleft |
| Strong/network copyleft (GPL/AGPL/SSPL) | **None** anywhere in either tree |
| Transitive LGPL-3.0 | `@img/sharp-libvips-linux-x64` / `-linuxmusl-x64` — native lib via `sharp`; dev/build-time (icon generation in V2) and Next image optimisation in garagesite3 |
| Transitive MPL-2.0 (file-level copyleft) | `axe-core` (MPL-2.0), `lightningcss` (MPL-2.0), `dompurify` (MPL-2.0 OR Apache-2.0 → Apache electable) — build/test tooling only |
| Other | `caniuse-lite` CC-BY-4.0 (data, standard) |
| Bundled fonts | **None** (no `.woff/.ttf/.otf`); brand logos/PWA icons appear to be the target's own assets |

## 4. Copyleft risk assessment

| Component | License | Linkage / usage | Risk | Action |
|---|---|---|---|---|
| sharp / libvips | LGPL-3.0-or-later | Dynamically-linked native binary, unmodified; dev/build-time & image optimisation | Low | Confirm libvips stays dynamically linked & unmodified; preserve relink rights if ever shipped |
| axe-core, lightningcss | MPL-2.0 | Transitive build/test tooling; MPL files not modified by target | Negligible | None |
| dompurify | MPL-2.0 OR Apache-2.0 | Apache can be elected | Negligible | Elect Apache-2.0 if needed |

MPL is weak, file-level copyleft: obligations attach only to modifications of the MPL files themselves, which the target is not making. No impact on proprietary application code.

## 5. `@anthropic-ai/sdk` — optional AI dependency

- v0.79.0, **MIT**. Used only in GarageFlowsV2 for two optional features (plate OCR `/api/plate-ocr`, plate-lookup fallback `/api/plate-lookup`) plus a stubbed Copilot.
- **Server-side, gated on optional `ANTHROPIC_API_KEY`**: degrades silently (503 / `source:'unknown'`) when absent — the product ships and functions **without any Anthropic dependency**.
- Both AI-calling routes are auth-gated (`requireSession`) and rate-limited per garage, with payload-size caps on OCR.
- The Copilot LLM layer is **provider-agnostic** behind an `LlmProvider` interface and ships deterministic-by-default (no provider bundled) — the LLM vendor is swappable without touching feature code.

## 6. Third-party service dependencies (non-npm)

| Service | Usage | Contractual note |
|---|---|---|
| api-immat.com | Free third-party plate/SIV lookup, tried before Claude fallback | **No contractual SLA** — reliability risk for that feature |
| Vercel (host/Blob) | Cloud hosting + installer storage | Vendor-dependent pricing (see `INFRASTRUCTURE_COST_MODEL.md`) |
| Upstash Redis | Distributed rate limiting | Vendor-dependent pricing |
| PostgreSQL (managed) | Cloud + PWA DB | Vendor-dependent pricing |
| Anthropic API | Optional AI (only if key set) | Usage-based; zero cost if disabled |

## 7. Maintenance / transferability caveats (not blockers)

| Item | Detail |
|---|---|
| Next.js major split | garagesite3 on Next ^15.1.6 vs GarageFlowsV2 on ^14.2.35 — two upgrade tracks |
| Electron 31.7.7 | Several majors behind current → trails Chromium/Node security patches; budget an upgrade cycle |
| next-auth v4 | Legacy line (Auth.js/v5 is the forward path) — functional but deprecating track |
| Effectively-unmaintained-but-stable pins | html2canvas 1.4.1 (no release since 2022), bcryptjs ^2.4.3 (v3 exists) |
| No `engines` field | Node version unconstrained in both package.json — build reproducibility risk |
| Dual Prisma schema (V2) | Desktop + `prisma/server/schema.prisma` generated separately — added build complexity |

## 8. IP / license file note

No LICENSE file existed in either repo at audit time (both `private:true`); a proprietary `LICENSE` has since been added to both repos this session. Ownership transfer remains contractual — see `09_INTELLECTUAL_PROPERTY.md`.

---
*Référence croisée : voir `docs/ACQUISITION_READINESS_AUDIT.md` pour l'audit de préparation complet.*
