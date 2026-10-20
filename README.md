# WSO2 API Manager next documentation (deployment branch)

This branch builds and deploys the WSO2 API Manager next documentation at
`https://wso2.com/api-platform/docs/api-manager/next/`.

- **Content** lives in `en/docs/api-manager/next/`. It comes from
  [wso2/docs-apim](https://github.com/wso2/docs-apim) (branch `master`):
  make every docs change there **and** here (one PR to each).
- **Navigation:** the `"next"` block under API Manager in `en/mkdocs.yml`.
  **Redirects:** `en/redirects.yml`.
- **Theme and site-wide assets:** the shared stylesheets, scripts, fonts and
  images under the site's root `/assets/` are served by the
  `platform-common` branch. Change them there.

## Build

```bash
docker build -f Dockerfile.next -t apim-docs-next .
docker run --rm -p 8080:8080 apim-docs-next   # http://localhost:8080/api-manager/next/
```

`Dockerfile.next` trims the nav to this version (`trim-mkdocs-version.py`) and builds
with MkDocs; `Dockerfile.next.dockerignore` keeps only this version's docs in the
build context.
