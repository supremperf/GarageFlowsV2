# Security Policy — GarageFlow

This document is the **responsible-disclosure policy** for the GarageFlow
ecosystem (desktop `GarageFlowsV2` and control-plane `garagesite3`). For the
security *architecture*, threat model and test plan, see `docs/SECURITY.md`,
`docs/SECURITY_ARCHITECTURE.md`, `docs/THREAT_MODEL.md` and
`docs/SECURITY_TEST_PLAN.md`.

## Reporting a vulnerability

Please report suspected vulnerabilities privately. Do **not** open a public
issue for security matters.

- Contact: the security e-mail configured for the deployment (see the brand
  configuration — `support`/`commercial` addresses). For the reference brand
  this is the support address of `garageflows.fr`.
- Include: affected component (desktop / PWA / control-plane), version, a clear
  description, reproduction steps, and impact.
- Please allow a reasonable time for remediation before any public disclosure.

We aim to acknowledge reports promptly and to keep reporters informed of
remediation progress.

## Scope

In scope:
- The Electron desktop application and its embedded server.
- The PWA served from the shared codebase.
- The `garagesite3` control-plane (licensing, updates, crash reporting, admin,
  public API) and marketing site.

Out of scope:
- Findings that require physical access to an already-compromised machine.
- Denial of service via volumetric attacks.
- Social-engineering and third-party services not operated by the vendor.

## Supported versions

The latest released desktop version and the currently deployed control-plane are
supported. Older desktop versions receive security updates through the signed
auto-update channel (Ed25519-signed manifests, SHA-256 verified before
execution).

## Security posture (summary)

GarageFlow ships a deliberately hardened baseline. Highlights (with pointers):

- **Desktop isolation:** `contextIsolation`, `sandbox`, `nodeIntegration:false`,
  loopback-only embedded server, navigation allowlist (`electron/main.js`,
  `electron/preload.js`).
- **Signed updates:** Ed25519 manifest is mandatory when a key is embedded;
  SHA-256 verified *before* the installer is executed (`electron/update-verify.js`).
- **Licensing:** ECDSA P-256 tokens, HWID binding, AES-256-GCM at-rest storage
  keyed by the hardware fingerprint plus the OS keystore.
- **Control-plane:** fail-closed environment validation, Redis-backed
  distributed rate limiting, constant-time admin-key comparison, audited denials.
- **Multi-tenant isolation:** query-level `garageId` scoping plus a 2nd-order
  IDOR relation guard (`src/lib/tenant.ts`), proven by tests.

## Known limitations (honest disclosure)

The following are documented, not hidden. See
`docs/acquisition-data-room/16_KNOWN_LIMITATIONS.md` and
`docs/VULNERABILITY_MANAGEMENT.md` for detail and remediation plans:

- Local desktop anti-tamper/integrity is JavaScript-level and, by design, not a
  hard DRM guarantee; license enforcement is fail-open on network errors.
- Portal 2FA TOTP secrets are **encrypted at rest** (AES-256-GCM, dedicated key
  `GF_TOTP_ENC_KEY` or a session-derived key, versioned format `gtotp1.…`, with
  backward-compatible read and lazy re-encryption of legacy plaintext on the next
  successful login). Backup codes are stored hashed. A per-account 2FA rate limit
  bounds brute-force.
- The licensing back-office authenticates against a single shared admin key
  (per-operator IAM/MFA/RBAC is a planned hardening item).
- Transitive dependency advisories exist (e.g. `sharp`/libvips); tracked in
  `docs/VULNERABILITY_MANAGEMENT.md`.
