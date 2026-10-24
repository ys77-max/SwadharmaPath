#!/usr/bin/env python3
"""Fail when a change touches code or specs without updating /docs.

    python3 scripts/check_docs.py [BASE_REF]      # default BASE_REF: origin/main

Rules (see docs/README.md and docs/sops/technical-sops.md, SOP-T8):
  1. Any changed file outside docs/ and the exempt list needs at least one change under docs/.
  2. A changed file matching a glob in docs/docs-map.txt needs a change to at least one mapped doc.
Set DOCS_NOT_REQUIRED=true (CI does this for the `docs-not-required` label) to skip.
"""
import fnmatch
import os
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
MAP_FILE = ROOT / "docs" / "docs-map.txt"

# Files that never need a doc change on their own.
EXEMPT = [
    "docs/*",
    "*.md",
    ".gitignore",
    "package-lock.json",
    ".github/pull_request_template.md",
    "public/*",
    "src/assets/*",
]


def changed_files(base):
    out = subprocess.run(
        ["git", "diff", "--name-only", f"{base}...HEAD"],
        cwd=ROOT, check=True, capture_output=True, text=True,
    ).stdout
    return [line for line in out.splitlines() if line]


def load_map():
    rules = []
    for line in MAP_FILE.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        glob, docs = (part.strip() for part in line.split("|", 1))
        rules.append((glob, [d.strip() for d in docs.split(",") if d.strip()]))
    return rules


def matches(path, patterns):
    return any(fnmatch.fnmatch(path, p) for p in patterns)


def main():
    if os.environ.get("DOCS_NOT_REQUIRED", "").lower() == "true":
        print("docs check skipped: docs-not-required label set (explain why in the PR description)")
        return 0

    base = sys.argv[1] if len(sys.argv) > 1 else "origin/main"
    files = changed_files(base)
    changed = set(files)
    code = [f for f in files if not matches(f, EXEMPT)]
    docs = [f for f in files if f.startswith("docs/")]

    if not code:
        print("docs check passed: no code changes")
        return 0

    errors = []
    if not docs:
        errors.append("Code changed but nothing under docs/ changed. Changed code:\n  " + "\n  ".join(code))

    for glob, mapped in load_map():
        hits = [f for f in code if fnmatch.fnmatch(f, glob)]
        if hits and not changed.intersection(mapped):
            errors.append(
                f"Files matching '{glob}' changed:\n  " + "\n  ".join(hits)
                + "\nUpdate at least one of:\n  " + "\n  ".join(mapped)
            )

    if errors:
        print("docs check FAILED\n")
        print("\n\n".join(errors))
        print("\nSee docs/README.md#which-doc-to-update. If this change truly has no doc impact,"
              " add the 'docs-not-required' label and explain why in the PR description.")
        return 1

    print(f"docs check passed: {len(code)} code file(s), {len(docs)} doc file(s) changed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
