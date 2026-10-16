#!/usr/bin/env python3
"""Build a docs-api-platform deployment branch the way it deploys and check the changed pages.

usage: verify.py <worktree> [--base REF]

  <worktree>  a checkout of the deployment branch with the change (committed or not)
  --base      what to compare against for "changed pages" (default: upstream/<branch>)

Builds the Docker image with the branch's own Dockerfile (Dockerfile.<version>, or
Dockerfile), copies the site out, and for every page changed since --base checks:
  - the page is in the built site
  - every relative link and image on it resolves: to a file in this build, or to a
    page in the branch that serves that path (another product or version)
Needs Docker. Removes the image and the copied site afterwards.
"""
import os, re, shutil, subprocess, sys, tempfile
from urllib.parse import urljoin, urlparse, unquote

W = os.path.abspath(sys.argv[1])
branch = subprocess.run(["git", "-C", W, "branch", "--show-current"], capture_output=True, text=True).stdout.strip()
base = sys.argv[sys.argv.index("--base") + 1] if "--base" in sys.argv else None
VER = re.compile(r"^(\d+\.\d+\.\d+|next|\d{4}\.\d{2}\.\d{2})$")


def run(*a, **k):
    return subprocess.run(a, capture_output=True, text=True, **k)


# which upstream branch is this? (for the diff and for the Dockerfile)
up = base
if not up:
    for cand in [f"upstream/{branch}"] + [l.strip() for l in run("git", "-C", W, "branch", "-r", "--contains", "HEAD~0").stdout.split("\n") if l.strip().startswith("upstream/")]:
        if run("git", "-C", W, "rev-parse", "--verify", "-q", cand).returncode == 0:
            up = cand; break
if not up:
    sys.exit("could not tell which upstream branch this is; pass --base upstream/<branch>")
deploy = up.split("/", 1)[1]
ver = deploy.rsplit("-", 1)[1] if VER.match(deploy.rsplit("-", 1)[-1]) else None
df = f"Dockerfile.{ver}" if ver and os.path.exists(os.path.join(W, f"Dockerfile.{ver}")) else "Dockerfile"
changed = [l for l in run("git", "-C", W, "diff", "--name-only", up, "--", "en/docs").stdout.split("\n") if l.endswith(".md")]
changed += [l for l in run("git", "-C", W, "ls-files", "--others", "--exclude-standard", "en/docs").stdout.split("\n") if l.endswith(".md")]
print(f"branch {deploy}: building with {df}; {len(changed)} changed page(s)")

tag = "docs-verify-" + re.sub(r"[^a-z0-9-]", "-", deploy.lower())
r = run("docker", "build", "-q", "-f", os.path.join(W, df), "-t", tag, W)
if r.returncode:
    print("BUILD FAILED\n" + r.stderr[-2000:]); sys.exit(1)
site = tempfile.mkdtemp(prefix="docs-verify-")
cid = run("docker", "create", tag).stdout.strip()
run("docker", "cp", f"{cid}:/usr/share/nginx/html", site + "/s"); run("docker", "rm", "-f", cid); run("docker", "rmi", "-f", tag)
site += "/s"
pages = sum(1 for _, _, fs in os.walk(site) for f in fs if f == "index.html")
print(f"build OK: {pages} pages in the image")

files = {}
def has(br, p):
    if br not in files:
        files[br] = set(run("git", "-C", W, "ls-tree", "-r", "--name-only", f"upstream/{br}", "en/docs").stdout.split())
    return f"en/docs/{p}" in files[br]

def owner(p):
    s = p.split("/")
    if s[0] == "cloud": return "cloud"
    if s[0] == "api-manager" and len(s) > 1: return f"apim-{s[1]}"
    if s[0] in ("ai-gateway", "api-gateway", "ai-workspace", "api-portal") and len(s) > 1 and VER.match(s[1]): return f"{s[0]}-{s[1]}"
    if s[0] in ("ai-gateway", "api-gateway", "ai-workspace", "api-portal", "api-manager"): return None
    return "platform-common"

problems = 0
for md in changed:
    rel = md[len("en/docs/"):]
    if "/includes/" in "/" + rel:
        continue
    url = rel[:-len("index.md")] if rel.endswith("index.md") else rel[:-3] + "/"
    f = os.path.join(site, url, "index.html")
    if not os.path.exists(f):
        if os.path.exists(os.path.join(W, md)):
            print(f"  MISSING PAGE {url} (not in the build: check the nav and the .dockerignore)"); problems += 1
        continue
    html = open(f, encoding="utf-8", errors="replace").read()
    bad = []
    for h in re.findall(r'(?:href|src)="([^"#][^"]*)"', html):
        if re.match(r"^[a-z]+:|^//|^/|^\{", h):
            continue
        path = unquote(urlparse(urljoin("https://x/" + url, h)).path.lstrip("/"))
        if os.path.exists(os.path.join(site, path)) or os.path.exists(os.path.join(site, path, "index.html")):
            continue
        if path.startswith(("assets/", "search/")) and not path.startswith(("assets/img", "assets/attachments")):
            continue                     # theme files served from the site root
        o = owner(path.rstrip("/")); b = path.rstrip("/")
        if o and o != deploy and (has(o, b + ".md") or has(o, b + "/index.md") or has(o, b)):
            continue                     # a page in another deployment
        bad.append(h)
    ids = set(re.findall(r'\bid="([^"]+)"', html))
    for frag in set(re.findall(r'href="#([^"]+)"', html)):
        if not frag.startswith("__") and frag not in ids:
            bad.append("#" + frag)
    if bad:
        problems += len(bad)
        print(f"  {url}: {len(bad)} broken: " + ", ".join(sorted(set(bad))[:8]))
    else:
        print(f"  {url}: OK")
shutil.rmtree(os.path.dirname(site), ignore_errors=True)
print("RESULT: " + ("all changed pages OK" if not problems else f"{problems} problem(s)"))
sys.exit(1 if problems else 0)
