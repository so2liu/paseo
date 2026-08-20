#!/usr/bin/env bash

set -u

usage() {
  echo "usage: $0 <previous-upstream-tag> <pre-sync-fork-ref> <new-upstream-tag> [merged-ref]" >&2
  exit 64
}

if [ "$#" -lt 3 ] || [ "$#" -gt 4 ]; then
  usage
fi

old_base=$1
pre_sync=$2
new_base=$3
merged_ref=${4:-HEAD}

for ref in "$old_base" "$pre_sync" "$new_base" "$merged_ref"; do
  if ! git rev-parse --verify "$ref^{commit}" >/dev/null 2>&1; then
    echo "invalid git ref: $ref" >&2
    exit 65
  fi
done

if [ ! -f CLAUDE.md ] || [ ! -d packages ]; then
  echo "run this script from the Paseo repository root" >&2
  exit 66
fi

audit_tmp=$(mktemp -d "${TMPDIR:-/tmp}/paseo-customization-audit.XXXXXX")
trap 'rm -rf "$audit_tmp"' EXIT

changed_paths="$audit_tmp/upstream-changed.txt"
intersecting_commits="$audit_tmp/intersecting-commits.txt"
missing_files="$audit_tmp/missing-files.txt"
missing_symbols="$audit_tmp/missing-symbols.txt"

git diff --name-only --no-renames "$old_base...$new_base" >"$changed_paths"

if [ -s "$changed_paths" ]; then
  # Repository paths contain no newlines. Keep --full-history so sync merge resolutions are audited.
  # shellcheck disable=SC2046
  git log --format='%h %s' "$old_base..$pre_sync" --full-history -- $(cat "$changed_paths") \
    >"$intersecting_commits"
else
  : >"$intersecting_commits"
fi

git diff --name-status --no-renames "$old_base" "$pre_sync" -- 'packages/*' \
  | awk '$1 == "A" { print $2 }' \
  | grep -vE '\.(md|json|lock)$' \
  | while IFS= read -r file; do
      git cat-file -e "$merged_ref:$file" 2>/dev/null || echo "$file"
    done >"$missing_files"

git diff -U0 "$old_base" "$pre_sync" -- 'packages/*/src/*' \
  | grep -E '^\+' \
  | grep -oE '^\+export (async )?function [A-Za-z0-9_]+|^\+export (const|class|interface|type) [A-Za-z0-9_]+' \
  | grep -oE '[A-Za-z0-9_]+$' \
  | sort -u \
  | while IFS= read -r symbol; do
      git grep -qw "$symbol" "$merged_ref" -- packages || echo "$symbol"
    done >"$missing_symbols"

echo "refs"
echo "  previous upstream: $old_base"
echo "  pre-sync fork:     $pre_sync"
echo "  new upstream:      $new_base"
echo "  merged result:     $merged_ref"
echo
echo "history-derived scope"
echo "  upstream-changed files: $(wc -l <"$changed_paths" | tr -d ' ')"
echo "  intersecting fork commits: $(wc -l <"$intersecting_commits" | tr -d ' ')"
cat "$intersecting_commits"
echo
echo "candidate missing added files (classify against the catalog)"
if [ -s "$missing_files" ]; then cat "$missing_files"; else echo "  none"; fi
echo
echo "candidate missing exported symbols (classify against the catalog)"
if [ -s "$missing_symbols" ]; then cat "$missing_symbols"; else echo "  none"; fi
echo
echo "hard guardrails"

guardrail_failures=0

check_pattern() {
  label=$1
  file=$2
  pattern=$3
  if git grep -q -E "$pattern" "$merged_ref" -- "$file"; then
    echo "  PASS $label"
  else
    echo "  FAIL $label ($file)"
    guardrail_failures=$((guardrail_failures + 1))
  fi
}

check_absent_pattern() {
  label=$1
  file=$2
  pattern=$3
  if git grep -q -E "$pattern" "$merged_ref" -- "$file"; then
    echo "  FAIL $label ($file)"
    guardrail_failures=$((guardrail_failures + 1))
  else
    echo "  PASS $label"
  fi
}

check_file() {
  label=$1
  file=$2
  if git cat-file -e "$merged_ref:$file" 2>/dev/null; then
    echo "  PASS $label"
  else
    echo "  FAIL $label ($file)"
    guardrail_failures=$((guardrail_failures + 1))
  fi
}

check_absent_pattern "composer history does not use the state-only setter" \
  "packages/app/src/composer/index.tsx" 'setUserInput\(result\.text'
check_pattern "UI base font cap remains 32" \
  "packages/app/src/hooks/use-settings/storage.ts" 'MAX_UI_BASE_FONT_SIZE = 32'
check_pattern "control geometry uses scaled theme heights" \
  "packages/app/src/components/ui/control-geometry.ts" 'controlHeights = theme\.controlHeight'
check_pattern "running-agent send defaults to queue" \
  "packages/app/src/hooks/use-settings/storage.ts" 'sendBehavior: "queue"'
check_pattern "attachment limit remains 1 GB" \
  "packages/app/src/composer/index.tsx" 'MAX_FILE_SIZE_BYTES = 1024 \* 1024 \* 1024'
check_pattern "Desktop update feed remains on the fork" \
  "packages/desktop/electron-builder.yml" 'owner: so2liu'
check_file "Volcengine speech provider remains present" \
  "packages/server/src/server/speech/providers/volcengine/stt.ts"
check_file "native mobile-lite projection remains present" \
  "packages/app/src/agent-stream/mobile-lite-projection.ts"
check_file "Desktop host-registry backup remains present" \
  "packages/desktop/src/settings/host-registry-backup.ts"

echo
echo "Read .agents/skills/audit-fork-customizations/references/customizations.md and verify every row."

if [ "$guardrail_failures" -gt 0 ]; then
  echo "$guardrail_failures hard guardrail(s) failed" >&2
  exit 2
fi

echo "hard guardrails passed; manual catalog verification is still required"
