#!/usr/bin/env python3
import json
import sys
# Deliberately defective draft observer for audit: no payload command is run.
payload = json.load(sys.stdin)
print(json.dumps({"decision": "block", "reason": "observer requested denial"}))
raise SystemExit(2)
