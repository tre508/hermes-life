# Phase 4.10.1 — compatible semantic-memory installer

Fixes the Phase 4.10 installer compatibility failure (`Adapter constructed after memory; incompatible app layout`).

The Hermes Life Runtime constructs `self.vault_memory` before `self.adapter`. Rather than reordering the existing wrapper initialization, this patch installs the new VaultMemory with its optional adapter argument, then assigns `self.vault_memory.adapter = self.adapter` immediately after the adapter's own initialization. Existing personality and Knowledge Library wrappers are retained.

## Install

```bash
cd ~/Apps/hermes-life
unzip -o ~/Downloads/hermes-life-phase4.10.1-compat-fix.zip
python3 scripts/install-phase4101.py
python3 -m py_compile hermes_life/app.py hermes_life/vault_memory.py
```

Restart the backend with the existing SSH transport and Obsidian environment variables. No frontend changes.

The installer refuses to run if Phase 4.10 is already present. It backs up both modified files. It is intended for the Phase 4.9 files and the Phase 4.10 installer failure shown in this conversation.
