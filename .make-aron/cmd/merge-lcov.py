#!/usr/bin/env python3
"""Merge lcov reports the way crap.py reads them: one record per source file.

coverlet writes one report per test project, and all three .NET projects load the
same assemblies, so Gones.Api ships up to three records for the same file — the
IntegrationTests one with real hits, the ArchitectureTests one with zeroes. Plain
concatenation keeps every record, and crap.py's parser is last-write-wins, so a
zero record silently erases a covered one. Merging on max hits per line is what
"a file was executed by some test in the run" actually means.

    usage: merge-lcov.py <out.info> <in.info...>
"""
import sys
from collections import defaultdict


def split_counter(prefix, payload):
    """-> (identity, hits) for one counted lcov line, or None for anything else.

    The counter sits at a different end per record type, and a C# member name is
    full of commas, so every split here is bounded rather than a plain split(',').
    """
    if prefix == "DA":  # DA:<line>,<hits>[,<checksum>]
        line, hits = payload.split(",")[:2]
        return line, int(hits)
    if prefix == "BRDA":  # BRDA:<line>,<block>,<branch>,<taken>
        line, block, branch, taken = payload.split(",", 3)
        return f"{line},{block},{branch}", 0 if taken == "-" else int(taken)
    if prefix == "FNDA":  # FNDA:<hits>,<name>
        hits, name = payload.split(",", 1)
        return name, int(hits)
    if prefix == "FN":  # FN:<line>,<name>
        return payload, 0
    return None


def parse(paths):
    """-> {source file: {prefix: {identity: hits}}}, insertion-ordered."""
    files = {}
    for path in paths:
        current = None
        with open(path) as handle:
            for line in handle:
                line = line.strip()
                prefix, _, payload = line.partition(":")
                if prefix == "SF":
                    current = files.setdefault(payload, defaultdict(dict))
                elif line == "end_of_record":
                    current = None
                elif current is not None:
                    counted = split_counter(prefix, payload)
                    if counted:
                        identity, hits = counted
                        record = current[prefix]
                        record[identity] = max(record.get(identity, 0), hits)
    return files


def emit(files, out):
    for source, records in files.items():
        out.write(f"SF:{source}\n")
        for name in records["FN"]:
            out.write(f"FN:{name}\n")
        for name, hits in records["FNDA"].items():
            out.write(f"FNDA:{hits},{name}\n")
        out.write(f"FNF:{len(records['FN'])}\n")
        out.write(f"FNH:{sum(1 for hits in records['FNDA'].values() if hits > 0)}\n")
        for branch, hits in records["BRDA"].items():
            out.write(f"BRDA:{branch},{hits or '-'}\n")
        out.write(f"BRF:{len(records['BRDA'])}\n")
        out.write(f"BRH:{sum(1 for hits in records['BRDA'].values() if hits > 0)}\n")
        for line, hits in records["DA"].items():
            out.write(f"DA:{line},{hits}\n")
        out.write(f"LF:{len(records['DA'])}\n")
        out.write(f"LH:{sum(1 for hits in records['DA'].values() if hits > 0)}\n")
        out.write("end_of_record\n")


if __name__ == "__main__":
    with open(sys.argv[1], "w") as out:
        emit(parse(sys.argv[2:]), out)
