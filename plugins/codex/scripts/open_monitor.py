#!/usr/bin/env python3
"""UserPromptSubmit hook: open the session viewer for this session.

Reads the hook payload from stdin. When the submitted prompt is the /monitor
trigger (the expanded skill sentinel, or a raw "/monitor" / "@monitor"),
opens http://<viewer>/sessions/codex/<session_id> in the browser and blocks
the prompt so nothing reaches the model (zero tokens), mirroring the
OpenCode plugin's command.execute.before + cancel behaviour.

All other prompts pass through untouched (no output, exit 0).

Environment:
  OPENCODE_OBSERVABILITY_URL       viewer base URL (default http://127.0.0.1:3737)
  OPENCODE_OBSERVABILITY_OPEN_CMD  override the browser opener command (testing)
"""

import json
import os
import subprocess
import sys
import urllib.request

SENTINEL = "OPENCODE_OBSERVABILITY_OPEN_MONITOR"
RAW_TRIGGERS = {"/monitor", "@monitor"}
DEFAULT_BASE_URL = "http://127.0.0.1:3737"


def base_url() -> str:
    return (
        os.environ.get("OPENCODE_OBSERVABILITY_URL") or DEFAULT_BASE_URL
    ).rstrip("/")


def server_reachable(base: str) -> bool:
    try:
        with urllib.request.urlopen(f"{base}/", timeout=2):
            return True
    except Exception:
        return False


def open_in_browser(url: str) -> bool:
    override = os.environ.get("OPENCODE_OBSERVABILITY_OPEN_CMD")
    if override:
        command = [*override.split(), url]
    elif sys.platform == "darwin":
        command = ["open", url]
    elif os.name == "nt":
        try:
            os.startfile(url)  # type: ignore[attr-defined]
            return True
        except OSError:
            return False
    else:
        command = ["xdg-open", url]
    try:
        subprocess.Popen(
            command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
        )
        return True
    except OSError:
        return False


def block(reason: str) -> None:
    print(json.dumps({"decision": "block", "reason": reason}, ensure_ascii=False))


def is_monitor_trigger(prompt: str) -> bool:
    stripped = prompt.strip()
    return SENTINEL in stripped or stripped in RAW_TRIGGERS


def main() -> None:
    try:
        payload = json.load(sys.stdin)
    except json.JSONDecodeError:
        return

    if not is_monitor_trigger(str(payload.get("prompt", ""))):
        return

    session_id = str(payload.get("session_id", ""))
    if not session_id:
        block("セッションIDを取得できなかったため、ビューアを開けませんでした。")
        return

    base = base_url()
    url = f"{base}/sessions/codex/{session_id}"

    if not server_reachable(base):
        block(
            "ビューアサーバーが起動していません。"
            f"`npx opencode-observability` で起動後に再実行してください。({url})"
        )
        return

    if open_in_browser(url):
        block(f"ビューアを開きました: {url}")
    else:
        block(f"ブラウザを自動で開けませんでした。手動で開いてください: {url}")


if __name__ == "__main__":
    main()
