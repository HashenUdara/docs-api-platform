#!/usr/bin/env python3
"""Port a docs change from its source branch to a deployment branch.

Source branches                     Deployment branch (docs-api-platform)
  docs-api-platform  main             <product>-<version>, cloud, platform-common
  docs-apim          <version>/master apim-<version> / apim-next

The change is the diff BASE..HEAD in the source checkout. Every changed file
is mapped to its path on the deployment branch, its links are rewritten the
way that branch writes them, and it is merged three-way into the deployment
worktree (the branches have drifted, so files are never copied over whole).

usage:
  port.py --source DIR --base REF --head REF --target-branch BRANCH --target DIR [--apim-version V]

  --source        checkout of the source repo (docs-api-platform or docs-apim)
  --base/--head   the change: e.g. upstream/main and my-change-branch
  --target-branch e.g. api-gateway-1.2.0, ai-gateway-next, cloud, platform-common, apim-4.7.0
  --target        a worktree of the deployment branch to write into
  --apim-version  for docs-apim sources: the version folder (4.7.0, next, ...);
                  defaults to the part after "apim-" in --target-branch

Writes the merged files into --target (no commit) and prints a report: what
was ported, what conflicted, and what must be done by hand (nav, redirects,
frontmatter on new pages, theme files).
"""
import argparse, json, os, posixpath, re, subprocess, sys, tempfile
from urllib.parse import unquote

ap = argparse.ArgumentParser()
ap.add_argument("--source", required=True); ap.add_argument("--base", required=True); ap.add_argument("--head", required=True)
ap.add_argument("--target-branch", required=True); ap.add_argument("--target", required=True); ap.add_argument("--apim-version")
a = ap.parse_args()
SRC, TGT, BR = a.source, a.target, a.target_branch
VER = re.compile(r"^(\d+\.\d+\.\d+|next|\d{4}\.\d{2}\.\d{2})$")
PRODUCTS = ("ai-gateway", "api-gateway", "ai-workspace", "api-portal")
PC_SECTIONS = ("guides", "analytics", "monetization", "policy-hub", "tools")
SITE = "https://wso2.com/api-platform/docs/"


def git(repo, *args, binary=False, check=True):
    r = subprocess.run(["git", "-C", repo, *args], capture_output=True)
    if check and r.returncode:
        sys.exit(f"git {' '.join(args)} failed: {r.stderr.decode()[:300]}")
    return r.stdout if binary else r.stdout.decode("utf-8", "surrogateescape")


def show(ref, path):
    r = subprocess.run(["git", "-C", SRC, "show", f"{ref}:{path}"], capture_output=True)
    return r.stdout if r.returncode == 0 else None


# docs-apim: its remote says so, or (in a worktree without remotes) it has no en/docs/cloud
remotes = git(SRC, "remote", "-v", check=False)
SRC_IS_APIM = "docs-apim" in remotes or not os.path.exists(os.path.join(SRC, "en/docs/cloud"))
APIM = SRC_IS_APIM and BR.startswith("apim-")
APIM_V = a.apim_version or (BR[len("apim-"):] if BR.startswith("apim-") else None)
if BR.startswith("apim-") and not APIM:
    sys.exit("apim-* branches take their changes from docs-apim: --source must be a docs-apim checkout")
if SRC_IS_APIM and not BR.startswith("apim-"):
    sys.exit("a docs-apim change goes to an apim-<version> branch")

# what this deployment branch builds (for deciding which links stay .md)
target_files = set(git(TGT, "ls-files", "en/docs").split("\n"))


def scope(path):
    """Does this source path (relative to en/docs) belong on BR? Returns the target path or None."""
    if APIM:
        return f"api-manager/{APIM_V}/{path}"
    p = path.split("/")
    if p[0] == "assets":
        return None                                   # placed next to the pages that use them, see asset_target()
    if BR == "cloud":
        return path if p[0] == "cloud" else None
    if BR == "platform-common":
        return path if (len(p) == 1 or p[0] in PC_SECTIONS) else None
    prod, ver = BR.rsplit("-", 1)
    return path if (p[0] == prod and len(p) > 1 and p[1] == ver) else None


def asset_home():
    """Where this branch keeps the images its pages use (relative to en/docs)."""
    if APIM:
        return f"api-manager/{APIM_V}/assets"
    if BR == "cloud":
        return "cloud/assets"
    if BR == "platform-common":
        return "assets"
    prod, ver = BR.rsplit("-", 1)
    return f"{prod}/{ver}/assets"


def asset_target(src_asset):            # src_asset: assets/img/x.png (relative to en/docs)
    return asset_home() + src_asset[len("assets"):]


def page_url_dir(path):                  # en/docs-relative .md -> its published folder
    if path.endswith("index.md"):
        return posixpath.dirname(path)
    return path[:-3] if path.endswith(".md") else posixpath.dirname(path)


def md_to_url(path):
    return path[: -len("index.md")] if path.endswith("index.md") else path[:-3] + "/"


MD_LINK = re.compile(r"(\]\(\s*<?)([^)\s>]+)")
HTML_ATTR = re.compile(r"(\b(?:src|href)=[\"'])([^\"']+)")
BASE_PATH = re.compile(r"\{\{\s*base_path\s*\}\}(/[^\s)\"'<>]*)?")
INCLUDE = re.compile(r"^([ \t]*)\{!\s*(includes/[^!]+?)\s*!\}[ \t]*$", re.M)
INCLUDE_LI = re.compile(r"^([ \t]*)(\d+\.)([ \t]+)\{!\s*(includes/[^!]+?)\s*!\}[ \t]*$", re.M)
new_assets = {}                          # source asset path -> target asset path (copied in step 2)


def transform(text, src_path, dst_path, new_files):
    """Rewrite a page's links from the source branch's form to the deployment branch's."""
    have = target_files | new_files

    def exists(p):                       # en/docs-relative
        return f"en/docs/{p}" in have

    def rewrite(raw, html):
        if re.match(r"^([a-z]+:|#|/|\{|mailto:|data:)", raw):
            return None
        path, sep, frag = raw.partition("#")
        path = unquote(path)
        base_src = page_url_dir(src_path) if html else posixpath.dirname(src_path)
        base_dst = page_url_dir(dst_path) if html else posixpath.dirname(dst_path)
        tgt = posixpath.normpath(posixpath.join(base_src, path)) if path else src_path
        if tgt.startswith("assets/") and not APIM:               # root asset on main -> this branch's asset folder
            new = asset_target(tgt); new_assets[tgt] = new
            return posixpath.relpath(new, base_dst or ".") + (sep + frag if sep else "")
        if tgt.endswith(".md") and not APIM:
            if exists(tgt):                                       # same build: keep .md, MkDocs converts it
                return posixpath.relpath(tgt, posixpath.dirname(dst_path) or ".") + (sep + frag if sep else "") if not html else None
            # another product/version: MkDocs can't convert it on this branch -> the page URL, from the page's URL
            return posixpath.relpath(md_to_url(tgt).rstrip("/"), page_url_dir(dst_path) or ".") + "/" + (sep + frag if sep else "")
        return None

    def sub_md(m):
        new = rewrite(m.group(2), False)
        return m.group(1) + new if new else m.group(0)

    def sub_html(m):
        new = rewrite(m.group(2), True)
        return m.group(1) + new if new else m.group(0)

    if APIM:
        root = f"api-manager/{APIM_V}/"

        def resolve(p):
            p = p.strip("/")
            if not p:
                return root + "index.md" if exists(root + "index.md") else None
            cands = [p] if posixpath.splitext(p)[1] else [p + ".md", p + "/index.md"]
            return next((root + c for c in cands if exists(root + c)), None)

        def bp(m, html):
            rest = m.group(1) or "/"
            path, _, anchor = rest.partition("#"); anchor = "#" + anchor if anchor else ""
            t = resolve(path)
            if not t:
                return f"https://apim.docs.wso2.com/en/{APIM_V}/{path.lstrip('/')}{anchor}"
            if html:                                  # raw HTML resolves against the page's URL
                tu = md_to_url(t) if t.endswith(".md") else t
                return posixpath.relpath(tu.rstrip("/"), page_url_dir(dst_path)) + ("/" if t.endswith(".md") else "") + anchor
            return posixpath.relpath(t, posixpath.dirname(dst_path)) + anchor

        text = HTML_ATTR.sub(lambda m: m.group(1) + BASE_PATH.sub(lambda b: bp(b, True), m.group(2)), text)
        text = BASE_PATH.sub(lambda b: bp(b, False), text)
        text = INCLUDE_LI.sub(lambda m: f'{m.group(1)}{m.group(2)}{m.group(3)}\n{m.group(1)}    --8<-- "api-manager/{APIM_V}/{m.group(4)}"', text)
        return INCLUDE.sub(lambda m: f'{m.group(1)}--8<-- "api-manager/{APIM_V}/{m.group(2)}"', text)
    text = MD_LINK.sub(sub_md, text)
    return HTML_ATTR.sub(sub_html, text)


# ------------------------------------------------------------------ the change
changes = []
for line in git(SRC, "diff", "--name-status", "-M", f"{a.base}...{a.head}", "--", "en").split("\n"):
    if not line.strip():
        continue
    parts = line.split("\t")
    st = parts[0][0]
    changes.append((st, parts[1], parts[2] if st == "R" else parts[1]))

report = {"branch": BR, "ported": [], "conflicts": [], "skipped (not on this branch)": [], "manual": []}
docs_changes = []
for st, old, new in changes:
    if new.startswith("en/theme/") or old.startswith("en/theme/"):
        report["manual"].append(f"theme file {new}: see 'Theme and styling' in SKILL.md (platform-common, every product branch for templates, docs-shared for theme.js)")
    elif new in ("en/mkdocs.yml",) or new.endswith("redirects.yml"):
        report["manual"].append(f"{new}: port nav / redirect changes by hand (see SKILL.md: nav and redirects differ per branch)")
    elif new.startswith("en/docs/"):
        docs_changes.append((st, old[len("en/docs/"):], new[len("en/docs/"):]))
    else:
        report["manual"].append(f"{new}: outside en/docs, check whether the deployment branch needs it")

# paths on the target branch
mapped = []
for st, old, new in docs_changes:
    t_new, t_old = scope(new), scope(old)
    if new.startswith("assets/") and not APIM:
        continue                                     # images follow the pages that use them
    if not t_new and not t_old:
        report["skipped (not on this branch)"].append(new); continue
    mapped.append((st, old, new, t_old, t_new))
new_files = {f"en/docs/{t}" for st, o, n, to, t in mapped if t and st in "AR"}

for st, old, new, t_old, t_new in mapped:
    dst = os.path.join(TGT, "en/docs", t_new) if t_new else None
    if st == "D":
        if t_old and os.path.exists(os.path.join(TGT, "en/docs", t_old)):
            git(TGT, "rm", "-q", f"en/docs/{t_old}")
            report["ported"].append(f"deleted {t_old}")
        continue
    head_bytes = show(a.head, f"en/docs/{new}")
    is_text = new.endswith((".md", ".html", ".txt", ".yml", ".yaml", ".json", ".css", ".js"))
    if st == "R" and t_old and os.path.exists(os.path.join(TGT, "en/docs", t_old)):
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        git(TGT, "mv", f"en/docs/{t_old}", f"en/docs/{t_new}")
    if not is_text:
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        open(dst, "wb").write(head_bytes)
        report["ported"].append(f"{'added' if st == 'A' else 'updated'} {t_new} (binary)")
        continue
    head_t = transform(head_bytes.decode("utf-8"), new, t_new, new_files)
    base_bytes = show(a.base, f"en/docs/{old}")
    if st == "A" or base_bytes is None or not os.path.exists(dst):
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        if os.path.exists(dst) and st == "A":
            report["conflicts"].append(f"{t_new}: already exists on the branch; overwritten with the new page, review the diff")
        open(dst, "w", encoding="utf-8").write(head_t)
        report["ported"].append(f"added {t_new}")
        if t_new.endswith(".md") and "/includes/" not in t_new and not head_t.startswith("---"):
            report["manual"].append(f"{t_new}: new page without frontmatter; add it (wso2-doc-frontmatter skill)")
        continue
    base_t = transform(base_bytes.decode("utf-8"), old, t_old or t_new, new_files)
    with tempfile.TemporaryDirectory() as d:
        bf, hf = os.path.join(d, "base"), os.path.join(d, "head")
        open(bf, "w", encoding="utf-8").write(base_t); open(hf, "w", encoding="utf-8").write(head_t)
        r = subprocess.run(["git", "merge-file", "-L", "deployment branch", "-L", "source before", "-L", "source after", dst, bf, hf], capture_output=True)
    if r.returncode:
        report["conflicts"].append(f"{t_new}: {r.returncode} conflict(s) left as <<<<<<< markers, resolve by hand")
    else:
        report["ported"].append(f"updated {t_new}")

# changed images whose pages did not change (e.g. a new screenshot): port them
# if a page that belongs on this branch uses them
if not APIM:
    scope_dirs = {"cloud": ["en/docs/cloud"], "platform-common": ["en/docs/" + s for s in PC_SECTIONS] + ["en/docs/*.md"]}.get(
        BR, ["en/docs/" + "/".join(BR.rsplit("-", 1))])
    for st, old, new in docs_changes:
        if not new.startswith("assets/") or st == "D":
            continue
        sub = new[len("assets/"):]
        users = git(SRC, "grep", "-l", "-F", sub, a.head, "--", *scope_dirs, check=False).split()
        if users:
            new_assets[new] = asset_target(new)
        else:
            report["skipped (not on this branch)"].append(f"{new} (no page on this branch uses it)")

# images and other files the ported pages link from the source's root assets/
for src_asset, tgt_asset in sorted(new_assets.items()):
    data = show(a.head, f"en/docs/{src_asset}")
    dst = os.path.join(TGT, "en/docs", tgt_asset)
    if data is None:
        report["conflicts"].append(f"{src_asset}: linked but not in the source change's tree"); continue
    if os.path.exists(dst) and open(dst, "rb").read() == data:
        continue
    os.makedirs(os.path.dirname(dst), exist_ok=True); open(dst, "wb").write(data)
    report["ported"].append(f"image {src_asset} -> {tgt_asset}")
print(json.dumps(report, indent=1))
