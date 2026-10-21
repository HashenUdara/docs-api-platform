"""
Rewrite site-root asset/search references to be /ai-gateway/-relative.

MkDocs generates base_url as '../' * depth for each page. Served under
/api-platform/docs-staging/ai-gateway/<version>/..., '../' * depth climbs
past /ai-gateway/ to the docs-staging root, where API Manager's deployment
answers asset/search requests instead of the correct AI Gateway version.

Removing one level makes assets resolve to /ai-gateway/assets/ and search
to /ai-gateway/search/ — the router locations that proxy to the right backend.
__md_scope / config.base are rewritten the same way so Material's search
plugin fetches the index from /ai-gateway/search/ rather than the staging root.

Material emits scope/base without a trailing slash (`../../..`), while asset
hrefs use the slashed form (`../../../assets/`). Both are rewritten.

Only site-root paths are affected (the full depth-based prefix). Doc images
at /ai-gateway/<version>/assets/ use one fewer ../ and are not touched.
"""


def on_post_page(output, page, config, **kwargs):
    url = page.url.rstrip("/")
    depth = len([p for p in url.split("/") if p])
    if depth < 2:
        return output
    old_up = "../" * depth          # ../../../
    new_up = "../" * (depth - 1)    # ../../
    # Scope/base form used in __md_scope and __config (no trailing slash).
    old_base = old_up.rstrip("/")   # ../../..
    new_base = new_up.rstrip("/")   # ../..

    output = output.replace(f'"{old_up}assets/', f'"{new_up}assets/')
    output = output.replace(f"'{old_up}assets/", f"'{new_up}assets/")
    output = output.replace(f'"{old_up}search/', f'"{new_up}search/')
    output = output.replace(f"'{old_up}search/", f"'{new_up}search/")
    # __md_scope=new URL("../../..",location) — drives search index URL
    output = output.replace(
        f'=new URL("{old_base}",location)', f'=new URL("{new_base}",location)'
    )
    output = output.replace(
        f"=new URL('{old_base}',location)", f"=new URL('{new_base}',location)"
    )
    # "base": "../../.." in __config (keep in sync with scope)
    output = output.replace(f'"base": "{old_base}"', f'"base": "{new_base}"')
    output = output.replace(f'"base": "{old_up}"', f'"base": "{new_up}"')
    return output
