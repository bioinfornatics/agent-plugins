# Minimal Node developer facade; package.json scripts remain canonical.
MAKEFLAGS += --no-print-directory
.PHONY: help clean test
help:
	@printf '%s\n' 'Agent Plugins developer commands (Node.js):' '  make clean    Remove generated root outputs safely' '  make test     Run the canonical test suite'
clean:
	@node scripts/clean.mjs
test:
	@node scripts/test.mjs
