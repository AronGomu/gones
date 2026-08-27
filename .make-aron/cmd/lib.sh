# Shared helpers for the make-aron-v2 gate commands in this polyglot repo.
#
# The repo is two stacks in one tree: an Angular/TypeScript frontend (src/, ops/)
# and a .NET backend (backend/). run.sh holds one command string per gate, so the
# stack dispatch lives here: cheap node checks always run, the 5-minute .NET
# suite runs only when the diff touches backend/.

# G10's flake.sh runs cmd.test without run.sh's {base} substitution, so the
# placeholder can arrive verbatim. Anything git cannot resolve degrades to HEAD,
# which still sees the ticket's uncommitted work.
BASE_REF="${1:-HEAD}"
git rev-parse --verify --quiet "$BASE_REF^{commit}" >/dev/null 2>&1 || BASE_REF=HEAD

# dotnet global tools (dotnet-stryker) need DOTNET_ROOT on NixOS: the apphost
# cannot find the runtime through the nix-store symlink on its own.
export DOTNET_ROOT="${DOTNET_ROOT:-$(dirname "$(readlink -f "$(command -v dotnet)")")}"
export PATH="$HOME/.dotnet/tools:$PATH"
export DOTNET_CLI_TELEMETRY_OPTOUT=1

changed_files() {
  {
    git diff --name-only "$BASE_REF" --
    git diff --cached --name-only
    git ls-files --others --exclude-standard
  } 2>/dev/null | sort -u | grep -v '^$' || true
}

backend_touched() {
  changed_files | grep -qE '^backend/'
}
