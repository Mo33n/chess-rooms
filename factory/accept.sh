#!/usr/bin/env bash
# Hidden acceptance checks. The gate runs this file from the main checkout
# with the job worktree as the working directory. A branch cannot replace it.
# The gate also runs factory/bin/contract (shipped tests plus the page smoke)
# even when a project replaces this stub.
set -euo pipefail
node --test test/hidden/product.test.js
