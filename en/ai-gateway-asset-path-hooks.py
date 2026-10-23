"""
Rewrite site-root asset/search references for the AI Gateway router.

MkDocs generates base_url as '../' * depth for each page. Served under
/api-platform/docs-staging/ai-gateway/<version>/..., that climbs past
/ai-gateway/ to the docs-staging root.

We rewrite:
- assets → /ai-gateway/assets/ (product root; Referer-routed by the router)
- search + __md_scope / config.base → /ai-gateway/<version>/ (version root)

Search must be version-pinned in the URL. The shared /ai-gateway/search/
path is Referer-routed, but Material's search worker sends the worker
script URL as Referer (under /ai-gateway/assets/...), so the router always
falls through to the default (latest) index. Version-scoped search URLs
avoid that.

Material emits scope/base without a trailing slash (`../..`), while asset
hrefs use the slashed form (`../../assets/`). Both forms are rewritten.

Only site-root paths are affected (the full depth-based prefix). Doc images
at /ai-gateway/<version>/assets/ use one fewer ../ and are not touched.
"""


def on_post_page(output, page, config, **kwargs):
    url = page.url.rstrip("/")
    parts = [p for p in url.split("/") if p]
    depth = len(parts)
    if depth < 2:
        return output

    version = parts[1] if parts[0] == "ai-gateway" else None

    old_up = "../" * depth  # ../../../
    product_up = "../" * (depth - 1)  # ../../ → /ai-gateway/
    # Version root: one level above the page's directory under <version>/.
    if depth > 2:
        version_up = "../" * (depth - 2)  # ../
    else:
        version_up = "./"

    old_base = old_up.rstrip("/")
    if version_up == "./":
        version_base = "."
    else:
        version_base = version_up.rstrip("/")

    # Assets stay at the product root (Referer-routed).
    output = output.replace(f'"{old_up}assets/', f'"{product_up}assets/')
    output = output.replace(f"'{old_up}assets/", f"'{product_up}assets/")

    # Search + Material scope/base → version root so the index URL is
    # /ai-gateway/<version>/search/search_index.json (router proxies by
    # path, not Referer).
    search_up = version_up if version else product_up
    search_base = version_base if version else product_up.rstrip("/")
    output = output.replace(f'"{old_up}search/', f'"{search_up}search/')
    output = output.replace(f"'{old_up}search/", f"'{search_up}search/")
    output = output.replace(
        f'=new URL("{old_base}",location)', f'=new URL("{search_base}",location)'
    )
    output = output.replace(
        f"=new URL('{old_base}',location)", f"=new URL('{search_base}',location)"
    )
    output = output.replace(f'"base": "{old_base}"', f'"base": "{search_base}"')
    output = output.replace(f'"base": "{old_up}"', f'"base": "{search_up}"')
    return output
