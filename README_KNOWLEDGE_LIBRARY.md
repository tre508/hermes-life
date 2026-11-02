# Hermes Life — Knowledge Library foundation

This patch adds a **host-owned reference library** separate from verified technical lessons. It does not download PDFs or extract their text; that is the next VM-side ingestion task. Existing schema version 11, memory and execution bridge stay unchanged.

## Install
Stop the **backend**. Back up the SQLite file and `hermes_life/app.py` first, then unzip into the project root, restart as usual with the SSH config.

```bash
cd ~/Apps/hermes-life
cp -a ~/.local/share/hermes-life/life.db ~/.local/share/hermes-life/life.db.before-knowledge-library
cp hermes_life/app.py hermes_life/app.py.before-knowledge-library
unzip -o ~/Downloads/hermes-life-knowledge-library-foundation.zip
source config/hermes-life-ssh.env.example
./start.sh
```

## Endpoints
- `POST /api/library/sources` — JSON: `{"title":"Python Handbook","url":"https://example.org/handbook.pdf","kind":"pdf","revision":"...","sha256":"..."}`
- `POST /api/library/sources/{source_id}/pages` — JSON `{"pages":[{"page":1,"text":"..."}]}`; maximum 100 pages per batch, 30,000 characters per page; repeated page numbers replace indexed content for that page.
- `GET /api/library/sources` — registered sources and count of indexed pages/chunks.
- `GET /api/library/search?q=integer+validation` — excerpt hits with URL and page references.

The task adapter retrieves up to four relevant excerpts, up to ~4500 characters, for each future task. Excerpts are explicitly treated as untrusted reference material, not as commands. **Ingestion requires submitting extracted pages through the API**; the VM's local PDF directory is not visible to the host and is not mounted. Promote genuinely verified technical findings using the existing tool-backed learning pipeline, not by marking PDF text as verified.

## Notes
- Simple lexical retrieval is intentionally used instead of embeddings; works without external model or service, but cannot yet retrieve all semantic paraphrases.
- No UI tab in this foundation patch. Existing Pixel World remains unchanged.
- The patch updates `hermes_life/app.py` from the supplied Phase 3.9.4 base. If locally modified, merge the new import, initialization, lifespan call, and four library routes instead of replacing the file blindly.
- No schema version bump: library tables are additive and created in FastAPI lifespan using `CREATE TABLE IF NOT EXISTS`.
