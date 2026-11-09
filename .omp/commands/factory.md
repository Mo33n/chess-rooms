---
description: Drive this repo's software factory from the omp session. The board at factory/bin/board is the primary surface; this command is the terminal mirror.
argument-hint: "board | run [issue] | status | programs | change <program> <text> | decide <program> <n> <text> | feedback <issue> <text> | answer <issue> <text> | reject <issue> <text>"
---

The factory for this repository is the Python orchestrator in `factory/`. You are only the control surface inside this omp session. Do not write product code, do not start your own `omp -p` workers, and do not deploy.

The argument line is:

$ARGUMENTS

Take the first word as the subcommand and the rest as its arguments. Run the matching command from the repository root with the bash tool, then show the command output in this chat.

- No arguments, or `help`: run `python3 factory/bin/run status` and `python3 factory/bin/program status`, then list the subcommands below.
- `board`: run `python3 factory/bin/board` in the background and tell the user to open http://127.0.0.1:8000/ . That page takes a PRD through research, an approved enriched PRD, an approved ticket list, parallel builds, decisions, change requests, review, merge, and the release note.
- `programs`: run `python3 factory/bin/program status`.
- `new <title>` with the PRD in the next message: pipe the PRD to `python3 factory/bin/program new "<title>"`, then run `python3 factory/bin/program step <id>` in the background.
- `step <program>`: run `python3 factory/bin/program step <program>` in the background. It researches, plans, starts every ready ticket, or drafts the release, depending on the stage.
- `approve-prd <program>`, `approve-tickets <program>`, `accept-release <program>`: run the matching `python3 factory/bin/program <command> <program>`, then `step` in the background.
- `change <program> <text>`: pipe `<text>` to `python3 factory/bin/program change <program>`, then `step` in the background. Research reruns and the planner diffs the ticket list for approval.
- `decide <program> <n> <text>`: pipe `<text>` to `python3 factory/bin/program decide <program> <n>`, then `step` in the background.
- `run`: run `python3 factory/bin/run` in the background. It drains every open issue labeled `factory`.
- `run <issue>`: run `python3 factory/bin/run <issue>` in the background.
- `status`: run `python3 factory/bin/run status` and `python3 factory/bin/job summary`.
- `feedback <issue> <text>`: pipe `<text>` to `python3 factory/bin/run feedback <issue>`.
- `answer <issue> <text>`: pipe `<text>` to `python3 factory/bin/run answer <issue>`.
- `reject <issue> <text>`: pipe `<text>` to `python3 factory/bin/run reject <issue>`.

If a `run` or `step` is already in progress for the same target, do not start another. Report status instead.

Long commands block because each role is a separate omp process. Start them in the background and tell the user to use `/factory status` for later checks. When a job stops at `needs-human`, the person merges the pull request on the board or GitHub, or sends `/factory feedback`. Every acceptance is recorded in the program's consent log under the `docs_dir` from `factory/config.json`.
