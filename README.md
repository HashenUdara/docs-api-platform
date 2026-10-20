# WSO2 API Manager 3.0.0 documentation (deployment branch)

This branch builds and deploys the WSO2 API Manager 3.0.0 documentation at
`https://wso2.com/api-platform/docs/api-manager/3.0.0/`.

- **Content** lives in `en/docs/api-manager/3.0.0/`. It comes from
  [wso2/docs-apim](https://github.com/wso2/docs-apim) (branch `3.0.0`):
  make every docs change there **and** here (one PR to each).
- **Navigation:** the `"3.0.0"` block under API Manager in `en/mkdocs.yml`.
  **Redirects:** `en/redirects.yml`.
- **Theme and site-wide assets:** the shared stylesheets, scripts, fonts and
  images under the site's root `/assets/` are served by the
  `platform-common` branch. Change them there.

## Build

```bash
docker build -f Dockerfile.3.0.0 -t apim-docs-3.0.0 .
docker run --rm -p 8080:8080 apim-docs-3.0.0   # http://localhost:8080/api-manager/3.0.0/
```

`Dockerfile.3.0.0` trims the nav to this version (`trim-mkdocs-version.py`) and builds
with MkDocs; `Dockerfile.3.0.0.dockerignore` keeps only this version's docs in the
build context.
