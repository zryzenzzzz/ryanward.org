#!/usr/bin/env python3
"""
Build the "shell" index.html + assets/desktop.js from _source/page.html.

_source/page.html is the editable master copy of the page (same file that used
to be index.html). The build splits it into:

    index.html          -> head metadata only (title, meta, OG tags, JSON-LD, fonts)
    assets/desktop.js   -> the CSS, the body markup, and the page script

The rendered page is byte-for-byte the same markup and CSS; the only
difference is that a "View Page Source" on the live site now shows the small
shell instead of the whole page.

GitHub Pages runs Jekyll by default, and Jekyll ignores folders whose name
starts with "_", so _source/ is never published to the live site.

Usage:  python3 tools/build_site.py
"""

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "_source" / "page.html"
OUT_HTML = ROOT / "index.html"
OUT_JS = ROOT / "assets" / "desktop.js"

JS_HEADER = """\
/* ------------------------------------------------------------------
   ryanward.org - generated file, do not edit by hand.
   Edit _source/page.html and run: python3 tools/build_site.py
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
    # Keep the bundle safe if it is ever inlined into HTML.
    return encoded.replace("</script", "<\\/script")


def fail(msg: str) -> None:
    sys.exit(f"build_site.py: {msg}")


def main() -> None:
    if not SOURCE.exists():
        fail(f"missing source file: {SOURCE}")

    page = SOURCE.read_text(encoding="utf-8")

    style_match = re.search(r"<style>\s*(.*?)\s*</style>", page, re.S)
    if not style_match:
        fail("could not find the <style> block in _source/page.html")
    css = style_match.group(1)

    body_match = re.search(r"<body>\s*(.*)\s*</body>", page, re.S)
    if not body_match:
        fail("could not find the <body> block in _source/page.html")
    body_inner = body_match.group(1)

    # The page script is the last <script>...</script> inside <body>.
    script_matches = list(re.finditer(r"<script>\s*(.*?)\s*</script>", body_inner, re.S))
    if not script_matches:
        fail("could not find the page script inside <body>")
    script_tag = script_matches[-1]
    js_code = script_tag.group(1)
    markup = body_inner[: script_tag.start()].rstrip()

    # --- index.html shell -------------------------------------------------
    head = page[: style_match.start()].rstrip()
    shell = (
        head
        + '\n    <style id="rw-css"></style>\n'
        + "</head>\n<body>\n"
        + '    <script src="assets/desktop.js"></script>\n'
        + "</body>\n</html>\n"
    )
    OUT_HTML.write_text(shell, encoding="utf-8")

    # --- assets/desktop.js ------------------------------------------------
    OUT_JS.parent.mkdir(parents=True, exist_ok=True)
    OUT_JS.write_text(
        JS_HEADER.format(
            css=js_string(css),
            markup=js_string(markup),
            script=js_code,
        ),
        encoding="utf-8",
    )

    print(f"wrote {OUT_HTML.relative_to(ROOT)}  ({OUT_HTML.stat().st_size:,} bytes)")
    print(f"wrote {OUT_JS.relative_to(ROOT)}  ({OUT_JS.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
