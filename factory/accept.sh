#!/usr/bin/env bash
# Product contract. The gate runs the main checkout's copy of this script and
# of test/hidden/ inside the job worktree, so a job cannot edit the contract.
set -euo pipefail
node --test test/hidden/product.test.js
