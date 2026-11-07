# Dual-runtime architecture

## Contract boundaries

Agent Plugins describes the portable package surface. It does not standardize this distribution's executable runtime profile. Keep runtime selection in a versioned reverse-domain extension and document the host integration separately.

## Language-specific details

This reference defines shared boundaries only. Select one language reference directly from `SKILL.md`: TypeScript by default, Rust when Cargo/Rust is requested, or Python when Python packaging is requested. Do not assume that Node launchers, `node_modules`, or Bun compilation apply to every language.

## Recommended repository layout

~~~text
plugin.json
<application-source>/
  <language manifest and lockfile>
  <editable implementation>
  tests/
skills/<skill>/
  SKILL.md
  references/
  scripts/<language-specific entrypoint>
  runtime/
    runtime-manifest.json
    <language-specific runtime closure>
~~~

The application directory owns editable source, build configuration, tests, and dependency metadata. The Skill owns only instructions and generated runtime material needed after an isolated copy.

## Git/source projection

Use the selected language branch's launcher, interpreter artifact, or exact target selector. It resolves the Skill root from its own location, reads a closed versioned runtime manifest, rejects unsafe mappings and symlinks, invokes without shell interpolation, and forwards exit status or signal.

Generate `runtime/` atomically when the language profile requires it. Include only the built runtime artifact, required resources, exact locked production closure, and notices. Exclude editable source, tests, build-only dependencies, and ungoverned lifecycle/build scripts or native libraries. Installation must not contact the network.

## Native release projection

Build one executable per pinned OS/architecture target from the same source entrypoint. Stage into a clean temporary directory, copy only portable documentation/resources, create `scripts/<command>` (`.exe` on Windows), record mode/target/compiler and every file hash, validate, then atomically publish the stage.

A native profile excludes the source launcher, `runtime/`, `node_modules`, source applications, tests, and build manifests. Packaging must detect wrong-architecture binaries and mixed runtime material.

## Vendor extension examples

Source installation uses the exact language profile and entrypoint selected from `SKILL.md`:

~~~json
{"extensions":{"io.example.plugin.runtime":{"schemaVersion":1,"mode":"source-contained","language":"<selected-language>","entrypoint":"skills/<name>/<language-specific-path>","runtimeManifest":"skills/<name>/runtime/runtime-manifest.json"}}}
~~~

Native release records its build strategy and target-specific executable:

~~~json
{"extensions":{"io.example.plugin.runtime":{"schemaVersion":1,"mode":"native","language":"<selected-language>","target":"<os-architecture-or-target-triple>","executable":"skills/<name>/scripts/<command>[.exe]"}}}
~~~

Replace the example namespace with one controlled by the distributor. These are host/vendor contracts, not portable Agent Plugins fields.

## Related commands

Avoid PATH lookup and undeclared sibling-script spawning. In a source profile, generate a contained related-command map and package the exact runtime component needed by the caller. In a native profile, prefer in-process dispatch when the selected toolchain can link or embed the handler; otherwise package and address a target-specific sibling explicitly in the closed manifest.
