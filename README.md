# router_ai-gateway

Experiment: one routing rule for infra instead of one per version - same
pattern as `router_api-manager`, applied to AI Gateway.

Today, infra has to configure a separate gateway rule for every single
`ai-gateway-<version>` deployment. This is a tiny nginx deployment that sits in
front of all of them - infra points ONE rule (`/ai-gateway`) at this
deployment's URL, and `nginx.conf` decides, per version, which real
deployment to invisibly forward to (`proxy_pass`, server-side - the
reader's address bar never sees the raw Choreo URL underneath).

Versions covered: `1.2.0`, `2026.09.24`, `1.1.0`, `1.0.0`, `next` (default: `1.2.0`).

Adding a new AI Gateway version later means editing `nginx.conf` here
and redeploying this one component - infra's gateway rule never changes
again.

This is purely additive: it doesn't modify, replace, or depend on any
existing deployment. Each location block just points at that version's
already-live, unmodified Choreo URL.

## Known gaps (same as router_api-manager)

- The default-version manifest block (`/ai-gateway/product-nav-manifest.json`)
  has to be updated by hand whenever the configured default version changes.
- Backend URLs here are static, resolved once at container start. If a
  version's Choreo URL ever changes, this file needs updating and
  redeploying, same as `SHARED_BASE` in `docs-shared`'s `theme.js`.
