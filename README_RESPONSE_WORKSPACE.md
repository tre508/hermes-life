# Hermes Life 3.3.2 — Response workspace

Frontend-only incremental patch from v0.3.3.1. Does not modify backend, DB, SSH bridge or VM.

## Install

Stop the frontend, then from `~/Apps/hermes-life`:

```bash
cp -a frontend "frontend.backup-$(date +%Y%m%d-%H%M%S)"
unzip -o ~/Downloads/hermes-life-phase3.3.2-response-workspace.zip
./scripts/start-world.sh
```

Hard-refresh the browser. The response workspace appears below the world and side controls. Tabs switch between Answer, Tool activity, and History; Expand enlarges the workspace; Show raw text switches between structured and literal output.

## Notes

- No runtime markdown dependency. Output is displayed with DOM text nodes, never inserted as untrusted HTML. Supports headings, paragraphs, fenced code, simple lists, bold and inline code.
- The renderer does not reconstruct missing Markdown structure from a single unformatted wall of text. Real paragraph/list breaks from Hermes produce the best results.
- The described database corruption is separate from this frontend patch. Pause autonomy and stop the running server before executing the existing test suite until recovery behavior is repaired.
