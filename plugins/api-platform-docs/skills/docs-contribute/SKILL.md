---
name: docs-contribute
description: Make a change to the WSO2 API Platform documentation and send it to every branch it has to land on. Every docs change goes to its source branch AND its deployment branch. API Manager changes go to wso2/docs-apim (version branch, or master for next) and the apim-<version> branch of wso2/docs-api-platform. API Gateway, AI Gateway, AI Workspace, API Portal, Cloud and the common pages go to main and the matching branch of wso2/docs-api-platform. Theme and styling changes go to platform-common, plus every branch whose templates change, and docs-shared for theme.js or hooks. Use it whenever someone adds, edits, moves or deletes a docs page, image, link, nav entry, redirect or style, e.g. "update the AI Gateway 1.2.0 rate limiting page", "add a new page to API Manager 4.7.0", "fix this image in API Gateway", "change the button style", or "send this doc fix to both branches".
---

# Docs change: source branch + deployment branch

The docs are written in one place and deployed from another. **Every change goes
to both.** A change that only reaches `main` or docs-apim never shows on the
site. A change that only reaches a deployment branch is lost the next time the
branch is synced.

Make the change, port it, verify it and push the branches. Then **stop and
ask the user before opening any PR**: show them what will be opened and wait
for a yes. Also ask the user when they need to choose, such as which versions a
change applies to or where a moved page should redirect.

## 1. Where a change goes

| What changes | Source PR | Deployment PR(s) |
|---|---|---|
| API Manager page, version `<v>` | `wso2/docs-apim` branch `<v>` (`4.7.0`, `3.2.0`…) | `wso2/docs-api-platform` branch `apim-<v>` |
| API Manager, unreleased | `wso2/docs-apim` `master` | `apim-next` |
| `en/docs/<product>/<v>/…` (`api-gateway`, `ai-gateway`, `ai-workspace`, `api-portal`) | `wso2/docs-api-platform` `main` | `<product>-<v>` (`api-gateway-1.2.0`, `ai-gateway-next`, `ai-gateway-2026.09.24`…) |
| `en/docs/cloud/…` | `main` | `cloud` |
| Common pages: `index.md`, `get-started.md`, `llms.txt`, `guides/`, `analytics/`, `monetization/`, `policy-hub/`, `tools/` | `main` | `platform-common` |
| Theme CSS/JS/fonts/images (`en/theme/material/assets/…`) | `main` | `platform-common` (it serves the site's root `/assets/` to every product) |
| Theme templates (`en/theme/material/partials/*.html`, `main.html`…) | `main` | `platform-common` **and every deployment branch** whose pages should change: templates are rendered into each build's HTML |
| `theme.js` behaviour (copy page, version dropdown, cross-product nav) | `docs-shared` branch (`assets/theme.js`) | none; it is deployed on its own, so say so in the PR |
| Build hooks (`docs_shared_hooks`) | `docs-shared` branch, then a new tag | each deployment branch: bump `docs-shared-hooks @ …@<tag>` in `en/requirements.txt` |

- **A change for several versions** (for example 1.2.0 and next) is one source
  PR touching every version folder on `main`, plus one deployment PR per
  version branch. For docs-apim, it is one source PR per version branch.
- **Ask which versions** when the user doesn't say. List the versions that
  have the page, using `git ls-tree` on each branch.
- **Template-only branches** (`*-template`, `apim-template`) and
  `apim-doc-migration` are not deployment branches. Leave them.

## 2. How the branches differ

The same page is written differently on the source branch and the deployment
branch. `scripts/port.py` handles everything marked ✓; the rest is manual.

| | Source | Deployment branch | |
|---|---|---|---|
| Page path | `main`: `en/docs/api-gateway/1.2.0/x.md`. docs-apim `4.7.0`: `en/docs/x.md` | Same path on product branches. `apim-4.7.0`: `en/docs/api-manager/4.7.0/x.md` | ✓ |
| Images | `main`: root `en/docs/assets/img/…`, linked as `../../assets/img/…` | Inside the version folder: `en/docs/api-gateway/1.2.0/assets/img/…`, linked as `assets/img/…`. `cloud`: `en/docs/cloud/assets/…`. `platform-common`: root `en/docs/assets/` like `main`. `apim-<v>`: `en/docs/api-manager/<v>/assets/{img,attachments,js,vids}` | ✓ copies the image to the right folder and rewrites the link |
| Links to another product or version | `main` is one build, so `../../ai-gateway/1.2.0/overview.md` works | Each product version is its **own build**. MkDocs can't convert a `.md` link to a page outside the build and leaves it as is, so it 404s. Write the **page URL, relative to the page's URL**: `../../../ai-gateway/1.2.0/overview/` | ✓ |
| Links within the same product version | `.md` | `.md` (MkDocs converts and checks them) | ✓ |
| docs-apim links | `{{base_path}}/x/y/` (macros) | Relative links. Markdown: relative to the file (`../x/y.md`). Raw HTML `src=`/`href=`: relative to the page URL (one more `../`). Targets not in the build: `https://apim.docs.wso2.com/en/<v>/…` | ✓ |
| docs-apim includes | `{!includes/x.md!}` | `--8<-- "api-manager/<v>/includes/x.md"`. In a numbered list item, the number goes on its own line and the snippet is indented under it | ✓ |
| Frontmatter | `main` pages have it; docs-apim pages don't | **Required** on every page: `title`, `description`, `canonical_url` and `md_url` (with the version in the path), `tags`, `content_type`… | new pages: add it with the `wso2-doc-frontmatter` skill |
| Nav | `main`: one `mkdocs.yml` nav, with each product's versions under it. docs-apim: its own nav | Same product block as `main` (the Dockerfile trims it to one version). `apim-<v>`: a `- "<v>":` block under API Manager with `api-manager/<v>/` paths | manual: same place in both |
| Redirects (moved or renamed page) | `main`: `redirect_maps` in `en/mkdocs.yml`. docs-apim: `en/redirects.yml` | `en/redirects.yml`. A target in **another** deployment must be an absolute URL (`https://wso2.com/api-platform/docs/<path>/`): `mkdocs-redirects` silently skips a `.md` target that isn't in the same build. Put the redirect on the branch that **serves the old URL**: unversioned `/<product>/…` paths go to the product's default version (AI Gateway 1.2.0, API Gateway 1.2.0, AI Workspace 1.0.0 at the time of writing), and old root paths go to `platform-common` | manual |
| Build | `main` builds everything | `Dockerfile.<v>` + `Dockerfile.<v>.dockerignore` (keeps only that version), `trim-mkdocs-version.py` | `scripts/verify.py` builds it |

## 3. Steps

Work in the user's forks (`gh repo fork wso2/docs-api-platform` /
`wso2/docs-apim` if they have none) and push branches there. Use a worktree per
target branch: `git worktree add -b <name> <dir> upstream/<branch>`. Use the
`upstream` remote for wso2's repos. For docs-apim, a separate clone or a
`git fetch https://github.com/wso2/docs-apim.git <branch>` into the same repo
both work.

1. **Decide the targets** from section 1, and the versions.
2. **Make the change on the source branch.** Branch from `upstream/main`, or
   docs-apim's `<v>`/`master`, as `docs/<short-topic>`. Commit with the user as
   author. For an image, add it under the source's assets folder and link it
   the source's way.
3. **Port it to each deployment branch.** From a worktree of
   `upstream/<deploy-branch>` on a branch `docs/<short-topic>-<deploy-branch>`:
   ```
   python3 $SKILL_DIR/scripts/port.py --source <source checkout> \
       --base <source base, e.g. upstream/main> --head <source change branch> \
       --target-branch <deploy-branch> --target <worktree>
   ```
   The script reads the change as `base...head`, maps paths and images,
   rewrites links, and merges three-way into the branch's (drifted) file. Then
   handle its report:
   - **`conflicts`:** resolve the `<<<<<<<` markers. The branch's file has
     drifted from the source's, so keep the branch's other content.
   - **`manual`:** nav, redirects, frontmatter for new pages, theme files,
     anything outside `en/docs`.
   - **`skipped`:** files that don't belong on this branch. That is expected
     when one source PR covers several branches.
4. **Verify each deployment branch** (needs Docker):
   `python3 $SKILL_DIR/scripts/verify.py <worktree>`. It builds the branch's
   image the way it deploys and checks that every changed page is in the site,
   with its links, images and `#anchors` resolving. A broken link that was
   already on the page shows up too: fix it in the same PR, or mention it.
   Don't open PRs while the build fails.
5. **Commit and push** the branches to the user's forks. **Don't open any PR
   yet.**
6. **Ask before opening the PRs.** Show the user, for every PR:
   - the repo and base branch, and the compare link
     (`https://github.com/<upstream>/compare/<base>...<fork-owner>:<repo>:<branch>`)
   - the proposed title and description
   - the verify result

   Open them only after the user says yes, and only the ones they approve,
   with the source PR first. If they want changes, make them, push, and ask
   again. If they say no, leave the pushed branches and give them the compare
   links. For the PRs themselves:
   - Title `[<Product> <version>] <what changed>` on both, so they read as a
     pair.
   - Each body says what changed and links the other PR(s): "Paired with
     wso2/docs-api-platform#…", "Source: wso2/docs-apim#…".
   - Deployment PR bodies list what the port changed beyond the source diff
     (moved images, rewritten links), and the verify result.
   - Use the PR template's sections if the repo has one.
7. **Report** the PR links (or the compare links, if no PR was opened) and
   anything left for the user: nav decisions, redirect targets, items that
   need someone else, such as a `docs-shared` deploy or a router change.

## Gotchas

- **`{#id}` breaks the build:** `markdownextradata` runs pages through Jinja,
  where `{#` starts a comment. Write explicit heading ids as `{ #id }`, with
  spaces.
- **`toc_depth: 3`:** `####` headings get no id, so `#anchor` links to them
  fail. Give the heading an explicit id, or link the parent heading.
- **`.gitignore` has `lib/`:** a new file under any `lib/` folder is silently
  left out of `git add -A`. Use `git add -f` and check `git status --ignored`.
- **Encoded file names:** a link like `...AP-%20with...svg` points at a file
  name with a space. Keep the `%20` in the link and the space in the file name.
- **Cross-product links on deployment branches are URLs, not `.md`.** MkDocs
  doesn't check them, so verify them (step 4).
- **Don't copy whole files between the source and a deployment branch.** They
  have drifted (frontmatter, link fixes, image paths). Always port the change
  (step 3).
- **A new version branch** needs `Dockerfile.<v>` and
  `Dockerfile.<v>.dockerignore` updated for that version. The `.dockerignore`
  keeps only that version's folder in the build. If it still names the old
  version, the image builds without errors but almost empty.
- **Root `/assets/` on staging is served by one component** (platform-common).
  So the theme CSS that every product loads comes from there, which is why
  styling changes must reach `platform-common`.
- **Browser caches `theme.js`:** after a `docs-shared` deploy, check in a
  fresh browser or with the cache disabled.
