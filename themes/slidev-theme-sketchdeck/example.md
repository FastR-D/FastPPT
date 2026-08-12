---
theme: ./
title: Rewriting the ingest pipeline
info: RFC-0142 — why the queue keeps melting, and the three shapes a fix could take.
layout: cover
eyebrow: RFC-0142 / draft
---

# Rewriting the<br />ingest pipeline

A deep dive on why the queue keeps melting, and the three shapes a fix could take.

<div class="flex gap-4 items-center pt-4">
  <StickyNote color="yellow" :tilt="-1.2">A. Okafor</StickyNote>
  <StickyNote color="blue" :tilt="0.8">Platform</StickyNote>
  <span class="font-mono text-[1.2rem] text-[var(--sk-ink-muted)]">2026-07-27</span>
</div>

<template #sketch>
  <SketchPlaceholder label="[ whiteboard sketch of the pipeline ]" :tilt="1.6" />
</template>

<!--
Twenty minutes, one decision at the end. Set that expectation now.
-->

---

# What we'll walk through

<div class="grid grid-cols-2 gap-8 mt-6">
  <SketchBox wobble="a" :tilt="-0.5">
    <div class="flex gap-6 items-start">
      <span class="font-hand text-[3.4rem] leading-none text-[var(--sk-red)]">1</span>
      <div>
        <div class="font-bold text-[1.9rem]">The failure mode</div>
        <div class="text-[1.3rem] text-[var(--sk-ink-soft)]">Where backpressure actually breaks</div>
      </div>
    </div>
  </SketchBox>
  <SketchBox wobble="b" :tilt="0.6">
    <div class="flex gap-6 items-start">
      <span class="font-hand text-[3.4rem] leading-none text-[var(--sk-blue)]">2</span>
      <div>
        <div class="font-bold text-[1.9rem]">Three candidate designs</div>
        <div class="text-[1.3rem] text-[var(--sk-ink-soft)]">Buffer, shard, or rewrite</div>
      </div>
    </div>
  </SketchBox>
  <SketchBox wobble="c" :tilt="0.4">
    <div class="flex gap-6 items-start">
      <span class="font-hand text-[3.4rem] leading-none text-[var(--sk-green)]">3</span>
      <div>
        <div class="font-bold text-[1.9rem]">Cost &amp; migration</div>
        <div class="text-[1.3rem] text-[var(--sk-ink-soft)]">What each one asks of us</div>
      </div>
    </div>
  </SketchBox>
  <SketchBox color="warm" wobble="d" :tilt="-0.8">
    <div class="flex gap-6 items-start">
      <span class="font-hand text-[3.4rem] leading-none text-[var(--sk-yellow)]">4</span>
      <div>
        <div class="font-bold text-[1.9rem]">The ask</div>
        <div class="text-[1.3rem] text-[var(--sk-ink-soft)]">One decision, today</div>
      </div>
    </div>
  </SketchBox>
</div>

---
layout: section
part: part one
accent: red
---

# The failure mode

Every incident since March has the same first paragraph.

<Scribble color="green" :tilt="6" right="8rem" bottom="7rem">yes, again</Scribble>

---

# Four causes, one root

<Underline color="yellow" width="36rem" class="mb-8" />

- Retries are unbounded — a single poisoned batch replays **forever**.
- Consumers share one lag budget, so the slowest sets the pace.
- Partition keys were chosen in 2023 for a workload we no longer have.
- Nobody owns the dead-letter queue. It has 4.1M messages in it.

<SketchBox wobble="b" :tilt="-0.7" class="mt-auto self-start">
  <span class="font-hand text-[2.2rem] text-[var(--sk-red)]">Root cause →</span>
  we priced retries at zero.
</SketchBox>

---
layout: quote
source: INC-2291 postmortem, line 40
---

We didn't run out of capacity. We ran out of patience with our own defaults.

---
layout: whiteboard
---

<template #title>

## Today's topology

</template>

<StickyNote color="red" :tilt="-1.4">3 single points of failure</StickyNote>

<template #board>
  <SketchPlaceholder :tilt="0" label="[ producers → broker → consumer pools → sink ]" />
</template>

<Scribble left="52%" top="30%" :tilt="-7">it melts here ↘</Scribble>

---
layout: two-cols
---

::left::

<div class="font-mono text-[1.2rem] uppercase tracking-widest text-[var(--sk-ink-muted)] mb-4">option B</div>

## Shard by tenant, not by event

Give every tenant its own lag budget. A noisy neighbour can still drown, but only in its own pool.

- <span class="text-[var(--sk-green)]">✓</span> Reuses the existing broker — no new infra.
- <span class="text-[var(--sk-green)]">✓</span> Rebalances are per-tenant and boring.
- <span class="text-[var(--sk-red)]">✗</span> Needs a key migration with 6h of dual-writes.

::right::

<div class="h-[26rem]">
  <SketchPlaceholder wobble="b" :tilt="1" :hatch="45" label="[ tenant → pool mapping ]" />
</div>

---
layout: code
file: ingest/admit.go
---

<template #title>

## The admission check

</template>

```go {3,7-9}
// one budget per tenant, refilled every second
func (p *Pool) Admit(b Batch) error {
  budget, ok := p.budgets[b.TenantID]
  if !ok {
    budget = p.defaults.Clone()
  }
  if budget.Remaining() < b.Size() {
    return Drop{Reason: "tenant_over_budget"}
  }
  return p.enqueue(b)
}
```

<Scribble right="6rem" top="12rem" :tilt="5">the whole RFC, really</Scribble>

---
layout: table
---

## Three options, honestly scored

|                  | A · bigger buffer | B · shard by tenant | C · full rewrite        |
| ---------------- | ----------------- | ------------------- | ----------------------- |
| Effort           | 1 sprint{.good}   | 3 sprints{.meh}     | 2 quarters{.bad}        |
| Fixes root cause | No{.bad}          | Mostly{.good}       | Yes{.good}              |
| Migration risk   | None{.good}       | 6h dual-write{.meh} | Everything, twice{.bad} |
| Recommendation   | stopgap           | → pick this{.pick}  | later, maybe            |

---
layout: stats
---

## Ninety days of evidence

<div class="sk-stat-row">
  <StatCard value="14" color="red" wobble="a" :tilt="-1">pages after midnight</StatCard>
  <StatCard value="4.1M" color="blue" wobble="b" :tilt="0.8">messages stuck in the DLQ</StatCard>
  <StatCard value="37%" color="yellow" wobble="c" :tilt="-0.6">of broker spend is retries</StatCard>
  <StatCard value="9m" color="green" wobble="d" :tilt="1.2">median recovery, once paged</StatCard>
</div>

---
layout: section
part: part four
accent: blue
---

# The ask

Approve option B and we start the key migration on Monday.

---
layout: end
---

# Questions,<br />objections, doodles

<template #notes>
  <StickyNote color="blue" :tilt="-1.4">#rfc-0142</StickyNote>
  <StickyNote color="green" :tilt="1">comments open until Fri</StickyNote>
  <StickyNote color="yellow" :tilt="-0.6">a.okafor@</StickyNote>
</template>

<Scribble color="muted" :tilt="-2">thanks for sitting through the diagrams</Scribble>
