# AGENTS.md

Instructions for AI coding assistants working in this repository. Human contributors should start
with [README.md](./README.md) or [README.en.md](./README.en.md).

## Repository scope

This is a **custom flight area drawing demo** for the SuperDock M400 automated dock by StrawBerry
Innovation. It produces `geofence_{md5}.json` files compatible with the DJI Cloud API custom flight
area format.

Keep it a small reference implementation: drawing, validation, import and export only. Do not add
accounts, a backend, databases, object storage, MQTT, or device synchronization unless the user
explicitly expands the scope.

## Environment and checks

- Use Node.js 20, matching `.github/workflows/deploy.yml`.
- Install the locked dependency set with `npm ci`.
- Run locally with `npm run dev` or expose it on a LAN with `npm run dev:host`.
- After code changes, run `npm test` and `npm run build`. The build includes `tsc --noEmit`; both
  commands must pass before finishing.
- Add or update Vitest coverage when changing geometry, validation, parsing, serialization, hashing,
  or other observable behavior.

## Integrating it into another system

Copy only the layers the target project needs; do not vendor the whole repository:

| Goal | Files to copy | Runtime dependencies |
| --- | --- | --- |
| Build or parse flight-area files | `src/types.ts`, `src/geometry.ts`, `src/validation.ts`, `src/geofenceFile.ts`, `src/hash.ts` | No third-party packages; modern TypeScript/ES2022 with `TextEncoder` |
| Add map drawing | The files above plus `src/draw.ts`, `src/render.ts`, `src/viewer.ts` | Cesium |
| Reuse the example UI | The files above plus `src/main.ts`, `index.html`, `src/style.css` | Browser DOM and Cesium |

The five core files in the first row import neither Cesium nor the DOM. A consuming project may
still need to adapt module paths or compiler settings to its own TypeScript and module-resolution
rules. React and Vue applications will normally replace the plain-DOM UI rather than copy it.

## Protocol invariants

Preserve these rules when generating a file:

- Encode the final file as UTF-8 JSON without a BOM or comments. Compute every digest from those
  exact final bytes.
- Name it `geofence_{md5}.json`, where `md5` is the lowercase MD5 digest of the file bytes.
- The DJI Cloud API `files[].checksum` value is the SHA256 digest of the same bytes. It is not the
  MD5 used in the filename. `files[].size` is the byte length, not the character count.
- Emit only fields defined by the protocol. Keep application-only metadata such as area names in
  the integrating system, keyed by the stable feature `id`.
- Coordinates are WGS84 `[longitude, latitude]`. Convert GCJ-02 or BD-09 input before validation and
  serialization; this repository does not implement coordinate-system conversion.
- A circle uses `geometry.type = "Point"`, `properties.subType = "Circle"`, and a radius of at least
  10 metres.
- A polygon uses `geometry.type = "Polygon"`, `properties.radius = 0`, and one closed outer ring.
  It needs at least three distinct vertices and may contain at most 255 points including the closing
  point.
- Export `properties.enable = true`. The protocol template says disabling is not supported by the
  current version.

Serialization and digest rules live in `src/geofenceFile.ts::buildGeofenceFile`. Geometry rules live
in `src/validation.ts::validateFlightAreaGeometry`. Coordinate conversion is always the caller's
responsibility.

## Canonical output used by this demo

These are project choices for reproducible output, not additional DJI protocol fields:

- Sort features by `id` before serialization.
- Use compact `JSON.stringify` output with stable field insertion order.
- Do not add timestamps, display names, comments, indentation, or custom fields to exported files.

Together these choices make the same set of areas produce identical bytes and digests, avoiding a
new file identity for a semantically unchanged set.

## Validation boundary

- `validateFlightAreaGeometry` is the authoritative semantic validator. New create, edit, paste,
  import, or API-fetch paths must call it before accepting an area so users get an immediate error.
- `buildGeofenceFile` performs the same validation again as the final export guard. Do not remove
  that check merely because the current drawing UI already validates.
- `parseGeofenceFile` may retain supported geometry while returning warnings. Parsing successfully
  does not by itself mean that every imported area is safe to export.
- Keep protocol limits in `src/validation.ts`; do not duplicate numeric thresholds in UI code.
- If a validation threshold changes, update the Constraints sections of both READMEs and the tests
  in the same change.

## Code conventions

- Keep TypeScript strict and the UI framework-free.
- Do not add dependencies for small utilities.
- Keep geometry and file-format code independent of Cesium and the DOM.
- Comments should explain why a constraint or workaround exists, not restate the code.
- Use the pure-JavaScript digest and UUID helpers in `src/hash.ts`. Do not switch to
  `crypto.subtle`: it is unavailable on plain-HTTP LAN origins and does not provide MD5.
- Preserve unrelated user changes. Do not commit generated `dist/` output.

## Security and public-repository hygiene

- Never commit `.env.local`, Cesium ion tokens, credentials, private URLs, device serial numbers, or
  captured production flight-area files.
- Use `.env.example` for public configuration examples and a GitHub repository secret for the
  optional Cesium ion token used by the Pages build.
- Treat imported JSON as untrusted input. Keep structural checks, coordinate bounds, point limits,
  and HTML escaping intact.

## Known traps

- The official DJI template contains `//` comments for explanation and is not valid JSON. Strip the
  comments before importing it as data.
- Do not add an area name to the exported feature. Dock firmware behavior for undocumented fields is
  unverified; store names outside the file.
- Changing the imagery provider is localized in `src/viewer.ts`, but the replacement imagery must be
  WGS84-aligned or the drawn coordinates must be converted before export.
- This demo intentionally does not support holes, multipolygons, no-landing zones, height ranges, or
  `features_extend`. Do not imply that ignored imported data will survive a re-export.
