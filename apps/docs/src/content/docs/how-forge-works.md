---
title: How forge works
description: The parts of a forge factory and how a piece of work moves through one.
type: explanation
owner: parsoFish
last_verified: 2026-10-05
covers: [packages/flows/**, packages/stations/**, packages/factory/**, packages/knowledge/**]
---

forge builds software factories: pipelines that take an idea for a codebase and carry it to a merged pull request, mostly without you.

A **factory** runs one **flow**, an ordered path of **stations**. At each station an **agent** does the work, using **skills**, or a **gate** decides whether the work moves on.

Agents read **Knowledge** before they act, and the factory writes back what each run taught it, so later runs start from what earlier runs learned.

forge ships one example factory, the develop flow. It stops for your approval at its plan gate, starts when you kick the plan off, and stops again at its verdict and reflection gates. You can change it, or build your own flow from the same parts.
