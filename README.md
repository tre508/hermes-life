# Hermes Life — nameplate and departmental color pass

Apply to the same codebase that already received `hermes-life-character-refinement.zip`.

## Changed files
- `frontend/src/town-world/labels.ts` — resident names 1.78 units wide (previously 0.92), role-color bordered uppercase label.
- `frontend/src/town-renderer-3d.ts` — raised nameplate anchor above headwear; based on previous character refinement version so its animation changes remain intact.
- `frontend/src/town-world/palette.ts` — distinctive but coordinated department materials; removes muddy tan overlay from department floors.
- `frontend/src/town-world/workstations.ts` — visible differentiated floor inset and upper acoustic panel trim.
- `frontend/src/town-world/facility.ts` — cool slate wall wainscoting to break up the uniform beige walls.

No model, backend, or task-state changes.

## Install
From `~/Apps/hermes-life`:
```bash
unzip -o ~/Downloads/hermes-life-nameplates-color-pass.zip -d .
cd frontend && npm run build
```

## Validation
Edited source files passed TypeScript transpilation/syntax checking. A full `npm run build` and a browser visual pass were not possible here without the full frontend package/dependencies and runtime.
