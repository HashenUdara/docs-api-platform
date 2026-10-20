#!/bin/sh
# Refresh the combined search index, then serve this deployment.
# A later product deploy shows up on the next refresh. The page rules are
# unchanged: staging /search/ is pointed at this host for every product.
set -u

INTERVAL="${SEARCH_INDEX_REFRESH_SECONDS:-900}"

refresh() {
    python3 /app/build-search-index.py || echo "search index refresh failed" >&2
}

refresh
(
    while true; do
        sleep "$INTERVAL"
        refresh
    done
) &

exec nginx -g "daemon off;"
