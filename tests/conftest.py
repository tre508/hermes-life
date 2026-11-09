import pytest

@pytest.fixture(autouse=True)
def isolate_default_database(monkeypatch, tmp_path):
    """A test that omits an explicit DB path cannot touch the user's database."""
    monkeypatch.setenv('HERMES_LIFE_DB', str(tmp_path / 'test-default.db'))
    # Same reason for the mirror: a test that forgets its own vault must not touch the real one.
    monkeypatch.setenv('HERMES_LIFE_OBSIDIAN_VAULT', str(tmp_path / 'test-default-vault'))
