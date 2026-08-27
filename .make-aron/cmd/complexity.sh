#!/usr/bin/env bash
set -uo pipefail

# G4 reads this on stdout as lizard CSV. Both stacks in one scan: lizard parses
# TypeScript and C# alike (verified 2026-08-27, lizard 1.22.1). crap.py filters
# to the functions the diff actually touched, so scanning wide costs only time.
exec lizard src ops backend/src --csv
