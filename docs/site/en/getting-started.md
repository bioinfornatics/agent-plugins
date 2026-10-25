# Getting started

The goal is to make a creator discoverable and confirm it can help without changing files. Creating a Skill comes next.

## 1. Choose your installation mode

Use Goose for the integration recorded as verified by this repository (**1.47.0**). Other hosts require their own documented installation and compatibility checks.

| Mode | You need | You do not need |
|---|---|---|
| Git plugin installation | Host, Git installation capability, Node.js 22+ | Build, Bun, npm dependency installation |
| Whole standalone Skill directory | Host with standalone Skill discovery; Node.js 22+ for the Git payload | Root repository tooling |
| Tagged native archive | Matching OS/CPU archive and verified checksum | Node.js or npm dependencies |

Only install code and instructions you trust. Automatic updates trade manual control for convenience; choose deliberately.

## 2. Install the Git distribution

Check Node.js:

```bash
node --version
```

Then install:

```bash
goose plugin install https://github.com/servierhub/agent-plugins.git
```

This is the ServierHub distribution, not the personal upstream development checkout. Installed plugins live under `~/.agents/plugins/<name>/`; project-local plugins may live under `.agents/plugins/<name>/`.

## 3. Check discovery without writing files

Start a new Goose session and ask:

> Use `agent-plugins:skill-creator` to explain what information you need to create a Skill. Do not modify any files yet.

**Success check:** the creator resolves and asks about the intended outcome, activation conditions, workflow, constraints, and evaluation needs. Discovery alone does not prove that a generated Skill will behave correctly.

**Next:** work through the [first Skill tutorial](tutorials/first-skill.md) in a scratch project.

## 4. Understand updates and alternatives

To opt into automatic updates, use this installation command instead:

```bash
goose plugin install --auto-update https://github.com/servierhub/agent-plugins.git
```

To update a Git-backed plugin on demand:

```bash
goose plugin update agent-plugins
```

For a standalone Skill on Linux or macOS, copy the **whole directory**:

```bash
git clone https://github.com/servierhub/agent-plugins.git
cd agent-plugins
mkdir -p ~/.agents/skills
cp -R skills/skill-creator ~/.agents/skills/skill-creator
```

Use `skill-creator` rather than the plugin-qualified name for that standalone installation. Goose discovers project Skills in `.agents/skills/` and global Skills in `~/.agents/skills/`; check other hosts separately. The [installable Skill tree](https://github.com/servierhub/agent-plugins/blob/main/skills/skill-creator/SKILL.md) includes supporting files that must remain together.

Native archives are selected manually; Goose's Git installer does not select them automatically. Download the matching archive and `SHA256SUMS` from the same tagged release, verify **before extraction**, and never mix Node and native payloads. Follow the [release installation guide](https://github.com/bioinfornatics/agent-plugins/blob/develop/RELEASES.md); check which repository actually publishes the release you intend to use. Manually copied installations have separate updates.

## Troubleshooting

| Symptom | What to check |
|---|---|
| Creator not found | New session; qualified name for plugin, plain name for standalone |
| Git creator does not launch | Node.js 22+ and complete Skill directory including `runtime/` |
| Missing runtime dependencies | Reinstall the complete distribution; do not repair with `npm install` |
| Validation failure | Follow the named file or field diagnostic; do not bypass it |
| Evaluation blocked | Supply the missing execution, grading, test, or review evidence |
| Wrong native version | Check PATH, OS/architecture, and old wrappers |

Report reproducible defects to the [upstream issue tracker](https://github.com/bioinfornatics/agent-plugins/issues), not a separate ServierHub queue. Include installation mode, versions, command, diagnostic, and a minimal non-sensitive reproduction.

**Next:** [First Skill tutorial](tutorials/first-skill.md) or [creator selection](how-to/creators.md).
