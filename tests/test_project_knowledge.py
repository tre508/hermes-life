import importlib.util
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

MODULE = Path(__file__).resolve().parents[1] / 'hermes_life/project_knowledge.py'
spec = importlib.util.spec_from_file_location('project_knowledge', MODULE)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class KnowledgeTests(unittest.TestCase):
    def test_section_selection(self):
        body = '# Intro\n' + 'a'*1500 + '\n## Other\n' + 'b'*1000 + '\n## Discovery\nDeduplicate TODOs on separate lines.\n'
        out=module.select_sections(body,'discovery duplicate TODOs',1900)
        self.assertIn('Deduplicate TODOs',out)
        self.assertIn('# Intro',out)

    def test_authoritative_spec_and_vault_are_read_only(self):
        with tempfile.TemporaryDirectory() as tmp:
            home=Path(tmp); repo=home/'repo'; repo.mkdir()
            (repo/'HERMES_LIFE_DEV_SPEC.md').write_text('# Source of truth\nUse test-driven validation')
            vault=home/'vault'; issues=vault/'Hermes-Life/Projects/Hermes-Life/CURRENT_ISSUES_01.md'
            issues.parent.mkdir(parents=True); issues.write_text('# Current issues\nDuplicate discoveries')
            proj={'name':'hermes-life','host_path':str(repo),'spec_path':'HERMES_LIFE_DEV_SPEC.md','vm_path':'/home/hermes/workspaces/hermes-life/commit'}
            wm=SimpleNamespace(_read=lambda name:proj)
            memory=SimpleNamespace(retrieve_notes=lambda query,limit:'[Curated memory]')
            manager=module.ProjectKnowledge(SimpleNamespace(project_workspaces=wm,vault_memory=memory))
            manager.vault=vault
            manifest=manager.manifest('hermes-life')
            self.assertEqual([True,True],[x['available'] for x in manifest['documents']])
            text=manager.context('hermes-life','duplicate discoveries')
            self.assertIn('Use test-driven validation',text)
            self.assertIn('Duplicate discoveries',text)
            self.assertIn('[Curated memory]',text)
            self.assertEqual((repo/'HERMES_LIFE_DEV_SPEC.md').read_text(),'# Source of truth\nUse test-driven validation')

if __name__ == '__main__':unittest.main()
