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
  OPENCODE_OBSERVABILITY_AUTOSTART set 0 to disable local server autostart
  OPENCODE_OBSERVABILITY_AUTOSTART_TIMEOUT_MS
                                    max wait for autostart readiness
  OPENCODE_OBSERVABILITY_SERVER_CMD
                                    override server command (testing)
  OPENCODE_OBSERVABILITY_OPEN_CMD  override the browser opener command (testing)
"""

import json
import os
import shlex
import subprocess
import sys
import tempfile
import time
import urllib.parse
import urllib.request

SENTINEL = "OPENCODE_OBSERVABILITY_OPEN_MONITOR"
RAW_TRIGGERS = {"/monitor", "@monitor"}
DEFAULT_BASE_URL = "http://127.0.0.1:3737"
DEFAULT_SERVER_PACKAGE = "opencode-observability@latest"
AUTOSTART_POLL_INTERVAL_SECONDS = 0.25
HEALTHCHECK_TIMEOUT_SECONDS = 0.8


def env_value(name: str):
    value = os.environ.get(name)
    if value is None:
        return None
    value = value.strip()
    return value or None


def env_int_ms(name: str, default: int, minimum: int) -> int:
    value = env_value(name)
    if value is None:
        return default
    try:
        parsed = int(value)
    except ValueError:
        return default
    return max(minimum, parsed)


def base_url() -> str:
    return (env_value("OPENCODE_OBSERVABILITY_URL") or DEFAULT_BASE_URL).rstrip("/")


def parse_server_target(base: str):
    parsed = urllib.parse.urlparse(base)
    scheme = parsed.scheme.lower()
    if scheme not in {"http", "https"}:
        return None

    try:
        port = parsed.port or (443 if scheme == "https" else 80)
    except ValueError:
        return None

    host = parsed.hostname or ""
    if not host or port <= 0:
        return None

    normalized_host = host.lower()
    is_local = normalized_host in {"127.0.0.1", "localhost", "::1"}
    health_url = urllib.parse.urlunparse(
        (parsed.scheme, parsed.netloc, "/api/monitor/snapshot", "", "", "")
    )

    return {
        "health_url": health_url,
        "host": host,
        "port": port,
        "is_local": is_local,
    }


def is_server_healthy(target) -> bool:
    try:
        request = urllib.request.Request(
            target["health_url"], headers={"Accept": "application/json"}
        )
        with urllib.request.urlopen(request, timeout=HEALTHCHECK_TIMEOUT_SECONDS) as response:
            return 200 <= response.status < 300
    except Exception:
        return False


def wait_for_healthy(target, timeout_ms: int) -> bool:
    deadline = time.monotonic() + timeout_ms / 1000
    while time.monotonic() < deadline:
        if is_server_healthy(target):
            return True
        time.sleep(AUTOSTART_POLL_INTERVAL_SECONDS)
    return False


def startup_lock_path_for(port: int) -> str:
    return os.path.join(tempfile.gettempdir(), f"opencode-observability-{port}.lock")


def try_acquire_startup_lock(lock_path: str):
    try:
        lock_fd = os.open(lock_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        os.write(lock_fd, str(os.getpid()).encode("utf-8"))
        return lock_fd
    except FileExistsError:
        return None


def acquire_startup_lock(lock_path: str):
    lock_fd = try_acquire_startup_lock(lock_path)
    if lock_fd is not None:
        return lock_fd

    try:
        lock_stat = os.stat(lock_path)
        lock_stale_seconds = env_int_ms(
            "OPENCODE_OBSERVABILITY_LOCK_STALE_MS", 30000, 1000
        ) / 1000
        if time.time() - lock_stat.st_mtime > lock_stale_seconds:
            os.remove(lock_path)
            return try_acquire_startup_lock(lock_path)
    except FileNotFoundError:
        return try_acquire_startup_lock(lock_path)
    except OSError:
        return None

    return None


def release_startup_lock(lock_path: str, lock_fd) -> None:
    if lock_fd is None:
        return

    try:
        os.close(lock_fd)
    except OSError:
        pass

    try:
        os.remove(lock_path)
    except FileNotFoundError:
        pass
    except OSError:
        pass


def server_command():
    override = env_value("OPENCODE_OBSERVABILITY_SERVER_CMD")
    if override:
        try:
            return shlex.split(override)
        except ValueError:
            return []

    npx_command = env_value("OPENCODE_OBSERVABILITY_NPX_CMD")
    if not npx_command:
        npx_command = "npx.cmd" if os.name == "nt" else "npx"
    server_package = (
        env_value("OPENCODE_OBSERVABILITY_NPX_PACKAGE") or DEFAULT_SERVER_PACKAGE
    )
    return [npx_command, "--yes", server_package]


def spawn_server(target) -> bool:
    command = server_command()
    if not command:
        return False

    env = os.environ.copy()
    env["PORT"] = str(target["port"])
    env["HOST"] = target["host"]
    env["npm_config_yes"] = "true"

    try:
        if os.name == "nt":
            subprocess.Popen(
                command,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                env=env,
                creationflags=(
                    subprocess.DETACHED_PROCESS
                    | subprocess.CREATE_NEW_PROCESS_GROUP
                ),
            )
        else:
            subprocess.Popen(
                command,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                env=env,
                start_new_session=True,
            )
        return True
    except OSError:
        return False


def ensure_server_ready(base: str) -> bool:
    target = parse_server_target(base)
    if target is None:
        return False

    if is_server_healthy(target):
        return True

    if env_value("OPENCODE_OBSERVABILITY_AUTOSTART") == "0":
        return False

    if not target["is_local"]:
        return False

    timeout_ms = env_int_ms("OPENCODE_OBSERVABILITY_AUTOSTART_TIMEOUT_MS", 20000, 1000)
    lock_path = startup_lock_path_for(target["port"])
    lock_fd = acquire_startup_lock(lock_path)

    if lock_fd is not None:
        try:
            if is_server_healthy(target):
                return True
            if not spawn_server(target):
                return False
            return wait_for_healthy(target, timeout_ms)
        finally:
            release_startup_lock(lock_path, lock_fd)

    return wait_for_healthy(target, timeout_ms)


def open_in_browser(url: str) -> bool:
    override = env_value("OPENCODE_OBSERVABILITY_OPEN_CMD")
    if override:
        try:
            command = [*shlex.split(override), url]
        except ValueError:
            return False
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

    if not ensure_server_ready(base):
        block(
            "ビューアサーバーを自動起動できませんでした。"
            f"`npx --yes opencode-observability@latest` "
            f"で起動後に再実行してください。({url})"
        )
        return

    if open_in_browser(url):
        block(f"ビューアを開きました: {url}")
    else:
        block(f"ブラウザを自動で開けませんでした。手動で開いてください: {url}")


if __name__ == "__main__":
    main()
