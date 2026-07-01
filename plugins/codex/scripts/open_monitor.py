#!/usr/bin/env python3
"""UserPromptSubmit hook: delegate /monitor handling to the latest npm CLI.

The hook stays intentionally small so behavior can ship through
`opencode-observability@latest` without requiring a plugin reinstall for every
future monitor implementation change. Non-monitor prompts pass through without
running npx.

Environment:
  OPENCODE_OBSERVABILITY_HOOK_CMD  override hook command before harness arg
                                   (testing/development)
  OPENCODE_OBSERVABILITY_NPX_CMD   override npx executable
  OPENCODE_OBSERVABILITY_NPX_PACKAGE
                                   override npm package
"""

import json
import os
import shlex
import subprocess
import sys

SENTINEL = "OPENCODE_OBSERVABILITY_OPEN_MONITOR"
RAW_TRIGGERS = {"/monitor", "@monitor"}
DEFAULT_PACKAGE = "opencode-observability@latest"


def env_value(name: str):
    value = os.environ.get(name)
    if value is None:
        return None
    value = value.strip()
    return value or None


def block(reason: str) -> None:
    print(json.dumps({"decision": "block", "reason": reason}, ensure_ascii=False))


def is_monitor_trigger(payload) -> bool:
    prompt = str(payload.get("prompt", "")).strip()
    return SENTINEL in prompt or prompt in RAW_TRIGGERS


def hook_command():
    override = env_value("OPENCODE_OBSERVABILITY_HOOK_CMD")
    if override:
        try:
            return [*shlex.split(override), "codex"]
        except ValueError:
            return []

    npx = env_value("OPENCODE_OBSERVABILITY_NPX_CMD")
    if not npx:
        npx = "npx.cmd" if os.name == "nt" else "npx"
    package = env_value("OPENCODE_OBSERVABILITY_NPX_PACKAGE") or DEFAULT_PACKAGE
    return [npx, "--yes", package, "hook", "codex"]


def main() -> None:
    raw_payload = sys.stdin.read()
    try:
        payload = json.loads(raw_payload)
    except json.JSONDecodeError:
        return

    if not is_monitor_trigger(payload):
        return

    command = hook_command()
    if not command:
        block("ビューア処理を起動できませんでした。hook command の設定を確認してください。")
        return

    env = os.environ.copy()
    env["npm_config_yes"] = "true"

    try:
        result = subprocess.run(
            command,
            input=raw_payload,
            capture_output=True,
            text=True,
            env=env,
            check=False,
        )
    except OSError:
        block(
            "ビューア処理を起動できませんでした。"
            "`npx --yes opencode-observability@latest hook codex` "
            "を実行できるか確認してください。"
        )
        return

    if result.stdout:
        print(result.stdout, end="")
    if result.returncode != 0 and not result.stdout:
        block(
            "ビューア処理が失敗しました。"
            "`npx --yes opencode-observability@latest hook codex` "
            "を実行できるか確認してください。"
        )


if __name__ == "__main__":
    main()
