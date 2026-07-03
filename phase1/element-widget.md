# Element Widget Integration

Phase 1 runs as a local Element Web custom widget iframe. The widget is a sidecar only: Element owns Matrix chat, membership, auth, and room state.

## URL

Start the sidecar:

```powershell
$env:MATRIX_BASE_URL='http://localhost:8008'
node .\phase1\server.mjs
```

Use this widget URL:

```text
http://localhost:8787/overlay.html?matrix_user_id=$matrix_user_id&room_id=elysium
```

If the local Element build does not expand variables, use literal user IDs while validating:

```text
http://localhost:8787/overlay.html?matrix_user_id=@a:local&room_id=elysium
```

## Parameters

- `matrix_user_id`: required for local widget identity. The overlay sends it to the API as `x-matrix-user-id`.
- `room_id`: overlay room id, such as `elysium` or `strada`.
- `as`: legacy local fallback for `matrix_user_id`; prefer `matrix_user_id`.

Real Matrix room IDs are written to `phase1/data.json` by `setup-matrix.mjs`. The widget should still receive the overlay room id because Phase 1 preserves the legacy RPG room model.

## Manual Element Setup

1. Open Element at `http://localhost:8080`.
2. Log in as one of the provisioned users, for example `@a:local`.
3. Join the provisioned Matrix room, for example `#elysium:local`.
4. Add a custom widget/iframe using the URL above. If the local Element build hides custom widget controls, keep the overlay open in a side-by-side browser panel with the same URL.
5. Repeat in separate browser profiles/sessions for `@b:local`, `@c:local`, and `@staff:local`.

## Caveats

- Matrix-native room membership remains visible in Element. Obfuscate affects only the RPG overlay roster.
- Local identity is trusted by `matrix_user_id`; production must validate Matrix tokens.
- Local `localhost` widget URLs work only for browsers that can reach this machine.
