# Local Matrix Stack

Synapse and Element Web for the Phase 1 local integration.

## First Run

Generate Synapse config once:

```powershell
cd .\phase1\matrix
docker compose run --rm synapse generate
```

Start Synapse and Element:

```powershell
docker compose up -d
```

Open:

- Synapse: `http://localhost:8008`
- Element: `http://localhost:8080`

## Provision Users And Rooms

Run from the repo root after Synapse is healthy. Use the generated registration secret from `synapse-data/homeserver.yaml`; do not paste it into reports or commits.

```powershell
$secretLine = Select-String -Path .\phase1\matrix\synapse-data\homeserver.yaml -Pattern '^registration_shared_secret:' | Select-Object -First 1
$secret = ($secretLine.Line -replace '^registration_shared_secret:\s*','').Trim().Trim('"')
$env:SYNAPSE_REGISTRATION_SHARED_SECRET=$secret
$env:MATRIX_PASSWORD='vp-demo-password'
node .\phase1\setup-matrix.mjs
```

Provisioning creates or logs into:

- `@a:local`
- `@b:local`
- `@c:local`
- `@staff:local`

It creates or resolves the seeded rooms, joins all four users, and writes the real Matrix IDs/tokens to `phase1/data.json`.

## Sidecar

From the repo root:

```powershell
$env:MATRIX_BASE_URL='http://localhost:8008'
$env:MATRIX_SYNC_POLL_MS='500'
node .\phase1\server.mjs
```

The sidecar serves the overlay at `http://localhost:8787/overlay.html` and reports sync watcher state at `http://localhost:8787/matrix/status`.

## Reset

This deletes local Synapse state, users, rooms, and keys:

```powershell
docker compose down
Remove-Item -Recurse -Force .\synapse-data
```
