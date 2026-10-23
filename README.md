# Atelier BIM — desktop pilot

Atelier is a standalone architectural BIM prototype built from `AI_BIM_MVP_PRD.docx`, delivered as a macOS desktop application through Electron with an embedded local service. It connects a bounded building model to reviewable AI revisions, deterministic quantities, preliminary estimates, construction activities and cost–time comparisons.

This is an executable vertical slice for technical evaluation. It is **not the complete production release described in the PRD**, a general CAD kernel, certified IFC implementation, engineering analysis tool or compliance sign-off system.

## Open the desktop application

The delivery target is **Atelier 0.1.0 for macOS Apple Silicon (arm64)**, a local pilot without a Developer ID signature or notarization. Packaging applies a local ad hoc signature. Deliverables are `outputs/Atelier.app`, `outputs/Atelier-macOS-arm64.zip` and the source archive `outputs/Atelier-source.zip`. Windows, Intel macOS and Linux packaging are not validated targets for this delivery.

Open `Atelier.app` from Finder. The desktop application starts its embedded service itself; a separate browser, Node.js installation or manually started server is not required to run a packaged build. macOS may request explicit user approval for an application without a Developer ID signature. Packaged launch, native menus/dialogs, save/reopen, IFC import, JSON/PDF/XLSX exports and a live AI preview have been checked. See `docs/BUILD_NOTES.md` for recorded verification and boundaries.

The desktop integration provides File/Edit menus with Import IFC or Project (`⌘O`), Save (`⌘S`), a portable JSON copy (`⇧⌘S`), IFC/PDF/XLSX exports and undo/redo, plus settings and help. Save/close handling flushes the pending persistence queue before the window exits. A tested edit survived application quit and relaunch on a new embedded service port.

Desktop projects, saved review versions and comments are stored under:

```text
~/Library/Application Support/Atelier/projects
```

The AI credential remains in this workspace's ignored `.env.local`, read server-side through `envPath` in the generated `desktop-config.json`. The generated path points to `.env.local` under the source workspace used for the build. **The key and `.env.local` must never be copied into the application bundle, archive or renderer.** The configuration records an absolute path, never the credential contents; no environment-variable override for this path is implemented. If the source workspace moves, rebuild from the new location to refresh the pointer. The packaged application does not create or embed a credential.

## Desktop development and packaging

Use Node.js 22 or newer and npm. From this workspace:

```sh
npm install
npm run desktop:dev
```

The desktop development command opens the Electron application. To build the local arm64 application and its archive:

```sh
npm test
npm run typecheck
npm run desktop:build
```

The macOS package build, automated packaged launch and native GUI workflow checks have passed. This is local pilot verification on one Apple Silicon computer; it does not establish compatibility or professional acceptance across other machines and projects.

The build script obtains the Electron runtime from the official release endpoint, with a fixed mirror fallback. Before extraction or packaging, it requires the archive's SHA-256 to match the checksum supplied by the installed Electron package. A mirror response is accepted only when its bytes match that exact trusted checksum; mismatches fail the build. Runtime downloads require network access.

Browser development remains available with `npm run dev`: open [the development workspace](http://127.0.0.1:5173). Vite serves the UI on port 5173 and proxies `/api` to the Express service on port 3001. `npm run build` followed by `npm start` serves the browser build and API on [port 3001](http://127.0.0.1:3001). Stop existing development processes before starting another service on that port. The browser launcher uses `server/data/` for its independent local project store.

The copilot uses a server-side `OPENAI_API_KEY` provisioned securely in the ignored `.env.local` file. Credentials are never sent to the browser. `OPENAI_MODEL` can override the default `gpt-4.1-mini`. The application can author models and run deterministic calculations without an AI connection; requesting a copilot proposal requires a configured API credential and an account with API access and available quota. Configuration status is not proof of successful provider authentication.

## Implemented workflow

- Start a blank project or explore a two-storey demonstration project; add levels and author rectangular walls, slabs, rooms, hosted doors/windows, flat roofs and regular straight stairs.
- Use linked plan, section, elevation and interactive 3D views. Select, inspect, move, duplicate and delete elements; use snapping, dimensions, project units and component types.
- Import/export the supported IFC subset below, or transfer a complete application project as validated JSON.
- Request bounded copilot operations: approved type replacement, allowlisted specification/property edits, missing-information analysis, revision explanation and crew-capacity evaluation. Review affected IDs and before/after values, accept or reject, and undo a committed transaction.
- Inspect source-linked quantities and explicit material, labour, equipment, waste, allowance and overhead calculations. Unknown cost inputs remain unpriced and affect completeness.
- Edit a preliminary activity network with working weekdays, dependencies, productivity, lead times and finite crews. Inspect dates, Gantt bars, feasibility issues and resource/dependency drivers.
- Compare bounded combinations of approved types, crew availability and procurement assumptions. Inspect budget/deadline violations and non-dominated alternatives; no globally optimal construction outcome is claimed.
- Publish immutable local review snapshots, attach version-specific comments, restore a snapshot as a new revision and inspect the action history.
- Export preliminary PDF, CSV, XLSX and machine-readable decision records. The documentation tools are a basic review workflow, not a production sheet/annotation authoring system.

The shared `src/domain/schema.ts` validates browser imports and API payloads. The model, quantity, cost and schedule engines calculate results; the language model cannot directly save or rewrite the canonical project. Project geometry is always stored in metres.

## IFC support matrix

| Input/output | Supported behaviour | Limitations |
|---|---|---|
| STEP schema | Import IFC4-family and IFC2X3; export IFC4 | Text STEP only; no IFCZIP, IFCXML or proprietary files |
| Classes | Walls/WallStandardCase, slabs, doors, windows, spaces, flat roofs, stairs/stair flights | Editable only when geometry fits the supported authoring representation |
| Placement | Nested `IfcLocalPlacement`, `IfcAxis2Placement3D`, profile placement and horizontal rotation | Grid/linear placements are unsupported; cycles are rejected |
| Solid geometry | One vertical `IfcExtrudedAreaSolid` with `IfcRectangleProfileDef`, horizontal rectangular footprint | Curved/arbitrary/hollow profiles and tilted authoring solids are not editable |
| Stairs | Regular straight stair flight composed of 4–32 rectangular vertical extrusions with equal treads and linearly increasing risers | Other staircase assemblies are not reconstructed as editable stairs |
| Reference fallback | Bounding proxies for supported BREP/surface/tessellated representations or explicit `IfcBoundingBox`; transformed rectangular extrusions may become bounding proxies | Proxies are read-only, exclude original surface detail, and are excluded from measured construction scope |
| Unsupported geometry | Explicitly excluded and reported when no safe bounding proxy is available | Mapped, boolean/CSG and arbitrary representation transforms are not reconstructed |
| Data | Product GlobalIds, application IDs/type IDs, primitive single-value properties and direct material associations | No complete IFC type/material-layer/quantity/property-template mapping; private application metadata uses `Pset_Atelier` |
| Openings | Export `IfcOpeningElement` with void/fill relationships; import supported host relationships | Only rectangular hosted openings; no arbitrary boolean cutting |
| Units | Canonical metres, SI length prefixes and simple conversion-based length factors | Missing unit declarations are reported with an assumed-metre warning; users must confirm external scale |
| Reporting | Per-class counts and editable/reference/excluded totals with warnings | Not a buildingSMART certification or independently validated real-world import corpus |

Round-trip tests cover authored data, stable external IDs, primitive properties, rotated origins, hosted opening links, stair geometry, display feet without geometry rescaling, an independent nested-placement IFC2X3 fixture, external millimetres, read-only tessellated proxies and malformed files. Exported door/window representations are simplified volumes; original source geometry that was reduced to a proxy cannot be recovered by exporting it again.

## Measurement and planning assumptions

- `x/y` identify the minimum local plan corner. Rotation is in degrees about that corner; `z` is the absolute base elevation. Width/depth are horizontal and height is vertical.
- Metres/feet controls display only. Quantities remain in the explicit units shown on each line; the component library defines whether an assembly is measured in square metres, cubic metres, metres or items.
- Wall net area deducts hosted opening areas; overlapping openings are not a geometric union operation. Review invalid/overlapping opening arrangements. Roof area is horizontal plan area; no sloped/freeform roof analysis is included.
- Demonstration rates, productivities, durations and allowances are illustrative. Currency changes relabel values and do not perform foreign-exchange conversion. Enter taxes and unmodelled work explicitly where appropriate.
- Unit labour rates and an optional incremental crew-day charge are separate inputs. Set the incremental charge to zero if it would duplicate labour already included in unit rates.
- Model-linked activities recalculate supported quantities from the current model. Assembly-linked productivity sums each source quantity divided by that assembly's productivity in its measurement unit per working day; the calendar/resource scheduler then applies minimum durations and dependencies. Manual quantity/productivity overrides remain planner-owned snapshots. Site work, foundations, services and other absent geometry require explicit planner/estimator review.
- Increasing available crews enables concurrent activities; it does not automatically divide individual task duration. The current dependency network is preserved during scenario enumeration. No holiday calendars, site logistics simulation or detailed discipline-specific equipment/crew assignment is provided.
- Known-cost totals and completeness describe entered scope only. They do not certify that all building work has been entered. Completion dates are preliminary calculations, not promises of site performance.

## Local data and security boundaries

- Desktop project records, snapshots and comments are saved as atomically replaced JSON files under `~/Library/Application Support/Atelier/projects`, with restrictive file permissions. The development browser launcher uses ignored `server/data/`. Renderer local storage retains a recovery copy; these stores are **not application-encrypted at rest**.
- The API uses an HttpOnly same-site local session cookie, validates payloads, restricts origins/hosts to loopback and enforces local role modes on writes. Published review snapshots have no update route.
- Admin/editor/contributor/reviewer selection is an explicit simulation for a trusted local pilot. Anyone who controls this computer can select another mode. It is **not user identity, organization isolation, remote sharing or enterprise authorization**.
- HTTP is used on loopback; TLS and cloud deployment security are not configured. Do not expose this server as a public or LAN service without adding proper identity, project authorization, encryption and operational controls.
- OpenAI requests occur only when the user submits a copilot request. They include the prompt and project model/type/schedule/constraint context, including more than the selected elements when needed for validation. The Responses API is called with `store: false`; that flag is not a claim of zero provider retention or local-only inference.
- API credentials stay on the server. Provider errors are sanitized; health reports readiness metadata only. Logs and exported reports must never contain a credential.
- No automatic supplier feeds, regulatory database, real-world approval workflow, encryption/key management service or usage analytics backend is implemented.

## Embedded desktop backend

`server/app.ts` exports the side-effect-free `createApp(options)` factory for the Electron main process. Importing this module does not load an env file, start a listener or inspect `import.meta`. The separate `server/index.ts` command-line launcher loads `.env.local` only when invoked as a program; it remains useful for browser development and automated testing.

The desktop host supplies its own `dataDir`, packaged `staticDir`, `mode: 'desktop-pilot'` and a freshly generated `desktopHeaderToken`, then listens on an ephemeral `127.0.0.1` port. The Electron session injects `X-Atelier-Desktop` internally for requests to that embedded origin. The backend verifies it using a constant-time comparison before **every** route, including assets, health and session creation. The renderer must not receive the token through preload or application state. A separate HttpOnly application session is still required for project APIs.

Origin validation accepts the service's actual ephemeral origin and the documented development ports, while rejecting unrelated origins. A normal browser without the process-local desktop capability cannot access the embedded service. This capability is process isolation for a trusted local desktop app, not multi-user identity or a substitute for production authorization.

## Validation and remaining PRD gates

`npm test` exercises deterministic geometry, transaction validation, measurements/costing/scheduling/scenarios, IFC exchange, API sessions, role checks, snapshot immutability and comments. Browser workflow checks and a live provider smoke test must be recorded separately; a mocked API test is not a live AI validation.

Desktop checks have confirmed package construction, strict local code-signature verification, packaged launch, renderer isolation, embedded service readiness and rejection of ordinary browser requests. Native GUI checks exercised settings, save/quit/reopen, IFC import, undo, JSON copy, PDF and XLSX output. A live OpenAI window-replacement proposal produced a reviewed preview without changing the model. Extracted application contents were scanned: the credential and private project records are absent; the external credential-path pointer is expected. The delivery notes distinguish completed checks from remaining release work.

The remaining PRD work includes a mature geometry kernel and production drawing/annotation tools, broader external IFC testing, independent quantity tolerances, planner-reviewed construction templates, real identity/project authorization, encryption and operational controls, accessible interaction/performance validation and the 3–5 firm pilot. The current role switcher and local review comments do not provide remote collaboration or organization isolation.

Before a professional pilot, independently check quantity tolerances and estimates, validate schedules with a planner, test a representative external IFC corpus, agree model-size/performance limits and close authoring/documentation gaps. Before production, add real identity and project authorization, encryption and backup/recovery operations, monitoring and privacy controls, broader interoperability testing, accessible interaction checks and the remaining PRD acceptance gates.

References: [buildingSMART IFC](https://www.buildingsmart.org/standards/bsi-standards/industry-foundation-classes/), [OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs).
