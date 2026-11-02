# Hermes Life Phase 3.3 — Goal Formulation

Overlay onto Phase 3.2 in `~/Apps/hermes-life`. Back up first, stop both processes, unzip from the project root, then restart backend with `source config/hermes-life-ssh.env.example; ./start.sh` and frontend with `./scripts/start-world.sh`.

## Operation

1. Discover TODO/FIXME findings using existing scanner.
2. Click **Formulate goal** beside a discovery. This invokes Hermes inside the SSH VM to produce a structured planning proposal; it does not execute work on that discovery.
3. Review title, suggested action (research, experiment, coding), rationale, acceptance criteria and priority.
4. Approve, defer or dismiss. Approve creates only a **read-only investigation** in the existing goal scheduler, regardless of suggested action. Coding and experimentation are recommendations, NOT automatic permissions.
5. Enable the existing autonomous goal scheduler if you want approved investigations to run.

API: `GET /api/formulations`, `POST /api/formulations/from-discovery/{id}`, `POST /api/formulations/{id}/{approve|defer|dismiss}`.

Known limits: one formulation per discovery; generation is synchronous and may block the HTTP request until Hermes finishes; source findings are bounded by the Phase 3.1 read-only scanner; no self-generated open-ended projects yet. Use one backend worker process. Formulation consumes model tokens. Existing SSH bridge untouched.
