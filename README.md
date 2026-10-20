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

This branch deploys as its own tiny nginx-only Choreo component (see
`Dockerfile`) - no mkdocs/Python build stage, just static files.

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
config mount. Everything else (the `theme.js` URL baked into each product's
`extra_javascript`, the `docs-shared-hooks` git tag pin in each product's
`requirements.txt`, this branch's own `SHARED_BASE` constant inside
`theme.js`) is baked in at build time and requires an actual commit + rebuild
to change - see each product branch's own `README.md` for that gotcha.

## Tagging

Cut a new `shared-vN` tag whenever `docs_shared_hooks` or `theme.js`
actually changes, then bump every product branch's `requirements.txt` pin to
match - a branch left on an old tag silently keeps using old hook logic with
no warning.
