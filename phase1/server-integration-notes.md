# Server Integration Notes

Historical planning notes were replaced by the implemented Phase 1 path.

Implemented behavior:

- The sidecar serves `overlay.html` and the RPG API.
- `setup-matrix.mjs` provisions real local Matrix users and rooms.
- `matrix-events.mjs` polls real Matrix `/sync` events.
- Public `m.room.message` events from an obfuscated character break Obfuscate.
- The old HTTP public-message hook is not present.
- Staff notifications are stored as staff event-log entries.

Current runbook:

- [README.md](README.md)
- [REAL-INTEGRATION.md](REAL-INTEGRATION.md)
- [matrix/README.md](matrix/README.md)
- [element-widget.md](element-widget.md)
- [VALIDATION-REPORT.md](VALIDATION-REPORT.md)
