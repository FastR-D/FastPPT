"""FastPPT local runtime management command."""

from __future__ import annotations

import argparse
import json
import os
import signal
import shutil
import subprocess
import sys
from pathlib import Path
from urllib.error import URLError
from urllib.request import urlopen

from fastppt_core.version import VERSION
from fastppt_ppt_master import PptMasterAdapter

from .config import RuntimeSettings


def _pid_file(settings: RuntimeSettings, service: str = "api") -> Path:
    suffix = "" if service == "api" else f"-{service}"
    return settings.data_dir / f"fastppt{suffix}.pid"


def _read_pid(settings: RuntimeSettings, service: str = "api") -> int | None:
    try:
        value = int(_pid_file(settings, service).read_text(encoding="ascii").strip())
        return value if value > 0 else None
    except (OSError, ValueError):
        return None


def _pid_is_alive(pid: int) -> bool:
    """Check a managed process without relying on Windows signal 0 semantics."""
    if pid <= 0:
        return False
    if os.name == "nt":
        import ctypes

        process_query_limited_information = 0x1000
        handle = ctypes.windll.kernel32.OpenProcess(process_query_limited_information, False, pid)
        if not handle:
            return False
        ctypes.windll.kernel32.CloseHandle(handle)
        return True
    try:
        os.kill(pid, 0)
    except (ProcessLookupError, PermissionError, OSError):
        return False
    return True


def _health(settings: RuntimeSettings) -> dict[str, object]:
    try:
        with urlopen(f"http://{settings.host}:{settings.port}/api/v1/health", timeout=2) as response:
            return json.loads(response.read())
    except (URLError, TimeoutError, json.JSONDecodeError):
        return {"api": {"status": "stopped"}}


def _spawn(settings: RuntimeSettings, service: str, module: str, log_name: str) -> int:
    current = _read_pid(settings, service)
    if current and _pid_is_alive(current):
        return current
    if current:
        _pid_file(settings, service).unlink(missing_ok=True)
    log_handle = (settings.data_dir / log_name).open("ab", buffering=0)
    kwargs: dict[str, object] = {"cwd": settings.repository_root, "stdout": log_handle, "stderr": log_handle, "stdin": subprocess.DEVNULL, "close_fds": True}
    if os.name == "nt":
        kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.DETACHED_PROCESS
    else:
        kwargs["start_new_session"] = True
    process = subprocess.Popen([sys.executable, "-m", module], **kwargs)
    log_handle.close()
    _pid_file(settings, service).write_text(str(process.pid), encoding="ascii")
    return process.pid


def start(settings: RuntimeSettings, *, foreground: bool) -> int:
    settings.prepare_directories()
    if foreground:
        from fastppt_api.server import serve

        serve()
        return 0
    already_running = _health(settings).get("api", {}).get("status") == "ready"
    api_pid = _read_pid(settings) if already_running else _spawn(settings, "api", "fastppt_api.server", "runtime.log")
    worker_pid = _spawn(settings, "worker", "fastppt_worker.cli", "worker.log")
    render_pid = None
    if settings.render_backend == "powerpoint":
        render_pid = _spawn(settings, "render", "fastppt_render.cli", "render-worker.log")
    print(json.dumps({"status": "already_running" if already_running else "started", "pid": api_pid, "worker_pid": worker_pid, "render_pid": render_pid, "url": f"http://{settings.host}:{settings.port}"}))
    return 0


def stop(settings: RuntimeSettings) -> int:
    stopped: dict[str, int] = {}
    failed = False
    for service in ("render", "worker", "api"):
        pid = _read_pid(settings, service)
        if not pid:
            continue
        try:
            os.kill(pid, signal.SIGTERM)
            stopped[service] = pid
        except ProcessLookupError:
            pass
        except PermissionError:
            failed = True
        _pid_file(settings, service).unlink(missing_ok=True)
    if failed:
        print(json.dumps({"status": "failed", "reason": "permission_denied", "stopped": stopped}))
        return 1
    if not stopped:
        print(json.dumps({"status": "not_running"}))
        return 0
    print(json.dumps({"status": "stopped", "services": stopped}))
    return 0


def doctor(settings: RuntimeSettings) -> int:
    result = {
        "product": "FastPPT",
        "version": VERSION,
        "configuration": settings.public_summary(),
        "kernel": PptMasterAdapter(settings.repository_root).probe(),
        "python": {"status": "ready", "version": sys.version.split()[0]},
        "node": {"status": "ready" if shutil.which("node") else "unavailable"},
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["kernel"]["status"] == "ready" else 1


def _local_runtime(settings: RuntimeSettings):
    from .bootstrap import build_runtime

    runtime = build_runtime(settings)
    if not runtime.local_user:
        raise RuntimeError("Context inspection and replay CLI commands require local_trusted mode; use the authenticated API in server mode")
    return runtime


def inspect_context(settings: RuntimeSettings, agent_run_id: str, project_id: str | None) -> int:
    runtime = _local_runtime(settings)
    run = runtime.store.get_agent_run(project_id, agent_run_id) if project_id else runtime.store.find_agent_run(agent_run_id)
    if not run:
        print(json.dumps({"status": "not_found", "agent_run_id": agent_run_id}))
        return 1
    result = runtime.service.inspect_agent_run(str(runtime.local_user["user_id"]), run["project_id"], agent_run_id)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["status"] == "available" else 1


def replay_prompt(settings: RuntimeSettings, agent_run_id: str, project_id: str | None, execute: bool) -> int:
    runtime = _local_runtime(settings)
    run = runtime.store.get_agent_run(project_id, agent_run_id) if project_id else runtime.store.find_agent_run(agent_run_id)
    if not run:
        print(json.dumps({"status": "not_found", "agent_run_id": agent_run_id}))
        return 1
    result = runtime.service.replay_agent_run(str(runtime.local_user["user_id"]), run["project_id"], agent_run_id, execute=execute)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["status"] in {"ready", "completed"} else 1


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--version", action="version", version=VERSION)
    commands = parser.add_subparsers(dest="command", required=True)
    start_parser = commands.add_parser("start", help="start the local runtime")
    start_parser.add_argument("--foreground", action="store_true")
    commands.add_parser("stop", help="stop a background local runtime")
    commands.add_parser("status", help="read runtime health")
    commands.add_parser("doctor", help="validate local configuration and kernel capability")
    context_parser = commands.add_parser("context", help="inspect saved Agent context")
    context_commands = context_parser.add_subparsers(dest="context_command", required=True)
    context_inspect = context_commands.add_parser("inspect", help="inspect one AgentRun context")
    context_inspect.add_argument("agent_run_id")
    context_inspect.add_argument("--project", dest="project_id")
    prompt_parser = commands.add_parser("prompt", help="inspect or replay saved prompts")
    prompt_commands = prompt_parser.add_subparsers(dest="prompt_command", required=True)
    prompt_replay = prompt_commands.add_parser("replay", help="dry-run or execute one prompt replay")
    prompt_replay.add_argument("agent_run_id")
    prompt_replay.add_argument("--project", dest="project_id")
    replay_mode = prompt_replay.add_mutually_exclusive_group(required=True)
    replay_mode.add_argument("--dry-run", action="store_true")
    replay_mode.add_argument("--execute", action="store_true")
    args = parser.parse_args()
    settings = RuntimeSettings.load()
    if args.command == "start":
        code = start(settings, foreground=args.foreground)
    elif args.command == "stop":
        code = stop(settings)
    elif args.command == "status":
        health = _health(settings)
        print(json.dumps(health, ensure_ascii=False, indent=2))
        code = 0 if health.get("api", {}).get("status") == "ready" else 1
    elif args.command == "doctor":
        code = doctor(settings)
    elif args.command == "context":
        code = inspect_context(settings, args.agent_run_id, args.project_id)
    else:
        code = replay_prompt(settings, args.agent_run_id, args.project_id, args.execute)
    raise SystemExit(code)


if __name__ == "__main__":
    main()
