---
name: fastppt-creative-animations
description: Retrieve and combine creative text, image, mask, path, elastic and multi-object motion for Slidev and editable Slidewave PPTX.
---

# Creative effects, object first

1. Define the creative job: reveal a product detail, lead the eye, stagger a
   title, emphasize a number, or choreograph a diagram. Keep the existing theme.
2. Use `search_animations` with the desired visual action and target type. Read
   2–3 results through `read_animation`; check scope and preview limitations.
3. The demo page is a neutral test stage, not a page layout to paste into a deck.
   Choose a single source object for an isolated effect, or map every distinct
   source target for multi-object choreography. Give destination text, picture
   or shape elements explicit `data-fastppt-group` anchors.
4. Deep-copy chosen effects, give them unique IDs, change their `target` and group
   IDs to actual anchors. Keep native XML, sourceDurationMs, behaviors and source
   order together. Use native text objects for letter/paragraph iteration.
5. Compose creatively: reuse one motion, combine different motions across objects,
   or invent new motion with the existing basic effects. Keep content legible and
   static brand/master structure intact. Avoid making every object animate.
6. Embed the AnimationDocumentV1 as HTML-escaped JSON in an inert
   `<template data-fastppt-motion="…"></template>` inside the slide, or save a
   per-slide override through the animations API. Slidev runtime reads the same
   metadata; Slidewave writes native timing and groups captured primitives.
7. Preview the whole timing sequence and scrub it. Check start, middle, end and
   interaction with surrounding objects. Native formulas are parsed as bounded
   arithmetic in the browser. Never insert executable JavaScript as a formula.
8. Report browser adaptations: whole-object preview of letter iteration, seeded
   random formulas, approximated reveal masks, and unsupported properties. Native
   PPTX preserves supported original timing trees with remapped object/time IDs;
   a static screenshot or video is not an editable-animation substitute.
9. Export QA must have valid target IDs and timing IDs. Multi-primitive objects
   must form a native group without crossing interleaved object paint order.
   Rebind or simplify an ambiguous target instead of silently dropping its motion.
10. Library loops that were infinite or longer than 16 cycles are adapted to two
    cycles for creative use. Preserve `rootTiming` and `sourceDurationMs` with the
    adapted XML; `nativeOriginalXml` is archival evidence, not the playback input.

## Native demo object slots

Read `resource.objects` before binding. Each object records its target, semantic
`role`, unique `slot`, replacement instructions, and source shape type, name,
text and bounds. Demo HTML exposes the same `data-animation-slot` and
`data-animation-role`; the original `data-fastppt-group="s…"` remains the motion
anchor. Replace contents or CSS while keeping that anchor. Use headline slots for
native text, product-image figures for native images, metrics for editable numbers,
and path nodes for a process. Dense sequences expose every source target as a
separate CSS particle so the complete choreography remains reusable. Metadata is
outside the AnimationDocumentV1 schema; it never changes native timing behavior.
