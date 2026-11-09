#!/usr/bin/env bash
# The repo's checks. The gate runs this from the main checkout with the job's
# worktree as the working directory. No dependencies to install.
set -euo pipefail
node --check src/server.js
node --test test/starter.test.js
