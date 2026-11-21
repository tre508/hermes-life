import importlib.util
import os
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

spec = importlib.util.spec_from_file_location('chat_models', ROOT / 'patches' / 'chat_models.py')
models = importlib.util.module_from_spec(spec)
spec.loader.exec_module(models)

spec2 = importlib.util.spec_from_file_location('installer', ROOT / 'install.py')
installer = importlib.util.module_from_spec(spec2)
spec2.loader.exec_module(installer)

class Tests(unittest.TestCase):
    def test_invalid_models_do_not_leak(self):
        old = os.environ.get('HERMES_LIFE_CHAT_MODELS')
        try:
            os.environ['HERMES_LIFE_CHAT_MODELS'] = '[{"provider":"openrouter","model":"good/model","context_window":4096},{"provider":"evil;rm","model":"x"}]'
            self.assertEqual(models._configured(), [{'provider':'openrouter','model':'good/model','label':'good/model','context_window':4096}])
        finally:
            if old is None: os.environ.pop('HERMES_LIFE_CHAT_MODELS', None)
            else: os.environ['HERMES_LIFE_CHAT_MODELS'] = old

    def test_replace_once_rejects_conflicts(self):
        with self.assertRaises(RuntimeError):
            installer.replace_once('two two', 'two', 'x', 'demo')
        with self.assertRaises(RuntimeError):
            installer.replace_once('none', 'two', 'x', 'demo')
        self.assertEqual(installer.replace_once('one two','two','three','demo'),'one three')

if __name__ == '__main__': unittest.main()
