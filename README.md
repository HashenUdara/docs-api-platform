# Claude Code plugins for the API Platform docs

This branch is a [Claude Code plugin marketplace](https://docs.claude.com/en/docs/claude-code/plugin-marketplaces). It holds no documentation.

## Install

In Claude Code:

```
/plugin marketplace add https://github.com/wso2/docs-api-platform.git#claude-plugins
/plugin install api-platform-docs@api-platform-docs
```

Start a new session afterwards. To update later: `/plugin marketplace update api-platform-docs`.

## Skills

| Skill | Use it to |
|---|---|
| `/api-platform-docs:docs-contribute` | Make a docs change and send it to its source branch **and** its deployment branch: `wso2/docs-apim` + `apim-<version>` for API Manager; `main` + `<product>-<version>`, `cloud` or `platform-common` for everything else. It converts paths, image locations and links for the deployment branch, and builds it to verify. |

Requirements: git, Python 3, Docker, the GitHub CLI (`gh auth login`), your own forks of `wso2/docs-api-platform` (and `wso2/docs-apim` for API Manager), with an `upstream` remote pointing at the wso2 repo.

## Changing a skill

Edit it under `plugins/api-platform-docs/skills/`, and bump `version` in `plugins/api-platform-docs/.claude-plugin/plugin.json`. Installed copies are cached by version, so without a bump nobody gets the change.
