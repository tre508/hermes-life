# Hermesha Command Centre — Phase 6 Validation

Generated UTC: 2026-11-10T00:14:46.947264+00:00

## Automated source checks

| Check | Result | Evidence |
|---|---|---|
| `single_command_centre` | PASS | Brand appears and reference workspace names are not present in dashboard markup |
| `physical_rooms` | PASS | All eight physical room identities are defined |
| `seven_role_assignment` | PASS | Piper, Hermes, and unowned Break Room explicitly represented |
| `physical_room_pick` | PASS | Room hit targets exist with resident/station priority |
| `bubble_head_anchor` | PASS | Bubble anchor uses rendered resident head instead of a fixed screen offset |
| `authoritative_state` | PASS | Existing TownState adapter remains the sole role-state input; behavioral testing still required |
| `existing_work_and_chat` | PASS | Existing task/chat DOM contracts and deep-link event are retained |
| `eight_room_nav` | PASS | Eight navigation shortcuts and physical-room event listener exist |
| `phase_6_tests_installed` | PASS | Contract regression tests installed |
| `phase_3_art` | PASS | Visual art/architecture source is installed |
| `no_eighth_backend_agent` | PASS | No new backend presentation role introduced in town-model.ts |
| `no_duplicate_world_switcher` | PASS | No second command-centre selection widget in markup |
| `frontend_modules` | PASS | Frontend package exists |

## Reproducible commands

### build: PASS

`npm run build` (exit 0)

```text

> hermes-life-world@0.3.0 build
> tsc --noEmit && vite build

vite v6.4.5 building for production...
transforming...
✓ 46 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                  23.57 kB │ gzip:   5.66 kB
dist/assets/index-Ba30XW2Q.css   73.98 kB │ gzip:  15.89 kB
dist/assets/index-Bfl21iM0.js   758.67 kB │ gzip: 203.24 kB

(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rollupOptions.output.manualChunks to improve chunking: https://rollupjs.org/configuration-options/#output-manualchunks
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
✓ built in 1.39s

```

### existing_tests: PASS

`npm test` (exit 0)

```text

> hermes-life-world@0.3.0 test
> npm run test:town && npm run test:ui && npm run test:renderer && npm run test:lifecycle


> hermes-life-world@0.3.0 test:town
> node --import tsx --test tests/town-model.test.ts

TAP version 13
# Subtest: each role has exactly one resident and one distinct building
ok 1 - each role has exactly one resident and one distinct building
  ---
  duration_ms: 1.323295
  type: 'test'
  ...
# Subtest: a fresh town shows 7 idle residents and invents nothing
ok 2 - a fresh town shows 7 idle residents and invents nothing
  ---
  duration_ms: 1.252024
  type: 'test'
  ...
# Subtest: real event names map to the area that acts on them
ok 3 - real event names map to the area that acts on them
  ---
  duration_ms: 0.553375
  type: 'test'
  ...
# Subtest: an unmapped event is never guessed at
ok 4 - an unmapped event is never guessed at
  ---
  duration_ms: 1.034176
  type: 'test'
  ...
# Subtest: event suffixes decide the activity, and labels stay factual
ok 5 - event suffixes decide the activity, and labels stay factual
  ---
  duration_ms: 0.15142
  type: 'test'
  ...
# Subtest: completed history produces no motion
ok 6 - completed history produces no motion
  ---
  duration_ms: 0.504073
  type: 'test'
  ...
# Subtest: in-flight records drive their role, and human gates are visible as waiting
ok 7 - in-flight records drive their role, and human gates are visible as waiting
  ---
  duration_ms: 0.48177
  type: 'test'
  ...
# Subtest: an autonomous task belongs to the researcher, not the coordinator
ok 8 - an autonomous task belongs to the researcher, not the coordinator
  ---
  duration_ms: 0.202707
  type: 'test'
  ...
# Subtest: a candidate awaiting a decision is a review gate, and the tester is not still testing
ok 9 - a candidate awaiting a decision is a review gate, and the tester is not still testing
  ---
  duration_ms: 0.341343
  type: 'test'
  ...
# Subtest: the newest run is the one that counts
ok 10 - the newest run is the one that counts
  ---
  duration_ms: 5.600017
  type: 'test'
  ...
# Subtest: a running verification shows in the lab
ok 11 - a running verification shows in the lab
  ---
  duration_ms: 0.17216
  type: 'test'
  ...
# Subtest: a live event overlays its role and the baseline comes back after the flash
ok 12 - a live event overlays its role and the baseline comes back after the flash
  ---
  duration_ms: 0.57049
  type: 'test'
  ...
# Subtest: a working claim survives while newer authoritative events keep arriving
ok 13 - a working claim survives while newer authoritative events keep arriving
  ---
  duration_ms: 0.362572
  type: 'test'
  ...
# Subtest: duplicate and out-of-order events change nothing
ok 14 - duplicate and out-of-order events change nothing
  ---
  duration_ms: 0.1646
  type: 'test'
  ...
# Subtest: a running tool decides which building the coordinator is working in
ok 15 - a running tool decides which building the coordinator is working in
  ---
  duration_ms: 0.885001
  type: 'test'
  ...
# Subtest: a snapshot refresh keeps live tool detail while a task is running
ok 16 - a snapshot refresh keeps live tool detail while a task is running
  ---
  duration_ms: 0.286362
  type: 'test'
  ...
# Subtest: tool activity only animates the coordinator while a task is really running
ok 17 - tool activity only animates the coordinator while a task is really running
  ---
  duration_ms: 0.365644
  type: 'test'
  ...
# Subtest: an autonomous investigation task belongs to the researcher, not the coordinator
ok 18 - an autonomous investigation task belongs to the researcher, not the coordinator
  ---
  duration_ms: 0.116877
  type: 'test'
  ...
# Subtest: a reconnect replay never animates historical events
ok 19 - a reconnect replay never animates historical events
  ---
  duration_ms: 0.149555
  type: 'test'
  ...
# Subtest: agent runtime stream events belong to no area and are not "unmapped"
ok 20 - agent runtime stream events belong to no area and are not "unmapped"
  ---
  duration_ms: 0.171738
  type: 'test'
  ...
# Subtest: terminal events are acknowledged, then the record baseline returns
ok 21 - terminal events are acknowledged, then the record baseline returns
  ---
  duration_ms: 0.215768
  type: 'test'
  ...
# Subtest: counts only ever reflect roles that are actually busy or waiting
ok 22 - counts only ever reflect roles that are actually busy or waiting
  ---
  duration_ms: 0.858875
  type: 'test'
  ...
# Subtest: the summary names who is busy and what waits on a human
ok 23 - the summary names who is busy and what waits on a human
  ---
  duration_ms: 0.32491
  type: 'test'
  ...
# Subtest: activity words never dress an idle role up as work
ok 24 - activity words never dress an idle role up as work
  ---
  duration_ms: 0.092926
  type: 'test'
  ...
1..24
# tests 24
# suites 0
# pass 24
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 271.866976

> hermes-life-world@0.3.0 test:ui
> node --import tsx --test tests/control-wiring.test.ts

TAP version 13
# Subtest: every interactive control is wired or deliberately hidden
ok 1 - every interactive control is wired or deliberately hidden
  ---
  duration_ms: 3.75344
  type: 'test'
  ...
# Subtest: the goal and scheduler controls are wired by a live module
ok 2 - the goal and scheduler controls are wired by a live module
  ---
  duration_ms: 0.412444
  type: 'test'
  ...
# Subtest: the goal form submits through the goals API, not into the void
ok 3 - the goal form submits through the goals API, not into the void
  ---
  duration_ms: 0.243473
  type: 'test'
  ...
# Subtest: the learned profile can be inspected, corrected and reviewed from the UI
ok 4 - the learned profile can be inspected, corrected and reviewed from the UI
  ---
  duration_ms: 0.302313
  type: 'test'
  ...
# Subtest: no placeholder claims work that is not happening
ok 5 - no placeholder claims work that is not happening
  ---
  duration_ms: 0.142334
  type: 'test'
  ...
1..5
# tests 5
# suites 0
# pass 5
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 250.974778

> hermes-life-world@0.3.0 test:renderer
> node --import tsx --test tests/town-renderer.test.ts

TAP version 13
# Subtest: the static fallback lists every role, in ROLES order
ok 1 - the static fallback lists every role, in ROLES order
  ---
  duration_ms: 2.455361
  type: 'test'
  ...
# Subtest: the fallback shows the model’s names, titles, stations and state words verbatim
ok 2 - the fallback shows the model’s names, titles, stations and state words verbatim
  ---
  duration_ms: 0.368407
  type: 'test'
  ...
# Subtest: an unknown state reads as unknown, never as an invented action
ok 3 - an unknown state reads as unknown, never as an invented action
  ---
  duration_ms: 0.174415
  type: 'test'
  ...
# Subtest: a finished role is a word, not an animation replay
ok 4 - a finished role is a word, not an animation replay
  ---
  duration_ms: 0.225421
  type: 'test'
  ...
# Subtest: the WebGL probe and the motion preference degrade safely with no DOM
ok 5 - the WebGL probe and the motion preference degrade safely with no DOM
  ---
  duration_ms: 0.16416
  type: 'test'
  ...
# Subtest: the design space the renderers frame is the panel ratio
ok 6 - the design space the renderers frame is the panel ratio
  ---
  duration_ms: 0.098138
  type: 'test'
  ...
# Subtest: the floor plan gives one station per role, in ROLES order, covering every location
ok 7 - the floor plan gives one station per role, in ROLES order, covering every location
  ---
  duration_ms: 0.398385
  type: 'test'
  ...
# Subtest: signage and destinations come from the model, worded for the facility
ok 8 - signage and destinations come from the model, worded for the facility
  ---
  duration_ms: 0.22872
  type: 'test'
  ...
# Subtest: every location has one presentation label, purpose and no leftovers from the town metaphor
ok 9 - every location has one presentation label, purpose and no leftovers from the town metaphor
  ---
  duration_ms: 0.513669
  type: 'test'
  ...
# Subtest: the coordinator holds the centre and no station overlaps or leaves the room
ok 10 - the coordinator holds the centre and no station overlaps or leaves the room
  ---
  duration_ms: 0.51613
  type: 'test'
  ...
# Subtest: every working station turns to face the command dais
ok 11 - every working station turns to face the command dais
  ---
  duration_ms: 0.219601
  type: 'test'
  ...
# Subtest: the plan is deterministic: the same town gives the same coordinates
ok 12 - the plan is deterministic: the same town gives the same coordinates
  ---
  duration_ms: 0.197022
  type: 'test'
  ...
# Subtest: the activity table covers every state the model can produce
ok 13 - the activity table covers every state the model can produce
  ---
  duration_ms: 0.185288
  type: 'test'
  ...
# Subtest: only `working` is allowed to look like work
ok 14 - only `working` is allowed to look like work
  ---
  duration_ms: 0.119308
  type: 'test'
  ...
# Subtest: waiting and queued are visibly not working: a badge and a still figure
ok 15 - waiting and queued are visibly not working: a badge and a still figure
  ---
  duration_ms: 0.111031
  type: 'test'
  ...
# Subtest: a failed or blocked operation is a stationary alert, never motion
ok 16 - a failed or blocked operation is a stationary alert, never motion
  ---
  duration_ms: 0.127645
  type: 'test'
  ...
# Subtest: completion is a one-shot acknowledgement, and only completion is
ok 17 - completion is a one-shot acknowledgement, and only completion is
  ---
  duration_ms: 0.095124
  type: 'test'
  ...
# Subtest: an unknown state is marked unknown, with nothing invented
ok 18 - an unknown state is marked unknown, with nothing invented
  ---
  duration_ms: 0.076778
  type: 'test'
  ...
# Subtest: a resident stands at its own desk, and a visitor stands beside it
ok 19 - a resident stands at its own desk, and a visitor stands beside it
  ---
  duration_ms: 0.340676
  type: 'test'
  ...
# Subtest: a destination is only ever a real building, and never invented
ok 20 - a destination is only ever a real building, and never invented
  ---
  duration_ms: 0.597816
  type: 'test'
  ...
# Subtest: the walk eases: it starts at the origin, ends at the target, and never goes backwards
ok 21 - the walk eases: it starts at the origin, ends at the target, and never goes backwards
  ---
  duration_ms: 0.151215
  type: 'test'
  ...
# Subtest: the state word is the model’s own, and unknown is never dressed up as an action
ok 22 - the state word is the model’s own, and unknown is never dressed up as an action
  ---
  duration_ms: 0.173854
  type: 'test'
  ...
# Subtest: the 3D tooltip and the static fallback cannot disagree about a state word
ok 23 - the 3D tooltip and the static fallback cannot disagree about a state word
  ---
  duration_ms: 0.236334
  type: 'test'
  ...
1..23
# tests 23
# suites 0
# pass 23
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 333.690701

> hermes-life-world@0.3.0 test:lifecycle
> node --import tsx --test tests/task-lifecycle.test.ts

TAP version 13
# Subtest: deriveLifecycle — manual tasks (no workflow chain)
    # Subtest: queued task: investigating is current, nothing else started
    ok 1 - queued task: investigating is current, nothing else started
      ---
      duration_ms: 1.84722
      type: 'test'
      ...
    # Subtest: running task: investigation done, work is current
    ok 2 - running task: investigation done, work is current
      ---
      duration_ms: 0.125736
      type: 'test'
      ...
    # Subtest: completed task with a result: all three reach complete
    ok 3 - completed task with a result: all three reach complete
      ---
      duration_ms: 0.138885
      type: 'test'
      ...
    # Subtest: failed task: respond is failed with the error surfaced
    ok 4 - failed task: respond is failed with the error surfaced
      ---
      duration_ms: 0.306841
      type: 'test'
      ...
    # Subtest: a plain task is never forced through coding stages
    ok 5 - a plain task is never forced through coding stages
      ---
      duration_ms: 0.15669
      type: 'test'
      ...
    1..5
ok 1 - deriveLifecycle — manual tasks (no workflow chain)
  ---
  duration_ms: 3.55166
  type: 'suite'
  ...
# Subtest: deriveLifecycle — workflow-chained task
    # Subtest: investigation produced a plan: investigate complete, plan current
    ok 1 - investigation produced a plan: investigate complete, plan current
      ---
      duration_ms: 0.383942
      type: 'test'
      ...
    # Subtest: a candidate run is awaiting review: build+test complete, review current
    ok 2 - a candidate run is awaiting review: build+test complete, review current
      ---
      duration_ms: 0.209181
      type: 'test'
      ...
    # Subtest: review accepted and task completed with a result: everything complete
    ok 3 - review accepted and task completed with a result: everything complete
      ---
      duration_ms: 0.282204
      type: 'test'
      ...
    # Subtest: an interrupted investigation with no plan is blocked at investigate
    ok 4 - an interrupted investigation with no plan is blocked at investigate
      ---
      duration_ms: 0.179771
      type: 'test'
      ...
    # Subtest: investigation task completed but the chain is still drafting its plan: Complete stays pending
    ok 5 - investigation task completed but the chain is still drafting its plan: Complete stays pending
      ---
      duration_ms: 0.239926
      type: 'test'
      ...
    # Subtest: verification disposition is surfaced on the test stage
    ok 6 - verification disposition is surfaced on the test stage
      ---
      duration_ms: 0.146132
      type: 'test'
      ...
    1..6
ok 2 - deriveLifecycle — workflow-chained task
  ---
  duration_ms: 1.768532
  type: 'suite'
  ...
1..2
# tests 11
# suites 2
# pass 11
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 250.177147

```

### hermesha_contract_tests: PASS

`node --import tsx --test tests/hermesha-phase6.test.ts` (exit 0)

```text
TAP version 13
# Subtest: exactly eight unique physical rooms (one Command Centre)
ok 1 - exactly eight unique physical rooms (one Command Centre)
  ---
  duration_ms: 2.133944
  type: 'test'
  ...
# Subtest: seven existing backend roles; Break Room has no owner
ok 2 - seven existing backend roles; Break Room has no owner
  ---
  duration_ms: 0.236801
  type: 'test'
  ...
# Subtest: facility plan preserves established backend LocationIds
ok 3 - facility plan preserves established backend LocationIds
  ---
  duration_ms: 0.685474
  type: 'test'
  ...
# Subtest: room graph has the screenshot-based spatial relationships
ok 4 - room graph has the screenshot-based spatial relationships
  ---
  duration_ms: 0.151602
  type: 'test'
  ...
1..4
# tests 4
# suites 0
# pass 4
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 313.997434

```

## Not certified by this package

- Pixel/layout similarity to the user reference: capture the running browser and inspect the comparison.
- Real task lifecycle/WebSocket reconnect: requires a running backend and controlled test task.
- Actual framerate, GPU memory, and browser teardown: requires measurements in a real browser.
- Accessibility interactions: require a keyboard/screen-reader browser review.

A build/test pass does **not** imply visual or end-to-end acceptance.
