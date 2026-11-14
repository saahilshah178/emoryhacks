"""Start the whole program with one command: the API and the web app.

  make run                  # then open the address the web app prints
  PORT=3100 make run        # the web app on another port
  API_PORT=8000 make run    # pin the API's port (default: any free port)

The API listens on this machine only and nobody opens it: the web app forwards /api to it,
so the browser sees one address. Ctrl-C stops both.
"""
from __future__ import annotations

import os
import shutil
import signal
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"
WEB = ROOT / "frontend"
# Starting includes connecting to the database and bringing its schema up to date.
START_TIMEOUT_S = 90
STOP_TIMEOUT_S = 10


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def port_is_free(port: int) -> bool:
    with socket.socket() as sock:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            sock.bind(("127.0.0.1", port))
        except OSError:
            return False
    return True


def wait_for_api(api: subprocess.Popen, url: str) -> bool:
    """True once the API answers; False if it exits or takes too long."""
    deadline = time.monotonic() + START_TIMEOUT_S
    while time.monotonic() < deadline:
        if api.poll() is not None:
            return False
        try:
            with urllib.request.urlopen(f"{url}/api/health", timeout=5) as res:
                if res.status == 200:
                    return True
        except (urllib.error.URLError, OSError):
            pass
        time.sleep(0.3)
    return False


def _signal_group(proc: subprocess.Popen, sig: int) -> None:
    try:
        os.killpg(proc.pid, sig)
    except ProcessLookupError:
        pass


def stop(procs: list[subprocess.Popen]) -> None:
    """Ask each process and its children to stop, then force any that do not."""
    for proc in procs:
        if proc.poll() is None:
            _signal_group(proc, signal.SIGTERM)
    deadline = time.monotonic() + STOP_TIMEOUT_S
    for proc in procs:
        try:
            proc.wait(timeout=max(0.1, deadline - time.monotonic()))
        except subprocess.TimeoutExpired:
            _signal_group(proc, signal.SIGKILL)
            proc.wait()


def _interrupt(signum, frame):
    raise KeyboardInterrupt


def main() -> int:
    npm = shutil.which("npm")
    if npm is None:
        print("npm was not found. Install Node.js, then run this again.", file=sys.stderr)
        return 1
    if not (WEB / "node_modules" / ".bin" / "next").exists():
        print("The web app's packages are not installed. Use `make run`, or run `npm install` in "
              f"{WEB.relative_to(ROOT)} first.", file=sys.stderr)
        return 1

    port = int(os.environ.get("API_PORT") or free_port())
    # Checked up front: otherwise whatever already holds the port could answer for the API.
    if not port_is_free(port):
        print(f"Port {port} is already in use. Leave API_PORT unset to use any free port.", file=sys.stderr)
        return 1
    api_url = f"http://127.0.0.1:{port}"
    # A closed terminal or a `kill` stops both halves the same way Ctrl-C does.
    signal.signal(signal.SIGTERM, _interrupt)
    signal.signal(signal.SIGHUP, _interrupt)

    procs: list[subprocess.Popen] = []
    try:
        print(f"Starting the API on {api_url} (only the web app talks to it)...", flush=True)
        # Each half gets its own process group, so stopping it also stops what it started.
        api = subprocess.Popen(
            [sys.executable, "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", str(port)],
            cwd=BACKEND, start_new_session=True)
        procs.append(api)
        if not wait_for_api(api, api_url):
            print("The API did not start. Its messages are above.", file=sys.stderr)
            return 1

        print("Starting the web app. Open the address it prints below.", flush=True)
        web = subprocess.Popen([npm, "run", "dev"], cwd=WEB, env={**os.environ, "API_URL": api_url},
                               start_new_session=True)
        procs.append(web)

        while True:
            for name, proc in (("API", api), ("web app", web)):
                code = proc.poll()
                if code is not None:
                    print(f"The {name} stopped (exit code {code}), so the rest is stopping too.", file=sys.stderr)
                    return code or 1
            time.sleep(0.5)
    except KeyboardInterrupt:
        print("\nStopping the web app and the API...", flush=True)
        return 0
    finally:
        stop(procs)


if __name__ == "__main__":
    sys.exit(main())
