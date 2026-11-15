#!/usr/bin/env python3
"""Detailed checks for the factory enrichments. No model and no GitHub."""

import importlib.machinery
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BIN = ROOT / "factory" / "bin"


def load(name):
    loader = importlib.machinery.SourceFileLoader(name, str(BIN / name))
    spec = importlib.util.spec_from_loader(name, loader)
    module = importlib.util.module_from_spec(spec)
    loader.exec_module(module)
    return module


jobmod = load("job")

PASS = []
FAIL = []


def check(name, cond, detail=""):
    if cond:
        PASS.append(name)
        print(f"PASS  {name}")
    else:
        FAIL.append(name)
        print(f"FAIL  {name}" + (f"\n      {detail}" if detail else ""))


def test_left_out():
    text = """DECISION: ACCEPT
RISK: low
SURFACES: ui
RESCOPED: yes

## Summary
- sliced the issue

## Scope
A board that plays one game.

## Left out
- Add a chess clock to each room
- none
- Host a tournament and pair the next round
* Persist rooms after a restart
"""
    items = jobmod.left_out_items(text)
    check("left out keeps real follow-ups", items == [
        "Add a chess clock to each room",
        "Host a tournament and pair the next round",
        "Persist rooms after a restart",
    ], str(items))
    check("left out none is empty", jobmod.left_out_items("## Left out\n- none\n") == [])
    check("missing left out is empty", jobmod.left_out_items("## Scope\n- a board\n") == [])


def test_memory_and_outcome():
    job = {
        "id": "001-clock",
        "issue": 7,
        "title": "Chess clock",
        "pr": 9,
        "round": 2,
        "tokens": 1200,
        "cost_usd": 0.0,
    }
    spec = """# Clock

> Issue #7: Chess clock

## Summary
- Each room shows a clock for white and black.

## Acceptance criteria
1. The clock swaps after a legal move.

## Out of scope
Accounts.
"""
    text = jobmod.render_memory(job, spec, "APPROVE")
    check("memory names the issue", "Issue: #7 Chess clock" in text, text)
    check("memory keeps the proof", "clock swaps after a legal move" in text, text)
    check("memory records the decision", "Result: APPROVE" in text, text)
    record = jobmod.outcome_record(job, "needs-human")
    check("outcome stage is the parking point", record["stage"] == "needs-human" and record["round"] == 2)
    check("outcome cost is a number", record["cost_usd"] == 0.0 and record["tokens"] == 1200)
    check("auto_merge stays off until a page smoke is configured", jobmod.CONFIG.get("auto_merge") is False)
    check("one job at a time", jobmod.CONFIG.get("concurrency") == 1)
    models = jobmod.CONFIG["models"]
    check(
        "coder seats are qwen3, which omp-setup says can call tools",
        models["smol"].startswith("ollama/qwen3") and models["default"].startswith("ollama/qwen3")
        and "qwen2.5" not in models["default"],
        str(models),
    )


def git(repo, *args):
    env = os.environ.copy()
    env.update({
        "GIT_AUTHOR_NAME": "Factory Test",
        "GIT_AUTHOR_EMAIL": "factory@example.com",
        "GIT_COMMITTER_NAME": "Factory Test",
        "GIT_COMMITTER_EMAIL": "factory@example.com",
    })
    subprocess.run(["git", *args], cwd=repo, check=True, env=env, capture_output=True, text=True)


def write(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)


def test_gate(tmp):
    origin = tmp / "origin.git"
    repo = tmp / "repo"
    wt = tmp / "wt"
    subprocess.run(["git", "init", "--bare", str(origin)], check=True, capture_output=True)
    subprocess.run(["git", "init", str(repo)], check=True, capture_output=True)
    git(repo, "remote", "add", "origin", str(origin))
    config = {
        "base_branch": "main",
        "protected_paths": ["factory/checks.sh", "factory/accept.sh", "factory/bin/*"],
    }
    write(repo / "factory" / "config.json", json.dumps(config))
    write(repo / "factory" / "checks.sh", "#!/usr/bin/env bash\nset -euo pipefail\necho checks-ok\n")
    write(repo / "factory" / "accept.sh", "#!/usr/bin/env bash\nset -euo pipefail\ngrep -q '^ok$' src/marker.txt\n")
    os.chmod(repo / "factory" / "checks.sh", 0o755)
    os.chmod(repo / "factory" / "accept.sh", 0o755)
    write(repo / "src" / "marker.txt", "missing\n")
    git(repo, "add", ".")
    git(repo, "commit", "-m", "base")
    git(repo, "branch", "-M", "main")
    git(repo, "push", "origin", "main")

    def job(worktree):
        folder = repo / "factory" / "jobs" / "001-demo"
        write(folder / "job.json", json.dumps({
            "id": "001-demo",
            "round": 1,
            "worktree": str(worktree),
        }))
        (folder / "round-1").mkdir(parents=True, exist_ok=True)

    def run_gate():
        env = os.environ.copy()
        env["FACTORY_REPO"] = str(repo)
        return subprocess.run(
            [sys.executable, str(BIN / "gate"), "001-demo"],
            cwd=repo, env=env, capture_output=True, text=True,
        )

    git(repo, "checkout", "-b", "factory/001-demo")
    write(repo / "src" / "marker.txt", "nope\n")
    git(repo, "add", ".")
    git(repo, "commit", "-m", "no marker")
    job(repo)
    failed = run_gate()
    check("accept.sh failure fails the gate", failed.returncode == 1 and "GATE: FAIL" in failed.stdout, failed.stdout + failed.stderr)
    log = (repo / "factory" / "jobs" / "001-demo" / "round-1" / "checks.md").read_text()
    check("gate report names accept.sh", "accept.sh failed" in log, log)
    before = (repo / "factory" / "jobs" / "001-demo" / "round-1" / "checks.md").read_text()
    nudged = subprocess.run(
        [sys.executable, str(BIN / "gate"), "--nudge", "001-demo"],
        cwd=repo, env={**os.environ, "FACTORY_REPO": str(repo)}, capture_output=True, text=True,
    )
    after = (repo / "factory" / "jobs" / "001-demo" / "round-1" / "checks.md").read_text()
    check(
        "a failing accept.sh nudges without rewriting the gate report",
        nudged.returncode == 2 and "accept.sh fails" in nudged.stderr and after == before,
        nudged.stderr,
    )

    write(repo / "src" / "marker.txt", "ok\n")
    git(repo, "add", ".")
    git(repo, "commit", "-m", "marker")
    passed = run_gate()
    check("marker satisfies the main accept.sh", passed.returncode == 0 and "GATE: PASS" in passed.stdout, passed.stdout + passed.stderr)
    write(repo / "factory" / "contract" / "frozen" / "src" / "marker.txt", "shipped\n")
    weakened = run_gate()
    check(
        "a changed shipped file fails the contract",
        weakened.returncode == 1 and "shipped test changed" in (weakened.stdout + weakened.stderr),
        weakened.stdout + weakened.stderr,
    )
    write(repo / "src" / "marker.txt", "ok\n")
    (repo / "factory" / "contract" / "frozen" / "src" / "marker.txt").write_text("ok\n")
    quiet = subprocess.run(
        [sys.executable, str(BIN / "gate"), "--nudge", "001-demo"],
        cwd=repo, env={**os.environ, "FACTORY_REPO": str(repo)}, capture_output=True, text=True,
    )
    check("a passing tree is not nudged", quiet.returncode == 0 and quiet.stderr == "", quiet.stderr)

    git(repo, "worktree", "add", str(wt), "HEAD")
    job(wt)
    write(wt / "factory" / "accept.sh", "#!/usr/bin/env bash\nexit 1\n")
    dirty = run_gate()
    check(
        "a dirty worktree cannot replace accept.sh",
        dirty.returncode == 0 and "GATE: PASS" in dirty.stdout,
        dirty.stdout + dirty.stderr,
    )

    git(repo, "checkout", "factory/001-demo")
    checks = (repo / "factory" / "checks.sh").read_text().replace("echo checks-ok", "echo checks-ok\necho tampered")
    write(repo / "factory" / "checks.sh", checks)
    git(repo, "add", ".")
    git(repo, "commit", "-m", "edit checks")
    job(repo)
    protected = run_gate()
    check(
        "editing checks.sh fails even when the script would pass",
        protected.returncode == 1 and "protected paths changed" in protected.stdout,
        protected.stdout + protected.stderr,
    )
    protected_nudge = subprocess.run(
        [sys.executable, str(BIN / "gate"), "--nudge", "001-demo"],
        cwd=repo, env={**os.environ, "FACTORY_REPO": str(repo)}, capture_output=True, text=True,
    )
    check(
        "a protected-path edit is nudged before the gate",
        protected_nudge.returncode == 2 and "Protected paths changed" in protected_nudge.stderr,
        protected_nudge.stderr,
    )


class Result:
    def __init__(self, code=0, stdout="", stderr=""):
        self.returncode = code
        self.stdout = stdout
        self.stderr = stderr


def test_run_recovery():
    runmod = load("run")
    with tempfile.TemporaryDirectory(prefix="factory-run-") as raw:
        root = Path(raw)
        runmod.FACTORY = root
        job_id = "004-demo"
        rd = root / "jobs" / job_id / "round-1"
        rd.mkdir(parents=True)
        (rd / "review-code.md").write_text("VERDICT: PASS\n\n## Evidence\n- `node --test test/clock.test.js` → exit 0, 1 passed\n")
        (rd / "review-bare.md").write_text("VERDICT: PASS\n\nok\n")
        (rd / "review-ux.md").write_text("still writing\n")
        check("a verdict counts as a finished review", runmod.finished_review(job_id, "code", 1))
        check("a file without a verdict is rerun", not runmod.finished_review(job_id, "ux", 1))
        check("a missing review is rerun", not runmod.finished_review(job_id, "ui", 1))

        spawned = []

        def fake_agent(jid, role, *args, check=True):
            spawned.append((role, args))
            if role == "reviewer-ux":
                (rd / "review-ux.md").write_text("VERDICT: PASS\n\n## Evidence\n- `curl -s http://127.0.0.1:9/` → exit 7, connection refused\n")
            if role == "reviewer-ui":
                (rd / "review-ui.md").write_text("VERDICT: PASS\n\n## Evidence\n- `curl -s http://127.0.0.1:9/` → exit 7, connection refused\n")
            return Result()

        advances = []

        def fake_job(*args, check=True, stdin=None):
            advances.append(args)
            return Result(stdout=f"{job_id}: ok\n")

        def fake_load(jid):
            reviews = {}
            for name in ("code", "ux", "ui"):
                path = rd / f"review-{name}.md"
                if not path.exists():
                    continue
                line = path.read_text().splitlines()[0]
                if line == "VERDICT: PASS":
                    reviews[name] = "PASS"
                elif line == "VERDICT: CHANGES":
                    reviews[name] = "CHANGES"
            return {
                "id": jid,
                "round": 1,
                "agents": {"reviewers": {"code": "smol", "ux": "default", "ui": "smol"}},
                "reviews": reviews,
            }

        runmod.agent = fake_agent
        runmod.job = fake_job
        runmod.load = fake_load
        stage = runmod.run_review(job_id)
        roles = [role for role, _ in spawned]
        check("a finished review is not spawned again", roles == ["reviewer-ux", "reviewer-ui"] or set(roles) == {"reviewer-ux", "reviewer-ui"}, str(roles))
        check("a verdict without a command is not finished", not runmod.finished_review(job_id, "bare", 1))
        check("reviewer-code was kept", "reviewer-code" not in roles)
        check("a complete review advances to approve", stage == "approve" and ("advance", job_id, "approve") in advances, str(advances))

        builds = {"n": 0}
        build_prompts = []

        def fake_builder(jid, role, *args, check=True):
            builds["n"] += 1
            build_prompts.append(args)
            (root / "jobs" / jid).mkdir(parents=True, exist_ok=True)
            (root / "jobs" / jid / "build.md").write_text("STATUS: READY\n")
            return Result()

        attempts = {"n": 0}

        def refuse_then_pass(*args, check=True, stdin=None):
            attempts["n"] += 1
            if attempts["n"] == 1:
                return Result(code=1, stderr="job: the worktree has uncommitted changes\n")
            return Result()

        runmod.agent = fake_builder
        runmod.job = refuse_then_pass
        runmod.load = lambda jid: {"id": jid, "round": 1}
        runmod.nudge_build = lambda jid: Result()
        stage = runmod.run_build(job_id)
        check("a refused ready build goes back to the builder once", builds["n"] == 2 and stage == "gate", f"builds={builds['n']} stage={stage}")
        check("the retry prompt quotes the refusal", any("uncommitted changes" in " ".join(a) for a in build_prompts), str(build_prompts))

        builds["n"] = 0

        def always_refuse(*args, check=True, stdin=None):
            return Result(code=1, stderr="job: the worktree has uncommitted changes\n")

        runmod.job = always_refuse
        stopped = False
        try:
            runmod.run_build(job_id)
        except SystemExit:
            stopped = True
        check("a second refusal stops the job", stopped and builds["n"] == 2, f"stopped={stopped} builds={builds['n']}")

        builds["n"] = 0

        def not_fixable(*args, check=True, stdin=None):
            return Result(code=1, stderr="job: 004-demo: intake → gate is not a legal transition\n")

        runmod.job = not_fixable
        stopped = False
        try:
            runmod.run_build(job_id)
        except SystemExit:
            stopped = True
        check("a refusal the builder cannot fix is not retried", stopped and builds["n"] == 1, f"stopped={stopped} builds={builds['n']}")

        nudges = {"n": 0}

        def fail_then_unused(jid):
            nudges["n"] += 1
            if nudges["n"] == 1:
                return Result(code=2, stderr="factory/checks.sh fails in your worktree (exit 1).\n")
            return Result()

        runmod.nudge_build = fail_then_unused
        runmod.job = lambda *args, check=True, stdin=None: Result()
        builds["n"] = 0
        build_prompts.clear()
        stage = runmod.run_build(job_id)
        check(
            "a failing check sends the builder back once",
            builds["n"] == 2 and nudges["n"] == 1 and stage == "gate",
            f"builds={builds['n']} nudges={nudges['n']} stage={stage}",
        )
        check(
            "the nudge prompt quotes the check failure",
            any("checks.sh fails" in " ".join(args) for args in build_prompts),
            str(build_prompts),
        )

        def keep_failing(jid):
            nudges["n"] += 1
            return Result(code=2, stderr="factory/accept.sh fails in your worktree (exit 1).\n")

        advances = []

        def record_advance(*args, check=True, stdin=None):
            advances.append(args)
            return Result()

        nudges["n"] = 0
        builds["n"] = 0
        runmod.nudge_build = keep_failing
        runmod.job = record_advance
        stage = runmod.run_build(job_id)
        check(
            "a second failing check is left for the gate",
            builds["n"] == 2 and nudges["n"] == 1 and stage == "gate"
            and ("advance", job_id, "gate") in advances,
            f"builds={builds['n']} nudges={nudges['n']} stage={stage} advances={advances}",
        )

        steps = {"nudge": 0, "advance": 0}

        def nudge_once(jid):
            steps["nudge"] += 1
            if steps["nudge"] == 1:
                return Result(code=2, stderr="factory/checks.sh fails in your worktree (exit 1).\n")
            return Result()

        def refuse_once(*args, check=True, stdin=None):
            steps["advance"] += 1
            if steps["advance"] == 1:
                return Result(code=1, stderr="job: the worktree has uncommitted changes\n")
            return Result()

        builds["n"] = 0
        runmod.nudge_build = nudge_once
        runmod.job = refuse_once
        stage = runmod.run_build(job_id)
        check(
            "a nudge and a refusal each resume the builder once",
            builds["n"] == 3 and steps["nudge"] == 1 and steps["advance"] == 2 and stage == "gate",
            f"builds={builds['n']} steps={steps} stage={stage}",
        )


def test_advance_after_merge():
    runmod = load("run")
    with tempfile.TemporaryDirectory(prefix="factory-advance-") as raw:
        root = Path(raw)
        job_dir = root / "factory" / "jobs" / "003-rooms"
        program_dir = root / "factory" / "programs" / "001-chess"
        job_dir.mkdir(parents=True)
        program_dir.mkdir(parents=True)
        job_path = job_dir / "job.json"
        program = {"id": "001-chess", "tickets": [{"n": 3, "issue": 3}, {"n": 4, "issue": 4}]}
        (program_dir / "program.json").write_text(json.dumps(program))
        runmod.FACTORY = root / "factory"
        calls = []

        def fake_sh(cmd, check=True, stdin=None):
            calls.append(cmd)
            return Result()

        runmod.sh = fake_sh
        job_path.write_text(json.dumps({"id": "003-rooms", "issue": 3, "stage": "needs-human"}))
        runmod.advance_programs(["003-rooms"])
        check("a parked ticket does not step its program", calls == [])

        job_path.write_text(json.dumps({"id": "003-rooms", "issue": 3, "stage": "merged"}))
        (program_dir / "running").write_text(f"{os.getpid()}\n")
        runmod.advance_programs(["003-rooms"])
        check("a program already stepping is left alone", calls == [])
        (program_dir / "running").unlink()

        runmod.advance_programs(["003-rooms", "003-rooms"])
        check(
            "a merged ticket steps its program once",
            len(calls) == 1 and calls[0][-2:] == ["step", "001-chess"],
            str(calls),
        )

        order = []

        class Lock:
            def close(self):
                order.append("unlock")

        runmod.drain_lock = lambda: Lock()
        runmod._drain = lambda only: order.append("drain") or ["003-rooms"]
        runmod.advance_programs = lambda ids: order.append(("advance", list(ids)))
        runmod.drain()
        check(
            "the drain lock is released before the program steps",
            order == ["drain", "unlock", ("advance", ["003-rooms"])],
            str(order),
        )

        order.clear()
        runmod.drain_lock = lambda: None
        runmod.drain(only_issue=3)
        check("a busy drain does not step", order == [], str(order))


def test_schedule_helpers():
    jobmod = load("job")
    gatemod = load("gate")
    check("a double-star pattern crosses directories", gatemod.path_matches("public/index.html", "public/**"))
    check("a single star stays in one segment", not gatemod.path_matches("test/page/a.js", "test/page*"))
    check("shared docs match exactly", gatemod.path_matches("AGENTS.md", "AGENTS.md"))
    folder = Path(tempfile.mkdtemp(prefix="factory-reviews-"))
    job = {"id": "009-sync", "round": 2}
    jobmod.FACTORY = folder
    jobmod.JOBS = folder / "jobs"
    (folder / "jobs" / "009-sync" / "round-1").mkdir(parents=True)
    (folder / "jobs" / "009-sync" / "round-2").mkdir()
    (folder / "jobs" / "009-sync" / "round-1" / "review-ux.md").write_text(
        "VERDICT: PASS\n\n## Evidence\n- `node --test test/page.test.js` → exit 0, ok\n"
    )
    (folder / "jobs" / "009-sync" / "round-1" / "review-security.md").write_text("VERDICT: PASS\n\nFine.\n")
    (folder / "jobs" / "009-sync" / "round-1" / "review-code.md").write_text("VERDICT: PASS\n\nFine.\n")
    (folder / "jobs" / "009-sync" / "round-1" / "review-ui.md").write_text("VERDICT: CHANGES\n\nNo.\n")
    jobmod.keep_passing_reviews(job)
    kept = folder / "jobs" / "009-sync" / "round-2"
    check("a sync round keeps a passing review", (kept / "review-ux.md").exists())
    check("a sync round re-reviews code", not (kept / "review-code.md").exists())
    check("a sync round drops a changes review", not (kept / "review-ui.md").exists())
    check("a pass without evidence is not kept", not (kept / "review-security.md").exists())
    stamped = {"id": "009-sync", "stage": "needs-human", "timeline": [{
        "to": "needs-human", "at": "2026-11-10T00:00:00Z", "total_cost_usd": 1.0, "total_tokens": 10,
    }]}
    jobmod.stamp_timeline(stamped, "build")
    check(
        "leaving a wait records the wait",
        stamped["timeline"][-1]["to"] == "build" and stamped["timeline"][-1]["wait_seconds"] is not None,
        str(stamped["timeline"][-1]),
    )
    repo = folder / "repo"
    subprocess.run(["git", "init", str(repo)], check=True, capture_output=True)
    git(repo, "branch", "-M", "main")
    write(repo / "public" / "index.html", "<p>rooms</p>\n")
    git(repo, "add", ".")
    git(repo, "commit", "-m", "base")
    subprocess.run(["git", "init", "--bare", str(folder / "origin.git")], check=True, capture_output=True)
    git(repo, "remote", "add", "origin", str(folder / "origin.git"))
    git(repo, "push", "origin", "main")
    git(repo, "checkout", "-b", "feature")
    write(repo / "src" / "other.js", "module.exports = {}\n")
    write(repo / "AGENTS.md", "notes\n")
    git(repo, "add", ".")
    git(repo, "commit", "-m", "outside")
    gatemod.CONFIG = {"base_branch": "main", "areas": {"web": ["public/**"]}, "shared_paths": ["AGENTS.md"]}
    check(
        "a file outside the claimed area is reported",
        gatemod.outside_claim(str(repo), ["web"]) == ["src/other.js"],
        str(gatemod.outside_claim(str(repo), ["web"])),
    )
    check("an area the map does not name is not enforced", gatemod.outside_claim(str(repo), ["api"]) == [])
    (folder / "jobs" / "009-sync" / "decision.md").write_text(
        "ESCALATE\n\n## Why\nThe merge failed:\n\nBase branch was modified. Review and try the merge again.\n"
    )
    check(
        "a stale-base park still records an approval",
        jobmod.memory_decision_line({"id": "009-sync"}) == "APPROVE",
    )
    check("a stale-base park can be merged again", jobmod.stale_base_park({"id": "009-sync"}))
    (folder / "jobs" / "009-sync" / "decision.md").write_text("ESCALATE\n\n## Why\nThe gate failed.\n")
    check(
        "a real escalate is not a stale-base park",
        jobmod.memory_decision_line({"id": "009-sync"}) == "ESCALATE" and not jobmod.stale_base_park({"id": "009-sync"}),
    )
    check("an ordinary merge failure is not retried", jobmod.merge_retry("GraphQL: something else", True) == "give-up")
    check("a current branch retries the merge", jobmod.merge_retry("Base branch was modified", True) == "retry")
    check("a branch behind main is resynced", jobmod.merge_retry("Base branch was modified", False) == "resync")
    (folder / "jobs" / "009-sync" / "decision.md").write_text(
        "ESCALATE\n\nThe gate failed after syncing with main.\n"
        "outside claimed areas: factory/memory/009-sync.md)\n"
    )
    check("a memory-note park can be merged again", jobmod.factory_note_park({"id": "009-sync"}))
    check(
        "a memory-note park still records an approval",
        jobmod.memory_decision_line({"id": "009-sync"}) == "APPROVE",
    )
    (folder / "jobs" / "009-sync" / "decision.md").write_text(
        "ESCALATE\n\noutside claimed areas: factory/memory/009-sync.md, src/other.js)\n"
    )
    check("other files outside the claim stay parked", not jobmod.factory_note_park({"id": "009-sync"}))
    write(repo / "factory" / "memory" / "009-sync.md", "# 009-sync\n")
    git(repo, "add", ".")
    git(repo, "commit", "-m", "memory")
    check(
        "the builder gate still reports the memory note",
        "factory/memory/009-sync.md" in gatemod.outside_claim(str(repo), ["web"]),
    )
    check(
        "the merge gate ignores the factory memory note",
        gatemod.outside_claim(str(repo), ["web"], ignore=["factory/memory/009-sync.md"]) == ["src/other.js"],
        str(gatemod.outside_claim(str(repo), ["web"], ignore=["factory/memory/009-sync.md"])),
    )


def main():
    test_left_out()
    test_memory_and_outcome()
    test_run_recovery()
    test_advance_after_merge()
    test_schedule_helpers()
    with tempfile.TemporaryDirectory(prefix="factory-enrich-") as raw:
        test_gate(Path(raw))
    print(f"\n{len(PASS)} passed, {len(FAIL)} failed")
    if FAIL:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
