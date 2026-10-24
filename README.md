# Atelier

A standalone desktop BIM copilot for architects and planners. Atelier connects a bounded architectural model to reviewable AI transactions, coordinated schedules, explicit estimates and construction cost–time comparisons. The architect remains in control of every model change.

The desktop application embeds its own service and runs without Node.js or a separate browser. Model editing, measurements, costing, scheduling, revisions and exports work offline. Only requested copilot operations require an OpenAI connection.

## Run and build

Use Node.js 24 and npm:

```sh
npm ci
npm test
npm run typecheck
npm run desktop:dev
```

Package for the current platform:

```sh
npm run desktop:build
```

The builder supports macOS arm64/x64, Windows x64 and Linux x64. It creates a portable application, versioned ZIP and SHA256 checksum under `outputs/`. The GitHub workflow verifies the source and builds all four targets. Packaging on a platform is distinct from testing its native workflows. See [desktop release operations](desktop/RELEASE.md) for signing, notarization, update feeds and isolated QA.

macOS developers can configure a [retained local signing identity](docs/LOCAL_SIGNING.md) to preserve the app's certificate-pinned signing requirement. This local certificate has no Apple TeamIdentifier, so a changed build can still require Keychain authorization. Local certificate setup and any scoped trust authorization are explicit; supported identity continuity across public updates requires an Apple-issued Developer ID.

Open the app and create a local studio account. There is no default production password. A workspace administrator can create additional accounts; project administrators assign admin, editor, contributor or reviewer access to individual projects. Project membership is enforced by the embedded service.

For AI, use **Settings → AI connection**. The default is **GPT-6.1 Sol** (`gpt-6.1-sol`); the former `gpt-4.1-mini` default upgrades automatically, while other explicitly configured model IDs remain unchanged. A newly entered key is protected by the OS credential service. Alternatively, choose an existing environment file: Atelier remembers its path and reads the key in the main process without copying it. Credentials are never returned to the renderer or included in a release. Browser development uses the ignored `.env.local` file; desktop development can explicitly set `ATELIER_ENV_FILE`.

## Product workflows

- Author rectangular walls, slabs, rooms, hosted doors/windows, flat roofs and regular straight stairs. Use levels, grids, snapping, linked plan/section/elevation/3D views, properties, annotations, design locks and reversible repetition.
- Import supported IFC4-family/IFC2X3 STEP models and export IFC4. Reports distinguish editable elements, read-only reference proxies and excluded geometry. Validated JSON transfers the complete Atelier project.
- Describe a one- or two-storey house, or improve an existing generated concept while preserving its room program. Review residential zoning, room dimensions and access, exterior-window provision, floor plans, proposed levels and the coordinated stair before accepting one undoable transaction. A selected slab retains its exact footprint. Replanning explicitly lists the generated elements it replaces; manual, imported and locked geometry is protected. Missing dimensions use disclosed planning assumptions. Compact hubs are preferred where the bounded candidates fit; constrained programmes use an explicitly labelled gallery fallback. Pools/garages remain reserved architectural zones, and window provision is a planning proxy rather than a daylight simulation or compliance assessment.
- Request scoped AI type replacements, specification edits and repeated modelling, or ask for missing-information checks, revision explanations and crew evaluations. Review affected IDs, created elements, before/after values and calculated impacts before accepting one undoable transaction.
- Open **Design notes & assumptions** for the full proposal context. Ordinary notes use a compact disclosure; actionable request or validation failures remain visible beside the affected action.
- Trace quantities to source elements. Inspect material, labour, equipment, waste, allowances, overhead and rate provenance. Missing rates, incompatible currencies and unmodelled scope stay visible; incomplete costs cannot be ranked as verified savings.
- Compare up to three distinct bounded layout candidates before accepting one. Inspect room-size and rectangular furnishing-envelope guides, access, dedicated circulation and exterior-window proxies. The search can return fewer alternatives when a fixed footprint or programme leaves no distinct feasible candidates.
- Configure **Site checks** for India → Kerala, the local authority and municipal/corporation or panchayat rules. Enter a surveyed rectangular plot, true north and ground datum. Dated October 2025 Kerala A1 worksheets retain official sources and clauses; the project team must confirm subsequent amendments and applicability. Unverified, missing or unsupported rules remain **Not evaluated**. Optional Vaastu checks compare explicitly tagged spaces with client-selected directional preferences.
- Plan activities with dependencies, quantity-linked productivity, finite crews, procurement releases, working weekdays and holiday dates. After model changes, review exact source IDs, quantities, retained manual assumptions and proposed activity additions before using completion dates again. Scope acceptance is one reversible transaction; it does not certify that every construction task is represented.
- Compare bounded, approved construction choices against budgets and deadlines. Review assumptions, design locks and the cost–time frontier before adopting an alternative.
- Publish immutable snapshots and version-specific comments. Compare revisions across geometry, types, specifications, quantities, rates, costs and programme. Share portable read-only review copies with an integrity checksum; these are not authenticated signatures or live collaboration links.
- Export coordinated review PDFs, XLSX workbooks, quantity/model-schedule CSVs, IFC models and decision records. Room, door and window schedules retain source identifiers and missing-property warnings. Configured site checks add source-backed geometric-limit and Vaastu review pages/sheets; unconfigured projects retain the original eight workbook sheets.

## Services coordination

The optional **Services** workspace connects a residential concept to editable electrical points and cold-water/drainage fixtures. Review per-level plan layers, room-hosted placement, conceptual circuit groups and centreline routes. Services-aware review highlights wet-area grouping, upper-floor wet-room proximity and potential wall/slab/stair penetrations; these are geometric coordination proxies, not engineering approval.

Point edits and same-floor bathroom function swaps stay detached until explicitly accepted. The swap retains the existing room shells, doors and windows, moves the bathroom fixtures, reroutes their connections and shows before/after quantities, known service subtotals and installation effort. Undo/redo restores the complete transaction. Architectural changes make services stale, and construction scope must be reviewed again before relying on updated programme dates.

Rates and crew productivity start unknown. Enter project quotations and installation output, or deliberately choose clearly labelled illustrative demo rates. Service costs are included in the estimate with traceable quantities; overlapping MEP allowances need reconciliation. Scope omissions remain visible, and conceptual route length is not a procurement cable quantity. Limited calculations cover single-phase demand/current arithmetic and drainage fall from horizontal run and an entered gradient. They do not size cables, protection, earthing or pipes, verify gravity drainage, or establish compliance.

An empty project offers a deterministic two-storey, four-bedroom demonstration. Service generation runs locally; the existing provider-backed architectural copilot is a separate workflow. Export services JSON and per-level SVG, or include services in the project JSON, review PDF and XLSX workbook. IFC currently exports the architectural model only. See the [connected demonstration walkthrough](docs/SERVICES_DEMO.md) for reproducible steps, recorded results and review boundaries.

## Storage and recovery

Packaged applications require a real local identity. Projects, snapshots, comments, memberships and account records use authenticated AES-256-GCM storage. A random data key is protected by the operating system credential service. Linux requires Secret Service/KWallet; insecure `basic_text` fallback is rejected. Missing vault keys fail closed rather than silently replacing a key and orphaning records.

If an older Atelier copy has changed a legacy project after encryption, migration retains the encrypted project and its access records, archives the legacy source under encryption, and creates a separate recovered legacy copy with visibly unverified history. Repeated startup does not overwrite an edited recovery copy or duplicate the same import. Startup checks the protected identity route before opening the workspace and reports specific migration, integrity or connection errors.

Atomic writes, verified backup generations, revision tokens and encrypted recovery drafts protect edits. Current permissions and credentials never roll back with an older model. Portable `.atelier-backup` files use a separate passphrase and can restore into a new project or as a new revision while retaining existing permissions. Keep a portable backup: copying an OS-bound key file alone is not a cross-computer recovery strategy.

The renderer does not persist production model data in plaintext localStorage. Legacy pilot drafts are preserved in verified encrypted archives before their old browser cache is cleared. The private embedded service binds to an ephemeral loopback address and requires a main-process capability plus an HttpOnly identity session. It is not a public HTTP service. See [release operations](desktop/RELEASE.md) for the security boundary and migration details.

Copilot requests include the prompt and relevant project model, type, schedule and constraint context. OpenAI Responses uses `store: false`; this is not a promise of zero provider retention. No model data or credentials are sent as telemetry. Local diagnostics expose safe counts and codes. Ten allowlisted product events are stored only as encrypted aggregate counts and bounded durations; prompts, project values and identities are not retained in those counters.

## Supported scope

Atelier targets low-rise architectural planning, not a general CAD kernel, structural/MEP analysis or regulatory sign-off. Geometry is stored in metres; feet only changes display. Hosted opening deductions use their geometric union to avoid double deductions. Roof areas are horizontal plan areas. Sample rates and productivities require professional confirmation. Currency changes do not perform foreign-exchange conversion.

IFC editing requires supported rectangular vertical extrusions and placements. Recognised tessellated/BREP geometry may become a read-only bounding proxy and is excluded from measured construction scope. Curved, mapped, arbitrary boolean and unsupported profile geometry is reported rather than silently treated as editable. Original detail reduced to a proxy cannot be recovered by re-export. Type/material and property mapping is deliberately bounded. Three unmodified external buildingSMART fixtures supplement authored round-trip tests; this does not establish IFC certification.

## Verification and release status

See [PRD acceptance mapping](docs/PRD_ACCEPTANCE.md), [validation evidence](docs/VALIDATION.md), [third-party provenance](docs/THIRD_PARTY.md) and [release operations](desktop/RELEASE.md). Automated verification covers geometry, costs, calendars, scenarios, IFC exchange, atomic AI changes, identity, permissions, concurrency, encryption, recovery, immutable reviews and desktop isolation. CI also scans dependencies and inspects packaged ASAR contents and preserved license notices.

Version 0.5.1 is a release candidate for controlled technical evaluation. Site checks are partial geometric prechecks, not legal certification, permit approval or proof of current-law completeness. Coverage/FAR/height measurements use disclosed model proxies; zoning, road/building lines, statutory exemptions, fire/egress, accessibility, structure, services and environmental restrictions still need professional review. Vaastu is an optional client preference, separate from statutory rules.

Public distribution still requires publisher signing/notarization credentials, native acceptance on each supported platform, independent professional quantity/schedule checks and the PRD's 3–5 firm pilot. Those external acceptance gates cannot be established by unit tests or local packaging. Automatic updates remain disabled unless the publisher configures a signed trusted feed and matching release identity.

The browser UI remains available for development with `npm run dev` at [localhost:5173](http://127.0.0.1:5173). Its role selector is a development simulation and its separate `server/data/` store is not the production desktop security model. Do not expose it to a network.
