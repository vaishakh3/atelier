# Atelier BIM — desktop implementation notes

This delivery targets a standalone macOS Apple Silicon application built with Electron and an embedded Express service. It implements an initial modelling → reviewed AI change → quantity/estimate → construction schedule → scenario comparison workflow from the PRD, with bounded geometry and IFC support. It is a local pilot prototype; the full production PRD remains incomplete.

## Included

- Native basic BIM authoring and coordinated model views.
- IFC4/IFC2X3 subset import, IFC4 export and import fidelity reports.
- Server-side OpenAI copilot proposals with validation, approval and reversible changes.
- Deterministic quantities, explicit rates/allowances and preliminary cost calculations.
- Editable construction activities, working calendars, resource constraints and scenario comparisons.
- Local project persistence, immutable review snapshots, version comments and report exports.

## Desktop delivery and run

- Application target: `Atelier.app`, version 0.1.0, and `Atelier-macOS-arm64.zip` in this directory. Source delivery: `Atelier-source.zip`.
- Platform: macOS arm64 / Apple Silicon. The build uses a local ad hoc signature; it has no Developer ID signature or notarization. Windows, Intel macOS and Linux builds have not been validated.
- Open the packaged app through Finder. The app owns its local backend process and does not require a separately opened browser or server.
- Desktop project records, immutable review snapshots and comments belong in `~/Library/Application Support/Atelier/projects`.
- Native menu/dialog, save/quit/reopen, IFC import and JSON/PDF/XLSX export checks passed in the packaged application; details are recorded below.

The renderer bridge includes Import IFC or Project (`⌘O`), Save (`⌘S`), Save Project Copy (`⇧⌘S`), IFC/PDF/XLSX exports, undo/redo, settings and help. Closing the application waits for the queued project save; a fresh desktop origin selects the newest saved project when no same-origin recovery cache is available. The native test session confirmed that a saved edit survived quit and relaunch on a different ephemeral service port.

For development and packaging from the source workspace:

```sh
npm install
npm run desktop:dev
npm run desktop:build
```

Run automated checks with `npm test` and `npm run typecheck`. Browser development remains available using `npm run dev` and [the local development UI](http://127.0.0.1:5173); its `server/data/` project store is separate from desktop application data.

The desktop source script downloads the Electron runtime from the official endpoint, with a fixed mirror fallback, and requires a matching SHA-256 from the installed Electron package before extraction/packaging. A mismatched archive is rejected, including one from the fallback mirror. The checksum-verified Electron 45 runtime enabled the confirmed development smoke test below.

The API credential belongs only in the workspace's ignored `.env.local`, accessed server-side through `desktop-config.json`'s `envPath`. This build points to `<source-workspace>/.env.local`; the configuration stores the path only and has no environment-variable override. **Neither the credential nor its file may be packaged into the application, archive or renderer.** Rebuild from the new source location if the workspace moves. Provider account access and quota are required for live AI proposals; deterministic modelling/planning works independently of an AI request.

## Desktop architecture

Electron hosts the application window and native menus/dialogs. Its main process creates an embedded Express application on an ephemeral `127.0.0.1` port and injects a process-local desktop capability into requests to that origin. The renderer receives neither the OpenAI API key nor that desktop capability. Project writes pass shared schema and local session/role checks; accepted AI changes use explicit, reversible transactions. Provider requests run only in the backend.

## Boundaries

- This is not the full production PRD release or engineering/compliance approval software.
- Geometry uses metres internally; display feet does not change measurement values. Sample rates and planning assumptions require confirmation.
- IFC editing is limited to horizontal rectangular extrusions and regular straight stairs. Unsupported data is reported as read-only bounding proxies or excluded; lost source geometry is not recovered on export.
- Cost and schedule outputs describe entered scope and are preliminary. Model-linked quantities and assembly productivities update duration after supported design/type revisions; manual overrides remain explicit. Additional crews enable concurrency rather than automatic per-task acceleration.
- Local role modes are simulations for a trusted computer. The application has no enterprise identity, cloud sharing, TLS or application-level encryption at rest.
- The desktop service uses an ephemeral loopback port and a process-local capability header injected by Electron; normal browser requests without that capability are rejected, including requests for assets, health and session bootstrap.
- Technical checks do not replace an architect/estimator/planner review, independent IFC corpus testing or the PRD's design-partner pilot gates.

## Verification

The application package, automated packaged launch and native GUI workflow are verified on the current Apple Silicon computer. Results are local pilot evidence rather than a claim of cross-platform compatibility or professional BIM acceptance.

Latest confirmed automated results from the integration run:

| Check | Confirmed result |
|---|---|
| Unit/integration suites | 101 tests passed across 8 test files |
| TypeScript checks | Passed |
| Development Electron smoke | Passed: UI root rendered, desktop bridge present, renderer Node unavailable and embedded backend healthy |
| Desktop isolation | Context isolation and sandbox configured; ordinary outside HTTP requests received 403 |
| Packaged app build/launch | `Atelier.app` built; packaged smoke passed with `packaged: true` |
| Local code signature | `codesign --verify --deep --strict` passed; local ad hoc signature only |
| Native settings | `⌘,` opened desktop settings with version 0.1.0 and the expected project data path |
| Save, quit and reopen | `⌘S` persisted an edited project; `⌘Q` exited cleanly; relaunch on a new ephemeral port restored the saved name and version |
| Native JSON copy | `⇧⌘S` saved a schema-valid project copy with 43 elements |
| Native IFC import and undo | `⌘O` imported the 43-element fixture as editable, with 0 reference-only and 0 excluded objects; `⌘Z` reversed the import |
| Native PDF export | A 12-page PDF was saved and parsed; project name, version and schedule content were checked |
| Native XLSX export | Saved file parsed successfully: Project, Quantities, Estimate, Schedule and Assumptions sheets; 44 quantity rows and 11 schedule rows including headers; project version 14 |
| Packaged application content | ASAR extracted and scanned: configured credential absent; private project records absent; external credential-path pointer present as intended |
| Application ZIP archive | `Atelier-macOS-arm64.zip` created, extracted with `ditto`, and extracted app passed strict/deep code-signature verification; framework symlinks preserved |
| Live OpenAI request | `gpt-4.1-mini` returned a 10-window replacement preview with a ₹61,500 cost delta and 0-day schedule delta; navigating away left model version and baseline types unchanged |

The suites cover model geometry, AI transaction boundaries, deterministic planning engines, IFC exchange, local API behaviour and desktop startup/recovery logic. Separate packaged smoke and native GUI checks verify the desktop bridge and application workflows. Provider account/quota errors must be reported as such; a mock or configured key is not a successful live provider test.

The final native session displayed a 57-calendar-day / 49-working-day baseline finishing December 28, 2026 and a rounded known-cost subtotal of ₹3,170,492. The saved project retained all 43 elements and all 10 original window types after the AI preview. These are demonstration outputs from illustrative inputs, not validated construction rates or durations.

A native screenshot is included as `Atelier-desktop.png` in this directory.

## Remaining production PRD gaps

Professional acceptance still requires independent quantity/estimate tolerances, architect/estimator/planner review, representative real-world IFC files, agreed model-size/performance targets and the design-partner pilot. Production also requires mature authoring/documentation, real user identity and project access controls, encryption/key management, backup/recovery operations, monitoring and privacy controls. Local role modes, review snapshots and comments support this computer's evaluation workflow; they do not provide secure multi-user or remote collaboration.
