#!/usr/bin/env python3
"""VAULT RAIDER build. SPEC v0.6 section 13.

Inlines src/ into a single dist/index.html with zero external requests.

The concatenated output is ONE module scope, so the CLAUDE.md rules about
unique identifiers and named-only exports are not style preferences - break
them and the build produces a file that throws at load. This script therefore
FAILS THE BUILD on all three, rather than trusting them:

  1. duplicate top-level identifier across the MANIFEST
  2. any `export default`
  3. any import naming a file outside the MANIFEST

Usage:  python build.py
"""

import os
import re
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(ROOT, "src")
DIST = os.path.join(ROOT, "dist")

# Explicit and ordered. Dependency direction is data -> core -> game -> render
# -> main. Nothing in this list may execute top-level code that reads another
# file's binding; every cross-module reference happens inside a function body,
# which is what keeps the order a convenience rather than a TDZ landmine.
MANIFEST = [
    "data/tuning.js",
    "core/rng.js",
    "core/input.js",
    "core/loop.js",
    "data/floors.js",
    "data/rooms.js",
    "game/collision.js",
    "game/entities.js",
    "game/room.js",
    "game/floor.js",
    "game/state.js",
    "core/gfx.js",
    "core/audio.js",
    "game/render.js",
    "main.js",
]

CSS_FILES = ["styles.css"]
SHELL = "index.html"
CSS_MARKER = "<!--INLINE_CSS-->"
JS_MARKER = "<!--INLINE_JS-->"

# Lines that exist only for the dev server (python -m http.server from src/).
DEV_TAG_PATTERNS = [
    re.compile(r'^\s*<link[^>]+href="styles\.css"[^>]*>\s*$'),
    re.compile(r'^\s*<script[^>]+src="main\.js"[^>]*>\s*</script>\s*$'),
    re.compile(r'^\s*<!--\s*Dev-only tag\..*?-->\s*$'),
]

IMPORT_RE = re.compile(
    r'^import\s+[\s\S]*?from\s+[\'"]([^\'"]+)[\'"];?[ \t]*\n?', re.M
)
EXPORT_DEFAULT_RE = re.compile(r'^\s*export\s+default\b', re.M)
EXPORT_PREFIX_RE = re.compile(r'^export\s+', re.M)
# Column 0 only. Everything nested is indented by our own style, so a
# declaration flush against the left margin is by definition top-level.
TOP_LEVEL_DECL_RE = re.compile(
    r'^(?:async\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)', re.M
)

errors = []


def fail(msg):
    errors.append(msg)


def read(path):
    with open(path, "r", encoding="utf-8") as handle:
        return handle.read()


def check_imports(rel_path, text):
    """Rule 3: every import must resolve to a file in the MANIFEST."""
    manifest_set = {os.path.normpath(p) for p in MANIFEST}
    base = os.path.dirname(rel_path)
    for match in IMPORT_RE.finditer(text):
        spec = match.group(1)
        if not spec.startswith("."):
            fail("%s: bare import %r - no dependencies allowed" % (rel_path, spec))
            continue
        resolved = os.path.normpath(os.path.join(base, spec))
        if resolved not in manifest_set:
            resolved = resolved.replace("\\", "/")
            fail(
                "%s: imports %r which resolves to %s, not in MANIFEST"
                % (rel_path, spec, resolved)
            )


def strip_module_syntax(rel_path, text):
    """Rule 2 lives here: export default is rejected, never rewritten."""
    if EXPORT_DEFAULT_RE.search(text):
        line = text[: EXPORT_DEFAULT_RE.search(text).start()].count("\n") + 1
        fail("%s:%d: export default - named exports only" % (rel_path, line))
    text = IMPORT_RE.sub("", text)
    text = EXPORT_PREFIX_RE.sub("", text)
    return text


def collect_top_level(rel_path, text, seen):
    """Rule 1: one flat scope after concatenation, so names must be unique."""
    for match in TOP_LEVEL_DECL_RE.finditer(text):
        name = match.group(1)
        line = text[: match.start()].count("\n") + 1
        if name in seen:
            fail(
                "%s:%d: duplicate top-level identifier %r (first declared in %s)"
                % (rel_path, line, name, seen[name])
            )
        else:
            seen[name] = rel_path


def build():
    shell_path = os.path.join(SRC, SHELL)
    if not os.path.exists(shell_path):
        fail("missing %s" % shell_path)
        return None

    shell = read(shell_path)
    for marker in (CSS_MARKER, JS_MARKER):
        if marker not in shell:
            fail("%s: missing marker %s" % (SHELL, marker))

    css_parts = []
    for name in CSS_FILES:
        path = os.path.join(SRC, name)
        if not os.path.exists(path):
            fail("missing %s" % path)
            continue
        css_parts.append(read(path))

    js_parts = []
    seen_names = {}
    for rel in MANIFEST:
        path = os.path.join(SRC, rel)
        if not os.path.exists(path):
            fail("MANIFEST lists %s but the file does not exist" % rel)
            continue
        raw = read(path)
        check_imports(rel, raw)
        stripped = strip_module_syntax(rel, raw)
        collect_top_level(rel, stripped, seen_names)
        js_parts.append("// ---- %s ----\n%s" % (rel, stripped.strip()))

    # Any source file not in the MANIFEST is dead weight at best and a missing
    # dependency at worst. Report it rather than silently dropping it.
    for dirpath, _dirnames, filenames in os.walk(SRC):
        for filename in filenames:
            if not filename.endswith(".js"):
                continue
            rel = os.path.relpath(os.path.join(dirpath, filename), SRC).replace("\\", "/")
            if rel not in MANIFEST:
                fail("src/%s exists but is not in the MANIFEST" % rel)

    if errors:
        return None

    out = shell
    out = out.replace(CSS_MARKER, "<style>\n%s\n</style>" % "\n".join(css_parts))
    out = out.replace(
        JS_MARKER,
        '<script type="module">\n%s\n</script>' % "\n\n".join(js_parts),
    )

    kept = []
    for line in out.split("\n"):
        if any(pattern.match(line) for pattern in DEV_TAG_PATTERNS):
            continue
        kept.append(line)
    return "\n".join(kept)


def main():
    output = build()
    if errors:
        sys.stderr.write("BUILD FAILED\n")
        for err in errors:
            sys.stderr.write("  %s\n" % err)
        return 1

    if not os.path.isdir(DIST):
        os.makedirs(DIST)
    target = os.path.join(DIST, "index.html")
    with open(target, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(output)

    size = len(output.encode("utf-8"))
    print("wrote %s (%d bytes, %d modules)" % (target, size, len(MANIFEST)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
