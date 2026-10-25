# Concise developer facade; package.json scripts remain canonical.
MAKEFLAGS += --no-print-directory
.PHONY: help clean test bundle release install-plugin bundle-install-plugin
ifeq ($(VERBOSE),1)
OUTPUT_FLAGS := --format human --progress creators --verbose
else
OUTPUT_FLAGS := --format human --progress creators
endif
ifneq ($(strip $(LOG)),)
OUTPUT_FLAGS += --log-file "$(LOG)"
endif
help:
	@printf '%s\n' 'Agent Plugins developer commands (Bun package runner):' '  make clean                               Remove generated root outputs safely' '  make test                                Run the canonical test suite' '  make bundle [VERBOSE=1] [LOG=path]       Stage runtime plugin for this OS/architecture' '  make release [OUTPUT=path]               Validate/package every pinned target' '  make install-plugin [DEST=path]          Install full plugin staging -> .agents/plugins' '                      [SOURCE=path] [DRY_RUN=1] [FORCE=1] [VERBOSE=1] [LOG=path]' '  make bundle-install-plugin [DEST=path]   Bundle, then install full plugin staging -> .agents/plugins' '                            [DRY_RUN=1] [FORCE=1] [VERBOSE=1] [LOG=path]' '' 'Normal bundle/install output is concise. VERBOSE=1 streams diagnostics; LOG=path records details.' 'Standalone .skill artifacts belong under .agents/skills; this facade does not install them.'
clean:
	@bun run clean
test:
	@bun run test
bundle:
	@printf '[%s/%s] Bundle plugin\n' '$(or $(STEP),1)' '$(or $(STEPS),1)'
	@bun run --silent bundle -- $(OUTPUT_FLAGS)
release:
	@bun run release -- $(if $(OUTPUT),--output "$(OUTPUT)",)
install-plugin:
	@printf '[%s/%s] Install plugin\n' '$(or $(STEP),1)' '$(or $(STEPS),1)'
	@bun run --silent install:plugin -- $(OUTPUT_FLAGS) $(if $(SOURCE),--source "$(SOURCE)",) $(if $(DEST),--destination "$(DEST)",) $(if $(DRY_RUN),--dry-run,) $(if $(FORCE),--force,)
bundle-install-plugin:
	+@$(MAKE) bundle STEP=1 STEPS=2
	+@$(MAKE) install-plugin STEP=2 STEPS=2 SOURCE= $(if $(DEST),DEST="$(DEST)",) $(if $(DRY_RUN),DRY_RUN="$(DRY_RUN)",) $(if $(FORCE),FORCE="$(FORCE)",) $(if $(VERBOSE),VERBOSE="$(VERBOSE)",) $(if $(LOG),LOG="$(LOG)",)
