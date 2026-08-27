#!/usr/bin/env python3
"""Changed line ranges per file, formatted for a mutation engine.

G5 is diff-scoped. Both engines mutate a whole file when handed a bare path, and
a ticket-sized edit to a 1000-line service would then be scored on every mutant
in it. Both accept a line range instead: StrykerJS as `path:start-end`, Stryker.NET
as `path{start..end}`.

    diff-ranges.py <base> --pattern <regex> --format js|net

Prints one scope entry per line. Untracked files are scoped whole.
"""
import argparse
import os
import re
import subprocess
import sys


def git(*args):
    out = subprocess.run(["git", *args], capture_output=True, text=True)
    return out.stdout if out.returncode == 0 else ""


def hunk_ranges(base):
    """-> {file: [(start, end)]} over lines added or modified vs base."""
    ranges = {}
    cur = None
    for line in git("diff", "-U0", base, "--").splitlines():
        if line.startswith("+++ b/"):
            cur = line[6:]
        elif line.startswith("@@") and cur:
            plus = line.split("+")[1].split(" ")[0]
            start, _, count = plus.partition(",")
            start, count = int(start), int(count or 1)
            if count == 0:      # pure deletion, nothing left to mutate
                continue
            ranges.setdefault(cur, []).append((start, start + count - 1))
    return ranges


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("base")
    ap.add_argument("--pattern", required=True)
    ap.add_argument("--format", choices=["js", "net"], required=True)
    args = ap.parse_args()

    keep = re.compile(args.pattern)
    ranges = {f: r for f, r in hunk_ranges(args.base).items() if keep.search(f)}

    for path in git("ls-files", "--others", "--exclude-standard").splitlines():
        if not keep.search(path) or not os.path.exists(path):
            continue
        with open(path, encoding="utf-8", errors="replace") as fh:
            n = sum(1 for _ in fh)
        if n:
            ranges.setdefault(path, []).append((1, n))

    for path, spans in sorted(ranges.items()):
        for start, end in spans:
            if args.format == "js":
                print(f"{path}:{start}-{end}")
            else:
                print(f"{path}{{{start}..{end}}}")


if __name__ == "__main__":
    sys.exit(main())
