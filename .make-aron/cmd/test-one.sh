#!/usr/bin/env bash
set -uo pipefail

# G0/G8 pass one acceptance test file in MA_ACCEPTANCE. Dispatch on its extension.
FILE="${1:-}"
[ -n "$FILE" ] || { echo "CANNOT RUN: no acceptance file given" >&2; exit 2; }

export DOTNET_ROOT="${DOTNET_ROOT:-$(dirname "$(readlink -f "$(command -v dotnet)")")}"
export DOTNET_CLI_TELEMETRY_OPTOUT=1

case "$FILE" in
  *.cs)
    # Walk up to the owning .csproj and run only the test class named after the file.
    dir="$(dirname "$FILE")"
    proj=""
    while [ "$dir" != "." ] && [ "$dir" != "/" ]; do
      proj="$(find "$dir" -maxdepth 1 -name '*.csproj' | head -1)"
      [ -n "$proj" ] && break
      dir="$(dirname "$dir")"
    done
    [ -n "$proj" ] || { echo "CANNOT RUN: no .csproj above $FILE" >&2; exit 2; }
    cls="$(basename "$FILE" .cs)"
    exec dotnet test "$proj" --configuration Release --filter "FullyQualifiedName~$cls"
    ;;
  *)
    exec npx vitest run "$FILE"
    ;;
esac
