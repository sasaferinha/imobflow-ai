# Conversation read hardening — 2026-09-15

## Delivered scope

- Overview conversation read returns up to 200 recent messages, not full message history.
- Opening a contact fetches its 50 most recent messages, scoped by authenticated company and lead.
- Older pages use a stable `(created_at,id)` cursor. No rows are deleted or truncated in storage.
- Delivery status and outbox enrichment are restricted to messages in the returned page.
- Client merges by message ID; older pages remain available after refresh. A detected gap after a burst resets the older-page cursor so missing pages remain reachable.
- Main lead/conversation refresh: 15 seconds; open conversation: 10 seconds; properties/appointments: 30 seconds. Local writes still invalidate subscriptions immediately; hidden documents skip reads.
- Additive indexes support company/recent, company/conversation/recent, and company/external delivery lookup.
- Next configuration now declares MIME sniffing prevention, restrictive cross-origin referrers and same-origin framing as defaults. Vercel already supplies these protections and its global framing header remains the stricter `DENY`; the demo has its existing explicit CSP `frame-ancestors 'self'` exception.

## Verification

`node scripts/test-conversation-pagination.cjs` uses a local PGlite database with 12,050 fictional messages, tied timestamps, all pages traversed without duplicates or omissions, and 30 interleaved tenant contexts. It rejects foreign lead reads and malformed cursors and tests client history merging. It never calls external services or sends messages.

Existing production test suite and Next compilation passed locally. Production release includes this regression test as a build gate.

Production verified: `www.imobflow.net.br/api/version` returned `dpl_DutY1HgUubxENswdtoPP94UPn44f`. All three indexes were confirmed in `pg_indexes`. Landing, panel login, presentation, demo and database health returned HTTP 200; unauthenticated conversations returned 401. Public demonstration contact switching was visually checked. Authenticated production UI was not exercised because the available browser has no logged-in session.

## Explicit limitations / follow-up

This is not a production load benchmark or independent penetration test. PGlite interleaving does not represent 30 simultaneous database connections or 390 browsers.

Lead, property and conversation metadata lists still use whole-list reads with an existing 10,000-row safety cap. Paginate these independently before datasets reach that scale. Broad service credentials remain in the backend; do not claim database RLS automatically constrains privileged server calls.

Remaining acceptance work: staging multi-browser/HTTP load test with provider mocks and production-equivalent compute; percentile latency and failure budgets; backup restore exercise; administrative MFA and previously shared credential rotation verification; independent security review. No production load or disruptive secret rotation was performed.
