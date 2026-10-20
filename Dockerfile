# Serves theme.js, root-index.json, and the combined search index for every
# product deployment. Python is used at runtime to refresh that index. There
# is still no mkdocs build on this branch.
FROM nginx:1.26-alpine

COPY --chown=10014:nginx assets /usr/share/nginx/html
COPY --chown=10014:nginx assets/root-index.json /app/root-index.json
COPY --chown=10014:nginx scripts/build-search-index.py /app/build-search-index.py
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
COPY nginx.conf /etc/nginx/conf.d/default.conf

RUN apk upgrade --no-cache libcrypto3 libssl3 \
    && apk add --no-cache python3 \
    && chmod 755 /app/docker-entrypoint.sh \
    && mkdir -p /usr/share/nginx/html/search /usr/share/nginx/html/assets \
    && chown 10014:nginx /usr/share/nginx/html/search /usr/share/nginx/html/assets

RUN adduser -u 10014 -D -H -G nginx appuser \
    && chown -R 10014:nginx /var/log/nginx \
    && chown -R 10014:nginx /var/cache/nginx \
    && chown -R 10014:nginx /etc/nginx/conf.d \
    && sed -i 's|/var/run/nginx.pid|/tmp/nginx.pid|g' /etc/nginx/nginx.conf

USER 10014

EXPOSE 8080

ENTRYPOINT ["/app/docker-entrypoint.sh"]
