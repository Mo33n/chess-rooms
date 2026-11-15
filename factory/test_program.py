#!/usr/bin/env python3
"""Checks for the PRD → tickets → release program. No model and no GitHub."""

import importlib.machinery
import importlib.util
import json
import os
import tempfile
from pathlib import Path

BIN = Path(__file__).resolve().parent / "bin"
os.environ["FACTORY_OPERATOR"] = "tester"
os.environ["FACTORY_PUBLISH_DOCS"] = "0"


def load(name):
    loader = importlib.machinery.SourceFileLoader(name, str(BIN / name))
    spec = importlib.util.spec_from_loader(name, loader)
    module = importlib.util.module_from_spec(spec)
    loader.exec_module(module)
    return module


program = load("program")

PASS = []
FAIL = []


def check(name, cond, detail=""):
    if cond:
        PASS.append(name)
        print(f"PASS  {name}")
    else:
        FAIL.append(name)
        print(f"FAIL  {name}" + (f"\n      {detail}" if detail else ""))


TICKETS = """
# Tickets

## 1. Create a room
Depends: none

A named room exists.

## 2. Sit down
Depends: 1

Two named seats can join that room.

## 3. Record a result
Depends: 1

A finished game stores a winner.
"""

PARALLEL = """
# Tickets

## 1. Rooms API contract
Depends: none
Kind: contract
Touches: api/rooms

The room shape.

## 2. Create a room
Depends: 1
Touches: api/rooms, db

Rooms persist.

## 3. Room list page
Depends: 1
After: 2
Touches: web/rooms

A page lists rooms.

## 4. Clock provider
Depends: 1
Decision: Which clock library do we use?
Touches: web/clock

## Options
- chess-clock-js
- hand rolled

## 5. Load test
Depends: 2, 3
Kind: spike

Findings only.
"""


def test_parse():
    tickets = program.parse_tickets(TICKETS)
    check("parses three tickets", [t["n"] for t in tickets] == [1, 2, 3])
    check("first ticket has no dependency", tickets[0]["depends"] == [])
    check("later tickets name their dependency", tickets[1]["depends"] == [1] and tickets[2]["depends"] == [1])
    check("defaults are feature and planned", tickets[0]["kind"] == "feature" and tickets[0]["status"] == "planned")
    try:
        program.parse_tickets("## 1. A\nDepends: 2\n\n## 2. B\nDepends: 1\n\n")
        check("rejects a cycle", False)
    except ValueError as exc:
        check("rejects a cycle", "cycle" in str(exc), str(exc))
    try:
        program.parse_tickets("## 1. A\nNo depends line\n")
        check("rejects a missing Depends line", False)
    except ValueError:
        check("rejects a missing Depends line", True)

    rich = program.parse_tickets(PARALLEL)
    check("reads Kind", rich[0]["kind"] == "contract" and rich[4]["kind"] == "spike")
    check("reads Touches", rich[1]["touches"] == ["api/rooms", "db"])
    check("reads After", rich[2]["after"] == [2] and rich[2]["depends"] == [1])
    check("reads Decision", rich[3]["decision"] == "Which clock library do we use?")
    rated = program.parse_tickets("## 1. A\nDepends: none\nRisk: high\nSurfaces: ui, security\n\nBody.\n")
    check("reads Risk and Surfaces", rated[0]["risk"] == "high" and rated[0]["surfaces"] == ["ui", "security"])
    try:
        program.parse_tickets("## 1. A\nDepends: none\nRisk: scary\n")
        check("rejects an unknown Risk", False)
    except ValueError:
        check("rejects an unknown Risk", True)
    chain = "\n".join(
        f"## {n}. T{n}\nDepends: {'none' if n == 1 else n - 1}\nTouches: web\n\nWork.\n" for n in range(1, 5)
    )
    warning = program.serial_warning(program.parse_tickets(chain))
    check("a one-ticket chain is sent back", warning is not None and "4 of 4" in warning, warning)
    wide = program.parse_tickets("## 1. A\nDepends: none\nTouches: api\n\n## 2. B\nDepends: 1\nTouches: web\n\n## 3. C\nDepends: 1\nTouches: api\n\n## 4. D\nDepends: 1\nTouches: db\n\n")
    check("a fan-out is not sent back", program.serial_warning(wide) is None, str(program.schedule_shape(wide)))
    check("header ends at the body", rich[3]["body"].startswith("## Options"), rich[3]["body"])
    try:
        program.parse_tickets("## 1. A\nDepends: none\nKind: epic\n")
        check("rejects an unknown Kind", False)
    except ValueError:
        check("rejects an unknown Kind", True)
    try:
        program.parse_tickets("## 1. A\nDepends: none\nAfter: 9\n")
        check("After must name a real ticket", False)
    except ValueError:
        check("After must name a real ticket", True)


def test_next_ready():
    tickets = program.parse_tickets(TICKETS)
    for ticket, issue in zip(tickets, (10, 11, 12)):
        ticket["issue"] = issue
    check("the first ticket is ready", program.next_ready(tickets, set(), set())["n"] == 1)
    check("dependents wait", program.next_ready(tickets, set(), {10}) is None)
    ready = program.next_ready(tickets, {10}, set())
    check("both dependents unlock together", ready["n"] == 2)
    check("a running ticket is skipped", program.next_ready(tickets, {10}, {11})["n"] == 3)
    check("finished tickets are not started again", program.next_ready(tickets, {10, 11, 12}, set()) is None)
    both = program.ready_tickets(tickets, {10}, set())
    check("ready_tickets returns every unblocked ticket", [t["n"] for t in both] == [2, 3])


def test_parallel():
    tickets = program.parse_tickets(PARALLEL)
    for ticket, issue in zip(tickets, (20, 21, 22, 23, 24)):
        ticket["issue"] = issue
    check("only the contract is ready at first", [t["n"] for t in program.ready_tickets(tickets, set(), set())] == [1])
    ready = program.ready_tickets(tickets, {20}, set(), blocked={4})
    check("after the contract merges, 2 and 3 start together", [t["n"] for t in ready] == [2, 3], str([t["n"] for t in ready]))
    check("an open decision blocks its ticket", all(t["n"] != 4 for t in ready))
    ready = program.ready_tickets(tickets, {20}, set())
    check("a decided ticket joins the ready set", {t["n"] for t in ready} == {2, 3, 4}, str([t["n"] for t in ready]))
    check("a ticket whose After has not landed starts last", ready[-1]["n"] == 3, str([t["n"] for t in ready]))
    ready = program.ready_tickets(tickets, {20}, {21})
    check("a busy area holds back a ticket that touches it", all(t["touches"] != ["api/rooms", "db"] for t in ready))
    check("other areas still run", {t["n"] for t in ready} == {3, 4}, str([t["n"] for t in ready]))
    check("After orders tickets once it has landed", [t["n"] for t in program.ready_tickets(tickets, {20, 21}, set())] == [3, 4])
    reason = program.waiting_reason(tickets[4], tickets, {20}, {21}, set())
    check("waiting reason names the dependency", reason == "waiting on 2, 3", reason)
    clash = program.parse_tickets("## 1. A\nDepends: none\nTouches: db\n\n## 2. B\nDepends: none\nTouches: db\n")
    clash[0]["issue"], clash[1]["issue"] = 30, 31
    check("two ready tickets on one area are serialized", [t["n"] for t in program.ready_tickets(clash, set(), set())] == [1])
    check("a superseded dependency counts as settled",
          program.ready_tickets(
              [dict(clash[0], status="superseded"), dict(clash[1], depends=[1], touches=[])], set(), set())[0]["n"] == 2)
    chain = program.parse_tickets("## 1. A\nDepends: none\n\n## 2. B\nDepends: 1\n")
    chain[0]["issue"], chain[1]["issue"] = 50, 51
    check("a rejected ticket does not restart and does not settle its dependents",
          program.ready_tickets(chain, set(), set(), rejected={50}) == [])
    reason = program.waiting_reason(chain[1], chain, set(), set(), set(), rejected={50})
    check("a rejected dependency is reported", reason == "blocked by rejected 1", reason)
    check("finished means merged only", program.finished_issues({1: "merged", 2: "rejected"}) == {1})
    check("live excludes parked jobs", program.live_issues({1: "build", 2: "needs-human", 3: "merged"}) == {1})


def test_merge_tickets():
    old = program.parse_tickets(TICKETS)
    for ticket, issue in zip(old, (10, 11, 12)):
        ticket["issue"] = issue
    new = program.parse_tickets(
        "## 1. Create a room\nDepends: none\n\nA named room exists.\n\n"
        "## 2. Sit down\nDepends: 1\n\nFour seats can join.\n\n"
        "## 3. Record a result\nDepends: 1\nStatus: superseded\n\nA finished game stores a winner.\n\n"
        "## 4. Spectate\nDepends: 2\n\nA fourth person can watch.\n"
    )
    merged = program.merge_tickets(old, new, {10})
    kinds = {t["n"]: t["change"] for t in merged}
    check("replan keeps the merged ticket", kinds[1] == "merged" and merged[0]["issue"] == 10)
    check("replan marks a changed ticket", kinds[2] == "changed" and merged[1]["issue"] == 11)
    check("replan marks a superseded ticket", kinds[3] == "superseded")
    check("replan marks new work", kinds[4] == "added" and merged[3]["issue"] is None)
    retouched = program.parse_tickets(
        "## 1. Create a room\nDepends: none\n\nA named room exists.\n\n"
        "## 2. Sit down\nDepends: 1\nTouches: seats\n\nTwo named seats can join that room.\n\n"
        "## 3. Record a result\nDepends: 1\n\nA finished game stores a winner.\n"
    )
    check("a header-only change counts as changed",
          {t["n"]: t["change"] for t in program.merge_tickets(old, retouched, {10})}[2] == "changed")
    try:
        program.merge_tickets(old, program.parse_tickets("## 1. Create a room\nDepends: none\n\nA named room exists.\n"), set())
        check("a filed ticket cannot vanish", False)
    except ValueError as exc:
        check("a filed ticket cannot vanish", "superseded" in str(exc), str(exc))
    try:
        program.merge_tickets(old, program.parse_tickets(
            "## 1. Create a bigger room\nDepends: none\n\nA named room exists.\n\n"
            "## 2. Sit down\nDepends: 1\n\nTwo named seats can join that room.\n\n"
            "## 3. Record a result\nDepends: 1\n\nA finished game stores a winner.\n"), {10})
        check("a merged ticket cannot change", False)
    except ValueError as exc:
        check("a merged ticket cannot change", "merged" in str(exc), str(exc))


def test_files():
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        program.REPO = root
        program.FACTORY = root / "factory"
        program.PROGRAMS = program.FACTORY / "programs"
        (program.FACTORY).mkdir()
        (program.FACTORY / "config.json").write_text(json.dumps({
            "labels": {"queue": "factory"},
            "roles": {},
            "models": {},
            "omp": {},
            "agent_timeout": "1m",
        }))
        created = program.create("Chess club", "# Club\n\nSeveral rooms.\n")
        check("new program waits for research", created["stage"] == "research")
        folder = program.PROGRAMS / created["id"]
        check("prd is stored", (folder / "prd.md").exists())
        check("creation is logged", created["log"][0]["event"] == "program created" and created["log"][0]["by"] == "tester")
        try:
            program.approve_prd(program.load(created["id"]))
            check("cannot approve before research", False)
        except SystemExit:
            check("cannot approve before research", True)
        (folder / "research.md").write_text("## Summary\n- found rooms\n")
        (folder / "prd.enriched.md").write_text("# Enriched\n\nRooms, then seats.\n")
        created["stage"] = "review-prd"
        program.save(created)
        program.approve_prd(program.load(created["id"]))
        loaded = program.load(created["id"])
        check("approved PRD moves to planning", loaded["stage"] == "plan")
        check("approval is in the consent log", any(e["event"] == "PRD approved" for e in loaded["log"]))
        docs = root / "docs" / "programs" / created["id"]
        check("documents are published to the repo", (docs / "prd.enriched.md").exists() and (docs / "README.md").exists())
        index = (docs / "README.md").read_text()
        check("the index records who approved", "accepted by tester" in index, index)

        (folder / "tickets.md").write_text(PARALLEL)
        loaded["tickets"] = program.parse_tickets(PARALLEL)
        program.sync_decisions(loaded)
        loaded["stage"] = "review-tickets"
        program.save(loaded)
        loaded = program.load(created["id"])
        check("review holds the parsed tickets", len(loaded["tickets"]) == 5)
        check("a Decision line becomes a proposed decision",
              len(loaded["decisions"]) == 1 and loaded["decisions"][0]["status"] == "proposed" and loaded["decisions"][0]["ticket"] == 4)
        decision_file = folder / loaded["decisions"][0]["file"]
        check("the decision file is an ADR draft", decision_file.exists() and "status: proposed" in decision_file.read_text())
        check("options come from the ticket body", "chess-clock-js" in decision_file.read_text())
        check("open decisions block their ticket", program.open_decisions(loaded) == {4})

        program.decide(loaded, 1, "Use chess-clock-js; it is maintained and small.")
        loaded = program.load(created["id"])
        text = decision_file.read_text()
        check("deciding accepts the ADR", loaded["decisions"][0]["status"] == "accepted" and "status: accepted" in text)
        check("the ADR names the decider", "decided_by: tester" in text and "Use chess-clock-js" in text, text)
        check("nothing blocks after the decision", program.open_decisions(loaded) == set())
        try:
            program.decide(loaded, 1, "again")
            check("a decision is made once", False)
        except SystemExit:
            check("a decision is made once", True)

        program.change(loaded, "Add spectators\n\nAnyone can watch a room without sitting down.")
        loaded = program.load(created["id"])
        check("a change request reopens research", loaded["stage"] == "research")
        check("the change request is a file with a status",
              loaded["changes"][0]["status"] == "open" and (folder / loaded["changes"][0]["file"]).read_text().startswith("---\nstatus: open"))
        check("the change title is the first line", loaded["changes"][0]["title"] == "Add spectators")
        check("the change is in the consent log", any(e["event"] == "change 1 requested" for e in loaded["log"]))
        check("the change is published", (docs / loaded["changes"][0]["file"]).exists())
        try:
            program.change(loaded, "another")
            check("no change request while research runs", False)
        except SystemExit:
            check("no change request while research runs", True)

        reworded = program.parse_tickets(PARALLEL.replace("Which clock library do we use?", "Do we need a clock at all?"))
        probe = dict(loaded, tickets=reworded, decisions=json.loads(json.dumps(loaded["decisions"])))
        probe["decisions"][0]["status"] = "proposed"
        program.sync_decisions(probe)
        check("a reworded question withdraws the old proposed decision and opens a new one",
              [d["status"] for d in probe["decisions"]] == ["withdrawn", "proposed"], str(probe["decisions"]))
        check("a withdrawn decision no longer blocks", program.open_decisions(probe) == {4})

        program.set_change_status(loaded, "open", "planned")
        check("change status moves with planning",
              loaded["changes"][0]["status"] == "planned" and "status: planned" in (folder / loaded["changes"][0]["file"]).read_text())

        for ticket, issue in zip(loaded["tickets"], (40, 41, 42, 43, 44)):
            ticket["issue"] = issue
        loaded["stage"] = "implementing"
        program.save(loaded)
        jobs = program.FACTORY / "jobs"
        for issue in (40, 41, 42, 43, 44):
            (jobs / f"00{issue - 39}-t").mkdir(parents=True)
            (jobs / f"00{issue - 39}-t" / "job.json").write_text(json.dumps({"issue": issue, "stage": "merged", "pr": issue + 100}))
        program.release(program.load(created["id"]))
        loaded = program.load(created["id"])
        release = folder / "release.md"
        check("every merged ticket drafts a release", loaded["stage"] == "release" and release.exists())
        check("the release note lists tickets and PRs", "| 2 | Create a room | #41 | #141 |" in release.read_text(), release.read_text())
        check("the release note carries the decision", "Use chess-clock-js" in release.read_text())
        program.accept_release(loaded)
        loaded = program.load(created["id"])
        check("accepting the release finishes the program",
              loaded["stage"] == "done" and "status: released" in release.read_text() and "released_by: tester" in release.read_text())
        index = (docs / "README.md").read_text()
        check("the index lists the release and the log", "release.md" in index and "release accepted" in index, index)


def test_implement():
    """The scheduling loop with the factory stubbed: label → run → merge → unlock → release."""
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        program.REPO = root
        program.FACTORY = root / "factory"
        program.PROGRAMS = program.FACTORY / "programs"
        jobs = program.FACTORY / "jobs"
        jobs.mkdir(parents=True)
        created = program.create("Rooms", "# Rooms\n")
        created["tickets"] = program.parse_tickets(PARALLEL)
        for ticket, issue in zip(created["tickets"], (60, 61, 62, 63, 64)):
            ticket["issue"] = issue
        program.sync_decisions(created)
        created["stage"] = "implementing"
        program.save(created)

        labeled = []
        synced = []
        outcome = {"stage": "needs-human"}

        def fake_run(issues=()):
            # Every labeled issue gets a job that parks at `outcome`, like run would.
            for issue in labeled:
                folder = jobs / f"{issue:03d}-t"
                if not (folder / "job.json").exists():
                    folder.mkdir(exist_ok=True)
                    (folder / "job.json").write_text(json.dumps({"issue": issue, "stage": outcome["stage"], "pr": issue + 100}))
            return 0

        def fake_sync():
            synced.append(True)
            for path in jobs.glob("*/job.json"):
                job = json.loads(path.read_text())
                if job["issue"] in merged_on_github:
                    job["stage"] = "merged"
                    path.write_text(json.dumps(job))

        merged_on_github = set()
        program.label_queue = lambda issue: labeled.append(issue)
        program.run_factory = fake_run
        program.sync_jobs = fake_sync

        program.implement(program.load(created["id"]))
        loaded = program.load(created["id"])
        check("only the contract is labeled first", labeled == [60], str(labeled))
        check("the program waits on the parked job", "your call on #60" in (loaded["waiting"] or ""), loaded["waiting"])
        check("job state is synced before scheduling", bool(synced))

        merged_on_github.add(60)  # the person merged PR #160 on the board
        program.implement(program.load(created["id"]))
        loaded = program.load(created["id"])
        check("a merge seen through job queue unlocks the dependents", set(labeled[1:]) == {61, 62}, str(labeled))
        check("the undecided ticket stays back", 63 not in labeled)
        check("the log records what started", any(e["event"] == "tickets started" for e in loaded["log"]))

        program.decide(loaded, 1, "Use chess-clock-js.")
        merged_on_github.update({61, 62})
        program.implement(program.load(created["id"]))
        check("the decided ticket and the unblocked spike start together", set(labeled[3:]) == {63, 64}, str(labeled))
        merged_on_github.update({63, 64})
        program.implement(program.load(created["id"]))
        loaded = program.load(created["id"])
        check("everything merged drafts the release", loaded["stage"] == "release")

        # A rejected ticket parks the program instead of pretending it shipped.
        rejected = program.create("Rejected", "# R\n")
        rejected["tickets"] = program.parse_tickets("## 1. A\nDepends: none\n\n## 2. B\nDepends: 1\n")
        rejected["tickets"][0]["issue"], rejected["tickets"][1]["issue"] = 70, 71
        rejected["stage"] = "implementing"
        program.save(rejected)
        (jobs / "070-t").mkdir()
        (jobs / "070-t" / "job.json").write_text(json.dumps({"issue": 70, "stage": "rejected", "pr": None}))
        before = list(labeled)
        program.implement(program.load(rejected["id"]))
        loaded = program.load(rejected["id"])
        check("a rejected ticket starts nothing", labeled == before)
        check("the reason names the rejection", "rejected" in (loaded["waiting"] or ""), loaded["waiting"])
        check("no release is drafted around a rejection", loaded["stage"] == "implementing")


def main():
    test_parse()
    test_next_ready()
    test_parallel()
    test_merge_tickets()
    test_files()
    test_implement()
    print(f"\n{len(PASS)} passed, {len(FAIL)} failed")
    raise SystemExit(1 if FAIL else 0)


if __name__ == "__main__":
    main()
