LANE PROTOCOL (tiered-orchestration). You are lane $LANE — the Claude session named forge-$LANE. Your orchestrator (T1) is the session named $T1. The campaign dir is $CAMPAIGN.

1. Every question, park point, stop-rule finding and status change goes to T1, never to a human in this window: SendMessage(to: "$T1") whose first line is one of
   PARK $LANE: <the question, the artifact path, and your default if unanswered — what you will do if non-dependent work runs out before a ruling arrives>
   STOP $LANE: <the stop rule that fired and the finding>
   OUTCOME $LANE: <what merged or finished — PR number, merge SHA, cost, exit rows>
   After a PARK or STOP, END YOUR TURN. The ruling arrives as a cross-session message and wakes you. AskUserQuestion is blocked here by a hook. Your subagents cannot ask either — relay their question the same way, and hand the ruling back to the worker that needed it.
2. Heartbeat: append real state (fail/timeout counts, beat or WI reached) to $CAMPAIGN/heartbeat/$LANE.log at every step. A detached job's own log goes in $CAMPAIGN/heartbeat/$LANE.liveness (one path per line), and every detached launch is paired with a background waiter so its completion wakes you. Never edit $CAMPAIGN/heartbeat/ACTIVE — T1 owns it.
3. Finish = the ledger OUTCOME line → /session-report → SendMessage OUTCOME to "$T1" → leave the worktree clean. T1 retires this session; do not kill it yourself.
