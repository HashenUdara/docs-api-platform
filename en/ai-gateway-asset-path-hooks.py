"""
Rewrite site-root asset/search references for a product version router.

MkDocs generates base_url as '../' * depth for each page. Served under
/api-platform/docs-staging/<product>/<version>/..., that climbs past the
product root to the docs-staging root.

We rewrite:
- assets → /<product>/assets/ (product root; Referer-routed by the router)
- search + __md_scope / config.base → /<product>/<version>/ (version root)

Search must be version-pinned in the URL. Shared /<product>/search/ is
Referer-routed, but Material's search worker sends the worker script URL
as Referer (under /<product>/assets/...), so the router always falls
through to the default (latest) index. Version-scoped search URLs avoid that.

Works for any product slug (ai-gateway, api-gateway, …); the first path
segment is the product and the second is the version when it looks like one.
"""

import re

_VERSION_RE = re.compile(r"^(next|\d[\w.-]*)$", re.IGNORECASE)


def _is_version(segment):
    return bool(segment and _VERSION_RE.match(segment))


def on_post_page(output, page, config, **kwargs):
    url = page.url.rstrip("/")
    parts = [p for p in url.split("/") if p]
    depth = len(parts)
    if depth < 2:
        return output

    version = parts[1] if _is_version(parts[1]) else None

    old_up = "../" * depth  # ../../../
    product_up = "../" * (depth - 1)  # ../../ → /<product>/
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

    # Search + Material scope/base → version root when we have a version.
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
