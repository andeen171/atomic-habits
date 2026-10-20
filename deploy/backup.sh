#!/usr/bin/env bash
# Nightly backup of Atomic Cloud, on the host (README.md, "Backups"):
#
#   ./backup.sh
#   # cron: 17 3 * * * /opt/atomic/deploy/backup.sh >> /var/log/atomic-backup.log 2>&1
#
# 1. A consistent database snapshot, taken inside the running server
#    (scripts/backup.ts: VACUUM INTO, then an integrity check of the copy).
# 2. The photos, when they live on the volume (BLOB_STORAGE=disk). Photos in
#    R2 stay in R2 (11 nines of durability; only GC and account deletion
#    remove them).
#
# Both land in deploy/backups/, newest BACKUP_KEEP of each kept (default 7).
# A backup on the same disk doesn't survive the disk: set BACKUP_COPY_TO to
# an rclone destination (e.g. "b2:atomic-offsite") to mirror the folder off
# the machine after each run (rclone installed and configured on the host).
# The mirror is exact (`rclone sync`): snapshots pruned here are deleted
# there too, so a deleted account leaves the off-site copies within
# BACKUP_KEEP days as well (README.md, "Backups and erasure"). Don't turn on
# object versioning at the destination without a lifecycle rule that
# expires old versions in the same window.
# Litestream (profile `backup`) is the continuous copy; this one is for
# upgrades, mistakes and the restore drill.
set -euo pipefail
cd "$(dirname "$0")"

# The value of a variable in .env (last one wins, surrounding quotes removed).
env_value() {
	local line
	line=$(grep -E "^$1=" .env 2>/dev/null | tail -n 1 || true)
	line=${line#*=}
	line=${line%\"}
	line=${line#\"}
	printf '%s' "$line"
}

keep=${BACKUP_KEEP:-$(env_value BACKUP_KEEP)}
keep=${keep:-7}
copy_to=${BACKUP_COPY_TO:-$(env_value BACKUP_COPY_TO)}
storage=$(env_value BLOB_STORAGE)
storage=${storage:-disk}
stamp=$(date -u +%Y-%m-%dT%H-%M-%SZ)
mkdir -p backups

echo "[$stamp] database snapshot"
inside=$(docker compose exec -T server bun run scripts/backup.ts /data/backups --keep 1 | tail -n 1)
case "$inside" in
/data/backups/atomic-*.db) ;;
*)
	echo "backup.sh: unexpected snapshot path: '$inside'" >&2
	exit 1
	;;
esac
docker compose cp "server:$inside" "backups/$(basename "$inside")"
docker compose exec -T server rm -f "$inside"
echo "  backups/$(basename "$inside")"

if [ "$storage" = disk ]; then
	echo "[$stamp] photos (BLOB_STORAGE=disk)"
	docker compose exec -T server sh -c 'mkdir -p /data/blobs && tar -C /data -czf - blobs' \
		>"backups/blobs-$stamp.tar.gz.partial"
	mv "backups/blobs-$stamp.tar.gz.partial" "backups/blobs-$stamp.tar.gz"
	echo "  backups/blobs-$stamp.tar.gz"
fi

# Keep the newest $keep files whose names match $1.
prune() {
	local files=() name excess i
	while IFS= read -r name; do files+=("$name"); done < <(ls -1 backups | grep -E "$1" | sort)
	excess=$((${#files[@]} - keep))
	for ((i = 0; i < excess; i++)); do rm -f "backups/${files[$i]}"; done
}
prune '^atomic-.*\.db$'
prune '^blobs-.*\.tar\.gz$'

if [ -n "$copy_to" ]; then
	# Never mirror an empty folder: that would wipe the off-site copies.
	if ! compgen -G 'backups/atomic-*.db' >/dev/null; then
		echo "backup.sh: no snapshot in backups/, not mirroring to $copy_to" >&2
		exit 1
	fi
	echo "[$stamp] mirroring backups/ to $copy_to"
	rclone sync backups "$copy_to"
fi
echo "[$stamp] done"
