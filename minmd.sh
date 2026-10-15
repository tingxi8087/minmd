#!/bin/sh
set -eu
MINMD_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec sh "$MINMD_ROOT/deploy/scripts/manage.sh" "$@"
