# Skill Nova Backend Security Audit

**Audit date:** 2026-10-17  
**Scope:** `backend/src` application code, middleware, route authorization, service and repository query construction, authentication, finance, reports, file storage, logging, and existing automated tests.  
**Latest validation:** `npm test` passed (17 test files, 110 tests), including a disposable MongoDB replica-set lifecycle suite; `npm run build` and the E2E TypeScript check passed. No external penetration test was performed.

## Executive summary

Institute scoping is consistently applied in the core CRM, student, finance, staff, and report data paths reviewed. Protected routers authenticate first and then apply role/permission controls or perform equivalent checks in the service layer. Sensitive file reads are private and tenant checked. Production errors return a generic message and correlation ID without stack traces.

The audit found and fixed four access-control gaps: student self-service could query other students in the same institute; teacher academic read paths were not consistently assigned-batch scoped; students could retrieve classmate assignment submissions and had the `batch.enroll` permission; and counsellors could reach financial reports through the broad `report.view` grant. Certificate verification was also limited to the requesting student’s own record for student-role callers.

## Coverage and findings

| Area | Result | Notes |
|---|---|---|
| Authentication and password storage | Pass | Password hashes use bcrypt cost 12 and are excluded by default from Mongoose reads. Login responses use explicit safe fields. |
| Access and refresh tokens | Pass with limitation | Access tokens use HS256, fixed algorithm verification, expiry, and current database user/institute checks. Refresh tokens are random opaque values; only SHA-256 hashes are stored and rotation consumes the previous token. |
| Logout/session invalidation | Limitation | Logout revokes the refresh session. Existing access JWTs remain usable until their short expiry (default 15 minutes). `authVersion` is checked, but no application-level user/session administration flow currently increments it or revokes all sessions. |
| Brute-force and API abuse | Partial | Login has per-IP rate limiting plus per-user failed-attempt locking. The general limiter is also per-process memory. A distributed deployment needs a shared limiter store and correct trusted-proxy configuration; unknown-account attempts rely on IP throttling. |
| Authorization and RBAC | Pass after fixes | Routes enforce permissions, and services repeat checks for sensitive operations. Student self-enrollment permission was removed. Counselor financial report access is denied at service level. |
| Institute isolation and IDOR | Pass in reviewed paths after fixes | Reads, writes, and report aggregation use the authenticated institute ID. User-supplied institute IDs are rejected when different. Student self-service, assigned teacher data, and certificate verification now have additional record-level scope. Cross-institute-style foreign-ID cases were added for leads, students, payments, expenses, staff, and reports. |
| MongoDB query injection | Pass | Global input middleware rejects `$` and `.` keys recursively. Query values are validated, strict schemas are used for writes, and user search terms are regex-escaped. |
| Mass assignment and input validation | Pass with review caveat | Most request schemas are strict and server-owned institute/actor fields are applied by services. Continue to review hand-written controller validation when adding endpoints. |
| Financial authorization | Pass in reviewed workflows | Payments, refunds, expenses, approvals, salary actions, accounts, and periods check permissions and institute scope. Expense and salary approval prevent self-approval; payment creation and financial multi-record workflows use transactions. |
| File upload and access | Pass in reviewed implementation | Private local storage uses opaque UUID keys and restrictive file modes. Uploads have a 20 MB cap, file-name checks, extension/MIME/magic validation, and metadata commit only after successful storage. Downloads check tenant, permission, related record, and return `no-store`/`nosniff` headers. |
| Sensitive data exposure | Pass with residual caveat | Passwords, refresh tokens, identity details, secure storage references, and assessment answer keys are filtered from audit snapshots or model serialization. Certificate verification still returns student identity to authorized non-student verifiers by design. |
| Logging and errors | Pass | Authorization/cookie headers are redacted. Error responses omit stacks and internal exception details. Server logs retain full exception details for operational diagnosis. |
| CORS and HTTP headers | Pass | Helmet is installed; powered-by is disabled. CORS uses an exact configured origin allowlist with credentials and rejects unlisted origins. |
| Environment secrets | Pass | Runtime configuration is validated; `.env.example` contains placeholders only. Production secrets must be provided through deployment environment/secret management. |
| Audit records | Pass | Audit entries are append-only at the Mongoose model layer and tenant-scoped on reads. Sensitive snapshot keys are removed. |

## Fixes made during this audit

- Constrained student list and ID lookups by the student’s linked user account.
- Scoped teacher course, batch, enrollment, and timetable reads to assigned batches; scoped student reads to enrolled batches and own enrollment rows.
- Scoped teacher enrollment writes to assigned batches and removed `batch.enroll` from the student role.
- Restricted assignment submission listing for student accounts to their own submission.
- Required financial-report permissions for revenue, expense, cash flow, profitability, and dashboard data; counsellors retain CRM reporting access.
- Restricted certificate verification for student accounts to their own certificate.
- Added regression tests for those access boundaries and institute-scoped query construction.

## Test evidence

- Full suite: **17 test files passed, 110 tests passed**.
- TypeScript: `npm run build` and the separate E2E type check passed.
- Lifecycle tests exercise the real Express app against a disposable MongoDB replica set, including transactions, tenant boundaries, all five roles, CRM-to-certificate progression, payment reversal, account transactions, expenses, salary, ledgers, cash flow, and P&L.
- Tests also cover failed login/lockout, expired access token, refresh rotation, logout refresh revocation, permission denial, financial self-approval, invalid files and inputs, audit protections, and query operator rejection.

## Production follow-up

1. Use a shared rate-limit store across application replicas and configure trusted proxy handling for the actual deployment topology.
2. Decide whether logout should also invalidate access tokens immediately. Current access-token lifetime bounds the remaining window.
3. Add an administrative session revocation/password-reset flow that increments `authVersion` and revokes stored refresh sessions when user administration is implemented.
4. Run the E2E suite against the deployment replica set, reverse proxy, and configured object-storage provider before launch. The automated MongoDB replica-set tests do not exercise production network edges or an external object-storage provider.
5. Consider normalizing the CORS rejection into an explicit 403 response. It currently remains non-disclosing but is handled as a generic server error by the central error handler.
