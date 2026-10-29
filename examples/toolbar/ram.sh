#!/usr/bin/env bash
# Linux example: RAM utilization using MemAvailable, including reclaimable memory.
# Configure buckets with WARN_PERCENT=70 and CRITICAL_PERCENT=90 (integer percentages).
set -euo pipefail
export LC_ALL=C

warning=${WARN_PERCENT:-70}
critical=${CRITICAL_PERCENT:-90}
if ! [[ $warning =~ ^[0-9]{1,3}$ && $critical =~ ^[0-9]{1,3}$ ]]; then
  printf 'ram.sh: thresholds must be integer percentages.\n' >&2
  exit 1
fi
warning=$((10#$warning))
critical=$((10#$critical))
if ((warning >= critical || critical > 100)); then
  printf 'ram.sh: require 0 <= WARN_PERCENT < CRITICAL_PERCENT <= 100.\n' >&2
  exit 1
fi

awk -v warning="$warning" -v critical="$critical" '
  $1 == "MemTotal:" { total = $2; have_total = ($2 ~ /^[0-9]+$/) }
  $1 == "MemAvailable:" { available = $2; have_available = ($2 ~ /^[0-9]+$/) }
  END {
    if (!have_total || !have_available || total <= 0 || available < 0 || available > total) {
      print "ram.sh: valid MemTotal and MemAvailable are required in /proc/meminfo." > "/dev/stderr"
      exit 1
    }
    used = total - available
    percent = 100 * used / total
    value = percent >= critical ? "high" : percent >= warning ? "medium" : "low"
    printf "{\"value\":\"%s\",\"message\":\"RAM: %.1f%% (%.2f / %.2f GiB used)\",\"percent\":%.1f}\n", value, percent, used / 1048576, total / 1048576, percent
  }
' /proc/meminfo
