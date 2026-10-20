#!/usr/bin/env bash
# Restore Atomic Cloud's database, and the photos when they live on the
# volume (README.md, "Restore" and "Restore drill"):
#
#   ./restore.sh litestream                        # latest state in R2
#   ./restore.sh litestream 2026-10-20T03:00:00Z   # a point in time (UTC, last 7 days)
#   ./restore.sh snapshot backups/atomic-2026-10-20T03-17-00Z.db [backups/blobs-….tar.gz]
#
# Steps: stop the server and Litestream; keep the current database (and
# photos, when restoring them) as *.before-<time> on the volume; restore;
# run scripts/restore-check.ts --fix with the server still stopped; start
# everything again and wait until /healthz is healthy. Nothing is deleted:
# the *.before-* copies stay until you remove them.
set -euo pipefail
cd "$(dirname "$0")"

usage() {
	sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'
	exit 2
}

mode=${1:-}
[ -n "$mode" ] || usage
shift
stamp=$(date -u +%Y-%m-%dT%H-%M-%SZ)
point=""
snapshot=""
blobs=""
case "$mode" in
litestream)
	point=${1:-}
	;;
snapshot)
	snapshot=${1:-}
	blobs=${2:-}
	[ -n "$snapshot" ] && [ -f "$snapshot" ] || usage
	[ -z "$blobs" ] || [ -f "$blobs" ] || usage
	snapshot=$(realpath "$snapshot")
	[ -z "$blobs" ] || blobs=$(realpath "$blobs")
	;;
*) usage ;;
esac

# Runs a shell command in a one-off server container (same image, volume and
# .env; no ports, no dependencies).
in_server() {
	docker compose run --rm --no-deps -T "$@"
}

echo "[$stamp] stopping the server and Litestream"
docker compose --profile backup stop litestream server

echo "[$stamp] keeping the current database as /data/atomic.db.before-$stamp"
in_server --entrypoint sh server -c "
	set -e
	cd /data
	for suffix in '' -wal -shm; do
		if [ -e atomic.db\$suffix ]; then mv atomic.db\$suffix atomic.db.before-$stamp\$suffix; fi
	done
	if [ -d .atomic.db-litestream ]; then mv .atomic.db-litestream .atomic.db-litestream.before-$stamp; fi
"

if [ "$mode" = litestream ]; then
	echo "[$stamp] restoring from the Litestream replica${point:+ at $point}"
	args=(restore -integrity-check full -o /data/atomic.db)
	[ -z "$point" ] || args+=(-timestamp "$point")
	docker compose --profile backup run --rm --no-deps -T litestream "${args[@]}" /data/atomic.db
else
	echo "[$stamp] restoring $(basename "$snapshot")"
	in_server -v "$snapshot:/restore/atomic.db:ro" --entrypoint sh server -c \
		'cp /restore/atomic.db /data/atomic.db'
	if [ -n "$blobs" ]; then
		echo "[$stamp] restoring photos from $(basename "$blobs") (current ones kept as /data/blobs.before-$stamp)"
		in_server -v "$blobs:/restore/blobs.tar.gz:ro" --entrypoint sh server -c "
			set -e
			cd /data
			if [ -d blobs ]; then mv blobs blobs.before-$stamp; fi
			tar -xzf /restore/blobs.tar.gz -C /data
		"
	fi
fi

echo "[$stamp] checking the restored database (server still stopped)"
if ! in_server server bun run scripts/restore-check.ts --fix; then
	echo "restore.sh: the check found problems it could not fix; the server stays stopped." >&2
	echo "The previous database is /data/atomic.db.before-$stamp on the volume." >&2
	exit 1
fi

echo "[$stamp] starting"
docker compose up -d
for _ in $(seq 1 60); do
	status=$(docker inspect -f '{{.State.Health.Status}}' "$(docker compose ps -q server)" 2>/dev/null || true)
	if [ "$status" = healthy ]; then
		echo "[$stamp] server healthy. Record the drill in README.md's log if this was one."
		exit 0
	fi
	sleep 2
done
echo "restore.sh: the server is not healthy after 2 minutes: docker compose logs server" >&2
exit 1
