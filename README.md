# docs-shared

Hosts the artifacts every product+version branch depends on at runtime/build
time, so they're maintained in exactly one place instead of copy-pasted
across dozens of branches:

- `assets/theme.js` - client-side cross-product navigation, version
  dropdowns, search breadcrumbs. Every product+version deployment loads this
  via `extra_javascript` in its own `mkdocs.yml`.
- `assets/root-index.json` - the single list of every product's slug, title,
  and `manifestUrl` (where to fetch that product's cross-product nav data),
  plus `_liveSiteBase` (fallback URL for a version not present in the current
  build). `theme.js` fetches this at runtime to build the cross-product
  sidebar.
- `docs_shared_hooks/` - the mkdocs build-hook logic (manifest building,
  cache-busting, redirects, `{BASE_URL}` resolution). Installed by every
  product+version branch via `pip install git+https://github.com/<fork>/docs-api-platform.git@<tag>`
  (see `requirements.txt` in any product branch) - never copied.
- `scripts/build-search-index.py` - builds the single search index every
  staging page requests from `/search/search_index.json`, and the breadcrumb
  map `theme.js` loads for result labels (`AI Gateway › 1.2.0 › …`).

This branch deploys as its own Choreo component (see `Dockerfile`). Product
pages are not built here.

## Search

Material would resolve `search/search_index.json` against the staging site
root (`docs-staging/search/search_index.json`). `theme.js` rewrites that
fetch to this deployment's absolute URL (`SHARED_BASE` +
`search/search_index.json`), same pattern as breadcrumbs, so search does not
depend on the staging gateway's `/search/` rewrite. The page rules for
`/cloud/`, `/api-manager/`, and the other products stay as they are.

On startup, and every 15 minutes (`SEARCH_INDEX_REFRESH_SECONDS`), the
entrypoint runs `scripts/build-search-index.py`. The script reads
`/app/root-index.json` (the copy baked into the image, not the mounted
staging file) and fetches `{host}/search/search_index.json` and
`{host}/assets/search-breadcrumbs.json` from each product host in that list.
Platform-common is fetched once. Its pages and crumbs are kept whole. From
each other host, only paths that start with that product's slug are kept
(`cloud/`, `api-manager/4.7.0/`, and so on). Results are written under
`/tmp/docs-search/` (Choreo's container root filesystem is read-only, so
writing under `/usr/share/nginx/html` fails with `Errno 30`). nginx serves
them at `/search/search_index.json` and `/assets/search-breadcrumbs.json`
via `alias`, and also at the full public staging paths
(`/api-platform/docs-staging/search/search_index.json` and
`/api-platform/docs-staging/assets/search-breadcrumbs.json`) so a gateway
that forwards the URI without stripping the prefix still works.
`theme.js` and `root-index.json` still live at the site root.
`theme.js` loads the breadcrumb file from this deployment (`SHARED_BASE`),
so a landing-page search can label hits from every product the same way
`main` does.

A doc change is deployed on that product branch as usual. The next refresh
reads the new index and breadcrumbs from that product's host. No product
branch is edited, and nothing is copied back. A new product is included by
adding it to `assets/root-index.json` and redeploying this component. If a
host cannot be fetched, that host's pages and crumbs from the previous files
are left in place.

## Choreo config mount

**`root-index.json` is the one file in this whole architecture meant to be
overridden via Choreo's config-file-mount feature**, since it's the only
place a `manifestUrl` lives and it's read at runtime (fetched by the
browser), not baked into any build.

- **File to mount:** `root-index.json`
- **Container path:** `/usr/share/nginx/html/root-index.json`
- **Content:** the `{"products": {...}, "_liveSiteBase": "..."}` structure -
  see the current committed `assets/root-index.json` for the exact shape.

No other file here, and no other branch in this whole project, needs a
config mount. The search builder does not read the mounted file. It reads
`/app/root-index.json`, so it keeps calling each product's own host. Everything
else (the `theme.js` URL baked into each product's `extra_javascript`, the
`docs-shared-hooks` git tag pin in each product's `requirements.txt`, this
branch's own `SHARED_BASE` constant inside `theme.js`) is baked in at build
time and requires an actual commit + rebuild to change - see each product
branch's own `README.md` for that gotcha.

## Tagging

Cut a new `shared-vN` tag whenever `docs_shared_hooks` or `theme.js`
actually changes, then bump every product branch's `requirements.txt` pin to
match - a branch left on an old tag silently keeps using old hook logic with
no warning.
