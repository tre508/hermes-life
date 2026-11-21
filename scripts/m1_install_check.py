"""M1 dependency check: install fastembed, verify no torch in the resolved tree."""
import subprocess
import sys

subprocess.run(
    [sys.executable, "-m", "pip", "install", "-q", "-e", ".[test]", "fastembed"],
    check=True,
)

# Dry-run report of what got pulled (full tree is already installed; verify torch absent)
import importlib.util

for mod in ("torch", "fastembed", "numpy", "onnxruntime"):
    spec = importlib.util.find_spec(mod)
    print(f"{mod}: {'PRESENT' if spec else 'absent'}")

pkgs = subprocess.run(
    [sys.executable, "-m", "pip", "list"], capture_output=True, text=True, check=True
).stdout
torch_lines = [l for l in pkgs.splitlines() if "torch" in l.lower()]
print("torch in pip list:", torch_lines or "NONE")
