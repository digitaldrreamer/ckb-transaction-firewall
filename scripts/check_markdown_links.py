#!/usr/bin/env python3
"""Validate repository-relative Markdown links without touching the network."""

from __future__ import annotations

import pathlib
import re
import sys
from urllib.parse import unquote, urlparse

ROOT = pathlib.Path(__file__).resolve().parents[1]
LINK_RE = re.compile(r"(?<!!)\[[^\]]+\]\(([^)]+)\)")
EXCLUDED_DIRS = {
    ".git",
    "node_modules",
    "target",
    "dist",
    "internal",
}


def iter_markdown_files() -> list[pathlib.Path]:
    files: list[pathlib.Path] = []
    for path in ROOT.rglob("*.md"):
        if any(part in EXCLUDED_DIRS for part in path.relative_to(ROOT).parts):
            continue
        files.append(path)
    return sorted(files)


def is_local_link(target: str) -> bool:
    parsed = urlparse(target)
    if parsed.scheme or parsed.netloc:
        return False
    return not target.startswith("#")


def normalize_target(raw_target: str) -> str:
    target = raw_target.strip()
    if target.startswith("<") and target.endswith(">"):
        target = target[1:-1]
    target = target.split("#", 1)[0].strip()
    return unquote(target)


def validate_file(path: pathlib.Path) -> list[str]:
    errors: list[str] = []
    text = path.read_text(encoding="utf-8")
    for line_no, line in enumerate(text.splitlines(), start=1):
        for match in LINK_RE.finditer(line):
            target = normalize_target(match.group(1))
            if not target or not is_local_link(target):
                continue
            resolved = (path.parent / target).resolve()
            try:
                resolved.relative_to(ROOT)
            except ValueError:
                errors.append(f"{path.relative_to(ROOT)}:{line_no}: link escapes repo: {target}")
                continue
            if not resolved.exists():
                errors.append(f"{path.relative_to(ROOT)}:{line_no}: missing link target: {target}")
    return errors


def main() -> int:
    errors: list[str] = []
    for path in iter_markdown_files():
        errors.extend(validate_file(path))
    if errors:
        print("Markdown link check failed:", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1
    print("Markdown link check passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
