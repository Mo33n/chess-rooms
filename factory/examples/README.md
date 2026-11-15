# Job files the dashboard expects

Copy a finished `factory/jobs/<id>/` here only if you want the dashboard to
show a recorded run. A live job is created by `factory/bin/job create` and
looks like:

```
factory/jobs/001-short-title/
  job.json
  issue.md          quoted GitHub data, not a prompt
  intake.md
  spec.md
  build.md
  decision.md
  round-1/checks.md
  round-1/review-code.md
  sessions/builder/   omp jsonl (usage + resume)
  logs/builder-r1.log
```

Do not commit `factory/jobs/`; it is gitignored runtime state.
