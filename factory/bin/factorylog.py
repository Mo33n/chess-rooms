"""Timestamped logs for factory processes.

Role runs stream omp's output line by line and, while omp is silent, write a
heartbeat with how long it has been and how much its session has grown. That
is the difference between a slow model call and a stuck one.
"""

import queue
import subprocess
import threading
import time
from datetime import datetime
from pathlib import Path


def stamp():
    return datetime.now().strftime("%H:%M:%S")


def line(path, text):
    """Append one timestamped line and flush, so tail -f shows it immediately."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a") as handle:
        handle.write(f"{stamp()} {text}\n")
        handle.flush()


def session_state(session_dir):
    """One clause about the omp session dir: empty, or size and age of the newest file."""
    session_dir = Path(session_dir) if session_dir else None
    if session_dir is None or not session_dir.exists():
        return "no session dir"
    files = [path for path in session_dir.rglob("*") if path.is_file() and not path.name.endswith(".lock.os")]
    if not files:
        return "session dir empty"
    total = sum(path.stat().st_size for path in files)
    newest = max(files, key=lambda path: path.stat().st_mtime)
    age = int(time.time() - newest.stat().st_mtime)
    return f"session {total} bytes, {newest.name} updated {age}s ago"


def run(cmd, log_path, cwd, env, session_dir=None, heartbeat=15):
    """Run a command, mirroring its output into log_path. Returns the exit code.

    A heartbeat line is written every `heartbeat` seconds with no output, so a
    run that prints nothing until it exits still leaves a trail.
    """
    log_path = Path(log_path)
    log_path.parent.mkdir(parents=True, exist_ok=True)
    started = time.monotonic()
    with log_path.open("a") as log:
        log.write(f"\n{stamp()} # --- start ---\n")
        log.write(f"{stamp()} $ {' '.join(str(part) for part in cmd)}\n")
        log.flush()
        proc = subprocess.Popen(
            cmd, cwd=cwd, env=env,
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, bufsize=1,
        )
        log.write(f"{stamp()} pid {proc.pid}\n")
        log.flush()
        lines = queue.Queue()

        def read():
            for output in proc.stdout:
                lines.put(output)
            lines.put(None)

        threading.Thread(target=read, daemon=True).start()
        while True:
            try:
                output = lines.get(timeout=heartbeat)
            except queue.Empty:
                if proc.poll() is not None:
                    continue
                elapsed = int(time.monotonic() - started)
                log.write(f"{stamp()} # still running, {elapsed}s, no output, {session_state(session_dir)}\n")
                log.flush()
                continue
            if output is None:
                break
            text = output if output.endswith("\n") else output + "\n"
            log.write(f"{stamp()} {text}")
            log.flush()
        code = proc.wait()
        elapsed = int(time.monotonic() - started)
        log.write(f"{stamp()} # exit {code} after {elapsed}s, {session_state(session_dir)}\n")
        log.flush()
        return code
