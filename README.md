# HL-FLOW-007A/B — Reproducible platform-owned test environments

This is a guarded backend update to FLOW-004 and FLOW-006.1. It does **not** change UI, schema, review decisions, approval gates, revision recovery, or original project contents.

## What changes

- `hermes_life/guest_env.py`: **one verbatim embedded implementation** of baseline-owned environment provisioning, Python resolution, and pytest execution, injected into both SSH guest scripts. A regression test checks that both code paths embed it.
- `hermes_life/implementation.py`: Initial baseline and candidate test operations, plus reevaluation, call `_evaluate_workspace(run_id, test_directory)`.
- `hermes_life/implementation_revision.py`: Revisions test their staging directory through exactly the same `_evaluate_workspace` routine. An agent-created `staging/.venv` or `candidate/.venv` **cannot override** it.
- `tests/test_flow007_guest_env.py`: Five focused stdlib regression tests.
- `scripts/install-flow007.py`: Checks the installed originals against the tested FLOW-004/FLOW-006.1 baseline SHA-256 before copying anything, preserving backups and refusing mismatched local code.

## Environment policy

The shared environment is `/home/hermes/experiments/env-<run-id>` in the **isolated VM**. The guest creates it on the first baseline/candidate/revision test or later reevaluation, using the VM's `python3 -m venv` and `pip`, **not** Hermes' private interpreter and not `.venv` from the agent's candidate/staging directory.

The environment is provisioned from the **baseline** snapshot:

- `pytest`, always.
- Direct index-package specifications from `requirements.txt`, `requirements-dev.txt`, `requirements-test.txt`.
- `[project].dependencies` and `[project.optional-dependencies]` groups `test`, `tests`, `testing`, `dev` in `pyproject.toml`.

Editable installs, nested `-r`, direct URLs, local files, and pip flags are not supported. Such directives produce `evaluation_error` with an explicit explanation. The evaluator does not run project build backends or install the project itself. Additions to candidate-authored dependency manifests do not change the test environment; those must be approved separately against the trusted baseline.

The environment stores `flow007.json` with dependency manifest fingerprints, resolved package versions (`pip freeze`), Python version/path, and the baseline dependency list. Test results include `env_source: platform-baseline`, the resolved dependency specifications, installed packages, `baseline_sha256`, exact interpreter and test command. If an existing run environment is corrupt or the baseline manifest changed, evaluation returns an environment error instead of silently falling back to an alternate interpreter.

Note: when a baseline has **no tests**, pytest reports no tests collected. This is correctly shown as `evaluation_error`, even if the candidate subsequently passes. The environment itself is no longer missing pytest.

## Install

Download the ZIP, place it in `~/Downloads`, then:

```bash
cd ~/Apps/hermes-life
unzip -o ~/Downloads/hermes-life-hl-flow007-environments.zip
.venv/bin/python scripts/install-flow007.py --check
.venv/bin/python scripts/install-flow007.py
.venv/bin/python -m pytest -q
```

Restart the running FastAPI service. This update makes **no frontend changes**. If the installer refuses a file because your working version differs, do not force it. Reconcile that file with the current host source first.

## Live verification

Use the existing reevaluation endpoint against a non-accepted test run, or a new approved-plan implementation run. Existing runs can provision the new environment from their retained baseline. A test will run first-time dependency installation in the VM, which requires the VM's package index access. Inspect `candidate_json`, `baseline_json` for `env_source`, `python`, `installed_packages`, and `baseline_sha256`.

This package does not delete experiments or environments; database-governed pruning is FLOW-007C/D.

## Validation in packaging environment

- Compiled all three backend Python modules and the installer.
- Compiled the *assembled* embedded guest scripts.
- Five focused unit tests passed.
- Guarded installer tested against the archived original SHA-256 files and confirmed idempotence.

**Not verified here:** Full test suite on your installed source, live SSH VM venv creation and dependency resolution, or real project integration. No claim is made that all Python packaging layouts are supported.
