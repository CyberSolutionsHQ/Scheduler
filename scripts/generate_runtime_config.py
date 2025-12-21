#!/usr/bin/env python3
import json
from pathlib import Path

ENV_PATH = Path(".env")
OUT_PATH = Path("public/runtime-config.js")
REQUIRED_KEYS = ["SUPABASE_URL", "SUPABASE_ANON_KEY"]
OPTIONAL_KEYS = ["SUPABASE_PROJECT_REF"]


def parse_env(text):
    env = {}
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[len("export ") :].strip()
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in ('"', "'"):
            value = value[1:-1]
        env[key] = value
    return env


def main():
    if not ENV_PATH.exists():
        raise SystemExit("Missing .env. Create one with SUPABASE_URL and SUPABASE_ANON_KEY.")

    env = parse_env(ENV_PATH.read_text(encoding="utf-8"))
    missing = [key for key in REQUIRED_KEYS if not env.get(key)]
    if missing:
        raise SystemExit(
            "Missing required keys in .env: " + ", ".join(missing)
        )

    payload = {key: env[key] for key in REQUIRED_KEYS}
    for key in OPTIONAL_KEYS:
        if env.get(key):
            payload[key] = env[key]

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    content = "window.RUNTIME_CONFIG = " + json.dumps(payload, indent=2, sort_keys=True) + ";\n"
    OUT_PATH.write_text(content, encoding="utf-8")
    print(f"Wrote {OUT_PATH}.")


if __name__ == "__main__":
    main()
