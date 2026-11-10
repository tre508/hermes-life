# Phase 6 — final acceptance checklist

Fill in results with actual observations and screenshot/test file links. Never mark unchecked items as completed just because the installer ran.

| Gate | Expected behavior | Evidence | Status |
|---|---|---|---|
| Identity | Exactly one **Hermesha Command Centre**; no ISONET or WeKeKe switcher | live screenshot | Pending |
| Physical plan | Eight bounded interconnected rooms at reference-relative positions | side-by-side capture | Pending |
| Visual fidelity | Central Control Room, distinct room dressing, cyan screens, warm doors, metallic surfaces | side-by-side capture | Pending |
| Seven roles | Hermes, Sage, Piper, Forge, Patch, Echo, Vale, accurate station/room placement | contract test + browser screenshot | Pending |
| Break Room | Present and selectable, no eighth backend agent | contract test + browser click | Pending |
| Dashboard | Left navigation, dominant world, activity/current-focus strip and right sidebar | screenshot + click | Pending |
| Actions | Resident, room, chat, tasks, results, goals and memory navigation works | browser test | Pending |
| Live events | Correct role/task labels, genuine tool args/results, no invented internal reasoning | controlled task + event log | Pending |
| Disconnect/reconnect | Stale state clearly indicated; no phantom active tasks after reconnect | backend restart test | Pending |
| Idle/working/waiting | Working pose only for backend `working`, no animation of historical completion | event sequence test | Pending |
| Bubbles | Positioned above resident head, bounded at viewport edges, no duplicate overlays | browser screenshot/motion | Pending |
| Static fallback | WebGL disabled still exposes seven roles and navigation | browser fallback test | Pending |
| Accessibility | Keyboard navigation, clear state labels, reduced motion, focus behavior | accessibility review | Pending |
| Performance | FPS on target client measured at operating viewport and multiple active tasks | performance trace | Pending |
| Teardown | No duplicate RAF, event streams, overlays or WebGL contexts after remount | browser/heap test | Pending |
| Build | `npm run build` passes | `phase6-report.md` | Pending |
| Regression | `npm test` and Phase 6 contract tests pass | `phase6-report.md` | Pending |

**Release decision:** NOT APPROVED until all relevant gates have completed evidence. Cosmetic screenshot changes must never alter backend truthfulness.
