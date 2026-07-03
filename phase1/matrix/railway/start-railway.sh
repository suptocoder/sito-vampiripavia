#!/bin/sh
set -e

# No-volume deployments (Railway Trial): /data is baked into the image, but recreate it
# defensively; with a mounted volume this is a no-op.
mkdir -p /data

# First boot on fresh storage: generate homeserver.yaml, then append the demo
# overrides. YAML keeps the LAST occurrence of a duplicate key, so appending wins.
if [ ! -f /data/homeserver.yaml ]; then
  /start.py generate

  {
    printf '\n# --- vampiripavia demo overrides ---\n'
    printf 'enable_registration: false\n'
    if [ -n "$SYNAPSE_REGISTRATION_SHARED_SECRET" ]; then
      printf 'registration_shared_secret: "%s"\n' "$SYNAPSE_REGISTRATION_SHARED_SECRET"
    fi
    # Provisioning registers 4 users and creates/joins 65 rooms in one burst,
    # and the whole test group logs in from the same office IP.
    printf 'rc_login:\n  address: {per_second: 100, burst_count: 100}\n  account: {per_second: 100, burst_count: 100}\n'
    printf 'rc_registration: {per_second: 100, burst_count: 100}\n'
    printf 'rc_joins:\n  local: {per_second: 100, burst_count: 100}\n'
    printf 'rc_message: {per_second: 50, burst_count: 100}\n'
    # Dedicated room-creation limiter (default 0.016/s, burst 10): provisioning creates
    # 65 rooms in one burst and would stall at ~10 with 429 (rc_room_creation) otherwise.
    printf 'rc_room_creation: {per_second: 100, burst_count: 100}\n'
  } >> /data/homeserver.yaml
fi

exec /start.py
