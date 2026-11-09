# VPN Panel security and improvement review

Review date: 2026-11-09

Scope: backend, frontend, deployment scripts, systemd service, authentication, subscription delivery, engine control, update mechanisms, and VPN configuration generation.

## Executive summary

Do not expose the current management panel directly to the Internet without remediation. The highest-risk issues are:

1. Public subscription URLs accept low-entropy identifiers (`client ID`, email, and `inbound:<id>`); UUIDs are bearer credentials that can also be leaked, so an attacker can obtain VPN access.
2. The WebSocket endpoint has no authentication and `/ws` bypasses the secret base-path check, exposing live system and engine telemetry.
3. The panel defaults to plaintext HTTP and silently falls back to HTTP when TLS setup fails.
4. Management and update endpoints are session-authenticated but not consistently admin-only and have no CSRF protection.
5. The panel service runs as root with `NoNewPrivileges=false`; a panel compromise becomes a host compromise.
6. Client and inbound expiry/traffic limits are not enforced in generated sing-box/Xray configurations.

The secret URL path is useful as a scanner-noise reduction measure, but it is not an authentication or authorization boundary.

## Critical findings

### C1. Guessable public subscriptions disclose VPN credentials

`/api/sub/:token` accepts UUIDs, emails, numeric client IDs, and `inbound:<id>` prefixes. The inbound form is deterministic and returns all active clients for that inbound. Numeric IDs are trivial to enumerate.

Evidence:

- [Client.js](/Users/katoaroosultan/Documents/GitHub/vpn-panel/backend/src/models/Client.js:42)
- [subscription.js](/Users/katoaroosultan/Documents/GitHub/vpn-panel/backend/src/api/subscription.js:160)

Impact: an unauthenticated attacker who guesses an ID or email can receive live proxy links, passwords, UUIDs, and subscription profiles.

Required change:

- Remove ID/email/inbound-token lookup from public feeds.
- Create a separate 128-bit-or-longer random subscription token per client/profile; store only a hash and support revocation/rotation.
- Do not expose tokens in ordinary list APIs. Reveal them only on an explicit, re-authenticated action.
- Add `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, and strict per-token/IP rate limits.
- Consider serving subscriptions from a separate minimal listener/reverse-proxy location that cannot reach the management API.

### C2. Unauthenticated WebSocket, including a base-path bypass

The upgrade handler accepts `/ws` even when a secret base path is configured, and it never verifies a session, origin, or client limit.

Evidence:

- [index.js](/Users/katoaroosultan/Documents/GitHub/vpn-panel/backend/src/index.js:293)
- [traffic.js](/Users/katoaroosultan/Documents/GitHub/vpn-panel/backend/src/services/traffic.js:27)

Impact: anyone can read system/engine telemetry; unlimited connections can trigger expensive status/process checks and exhaust resources.

Required change:

- Require an authenticated session during the upgrade handshake.
- Remove the unconditional `/ws` alternative when a base path is configured.
- Validate `Origin`, cap concurrent connections, add ping/pong timeouts, and rate-limit reconnects.
- Avoid returning binary paths, PIDs, service names, and other host details to non-admin users.

### C3. Plaintext HTTP is the default and TLS failure is fail-open

The server binds to every interface and starts over HTTP when certificates are absent or cannot be loaded. The installer and README present HTTP as the normal access URL.

Evidence:

- [index.js](/Users/katoaroosultan/Documents/GitHub/vpn-panel/backend/src/index.js:74)
- [index.js](/Users/katoaroosultan/Documents/GitHub/vpn-panel/backend/src/index.js:314)
- [README.md](/Users/katoaroosultan/Documents/GitHub/vpn-panel/README.md:76)

Impact: admin credentials, sessions, and generated VPN credentials can be intercepted.

Required change:

- Require HTTPS in production; fail startup if TLS is configured but invalid.
- Prefer binding the management service to `127.0.0.1` behind a hardened Caddy/Nginx endpoint, or require a firewall/VPN allowlist.
- Set HSTS only when HTTPS is guaranteed and configure `trust proxy` explicitly for a known proxy.
- Use a configured public origin for generated links; do not trust arbitrary `Host` or `X-Forwarded-Host` headers.

### C4. Management and update actions are not consistently admin-only and lack CSRF protection

The engine router and inbound router apply only `requireAuth`, so any authenticated role can mutate VPN state or invoke service controls. The codebase defines a `viewer` role but does not enforce read-only behavior.

Evidence:

- [engine.js](/Users/katoaroosultan/Documents/GitHub/vpn-panel/backend/src/api/engine.js:14)
- [inbounds.js](/Users/katoaroosultan/Documents/GitHub/vpn-panel/backend/src/api/inbounds.js:25)

The global CORS policy reflects arbitrary origins while allowing credentials, which is unsafe for cookie-authenticated management endpoints.

- [index.js](/Users/katoaroosultan/Documents/GitHub/vpn-panel/backend/src/index.js:113)

The login limiter is mounted before the base-path rewrite, so login requests through a configured secret path do not match `/api/auth/login` and can bypass that limiter.

- [index.js](/Users/katoaroosultan/Documents/GitHub/vpn-panel/backend/src/index.js:149)
- [index.js](/Users/katoaroosultan/Documents/GitHub/vpn-panel/backend/src/index.js:153)

Required change:

- Require `requireAdmin` for all mutations, engine controls, settings changes, and updates.
- Add CSRF tokens or strict `Origin`/`Referer` validation for every cookie-authenticated state-changing request.
- Replace `origin: true` with an explicit same-origin allowlist, or remove CORS for the management API.
- Apply rate limiting after canonical path normalization and add a global authenticated-request limiter.
- Regenerate the session on login, use a production session store, and revoke all sessions after a password change.

### C5. The management process runs as root

The systemd unit does not set a service user and explicitly disables `NoNewPrivileges`. It can write `/etc` configuration files, start/stop services, replace binaries, and run shell commands.

Evidence:

- [vpn-panel.service](/Users/katoaroosultan/Documents/GitHub/vpn-panel/deploy/vpn-panel.service:7)
- [singbox.js](/Users/katoaroosultan/Documents/GitHub/vpn-panel/backend/src/services/singbox.js:100)
- [xray.js](/Users/katoaroosultan/Documents/GitHub/vpn-panel/backend/src/services/xray.js:107)

Impact: an XSS, dependency compromise, session compromise, or endpoint bug can become arbitrary root code execution.

Required change:

- Run the HTTP panel as a dedicated unprivileged user.
- Move privileged operations to a small, separately installed helper with a strict allowlist and narrowly scoped systemd/sudo/polkit permissions.
- Use `execFile`/argument arrays instead of shell command strings; whitelist service names and paths.
- Add systemd hardening (`NoNewPrivileges=true`, `ProtectSystem=strict`, `ProtectHome=true`, `PrivateDevices=true`, `RestrictAddressFamilies`, `ReadWritePaths`, capability bounding, and syscall restrictions).

### C6. Quotas and expiry are not enforced by the engines

Both engines include every enabled client regardless of `expiry_time` or `total_bytes_limit`. The subscription endpoint filters expired/over-limit clients, but previously issued direct links continue to work.

Evidence:

- [singbox.js](/Users/katoaroosultan/Documents/GitHub/vpn-panel/backend/src/services/singbox.js:182)
- [xray.js](/Users/katoaroosultan/Documents/GitHub/vpn-panel/backend/src/services/xray.js:196)

Required change:

- Enforce expiry and quota before generating each engine configuration.
- Add a scheduler that disables expired/over-limit clients and atomically reapplies the relevant engine config.
- Define behavior for counter reset, clock skew, and failed config application.
- Treat a failed apply/restart as an API failure; do not return success while the running engine still has old credentials.

## High-priority findings

### H1. Client secrets are stored and returned in plaintext

Passwords are stored directly in SQLite and returned through client/inbound APIs, links, QR payloads, generated YAML, and JSON. The frontend renders them in ordinary client lists.

Evidence:

- [database.js](/Users/katoaroosultan/Documents/GitHub/vpn-panel/backend/src/config/database.js:62)
- [inbounds.js](/Users/katoaroosultan/Documents/GitHub/vpn-panel/backend/src/api/inbounds.js:79)
- [Clients.jsx](/Users/katoaroosultan/Documents/GitHub/vpn-panel/frontend/src/pages/Clients.jsx:241)

Required change:

- Return redacted client objects by default; require explicit re-authentication for reveal/export.
- Encrypt credentials at rest using a key outside the database, with a documented rotation procedure.
- Protect generated config files and backups with mode `0600`, restricted ownership, encryption, and retention limits.
- Never print admin passwords in installer output, CI logs, or update logs.

### H2. Weak/default authentication and production session defaults

The code still has a known `admin/admin123` fallback, only six characters are required for password changes, and `express-session` uses its default in-memory store. A missing session secret is silently regenerated on restart.

Evidence:

- [app-config.js](/Users/katoaroosultan/Documents/GitHub/vpn-panel/backend/src/config/app-config.js:28)
- [app-config.js](/Users/katoaroosultan/Documents/GitHub/vpn-panel/backend/src/config/app-config.js:94)
- [auth.js](/Users/katoaroosultan/Documents/GitHub/vpn-panel/backend/src/api/auth.js:20)
- [index.js](/Users/katoaroosultan/Documents/GitHub/vpn-panel/backend/src/index.js:123)

Required change:

- Refuse startup with default/placeholder credentials or secrets.
- Require a strong password (prefer 12+ characters and breached-password screening) and add MFA/WebAuthn for administrators.
- Use a persistent, bounded session store (SQLite/Redis), secure `__Host-` cookies, and explicit idle/absolute timeouts.
- Use a constant-time dummy bcrypt comparison when a username does not exist, and log/alert repeated failures.

### H3. Missing request validation and object-level authorization

Inbound/client mutation routes accept raw JSON without Joi schemas. Client routes do not verify that the client belongs to the inbound in the URL, enabling cross-inbound IDORs. Settings accepts arbitrary key/value names and values.

Evidence:

- [inbounds.js](/Users/katoaroosultan/Documents/GitHub/vpn-panel/backend/src/api/inbounds.js:171)
- [inbounds.js](/Users/katoaroosultan/Documents/GitHub/vpn-panel/backend/src/api/inbounds.js:437)
- [inbounds.js](/Users/katoaroosultan/Documents/GitHub/vpn-panel/backend/src/api/inbounds.js:486)
- [settings.js](/Users/katoaroosultan/Documents/GitHub/vpn-panel/backend/src/api/settings.js:37)

Required change:

- Add strict schemas for every endpoint: protocol enum, port range, address format, credential format, byte limits, timestamps, and bounded string lengths.
- Reject unknown fields and reject empty/duplicate credentials.
- Check parent ownership for every `/:id/clients/:clientId` operation.
- Use database uniqueness constraints and transactions for inbound/client creation and config application.

### H4. Unsafe TLS defaults in generated client configurations

Trojan Clash output always sets `skip-cert-verify: true`. Hysteria links default to insecure verification when the SNI is an IP address, which is the installer's default host mode.

Evidence:

- [link-generator.js](/Users/katoaroosultan/Documents/GitHub/vpn-panel/backend/src/utils/link-generator.js:81)
- [link-generator.js](/Users/katoaroosultan/Documents/GitHub/vpn-panel/backend/src/utils/link-generator.js:375)

Required change:

- Default to certificate verification.
- Require a valid certificate/SNI for TLS protocols, or make insecure mode an explicit, prominently warned exception.
- Add tests that fail if generated links disable verification unexpectedly.

### H5. Update and installation supply-chain risk

The panel downloads and replaces executables and application code from GitHub without verifying a signed release, checksum, or pinned commit. Binary archives are extracted as root. The backend has no lockfile, and production installs use `npm install` rather than a locked install.

Evidence:

- [binary-updater.js](/Users/katoaroosultan/Documents/GitHub/vpn-panel/backend/src/services/binary-updater.js:72)
- [binary-updater.js](/Users/katoaroosultan/Documents/GitHub/vpn-panel/backend/src/services/binary-updater.js:281)
- [panel-updater.js](/Users/katoaroosultan/Documents/GitHub/vpn-panel/backend/src/services/panel-updater.js:341)
- [update.sh](/Users/katoaroosultan/Documents/GitHub/vpn-panel/deploy/update.sh:99)

Required change:

- Publish signed, immutable releases and verify signatures/checksums before installation.
- Pin repository commits/tags, validate archive paths, stage updates in a new directory, run tests/config checks, then switch atomically.
- Keep a tested rollback of the complete application, dependencies, configuration, and database.
- Add `backend/package-lock.json` and use `npm ci --omit=dev`; add automated dependency and secret scanning.

### H6. sing-box allows private-network access by default

The generated sing-box route sends private IP traffic to `direct`, while the Xray route blocks private addresses. A VPN client can therefore use sing-box to reach internal services, loopback-adjacent networks, or cloud metadata paths unless separately blocked.

Evidence:

- [singbox.js](/Users/katoaroosultan/Documents/GitHub/vpn-panel/backend/src/services/singbox.js:234)
- [xray.js](/Users/katoaroosultan/Documents/GitHub/vpn-panel/backend/src/services/xray.js:288)

Required change:

- Block loopback, RFC1918, link-local, IPv6 local ranges, and cloud metadata addresses by default.
- Permit private destinations only through an explicit administrator allowlist.
- Add regression tests for SSRF/internal-network access through every supported protocol.

## Medium-priority findings

### M1. Unbounded resource consumption

Public subscriptions and QR generation have no rate limit. Log line counts are not bounded. WebSocket clients and traffic logs are unbounded, and `traffic_logs` has no retention job.

Add per-IP/per-token limits, strict numeric bounds, maximum response sizes, connection caps, database indexes/retention, and backpressure.

### M2. Unsafe generated YAML and host handling

Remarks, SNI values, passwords, and other user-controlled fields are interpolated into YAML strings rather than serialized with a YAML library. `Host`/`X-Forwarded-Host` is used to construct links when `server_ip` is empty.

Use a real serializer, validate hostnames/IPs, configure a trusted proxy explicitly, and use a fixed public origin.

### M3. Error and browser hardening gaps

The global error handler returns `err.message` to clients, which can expose filesystem/command details. Content Security Policy is disabled, and no explicit management-only security policy is documented.

Return generic production errors with request IDs, keep details in restricted logs, enable a nonce-based CSP, and add `Referrer-Policy`, `Permissions-Policy`, and strict transport headers.

### M4. Missing auditability and account administration

There is no audit trail for logins, credential reveals, settings changes, engine controls, deletes, or updates. A role column exists, but there is no secure user-management API, account disablement, session revocation, or administrator MFA flow.

Implement append-only audit records with actor, source address, action, target, result, and timestamp; add safe account administration and recovery procedures.

### M5. Reality key generation fallback is cryptographically invalid

If the Xray command fails, `/gen-keypair` returns two unrelated random values labelled private/public keys. This can create a configuration that looks valid in the UI but cannot provide a valid Reality handshake.

Use a supported X25519 implementation or fail closed with an actionable error; never label unrelated random values as a key pair.

## UX and operational experience review

This is a static source review of the current frontend and its API behavior. The visual language is reasonably consistent, navigation is simple, search and engine filters exist, protocol-specific fields are grouped, and most asynchronous actions have basic loading/toast feedback. The main UX problems are not cosmetic: the interface can report an incorrect state or imply that an action took effect when it did not.

### UX0. Status indicators are not trustworthy

Several prominent indicators are static or map missing data to a healthy state:

- The header always says `Live Sync`, regardless of WebSocket connectivity.
- The sidebar always says `Dual-Core Active` and shows a hard-coded `v1.2.0`.
- Update cards render `Up to date` when update data is missing or the request failed.
- The dashboard renders zeroes, `Online`, or `Service Stopped` while data is still loading or unavailable.

Evidence:

- [Header.jsx](/Users/katoaroosultan/Documents/GitHub/vpn-panel/frontend/src/components/layout/Header.jsx:42)
- [Sidebar.jsx](/Users/katoaroosultan/Documents/GitHub/vpn-panel/frontend/src/components/layout/Sidebar.jsx:75)
- [Settings.jsx](/Users/katoaroosultan/Documents/GitHub/vpn-panel/frontend/src/pages/Settings.jsx:318)
- [Dashboard.jsx](/Users/katoaroosultan/Documents/GitHub/vpn-panel/frontend/src/pages/Dashboard.jsx:28)
- [EngineCard.jsx](/Users/katoaroosultan/Documents/GitHub/vpn-panel/frontend/src/components/ui/EngineCard.jsx:12)

Required change:

- Define explicit `loading`, `healthy`, `degraded`, `offline`, `stale`, and `unknown` states. Never turn missing data into zero, stopped, online, or up-to-date.
- Connect the header indicator to real WebSocket state and show the last successful update time.
- Fetch the installed panel version and actual engine states; remove hard-coded operational labels.
- Preserve the last known data during a transient failure, visibly mark it stale, and provide retry details.
- Use text and icons in addition to color for every status.

### UX0. Settings claim success even when values do not affect runtime

The UI lets an administrator edit the panel port and core binary paths, but the running services read these from startup environment configuration rather than the settings table. Certificate changes are read only during server startup. The UI still reports `Settings saved successfully` without explaining that a restart or external configuration change is required.

Evidence:

- [Settings.jsx](/Users/katoaroosultan/Documents/GitHub/vpn-panel/frontend/src/pages/Settings.jsx:106)
- [app-config.js](/Users/katoaroosultan/Documents/GitHub/vpn-panel/backend/src/config/app-config.js:25)
- [index.js](/Users/katoaroosultan/Documents/GitHub/vpn-panel/backend/src/index.js:47)
- [singbox.js](/Users/katoaroosultan/Documents/GitHub/vpn-panel/backend/src/services/singbox.js:13)
- [xray.js](/Users/katoaroosultan/Documents/GitHub/vpn-panel/backend/src/services/xray.js:13)

Required change:

- Choose one configuration source and make every editable setting use it.
- Make detected binary paths read-only unless the backend can validate and activate a change.
- Validate host, port, certificate/key pairing, file readability, and port conflicts before saving.
- Show a review of changes and their impact, then apply/restart transactionally.
- Report `saved`, `restart required`, `applied`, and `failed/rolled back` as separate outcomes.
- Warn about unsaved changes before navigation or modal closure.

### UX0. Success feedback can be false

Inbound creation says `created and deployed`, while backend engine application errors are swallowed. The global `Apply Configs` action also returns success after catching individual engine failures. This gives the operator false confidence that new credentials are live.

Evidence:

- [AddInboundModal.jsx](/Users/katoaroosultan/Documents/GitHub/vpn-panel/frontend/src/components/modals/AddInboundModal.jsx:336)
- [inbounds.js](/Users/katoaroosultan/Documents/GitHub/vpn-panel/backend/src/api/inbounds.js:54)
- [inbounds.js](/Users/katoaroosultan/Documents/GitHub/vpn-panel/backend/src/api/inbounds.js:542)
- [Header.jsx](/Users/katoaroosultan/Documents/GitHub/vpn-panel/frontend/src/components/layout/Header.jsx:10)

Required change:

- Do not show success until configuration validation, atomic write, restart, and post-restart health checks pass.
- Return and display a per-engine result with the failing step and a safe recovery action.
- Decide on one mental model: either mutations apply immediately, or changes are staged and explicitly applied. The current mix of auto-apply and a global `Apply Configs` button is ambiguous.
- For a staged model, show a persistent `Unapplied changes` banner with review, validate, apply, and discard actions.
- For an immediate model, move manual apply into a repair/diagnostics area and label it accordingly.

### UX1. Critical actions are too easy to trigger

Stop, restart, update, reset-traffic, toggle, edit, and delete controls are small adjacent icons. Some use browser `confirm`, others have no confirmation, and reset traffic is destructive but immediate. The panel update begins as soon as its modal opens and cannot be closed while running.

Evidence:

- [EngineCard.jsx](/Users/katoaroosultan/Documents/GitHub/vpn-panel/frontend/src/components/ui/EngineCard.jsx:57)
- [Inbounds.jsx](/Users/katoaroosultan/Documents/GitHub/vpn-panel/frontend/src/pages/Inbounds.jsx:195)
- [PanelUpdateModal.jsx](/Users/katoaroosultan/Documents/GitHub/vpn-panel/frontend/src/components/modals/PanelUpdateModal.jsx:38)

Required change:

- Separate common actions from destructive/privileged actions using an overflow menu.
- Use a consistent confirmation dialog that states scope and impact, such as number of affected clients and expected downtime.
- Require re-authentication for credential export, binary/panel updates, and other high-impact operations.
- Disable repeated actions while pending and show the operation on the affected row/card, not only in a transient toast.
- Make update review and update execution separate steps; show version, source, signature/checksum status, backup state, and rollback availability before starting.

### UX1. Client management is duplicated and omits the most important state

Clients can be created and edited from both the Inbounds page and Clients page with separate forms and slightly different behavior. The directory prominently displays credentials but does not show expiry, quota, percent used, expired/over-limit state, or last activity.

Evidence:

- [Inbounds.jsx](/Users/katoaroosultan/Documents/GitHub/vpn-panel/frontend/src/pages/Inbounds.jsx:177)
- [Clients.jsx](/Users/katoaroosultan/Documents/GitHub/vpn-panel/frontend/src/pages/Clients.jsx:166)
- [ClientModal.jsx](/Users/katoaroosultan/Documents/GitHub/vpn-panel/frontend/src/components/modals/ClientModal.jsx:206)

Required change:

- Use one shared client form and one detail surface everywhere.
- Keep Inbounds focused on listeners; link to a filtered client directory for an inbound.
- Add status, expiry, quota progress, last activity, engine/inbound, and subscription-token state to the client directory.
- Hide credentials by default; use explicit reveal/copy/export actions with clear audit feedback.
- Add engine/protocol/status/expiry filters, sorting, pagination, bulk disable/revoke, and CSV export that excludes secrets by default.
- Distinguish `disabled`, `expired`, `quota reached`, and `engine unavailable`; a single Active toggle is insufficient.

### UX1. The inbound wizard needs progressive disclosure and preflight checks

The first step is clear, but the second step combines general settings, TLS/Reality keys, transport, protocol internals, quota, expiry, and initial client creation in one long modal. Advanced defaults such as a large UDP port-hopping range can be enabled without verifying certificates, firewall rules, port availability, or engine support.

Evidence:

- [AddInboundModal.jsx](/Users/katoaroosultan/Documents/GitHub/vpn-panel/frontend/src/components/modals/AddInboundModal.jsx:349)
- [AddInboundModal.jsx](/Users/katoaroosultan/Documents/GitHub/vpn-panel/frontend/src/components/modals/AddInboundModal.jsx:440)

Required change:

- Use three focused steps: protocol and use case, required connection settings, then review and preflight.
- Put advanced transport and anti-censorship options behind an `Advanced` disclosure with protocol-safe defaults.
- Before deployment, validate port conflicts, certificate/SNI compatibility, key pairs, firewall requirements, engine version support, and generated configuration.
- Show the exact endpoints/ports that will open and whether each is TCP or UDP.
- Save a local/server draft so closing a long form does not discard work.
- After successful creation, lead directly to the primary next action: create/review client, copy subscription, or run a connectivity check.

### UX1. Mobile layouts are technically scrollable but not task-friendly

The main data views remain wide desktop tables with many columns and clusters of 28-pixel icon buttons. The global apply action disappears below the `sm` breakpoint without an alternative. Long modals and the fixed 650-pixel log view are awkward on short screens.

Evidence:

- [Inbounds.jsx](/Users/katoaroosultan/Documents/GitHub/vpn-panel/frontend/src/pages/Inbounds.jsx:120)
- [Clients.jsx](/Users/katoaroosultan/Documents/GitHub/vpn-panel/frontend/src/pages/Clients.jsx:203)
- [Header.jsx](/Users/katoaroosultan/Documents/GitHub/vpn-panel/frontend/src/components/layout/Header.jsx:48)
- [Logs.jsx](/Users/katoaroosultan/Documents/GitHub/vpn-panel/frontend/src/pages/Logs.jsx:99)

Required change:

- Use compact responsive rows/cards on mobile with the primary status and action visible; move secondary actions into a menu.
- Keep touch targets at least 44 by 44 pixels and prevent adjacent destructive actions.
- Use viewport/dynamic-height modal layouts with sticky headers and footers.
- Ensure every desktop action has a discoverable mobile equivalent.
- Test at 320, 375, and 768 pixel widths, landscape mobile, 200% zoom, and long translated labels.

### UX1. Accessibility foundations are incomplete

Most modal overlays are custom divs without dialog semantics, focus trapping, Escape handling, initial focus, or focus restoration. Many icon buttons rely on `title`, labels are not associated with inputs, focus outlines are removed, and status often relies on color.

Evidence:

- [ConfirmModal.jsx](/Users/katoaroosultan/Documents/GitHub/vpn-panel/frontend/src/components/ui/ConfirmModal.jsx:7)
- [Toggle.jsx](/Users/katoaroosultan/Documents/GitHub/vpn-panel/frontend/src/components/ui/Toggle.jsx:4)
- [Sidebar.jsx](/Users/katoaroosultan/Documents/GitHub/vpn-panel/frontend/src/components/layout/Sidebar.jsx:25)
- [index.css](/Users/katoaroosultan/Documents/GitHub/vpn-panel/frontend/src/index.css:58)

Required change:

- Use an accessible dialog primitive or implement `role="dialog"`, `aria-modal`, labelled descriptions, focus trap, Escape close, and focus restoration.
- Add programmatic names to every icon-only button and each switch; associate labels and validation errors with inputs.
- Use visible `:focus-visible` rings throughout and do not make hover the only discoverable state.
- Announce toasts, update progress, connection changes, and validation errors through appropriate live regions.
- Raise small body/help text from 10-12 pixels where possible and verify WCAG AA contrast.
- Respect reduced-motion preferences and avoid pulsing status as the sole signal.

### UX2. Logs need operator tools rather than terminal decoration

The log page replaces the entire text block every four seconds. It lacks search, severity filters, timestamps controls, pause-on-scroll, copy/download, line count selection, wrapping control, and a clear stale/error state. Decorative terminal dots and a hard-coded binary path consume space without helping diagnosis.

Evidence:

- [Logs.jsx](/Users/katoaroosultan/Documents/GitHub/vpn-panel/frontend/src/pages/Logs.jsx:14)
- [Logs.jsx](/Users/katoaroosultan/Documents/GitHub/vpn-panel/frontend/src/pages/Logs.jsx:99)

Required change:

- Add follow/pause, search, severity/time filters, selectable line count, wrap toggle, copy, and redacted download.
- Preserve scroll position unless follow mode is enabled.
- Distinguish `clear display` from deleting server logs.
- Show fetch time, source, stale state, and actionable retrieval errors.

### UX2. Export is powerful but overwhelming and exposes secrets casually

The export modal combines subscription QR, direct node QR, Clash YAML, sing-box JSON, Hysteria YAML, raw plugin parameters, and compatibility switches. Credentials are visible by default and subscription links can be opened in a new browser tab, increasing history/referrer exposure.

Evidence:

- [QRModal.jsx](/Users/katoaroosultan/Documents/GitHub/vpn-panel/frontend/src/components/modals/QRModal.jsx:205)
- [QRModal.jsx](/Users/katoaroosultan/Documents/GitHub/vpn-panel/frontend/src/components/modals/QRModal.jsx:287)

Required change:

- Start with a client/app selector and present one recommended import method.
- Place raw links and configuration formats under advanced export options.
- Mask credentials and require reveal/copy intent; warn that exports grant VPN access.
- Support token rotation/revocation from the same surface and show token creation/last-use metadata.
- Avoid opening bearer subscription URLs in a normal tab; provide a protected preview instead.

### UX2. Error, empty, and scale behavior needs completion

Several fetch failures are silently ignored, so failed requests can appear as empty or healthy screens. Client pages refetch all inbounds, clients, generated links, YAML, JSON, and secrets every five seconds. This will become slow and visually noisy as usage grows. The production bundle is also about 903 KB before gzip and emits a Vite large-chunk warning.

Evidence:

- [Settings.jsx](/Users/katoaroosultan/Documents/GitHub/vpn-panel/frontend/src/pages/Settings.jsx:43)
- [useInbounds.js](/Users/katoaroosultan/Documents/GitHub/vpn-panel/frontend/src/hooks/useInbounds.js:8)
- [Clients.jsx](/Users/katoaroosultan/Documents/GitHub/vpn-panel/frontend/src/pages/Clients.jsx:48)

Required change:

- Give every page distinct loading, empty, error, offline, and permission-denied states with retry actions.
- Use summary/list endpoints with server pagination and filters; fetch credentials/config exports only on demand.
- Pause background polling in hidden tabs and replace overlapping polling with a shared live-update source.
- Lazy-load routes, charts, and large modals; split vendor chunks.
- Preserve form input after validation/network failures and place errors next to the relevant fields.

### Suggested UX implementation order

1. Make status, save, apply, and update results truthful; implement unknown/stale/error states.
2. Make critical actions safe and reconcile immediate versus staged configuration behavior.
3. Consolidate client workflows and expose quota/expiry/health rather than credentials.
4. Add inbound preflight/review and settings validation/restart handling.
5. Fix modal, keyboard, focus, contrast, and touch accessibility.
6. Build responsive data views, operator-grade logs, on-demand export, and scalable APIs.

## Recommended implementation order

### Phase 0 - before Internet exposure

- Disable public management access or put it behind an allowlisted administrative VPN/reverse proxy.
- Close `/ws` until authentication and origin checks exist.
- Disable in-panel updates until release verification and admin-only authorization are implemented.
- Require HTTPS, rotate admin credentials/session secrets, and remove the default credential text from the UI and README.
- Replace all existing subscription URLs/tokens after deploying random-token support.
- Block private, loopback, link-local, and metadata destinations in both engines.

### Phase 1 - authentication and authorization

- Add persistent sessions, session regeneration, CSRF protection, strict CORS, admin/viewer enforcement, MFA, and session revocation.
- Add strict object-level authorization and request schemas.
- Redact secrets from ordinary responses and add explicit re-authentication for export/reveal actions.

### Phase 2 - privileged operations and updates

- Split the unprivileged web process from a small privileged helper.
- Harden all systemd units and replace shell interpolation with allowlisted argument-based process execution.
- Implement signed/pinned update artifacts, checksums, atomic staging, rollback, and locked dependency installs.

### Phase 3 - VPN correctness and operations

- Enforce quotas/expiry in the running engine configuration and add failure-aware config deployment.
- Serialize configuration writes/restarts and add health checks before reporting success.
- Add traffic-log retention, audit logs, backups with encryption/permissions, and recovery tests.

### Phase 4 - verification

- Add unit tests for auth, CSRF, IDOR, token revocation, host handling, YAML/JSON serialization, quota expiry, and private-network blocking.
- Add integration tests that start the panel with a temporary SQLite database and fake engine binaries.
- Add CI for `npm ci`, linting, tests, `npm audit`, secret scanning, shellcheck, and dependency/license review.

## Verification performed during this review

- Backend JavaScript syntax checks: passed.
- Frontend JavaScript syntax checks: passed.
- Frontend production build: passed; Vite emitted a deprecation warning and a large-bundle warning.
- `npm audit`: could not complete because the environment could not resolve `registry.npmjs.org`; run it in CI or a networked build environment.
- No automated backend test suite is present in the repository.

