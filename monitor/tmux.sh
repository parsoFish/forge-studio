#!/usr/bin/env bash
# Launch the forge monitor: 3-pane tmux layout (scheduler / log tail / status).
# Run from the forge root directory.
set -euo pipefail

SESSION="forge-monitor"

if tmux has-session -t "$SESSION" 2>/dev/null; then
  echo "Session '$SESSION' already exists. Attaching."
  exec tmux attach -t "$SESSION"
fi

# Window 1: scheduler in left half; status in right half.
tmux new-session -d -s "$SESSION" -n monitor "echo 'Pane 1: forge serve'; npm run forge -- serve"

tmux split-window -t "$SESSION":monitor -h \
  "echo 'Pane 3: forge status --watch'; npm run forge -- status --watch"

tmux split-window -t "$SESSION":monitor.0 -v \
  "echo 'Pane 2: tail event log'; \
   while :; do \
     LOG=\$(ls -t _logs/*/events.jsonl 2>/dev/null | head -1); \
     if [ -n \"\$LOG\" ]; then tail -F \"\$LOG\"; fi; \
     sleep 2; \
   done"

tmux select-pane -t "$SESSION":monitor.0

echo "Started forge-monitor. Attach with: tmux attach -t $SESSION"
exec tmux attach -t "$SESSION"
