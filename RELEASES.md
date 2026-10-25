# Bun release assets

Each tagged GitHub release contains standalone creator executables built and smoke-tested on the matching native runner. Select exactly one archive from this table; the operating-system and CPU architecture are explicit in every filename.

| Operating system | Architecture | Release asset |
|---|---|---|
| Linux | x86-64 / AMD64 | `agent-plugins-creators-linux-x64.tar.gz` |
| Linux | ARM64 / AArch64 | `agent-plugins-creators-linux-arm64.tar.gz` |
| macOS | Intel x86-64 | `agent-plugins-creators-darwin-x64.tar.gz` |
| macOS | Apple silicon ARM64 | `agent-plugins-creators-darwin-arm64.tar.gz` |
| Windows | x86-64 / AMD64 | `agent-plugins-creators-win32-x64.tar.gz` |

Each archive expands to a same-named directory containing four complete portable Skill trees under `skills/`. Release assembly uses the `native-bun` profile: it explicitly excludes the Git/source `scripts/<name>.mjs`, `runtime/`, and all `node_modules`, then injects exactly one Bun executable at `skills/<name>/scripts/<name>` (`.exe` on Windows). TypeScript application source remains under `apps/<creator>-cli/` and is not part of the Skill tree. Both `plugin.json` and `release-manifest.json` identify the archive as `native-bun`. Packaging rejects mixed Node/native trees. These executables are runtime-only; Node.js and installed package dependencies are not required.

## Verify before extracting

Download the selected archive and `SHA256SUMS` from the same GitHub release. On Linux:

```bash
sha256sum --ignore-missing -c SHA256SUMS
```

On macOS:

```bash
grep "  agent-plugins-creators-darwin-$(uname -m | sed 's/x86_64/x64/; s/arm64/arm64/').tar.gz$" SHA256SUMS | shasum -a 256 -c -
```

On Windows PowerShell, display the expected line and compare it with the computed hash (case-insensitive):

```powershell
Select-String 'agent-plugins-creators-win32-x64.tar.gz' SHA256SUMS
(Get-FileHash .\agent-plugins-creators-win32-x64.tar.gz -Algorithm SHA256).Hash
```

Do not use an archive when its hash differs. Extract a verified archive with `tar -xzf <asset-name>.tar.gz`; current Windows versions include `tar.exe`.

Release publication fans in only after every platform build and native smoke test succeeds. A rerun refuses to overwrite an existing GitHub release or its assets.

## Run the creators

Compatible hosts execute the injected file from each Skill's `scripts/` directory. For direct shell use, invoke that path or add the individual `scripts/` directories to PATH. The command names remain stable on every platform: **skill-creator**, **agent-creator**, **hook-creator**, and **plugin-creator**.

Linux and macOS (`RELEASE-DIR` is the extracted same-named directory):

~~~bash
./RELEASE-DIR/skills/skill-creator/scripts/skill-creator --help
./RELEASE-DIR/skills/agent-creator/scripts/agent-creator --help
./RELEASE-DIR/skills/hook-creator/scripts/hook-creator --help
./RELEASE-DIR/skills/plugin-creator/scripts/plugin-creator --help
# Optional PATH setup for one or more creators:
export PATH="$PWD/RELEASE-DIR/skills/skill-creator/scripts:$PATH"
skill-creator --help
~~~

Windows PowerShell:

~~~powershell
.\RELEASE-DIR\skills\skill-creator\scripts\skill-creator.exe --help
.\RELEASE-DIR\skills\agent-creator\scripts\agent-creator.exe --help
.\RELEASE-DIR\skills\hook-creator\scripts\hook-creator.exe --help
.\RELEASE-DIR\skills\plugin-creator\scripts\plugin-creator.exe --help
# Optional PATH setup for one or more creators:
$env:Path = "$PWD\RELEASE-DIR\skills\skill-creator\scripts;$env:Path"
skill-creator.exe --help
~~~

Do not combine files from different operating-system or architecture archives. Treat extracted and `release-staging/<target>/` trees as immutable products: rebuild or re-extract instead of editing them. If a shell still resolves an older installation, remove its legacy wrapper or internal-script directory from PATH, remove any shell alias that invokes Node or a dist file, then add only the new Skill's `scripts/` directory. Do not copy old dist, vendor, or node_modules trees beside these executables. Confirm the active binary with **command -v skill-creator** on Linux/macOS or **Get-Command skill-creator.exe** on Windows.
