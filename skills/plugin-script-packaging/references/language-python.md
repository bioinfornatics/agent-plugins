# Python external packaging

Use only for Python. 

Keep pyproject.toml, editable sources/tests and fully resolved lock in the build workspace. For uv, commit uv.lock and pin uv/Python implementation/version; derive closure through locked resolution/export in authorized build/CI. Review environment markers, namespace packages, package data, entrypoints, licenses and native extensions. Installation uses neither uv nor pip nor an index.

For pure Python, a deterministic contained interpreter artifact (for example a zipapp) can include application code, exact locked packages and resources. Declare interpreter constraints explicitly. Invocation must disable user-site, project and PYTHONPATH fallback; an archive alone does not enforce isolation. Confirm that the entrypoint/import/resource strategy actually works with that interpreter.

Compiled wheels/shared libraries are not arbitrarily zip-importable or cross-platform. Select explicit OS/CPU/Python ABI artifacts or mark generic Git mode unsupported. Never silently resolve missing imports from system packages or install online. Node is not the Python runtime.

For requested frozen/native output, independently establish a pinned freezer/compiler such as PyInstaller/Nuitka and its target/licensing behavior. Stage only the profile's declared executable/resources, not an editable project or incidental environment. Reject source/native ambiguity against the supplied contract.

Proof: lock check and locked closure; two-build inventories/hashes; isolated interpreter execution with user/project packages unavailable; package-data/Unicode/entrypoint coverage; unsupported interpreter/native-extension failures; matching-target frozen execution without Python/uv/pip. Source zipapp success is not native proof.
