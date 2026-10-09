---
title: Monitor
description: Monitor lists everything running in Studio and everything waiting on you, with the controls to stop it.
type: guide
owner: parsoFish
last_verified: 2026-10-09
covers: [apps/studio/app/monitor/**, apps/studio/lib/monitor-view.ts]
sidebar:
  order: 3
---

Monitor shows what is running and what is stuck: flow runs, standalone agent runs, interactive sessions and everything waiting on you. Use it to supervise a factory that runs unattended.

## What Monitor shows

From the top of the page:

- **What is running** has four tiles: Live, Needs you, Failed and Queued. Live counts in-flight runs plus open interactive sessions. Needs you adds gated runs, sessions that need you and attention items. Failed counts flow and standalone agent runs that failed or were stopped by their cost ceiling; find them in **Recent activity** by filtering on status. Queued counts runs waiting for the scheduler.
- A notice appears only when `forge serve` is not running normally. Queued work waits until it is back.
- **Waiting on you** lists project gates, reflections waiting for your answers, Knowledge edits parked for review and Knowledge lint findings. Each row links to the thing to act on.
- **Active sessions** lists every open interactive session, needs-you first.
- **Flow runs** groups runs as NEEDS YOU, ACTIVE, FAILED, QUEUED and COMPLETE.
- **Recent activity** merges flow runs and standalone agent runs, newest first, with a status filter and **Show more** paging.

## Read cost

Rows in **Recent activity** show their recorded cost in dollars. Monitor shows no total.

## Stop work

To stop one session, press **Cancel** on its card in **Active sessions**, then **Confirm cancel**.

To stop everything, press **Emergency halt** in the nav bar. Nothing new starts, active runs finish, and queued runs wait. A red banner reports the counts. Press **Release halt** to resume. Halt has no confirm step.

## Home and Monitor

Home carries the same four tiles as a summary; each links to Monitor, which holds the detail.

## Related

- [Drive forge through the assistant](/guides/how-to/drive-forge-through-the-assistant/)
- [Sessions & gates](/guides/sessions-and-gates/)
- [Flows](/guides/flows/)
