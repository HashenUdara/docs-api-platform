"""
Rewrite site-root asset/search references to be /ai-gateway/-relative.

MkDocs generates base_url as '../' * depth for each page. Served under
/api-platform/docs-staging/ai-gateway/<version>/..., '../' * depth climbs
past /ai-gateway/ to the docs-staging root, where API Manager's deployment
answers asset/search requests instead of the correct AI Gateway version.

Removing one level makes assets resolve to /ai-gateway/assets/ and search
to /ai-gateway/search/ — the router locations that proxy to the right backend.
__md_scope is rewritten by the same one-level reduction so Material's search
plugin fetches the index from /ai-gateway/search/ rather than the staging root.

Only site-root paths are affected (the full depth-based prefix). Doc images
at /ai-gateway/<version>/assets/ use one fewer ../ and are not touched.
"""


def on_post_page(output, page, config, **kwargs):
    url = page.url.rstrip("/")
    depth = len([p for p in url.split("/") if p])
    if depth < 2:
        return output
    old_up = "../" * depth
    new_up = "../" * (depth - 1)
    output = output.replace(f'"{old_up}assets/', f'"{new_up}assets/')
    output = output.replace(f"'{old_up}assets/", f"'{new_up}assets/")
    output = output.replace(f'"{old_up}search/', f'"{new_up}search/')
    output = output.replace(f"'{old_up}search/", f"'{new_up}search/")
    # Rewrite __md_scope so the Material search plugin resolves its index URL
    # to /ai-gateway/search/ (handled by the router) instead of the staging
    # root, where the catch-all would serve the common deployment's index.
    output = output.replace(f'=new URL("{old_up}",location)', f'=new URL("{new_up}",location)')
    return output
