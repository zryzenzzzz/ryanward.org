#!/usr/bin/env python3
"""Build the GitHub Pages site from the editable root index.html.

Edit index.html as a normal HTML page. On deployment, this script copies the
site into _site/ and converts only the published copy of index.html into a
small HTML shell, moving its CSS, body markup, and inline page script into
_site/assets/desktop.js. The checked-in index.html is never rewritten.

Usage: python3 tools/build_site.py
"""

import json
import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "index.html"
OUTPUT = ROOT / "_site"
EXCLUDED = {".git", ".github", "_source", "_site", "tools"}

JS_HEADER = """\
/* ------------------------------------------------------------------
   ryanward.org - generated during deployment from index.html.
   ------------------------------------------------------------------ */

/* 1. Page styles (fills the <style id="rw-css"> element in the shell) */
var __rwCss = {css};

/* 2. Page markup */
var __rwMarkup = {markup};

(function applyPageShell() {{
    var styleEl = document.getElementById('rw-css');
    if (!styleEl) {{
        styleEl = document.createElement('style');
        styleEl.id = 'rw-css';
        document.head.appendChild(styleEl);
    }}
    styleEl.textContent = __rwCss;

    /* Decode so that the HTML parser treats it exactly like served markup. */
    document.body.innerHTML = __rwMarkup;
}})();

/* 3. Page behaviour (runs at global scope so inline onclick="" still work) */
{script}
"""


def js_string(value: str) -> str:
    """Encode text as a JS string literal (JSON strings are valid JS strings)."""
    encoded = json.dumps(value, ensure_ascii=False)
    return encoded.replace("</script", "<\\/script")


def fail(message: str) -> None:
    sys.exit(f"build_site.py: {message}")


def copy_site_files() -> None:
    """Copy normal site files to the Pages artifact, excluding build inputs."""
    if OUTPUT.exists():
        shutil.rmtree(OUTPUT)
    OUTPUT.mkdir(parents=True)

    for path in ROOT.iterdir():
        if path.name in EXCLUDED or path.name == "index.html":
            continue
        destination = OUTPUT / path.name
        if path.is_dir():
            shutil.copytree(path, destination)
        else:
            shutil.copy2(path, destination)


def main() -> None:
    if not SOURCE.is_file():
        fail("missing root index.html")

    page = SOURCE.read_text(encoding="utf-8")
    style_match = re.search(r"<style\b[^>]*>(.*?)</style\s*>", page, re.S | re.I)
    if not style_match:
        fail("could not find a <style>...</style> block in index.html")

    body_match = re.search(r"(<body\b[^>]*>)(.*?)(</body\s*>)", page, re.S | re.I)
    if not body_match:
        fail("could not find a <body>...</body> block in index.html")

    body_inner = body_match.group(2).lstrip()
    # The page's inline script is the last script block inside <body>.
    script_matches = list(re.finditer(r"<script>\s*(.*?)\s*</script>", body_inner, re.S))
    if not script_matches:
        fail("could not find the page's inline script inside <body>")

    script_tag = script_matches[-1]
    js_code = script_tag.group(1)
    markup = body_inner[:script_tag.start()].rstrip()
    css = style_match.group(1).strip()

    # Copy images, subpages, CNAME, and other regular site files first.
    copy_site_files()

    # Keep the entire <head> so ordinary title/meta/link edits in index.html
    # make it to the published page. Replace only the page's large CSS block.
    page_without_css = page[:style_match.start()] + '<style id="rw-css"></style>' + page[style_match.end():]
    head_end = re.search(r"</head\s*>", page_without_css, re.I)
    if not head_end:
        fail("could not find </head> in index.html")
    head = page_without_css[:head_end.start()].rstrip()

    # Keep body attributes (if any), but let the bundle restore its contents.
    shell = (
        head
        + "\n</head>\n"
        + body_match.group(1)
        + '\n    <script src="assets/desktop.js"></script>\n'
        + body_match.group(3)
        + "\n</html>\n"
    )
    (OUTPUT / "index.html").write_text(shell, encoding="utf-8")

    bundle = JS_HEADER.format(
        css=js_string(css),
        markup=js_string(markup),
        script=js_code,
    )
    asset = OUTPUT / "assets" / "desktop.js"
    asset.parent.mkdir(parents=True, exist_ok=True)
    asset.write_text(bundle, encoding="utf-8")

    print(f"Built {OUTPUT.relative_to(ROOT)}/ from index.html")
    print(f"  published shell: {(OUTPUT / 'index.html').stat().st_size:,} bytes")
    print(f"  page bundle:     {asset.stat().st_size:,} bytes")


if __name__ == "__main__":
    main()
