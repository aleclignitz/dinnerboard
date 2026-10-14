#!/usr/bin/env python3
"""Build docs/index.html (the live, self-hosted board) from board/supper-board.html.

Same pattern as the original project's tools/build_demo.py, but wraps the
board fragment with the Supabase adapter instead of the Claude artifact
shim. Run this after any change to board/supper-board.html, config.js, or
supabase-adapter.js, and commit the generated docs/index.html so GitHub
Pages can serve it directly.

Usage:  python3 tools/build_board.py
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
board = (ROOT / "board" / "supper-board.html").read_text(encoding="utf-8")

shell_head = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<style>
:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}
body{margin:0}
img{max-width:100%}
[hidden]{display:none!important}
</style>
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js"></script>
<script src="config.js"></script>
<script src="supabase-adapter.js"></script>
</head>
<body>
"""
shell_tail = "\n</body>\n</html>\n"

out = ROOT / "docs" / "index.html"
out.write_text(shell_head + board + shell_tail, encoding="utf-8")
print(f"Wrote {out.relative_to(ROOT)}")
