#!/usr/bin/env python3
"""Publish one search index and breadcrumb map for every product in root-index.json.

Each product deployment builds its own search/search_index.json and
assets/search-breadcrumbs.json. Pages on staging all request one search file,
and theme.js loads one breadcrumb map from this deployment, so both are rebuilt
here. The product list is the same root-index.json the navbar uses. Only the
current host of each product is fetched, which is the set the main branch
indexes in a single site build.

Platform-common pages (overview, get started, analytics, and the other
unversioned sections) are kept whole. From every other deployment, only
paths that start with that product's slug are kept, so a second copy of
get-started/ is not added.

The source list is /app/root-index.json, the copy baked into the image.
The file mounted over /usr/share/nginx/html/root-index.json is the public
staging list and is not used here. A failed fetch leaves that host's pages
and crumbs from the previous files in place.

Outputs default to /tmp/docs-search/ because Choreo runs the container
filesystem read-only; nginx serves those paths via alias (see nginx.conf).
"""

import fcntl
import json
import os
import sys
import tempfile
import urllib.request
from urllib.parse import urlparse

ROOT_INDEX = os.environ.get("ROOT_INDEX_PATH", "/app/root-index.json")
OUTPUT = os.environ.get(
    "SEARCH_INDEX_PATH", "/tmp/docs-search/search_index.json"
)
BREADCRUMBS_OUTPUT = os.environ.get(
    "SEARCH_BREADCRUMBS_PATH",
    "/tmp/docs-search/search-breadcrumbs.json",
)
LOCK = os.environ.get("SEARCH_INDEX_LOCK", "/tmp/search-index.lock")
TIMEOUT = int(os.environ.get("SEARCH_INDEX_FETCH_TIMEOUT", "90"))


def origin_of(url):
    parsed = urlparse(url)
    return "%s://%s" % (parsed.scheme, parsed.netloc)


def fetch_json(url):
    request = urllib.request.Request(url, headers={"User-Agent": "docs-shared-search"})
    with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
        return json.load(response)


def load_json(path):
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def previous_docs():
    if not os.path.exists(OUTPUT):
        return []
    try:
        return load_json(OUTPUT).get("docs", [])
    except (OSError, ValueError) as error:
        print("could not read previous index: %s" % error, file=sys.stderr)
        return []


def previous_breadcrumbs():
    if not os.path.exists(BREADCRUMBS_OUTPUT):
        return {}
    try:
        data = load_json(BREADCRUMBS_OUTPUT)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError) as error:
        print("could not read previous breadcrumbs: %s" % error, file=sys.stderr)
        return {}


def starts_with_slug(location, slugs):
    return any(location.startswith(slug + "/") for slug in slugs)


def atomic_write_json(path, payload):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(
        dir=os.path.dirname(path), prefix=".search-merge-", suffix=".tmp"
    )
    with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, separators=(",", ":"))
    os.replace(temporary, path)


def main():
    lock_handle = open(LOCK, "w")
    try:
        fcntl.flock(lock_handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        print("search index refresh already running")
        return 0

    root = load_json(ROOT_INDEX)
    products = root["products"]
    common_host = origin_of(root["_platformCommonBase"])

    hosts = {}
    for slug, info in products.items():
        manifest = info.get("manifestUrl")
        if not manifest:
            print("skipping %s: no manifestUrl" % slug, file=sys.stderr)
            continue
        hosts.setdefault(origin_of(manifest), []).append(slug)

    ordered_hosts = sorted(hosts, key=lambda host: host != common_host)
    other_slugs = [
        slug
        for host, slugs in hosts.items()
        if host != common_host
        for slug in slugs
    ]
    carried = previous_docs()
    carried_crumbs = previous_breadcrumbs()
    docs = []
    seen = set()
    breadcrumbs = {}
    config = None
    failures = []
    refreshed = []
    crumb_hosts = []

    def take(doc):
        location = doc.get("location", "")
        if location in seen:
            return
        seen.add(location)
        docs.append(doc)

    def take_crumbs(mapping, host, slugs):
        if not isinstance(mapping, dict):
            return
        for key, crumbs in mapping.items():
            if host != common_host and not starts_with_slug(key, slugs):
                continue
            if host == common_host and starts_with_slug(key, other_slugs):
                continue
            breadcrumbs[key] = crumbs

    for host in ordered_hosts:
        slugs = hosts[host]
        url = host + "/search/search_index.json"
        try:
            data = fetch_json(url)
        except Exception as error:
            failures.append("%s: %s" % (url, error))
            if host == common_host:
                for doc in carried:
                    if not starts_with_slug(doc.get("location", ""), other_slugs):
                        take(doc)
                take_crumbs(carried_crumbs, host, slugs)
            else:
                for doc in carried:
                    if starts_with_slug(doc.get("location", ""), slugs):
                        take(doc)
                take_crumbs(carried_crumbs, host, slugs)
            continue
        refreshed.append(host)
        if config is None or host == common_host:
            config = data.get("config") or config
        for doc in data.get("docs", []):
            location = doc.get("location", "")
            if host != common_host and not starts_with_slug(location, slugs):
                continue
            take(doc)

        crumb_url = host + "/assets/search-breadcrumbs.json"
        try:
            crumb_data = fetch_json(crumb_url)
        except Exception as error:
            failures.append("%s: %s" % (crumb_url, error))
            take_crumbs(carried_crumbs, host, slugs)
            continue
        crumb_hosts.append(host)
        take_crumbs(crumb_data, host, slugs)

    if not refreshed:
        print("all search index fetches failed; keeping the previous file", file=sys.stderr)
        for line in failures:
            print(line, file=sys.stderr)
        return 1

    if not docs:
        print("no search documents collected", file=sys.stderr)
        return 1

    payload = {
        "config": config
        or {
            "lang": ["en"],
            "separator": "[\\s\\-]+",
            "pipeline": ["stopWordFilter"],
        },
        "docs": docs,
    }
    atomic_write_json(OUTPUT, payload)
    atomic_write_json(BREADCRUMBS_OUTPUT, breadcrumbs)
    print(
        "wrote %s documents and %s breadcrumbs from %s index hosts / %s crumb hosts (%s failed)"
        % (
            len(docs),
            len(breadcrumbs),
            len(refreshed),
            len(crumb_hosts),
            len(failures),
        )
    )
    for line in failures:
        print(line, file=sys.stderr)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as error:
        print("search index refresh failed: %s" % error, file=sys.stderr)
        sys.exit(1)
