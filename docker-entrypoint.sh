#!/bin/sh
set -e

# Runs once as root, before dropping to the unprivileged "node" user below.
# A deployment that predates the container running as non-root will have
# /data (app.db, .encryption.key) already owned by root from before — chown
# it on every start so a redeploy never breaks on a stale root-owned volume,
# rather than requiring a one-time manual fix on the VPS.
mkdir -p /data
chown -R node:node /data

exec gosu node "$@"
