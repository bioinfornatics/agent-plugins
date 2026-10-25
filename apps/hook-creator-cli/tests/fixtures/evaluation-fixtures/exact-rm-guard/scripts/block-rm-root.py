#!/usr/bin/env python3
import json, sys
try: payload=json.load(sys.stdin)
except Exception: raise SystemExit(0)
command=payload.get("tool_input",{}).get("command","") if payload.get("tool_name")=="developer__shell" else ""
if command.strip()=="rm -rf /":
    print("Blocked exact root deletion",file=sys.stderr)
    raise SystemExit(2)
