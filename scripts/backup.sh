#!/usr/bin/env bash
# Our own copy of a hosted project: database (schema, data) and Storage files.
# Read-only on the project. Rehearsed on staging, 2026-11-08 (docs/runbook.md).
#
#   scripts/backup.sh <project-ref> <output-folder>
#
# Needs `supabase login`. Keep the output somewhere private: it holds guest
# data and invoices. Never commit it.
set -euo pipefail

ref="${1:?project ref, e.g. iecsohriashrdbqcelkl}"
out="${2:?output folder}/$(date -u +%Y-%m-%dT%H%MZ)"
mkdir -p "$out/files"

supabase db dump --remote="$ref" -f "$out/schema.sql"
supabase db dump --remote="$ref" --data-only --use-copy -f "$out/data.sql"

for bucket in media invoices uploads-private; do
  mkdir -p "$out/files/$bucket"
  supabase storage cp -r "ss:///$bucket" "$out/files/$bucket" \
    --remote="$ref" --experimental >/dev/null
done

echo "Backup in $out"
find "$out" -type f | wc -l | xargs echo "files:"
