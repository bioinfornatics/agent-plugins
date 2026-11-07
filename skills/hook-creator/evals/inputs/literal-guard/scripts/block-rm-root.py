#!/usr/bin/env python3
"""Literal-command fixture: payload strings are never executed.

Whitespace is significant: trimming would deny more than the exact policy.
Malformed inputs fail open, like ordinary hook failures on the recorded host.
"""
import json
import sys

try:
    payload = json.load(sys.stdin)
except (ValueError, TypeError):
    raise SystemExit(0)
if not isinstance(payload, dict):
    raise SystemExit(0)
tool_input = payload.get("tool_input")
if not isinstance(tool_input, dict):
    raise SystemExit(0)
if payload.get("tool_name") == "developer__shell" and tool_input.get("command") == "rm -rf /":
    print("Blocked exact root deletion; choose a non-root target", file=sys.stderr)
    raise SystemExit(2)
