import re
import os
import json
import yaml
import hashlib
import logging
from urllib.parse import urlparse

logger = logging.getLogger('mkdocs.plugins.' + __name__)


def _project_root(config) -> str:
    """The mkdocs project root (where mkdocs.yml, redirects.yml, theme/ live).

    Not os.path.dirname(__file__): this module is installed as a package
    (see docs-shared/pyproject.toml), so its own file lives in site-packages,
    nowhere near the product branch's actual project files. config's own
    config_file_path is the reliable anchor regardless of where this code is
    installed from or what directory mkdocs build happens to be run in.
    """
    return os.path.dirname(os.path.abspath(config["config_file_path"]))


# Populated in on_pre_build; used by on_post_page and on_post_build.
_partial_hashes: dict[str, str] = {}
_theme_css_version: str = ""

# Maps each page URL to its breadcrumb (list of ancestor section titles).
# Populated in on_nav; written to a JSON asset in on_post_build so the search
# results UI can show which doc set / version a result belongs to.
_breadcrumbs: dict[str, list[str]] = {}

# slug -> {slug, default, versions: {version: [nav tree]}} for this build's
# own versioned top-level section(s). Populated in on_nav; written to a JSON
# asset in on_post_build so OTHER products' deployments can render this
# product's expandable nav section client-side without hosting its pages.
# See theme.js's cross-product nav block and root-index.json.
_product_manifest: dict[str, dict] = {}


def load_redirects(project_root: str) -> dict[str, str]:
    """Read redirect_maps out of redirects.yml, kept separate from mkdocs.yml
    so the (very long) redirect list doesn't have to live inline in the config.
    """
    redirects_path = os.path.join(project_root, "redirects.yml")
    if not os.path.exists(redirects_path):
        return {}
    with open(redirects_path, encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}
    return data.get("redirect_maps") or {}


def on_config(config, **kwargs):
    """Inject redirects.yml's redirect_maps into the redirects plugin's config.

    Runs before on_files, which is when the plugin reads redirect_maps off its
    own config - see mkdocs_redirects/plugin.py.
    """
    redirects = load_redirects(_project_root(config))
    if not redirects:
        return config

    redirects_plugin = config["plugins"].get("redirects")
    if redirects_plugin is None:
        logger.warning("redirects.yml has %d entries but the redirects plugin isn't configured", len(redirects))
        return config

    redirects_plugin.config["redirect_maps"].update(redirects)
    logger.info("Loaded %d redirects from redirects.yml", len(redirects))
    return config


def _file_hash(path: str) -> str:
    """Return the first 8 hex characters of the MD5 hash of a file's content."""
    with open(path, "rb") as f:
        return hashlib.md5(f.read()).hexdigest()[:8]


def on_pre_build(config, **kwargs):
    """Pre-compute content hashes from source CSS files.

    The combined hash of theme.css + every partial is stored as the version
    string added to the <link> tag in HTML, so any change to any partial also
    busts the theme.css browser/CDN cache.
    """
    global _theme_css_version
    _partial_hashes.clear()

    css_src_dir = os.path.join(_project_root(config), "theme", "material", "assets", "css")
    partials_src_dir = os.path.join(css_src_dir, "partials")

    # Collect raw bytes of theme.css + all partials for a combined hash
    combined = bytearray()

    theme_css_src = os.path.join(css_src_dir, "theme.css")
    if os.path.exists(theme_css_src):
        with open(theme_css_src, "rb") as f:
            combined += f.read()

    if os.path.exists(partials_src_dir):
        for fname in sorted(os.listdir(partials_src_dir)):
            if fname.endswith(".css"):
                path = os.path.join(partials_src_dir, fname)
                data = open(path, "rb").read()
                combined += data
                _partial_hashes[fname] = hashlib.md5(data).hexdigest()[:8]

    _theme_css_version = hashlib.md5(combined).hexdigest()[:8]


def on_nav(nav, config, files):
    """Build a URL -> breadcrumb map from the navigation tree.

    The breadcrumb is the list of ancestor section titles for each page (e.g.
    ["API Gateway", "1.1.0", "Policies"]). This is used to disambiguate search
    results that share the same title across versions / doc sets.
    """
    _breadcrumbs.clear()
    for page in nav.pages:
        crumbs = []
        item = page.parent
        while item is not None:
            if getattr(item, "title", None):
                crumbs.insert(0, item.title)
            item = item.parent
        if page.url and crumbs:
            _breadcrumbs[page.url] = crumbs

    _build_product_nav_manifest(nav, config)
    return nav


def _nav_tree(item):
    """Convert one nav item into a {title, url} or {title, children} dict for
    the cross-product manifest. Returns None for an item with nothing worth
    sending (an external link, or a section with no local pages under it).
    """
    if getattr(item, "is_page", False):
        url = item.url or ""
        if url.startswith("/"):
            return None
        return {"title": item.title, "url": url}
    if getattr(item, "is_link", False):
        # Only doc-local relative links are sent to other products - an
        # absolute/external link isn't something another deployment can
        # usefully render into its own sidebar.
        return None
    children = [
        node for node in (_nav_tree(c) for c in getattr(item, "children", None) or []) if node
    ]
    if not children:
        return None
    return {"title": item.title, "children": children}


_icon_svg_cache: dict[str, str] = {}


def _icon_svg(icon: str) -> str | None:
    """Read a Material icon's raw SVG content (e.g. 'octicons/sliders-16'),
    for embedding directly into a cross-product manifest. A page rendering
    another product's section has no local .icons/ directory to resolve an
    icon name from itself - see nav-item.html's own nav_icon() macro, which
    this mirrors, but for a build-time string instead of a Jinja include.
    """
    if icon in _icon_svg_cache:
        return _icon_svg_cache[icon]
    svg = None
    try:
        import material
        path = os.path.join(os.path.dirname(material.__file__), ".icons", icon + ".svg")
        with open(path, encoding="utf-8") as f:
            svg = f.read()
    except Exception:
        logger.warning("Could not read icon %r for cross-product manifest", icon)
    _icon_svg_cache[icon] = svg
    return svg


def _section_icon(title: str, config) -> str | None:
    """This section's icon, if config.extra.nav_icons configures one for it.

    Mirrors nav-item.html's own icon resolution: a versioned or unversioned
    top-level section is always level 1, so only consider a nav_icons entry
    that doesn't restrict itself to some other level.
    """
    nav_icons = (config.get("extra") or {}).get("nav_icons") or {}
    cfg = nav_icons.get(title)
    if not cfg:
        return None
    level = cfg.get("level")
    if level is not None:
        levels = level if isinstance(level, list) else [level]
        if 1 not in levels:
            return None
    icon = cfg.get("icon")
    return _icon_svg(icon) if icon else None


def _section_style(title: str, config) -> dict:
    """This section's expanded_navs styling (vertical line), if configured.
    Mirrors nav-item.html's own matched_expanded_nav lookup, so a
    cross-product section gets the same styling a native one would.

    The divider is unconditional, not read from config: nav-item.html now
    hardcodes a divider before every top-level product section (native or
    cross-product), since that was always true in practice on the real
    site and never actually optional - leaving it config-driven let a
    branch (e.g. API Portal) silently drift out of sync. This function is
    only ever called once per top-level product (see
    _build_product_nav_manifest), so there's no case where a title reaching
    here shouldn't get one.

    "verticle-line" and "verticle-line-only" both draw the vertical line
    (verticleLine), but only plain "verticle-line" also adds the wrapping
    md-nav--expanded-section class (expandedSection) - nav-item.html applies
    that one separately (see its two matched_expanded_nav branches).
    """
    expanded_navs = (config.get("extra") or {}).get("expanded_navs") or []
    for entry in expanded_navs:
        if entry.get("title") != title:
            continue
        # A top-level manifest section is always level 1 (mirrors
        # _section_icon's own guard) - skip an entry that restricts itself to
        # some other level, e.g. the "AI Workspace" / "Monetization" entries
        # that exist to style a same-named nested item instead.
        level = entry.get("level")
        if level is not None and level != 1:
            continue
        options = entry.get("options") or []
        return {
            "divider": True,
            "verticleLine": "verticle-line" in options or "verticle-line-only" in options,
            "expandedSection": "verticle-line" in options,
        }
    return {"divider": True, "verticleLine": False, "expandedSection": False}


def _build_product_nav_manifest(nav, config):
    """Build a cross-product manifest for this build's own top-level
    section(s) - both versioned (extra.versioned_sections) and unversioned
    (extra.unversioned_sections) in mkdocs.yml.

    This is deliberately a full tree (title + url + nested children), not
    the flat per-version page-url list a same-product redirect needs: the
    cross-product sidebar has to render another product's whole expandable
    section from data alone, since it doesn't have that product's pages.

    A versioned section's manifest has a "versions" key (see below); an
    unversioned one has a flat "tree" instead - theme.js's renderer branches
    on which key is present to decide whether to render a version dropdown.
    """
    _product_manifest.clear()
    extra = config.get("extra") or {}
    versioned_sections = extra.get("versioned_sections") or {}
    unversioned_sections = extra.get("unversioned_sections") or {}
    slug_by_title = {
        title: cfg["slug"] for title, cfg in versioned_sections.items() if cfg.get("slug")
    }
    unversioned_slug_by_title = {
        title: cfg["slug"] for title, cfg in unversioned_sections.items() if cfg.get("slug")
    }
    if not slug_by_title and not unversioned_slug_by_title:
        return

    for item in nav.items:
        title = getattr(item, "title", None)
        if title in slug_by_title:
            slug = slug_by_title[title]
            cfg = versioned_sections[title]
            versions = {}
            for version_item in getattr(item, "children", None) or []:
                tree = _nav_tree(version_item)
                if tree:
                    versions[version_item.title] = tree.get("children", [])
            _product_manifest[slug] = {
                "slug": slug,
                "default": cfg.get("default"),
                # The full configured version list (may include versions this
                # particular build doesn't physically have - e.g. a single-
                # version API Manager image still advertises all 11). The
                # cross-product dropdown lists all of these; selecting one
                # missing from "versions" below falls back to the live site,
                # same as the same-product dropdown already does.
                "allVersions": cfg.get("versions") or [],
                # STS releases are listed in the dropdown but are never the
                # default. theme.js renders them under "Latest STS Version"
                # and relabels the default group "Latest LTS Version".
                "stsVersions": cfg.get("sts_versions") or [],
                "versions": versions,
                "icon": _section_icon(title, config),
                **_section_style(title, config),
            }
        elif title in unversioned_slug_by_title:
            slug = unversioned_slug_by_title[title]
            tree = _nav_tree(item)
            if tree:
                _product_manifest[slug] = {
                    "slug": slug,
                    "tree": tree.get("children", []),
                    "icon": _section_icon(title, config),
                    **_section_style(title, config),
                }


def on_post_build(config, **kwargs):
    """Append content-hash query strings to @import URLs inside the built theme.css
    so that CDN / browser caches are busted whenever a partial file changes.
    Also writes the search breadcrumb map collected in on_nav."""
    site_dir = config["site_dir"]

    # Write this build's own top-level product slugs (versioned AND
    # unversioned), so theme.js can tell "already present on this page"
    # apart from "needs fetching cross-product" without inspecting the DOM -
    # a DOM attribute only ever exists for versioned sections, so relying on
    # it silently missed every unversioned one (see the "products" nesting
    # note in root-index.json's own history for the matching client-side fix).
    own_slugs_path = os.path.join(site_dir, "assets", "own-product-slugs.json")
    os.makedirs(os.path.dirname(own_slugs_path), exist_ok=True)
    with open(own_slugs_path, "w", encoding="utf-8") as f:
        json.dump(list(_product_manifest.keys()), f, ensure_ascii=False)

    # Write the breadcrumb map for the search results UI.
    breadcrumbs_path = os.path.join(site_dir, "assets", "search-breadcrumbs.json")
    os.makedirs(os.path.dirname(breadcrumbs_path), exist_ok=True)
    with open(breadcrumbs_path, "w", encoding="utf-8") as f:
        json.dump(_breadcrumbs, f, ensure_ascii=False)

    # Write this build's own product nav manifest, so other products'
    # deployments can render this product's section into their sidebar.
    # Written under the product's own slug (e.g. ai-gateway/product-nav-
    # manifest.json), not under the shared assets/ dir: assets/ is a sibling
    # of every product's page tree under docs_dir, so a path under it is
    # identical across every product's build and can't carry per-product
    # data. Nesting under the slug puts it inside the same URL prefix
    # (/<slug>/*) the reverse proxy already routes to this deployment.
    for slug, manifest in _product_manifest.items():
        manifest_path = os.path.join(site_dir, slug, "product-nav-manifest.json")
        os.makedirs(os.path.dirname(manifest_path), exist_ok=True)
        with open(manifest_path, "w", encoding="utf-8") as f:
            json.dump(manifest, f, ensure_ascii=False)

    theme_css_path = os.path.join(site_dir, "assets", "css", "theme.css")

    if not os.path.exists(theme_css_path):
        return

    with open(theme_css_path, "r", encoding="utf-8") as f:
        content = f.read()

    def _add_hash(match):
        url = match.group(1)
        base_url = url.split("?")[0]
        fname = os.path.basename(base_url)
        version = _partial_hashes.get(fname)
        if version:
            return f"@import url('{base_url}?v={version}')"
        return match.group(0)

    new_content = re.sub(r"@import url\('([^']+)'\)", _add_hash, content)

    with open(theme_css_path, "w", encoding="utf-8") as f:
        f.write(new_content)


# Matches an HTML comment, except a bang comment (<!--! ... -->, used for
# third-party license notices) and a conditional comment (<!--[if ... ).
# Comments inside a code sample reach the browser escaped (&lt;!--), so they are
# not affected; a literal comment inside a raw <pre> block would be.
_HTML_COMMENT_RE = re.compile(r"<!--(?![!\[])(?:(?!<!--).)*?-->", re.DOTALL)


def _strip_html_comments(output: str) -> str:
    """Drop template comments from the rendered page.

    Material's templates document themselves with HTML comments, and
    partials/nav-item.html is rendered once per navigation item - several
    hundred times per page - so those comments account for roughly 60% of the
    bytes the browser has to download and parse for every page.
    """
    return _HTML_COMMENT_RE.sub("", output)


# Elements whose content is whitespace-sensitive. The theme renders code, kbd
# and pre as white-space: pre-wrap, a textarea shows its content verbatim, and
# collapsing a newline inside a script or a stylesheet would pull the next line
# into a line comment.
_PROTECTED_RE = re.compile(
    r"<(pre|textarea|script|style|code|kbd)\b.*?</\1\s*>", re.DOTALL | re.IGNORECASE
)
_WHITESPACE_RUN_RE = re.compile(r"[ \t\r\n]{2,}")


def _collapse_whitespace(output: str) -> str:
    """Collapse every run of whitespace outside a protected element to one space.

    Template indentation is about half of what a page weighs once its comments
    are gone. Browsers render consecutive whitespace as a single space anyway,
    so collapsing the runs - rather than removing them - leaves the rendered
    text and the inline layout unchanged.
    """
    parts = []
    end = 0
    for match in _PROTECTED_RE.finditer(output):
        parts.append(_WHITESPACE_RUN_RE.sub(" ", output[end : match.start()]))
        parts.append(match.group(0))
        end = match.end()
    parts.append(_WHITESPACE_RUN_RE.sub(" ", output[end:]))
    return "".join(parts)


def on_post_template(output, template_name, config, **kwargs):
    """Strip template comments from theme templates such as 404.html, which are
    rendered outside the page pipeline and so never reach on_post_page."""
    if template_name.endswith(".html"):
        return _collapse_whitespace(_strip_html_comments(output))
    return output


def _extract_base_url(site_url: str) -> str:
    """Extract the base path from site_url, e.g.
    https://wso2.com/api-platform/docs -> /api-platform/docs
    """
    path = urlparse(site_url).path.rstrip("/")
    return path if path else "/"


def on_post_page(output, page, config, **kwargs):
    output = _collapse_whitespace(_strip_html_comments(output))

    # Add cache-busting version to the theme.css <link> tag so CDN/browser
    # cache is invalidated whenever theme.css or any of its partials change.
    if _theme_css_version:
        output = re.sub(
            r'(<link[^>]+href="[^"]*assets/css/theme\.css)(")',
            rf'\1?v={_theme_css_version}\2',
            output,
        )

    # Replace {BASE_URL} placeholders with the actual base path derived from
    # site_url.
    site_url = config.get("site_url", "")
    if site_url:
        output = output.replace("{BASE_URL}", _extract_base_url(site_url))

    if page.is_homepage:
        return output

    first = next(iter(page.toc), None)
    # we want the page's title to be derived from the frontmatter's title key.
    # if frontmatter or title key is unavailable, we fall back to the page's H1
    # heading
    if page.meta and page.meta.get("title"):
        title = page.meta["title"]
    elif first and first.level == 1:
        title = re.sub(r"<[^>]+>", "", first.title).strip()
    elif page.title:
        title = re.sub(r"<[^>]+>", "", page.title).strip()
    else:
        return output

    suffix = config.get("extra", {}).get("page_title_suffix", "")
    full_title = f"{title} | {suffix}" if suffix else title

    return re.sub(r"<title>.*?</title>", f"<title>{full_title}</title>", output, count=1)

# Matches a YAML frontmatter block at the start of a file.
FRONTMATTER_RE = re.compile(r"\A-{3}[ \t]*\n.*?\n(?:-{3}|\.{3})[ \t]*\n", re.DOTALL)


def _raw_frontmatter(src_path: str) -> str:
    """
    Return the page's frontmatter block as written in the source file.
    """
    try:
        with open(src_path, encoding="utf-8-sig") as f:
            source = f.read()
    except OSError:
        return ""
    match = FRONTMATTER_RE.match(source)
    return match.group(0) if match else ""


def _drop_tags_from_search(page):
    """Stop frontmatter tags from dominating search ranking.

    Material weights `tags` very heavily. Broad tags (e.g. the homepage's
    "platform-overview", "api-management") tokenize into common query words and
    let unrelated pages outrank the exact page a user searched for. There is no
    `tags` plugin in this project, so tags exist only to feed search — removing
    them from the index restores title/content-driven ranking with no other
    side effects.
    """
    if isinstance(page.meta, dict) and page.meta.get("tags"):
        page.meta["tags"] = []


def on_page_markdown(markdown, page, config, **kwargs):
    """Write Markdown files to a parallel .md file in the build output.

    For example, it creates the file `SITE_DIR/cloud/ai-gateway/overview.md`
    alongside the HTML page.
    """
    # Keep tags out of the search index (see helper above).
    _drop_tags_from_search(page)

    site_dir = config["site_dir"]
    # page.url is like "cloud/ai-gateway/overview/" so strip trailing slash
    # to produce "cloud/ai-gateway/overview.md".
    # When use_directory_urls is false, page.url ends in .html so strip that too.
    url_path = page.url.rstrip("/")
    if url_path.endswith(".html"):
        url_path = url_path[:-5]
    # If page.url is the homepage, after the rstrip, it becomes ""
    if not url_path:
        url_path = "index"
    md_output_path = os.path.join(site_dir, url_path + ".md")
    parent_dir = os.path.dirname(md_output_path)
    if parent_dir:
        os.makedirs(parent_dir, exist_ok=True)
    with open(md_output_path, "w", encoding="utf-8") as f:
        frontmatter = _raw_frontmatter(page.file.abs_src_path)
        if frontmatter:
            f.write(frontmatter)
            if not markdown.startswith("\n"):
                f.write("\n")
        f.write(markdown)
    return markdown
