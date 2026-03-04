#!/usr/bin/env bash

set -euo pipefail

SCRIPT_NAME="$(basename "$0")"

COUNTS_FILE="${COUNTS_FILE:-./artifacts/migration/dry-run-counts.csv}"
CHECKSUM_FILE="${CHECKSUM_FILE:-./artifacts/migration/checksum-diff.csv}"
ENTITIES_CSV="${ENTITIES_CSV:-tasks,reviews,notifications,activities,webhooks}"

usage() {
  cat <<USAGE
Usage: $SCRIPT_NAME [options]

Validate dry-run migration parity for required entities.

Options:
  --counts-file <path>      CSV with columns: entity,source_count,target_count
                            default: $COUNTS_FILE
  --checksums-file <path>   CSV with columns: entity,diff_count
                            default: $CHECKSUM_FILE
  --entities <csv>          Required entities (comma-separated)
                            default: $ENTITIES_CSV
  -h, --help                Show this help text

Exit codes:
  0  All required entities passed row-count parity and checksum diff checks
  1  One or more required checks failed
  2  Invalid input or parse error
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --counts-file)
      [[ $# -lt 2 ]] && { echo "ERROR: --counts-file requires a value" >&2; exit 2; }
      COUNTS_FILE="$2"
      shift 2
      ;;
    --checksums-file)
      [[ $# -lt 2 ]] && { echo "ERROR: --checksums-file requires a value" >&2; exit 2; }
      CHECKSUM_FILE="$2"
      shift 2
      ;;
    --entities)
      [[ $# -lt 2 ]] && { echo "ERROR: --entities requires a value" >&2; exit 2; }
      ENTITIES_CSV="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "ERROR: Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ ! -r "$COUNTS_FILE" ]]; then
  echo "ERROR: counts file is not readable: $COUNTS_FILE" >&2
  exit 2
fi

if [[ ! -r "$CHECKSUM_FILE" ]]; then
  echo "ERROR: checksums file is not readable: $CHECKSUM_FILE" >&2
  exit 2
fi

awk \
  -v required_csv="$ENTITIES_CSV" \
  -v counts_file="$COUNTS_FILE" \
  -v checksums_file="$CHECKSUM_FILE" \
  '
function trim(value) {
  gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
  return value
}

function fail_parse(message) {
  print message > "/dev/stderr"
  exit 2
}

function print_row(entity, source, target, diff, result) {
  printf "%-16s %-12s %-12s %-12s %-8s\n", entity, source, target, diff, result
}

BEGIN {
  split(required_csv, raw_required, ",")
  required_count = 0

  for (i = 1; i <= length(raw_required); i++) {
    entity = tolower(trim(raw_required[i]))
    if (entity == "") {
      continue
    }
    if (!(entity in required_set)) {
      required_count++
      required_order[required_count] = entity
      required_set[entity] = 1
    }
  }

  if (required_count == 0) {
    fail_parse("ERROR: no required entities provided")
  }
}

FILENAME == counts_file {
  line = $0
  gsub(/\r$/, "", line)
  if (trim(line) == "" || line ~ /^[[:space:]]*#/) {
    next
  }

  field_count = split(line, fields, ",")
  if (field_count != 3) {
    fail_parse("ERROR: invalid counts row at line " FNR ": " line)
  }

  entity = tolower(trim(fields[1]))
  source = trim(fields[2])
  target = trim(fields[3])

  if (!has_counts_data && entity == "entity" && tolower(source) == "source_count" && tolower(target) == "target_count") {
    next
  }

  if (entity == "" || source == "" || target == "") {
    fail_parse("ERROR: invalid counts row at line " FNR ": " line)
  }

  if (source !~ /^[0-9]+$/ || target !~ /^[0-9]+$/) {
    fail_parse("ERROR: non-numeric count at line " FNR ": " line)
  }

  if (entity in source_counts) {
    fail_parse("ERROR: duplicate counts entry for entity '\''" entity "'\''")
  }

  source_counts[entity] = source
  target_counts[entity] = target
  has_counts_data = 1
  next
}

FILENAME == checksums_file {
  line = $0
  gsub(/\r$/, "", line)
  if (trim(line) == "" || line ~ /^[[:space:]]*#/) {
    next
  }

  field_count = split(line, fields, ",")
  if (field_count != 2) {
    fail_parse("ERROR: invalid checksum row at line " FNR ": " line)
  }

  entity = tolower(trim(fields[1]))
  diff_count = trim(fields[2])

  if (!has_checksum_data && entity == "entity" && tolower(diff_count) == "diff_count") {
    next
  }

  if (entity == "" || diff_count == "") {
    fail_parse("ERROR: invalid checksum row at line " FNR ": " line)
  }

  if (diff_count !~ /^[0-9]+$/) {
    fail_parse("ERROR: non-numeric diff_count at line " FNR ": " line)
  }

  if (entity in diff_counts) {
    fail_parse("ERROR: duplicate checksum entry for entity '\''" entity "'\''")
  }

  diff_counts[entity] = diff_count
  has_checksum_data = 1
  next
}

END {
  if (!has_counts_data) {
    fail_parse("ERROR: counts file has no data rows: " counts_file)
  }

  if (!has_checksum_data) {
    fail_parse("ERROR: checksums file has no data rows: " checksums_file)
  }

  print "=== Migration Rehearsal Parity Check ==="
  print "Counts file:    " counts_file
  print "Checksums file: " checksums_file
  print ""
  print_row("ENTITY", "SOURCE", "TARGET", "DIFF_COUNT", "RESULT")
  print_row("------", "------", "------", "----------", "------")

  pass_count = 0
  fail_count = 0

  for (i = 1; i <= required_count; i++) {
    entity = required_order[i]
    source = (entity in source_counts) ? source_counts[entity] : "-"
    target = (entity in target_counts) ? target_counts[entity] : "-"
    diff_count = (entity in diff_counts) ? diff_counts[entity] : "-"
    result = "PASS"

    if (source == "-" || target == "-") {
      result = "FAIL"
      print "ERROR: missing counts data for required entity '\''" entity "'\''" > "/dev/stderr"
    } else if (diff_count == "-") {
      result = "FAIL"
      print "ERROR: missing checksum data for required entity '\''" entity "'\''" > "/dev/stderr"
    } else {
      if (source != target) {
        result = "FAIL"
        print "ERROR: row count mismatch for '\''" entity "'\'' (source=" source ", target=" target ")" > "/dev/stderr"
      }
      if (diff_count != "0") {
        result = "FAIL"
        print "ERROR: checksum diff_count is non-zero for '\''" entity "'\'' (diff_count=" diff_count ")" > "/dev/stderr"
      }
    }

    if (result == "PASS") {
      pass_count++
    } else {
      fail_count++
    }

    print_row(entity, source, target, diff_count, result)
  }

  print ""
  print "Summary: pass=" pass_count " fail=" fail_count

  if (fail_count > 0) {
    exit 1
  }

  exit 0
}
' "$COUNTS_FILE" "$CHECKSUM_FILE"
