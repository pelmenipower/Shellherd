#!/usr/bin/env bash
# Linux example: one-second, machine-wide CPU utilization for a dynamic display.
# Configure buckets with WARN_PERCENT=70 and CRITICAL_PERCENT=90 (integer percentages).
set -euo pipefail
export LC_ALL=C

warning=${WARN_PERCENT:-70}
critical=${CRITICAL_PERCENT:-90}
if ! [[ $warning =~ ^[0-9]{1,3}$ && $critical =~ ^[0-9]{1,3}$ ]]; then
  printf 'cpu.sh: thresholds must be integer percentages.\n' >&2
  exit 1
fi
warning=$((10#$warning))
critical=$((10#$critical))
if ((warning >= critical || critical > 100)); then
  printf 'cpu.sh: require 0 <= WARN_PERCENT < CRITICAL_PERCENT <= 100.\n' >&2
  exit 1
fi

sample_cpu() {
  awk '
    $1 == "cpu" {
      found = 1
      # First eight counters only: guest time is already included in user/nice.
      if (NF < 9) { print "cpu.sh: incomplete /proc/stat counters." > "/dev/stderr"; exit 1 }
      for (i = 2; i <= 9; i++) {
        if ($i !~ /^[0-9]+$/) { print "cpu.sh: invalid /proc/stat counter." > "/dev/stderr"; exit 1 }
        total += $i
      }
      printf "%.0f %.0f\n", total, $5 + $6
      exit
    }
    END { if (!found) { print "cpu.sh: aggregate CPU counters missing." > "/dev/stderr"; exit 1 } }
  ' /proc/stat
}

before=$(sample_cpu)
read -r total_before idle_before <<< "$before"
sleep 1
after=$(sample_cpu)
read -r total_after idle_after <<< "$after"

awk -v before="$total_before" -v after="$total_after" \
    -v idle_before="$idle_before" -v idle_after="$idle_after" \
    -v warning="$warning" -v critical="$critical" '
  BEGIN {
    total = after - before
    idle = idle_after - idle_before
    if (total <= 0 || idle < 0 || idle > total) {
      print "cpu.sh: CPU counters did not advance consistently; retry the measurement." > "/dev/stderr"
      exit 1
    }
    percent = 100 * (total - idle) / total
    value = percent >= critical ? "high" : percent >= warning ? "medium" : "low"
    printf "{\"value\":\"%s\",\"message\":\"CPU: %.1f%% (1 second sample, all logical CPUs)\",\"percent\":%.1f}\n", value, percent, percent
  }
'
