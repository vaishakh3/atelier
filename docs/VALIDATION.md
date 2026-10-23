# Validation evidence

Evidence is separated into automated checks, measured synthetic performance, final desktop integration and external professional acceptance. A passing unit test, configured credential or build command alone does not establish a working packaged user workflow.

## Current automated checks

On October 24, 2026, the local source run completed:

| Check | Recorded result |
|---|---|
| Full automated suite | **205 tests passed across 22 files**, Vitest 5.0.5 |
| `npm run typecheck` | Passed |
| Dependency advisory audit | **0 reported vulnerabilities** at this checkpoint; advisories can change after the run |
| PDF and workbook regressions | Passed using jsPDF 4.2.1 and the official SheetJS 0.20.3 package |
| Approved sequencing | Seven baseline-bound sequencing tests included; locks, cycles, stale approval and the disclosed search cap covered |
| Desktop 0.2.0 package checkpoint | macOS arm64 ASAR inspection passed (161 runtime packages, 178 preserved notice/license files); strict deep local ad-hoc signature verification passed; 14 isolated packaged smoke checks passed, exit 0. Final UI changes require a rebuild and fresh integration check. |
| Final production frontend/desktop build and package verification | Pending the final integration run after the UI changes; do not infer it from the package checkpoint above |
| Native live provider/UI checkpoint | Live two-room repetition preview preserved 43 elements at v1; acceptance produced 45/v2; undo restored 43/v3. Published immutable v3 and reopened its read-only review file. Final distribution rebuild pending. |
| Native report checkpoint | PDF: all 16 rendered pages visually inspected without overlap, clipping or broken glyphs. XLSX: eight sheets parsed; Rooms 8, Doors 7, Windows 10 data rows. |

The count is a recorded checkpoint, not a promise that later source edits were included. Update this table with the final integration results before shipping the new artifacts.

The suites exercise:

- Geometry transforms, wall/opening unions, hosted bounds/alignment, views, annotations and model schedules.
- Preview/accept/reject boundaries, locks, stale/tampered operations, repetition caps/hosted children and undoable changes.
- Quantity rules, missing rates/allowances, currency mismatches, financial precision, calendars/holidays, resources, critical drivers and Pareto scenarios. Approved dependency variants retain exact predecessor diffs/rationale, reject stale baseline approvals and expose bounded-search truncation.
- Semantic revision changes, incomplete/currency-incomparable deltas and reproducibility.
- IFC round trips, external units/placements, safe reference/excluded fallbacks and independent upstream fixture bytes.
- Real account setup/login, per-project roles, cross-project access, concurrent saves, server-attributed audit, comments, encrypted drafts/backups and restore conflicts.
- Authenticated at-rest encryption, recovery generations, corruption failures and security-state rollback prevention.
- OS-protected storage adapters, credential-bridge authorization, redacted diagnostics and signed update-feed validation.
- Portable review-copy schema, detached snapshot/comment scope and checksum changes.
- Ten allowlisted local usage aggregates, encrypted persistence, concurrency/overflow bounds, input-field rejection, project membership and administrator-only diagnostics.

OS credential adapter tests use controlled adapters. A controlled-adapter test does not validate the user's actual Keychain/DPAPI/Secret Service state. Update-feed unit tests do not establish a hosted feed, publisher signing identity, notarization or a successfully installed update.

The packaged smoke checkpoint separately exercised actual macOS protected storage, an isolated test identity, denied anonymous access, blocked role self-assignment, encrypted storage, capability protection, renderer Node isolation, sandbox/context isolation and administrator authorization for credential IPC. A guarded isolated fixture account is test setup, not a built-in production account. This checkpoint is stronger than an adapter test, but it still does not replace the final user workflow checks below.

## Reproducible synthetic performance measurement

Run from the source workspace:

```sh
npx tsx tests/benchmark.ts
npx tsx tests/benchmark.ts --scenarios-only
```

The recorded run used **Node v24.15.0 on darwin-arm64**. The script repeats the two-storey demonstration's 43 element records into separate translated wings until the requested 1,500/3,000 elements are reached. IDs and hosted relationships are remapped; room/wall/opening/slab/roof/stair classes and two levels remain. It is a synthetic scalability fixture, not an independently authored real building or acceptance corpus. Illustrative rates/productivity are retained; the intentionally unknown demonstration allowance is explicitly set to zero only in this performance fixture.

Each operation runs once as a warm-up. Quantity, estimate, schedule, model-schedule and revision operations then run five times; IFC import/export run three times. `performance.now()` measures elapsed milliseconds in one local Node process. Samples are sorted; median is the middle sample and P95 is the `ceil(0.95 × n)` sample. With these small sample counts, reported P95 is the observed maximum, not a statistically stable production percentile.

The estimate benchmark receives a precomputed schedule; schedule generation is measured separately. Revision comparison computes both source and revised calculations after one slab width changes. IFC import uses IFC exported from the same synthetic model, so it measures throughput rather than independent interoperability correctness. Tests against independent fixtures are recorded separately below.

| Operation | 1,500 elements P95 (ms) | 3,000 elements P95 (ms) |
|---|---:|---:|
| Quantity calculation | 4.71 | 6.15 |
| Estimate with precomputed schedule | 3.67 | 8.93 |
| Construction schedule | 30.35 | 104.72 |
| Room/door/window schedules and geometry checks | 2.60 | 4.61 |
| Full revision comparison | 80.48 | 249.99 |
| IFC export | 99.25 | 201.83 |
| IFC import | 300.41 | 606.55 |

Export sizes were **2,327,252 bytes** and **4,679,746 bytes** respectively; both schedules were feasible under the supplied synthetic inputs. The complete run output was retained in the local scratch report `work/engine-benchmark.json`; rerun the versioned script to reproduce on another machine.

The separate scenario run uses the same fixtures and runtime, one warm-up and three timed samples per case. With no sequencing variants, it evaluates all 24 configured material/crew/procurement combinations. The expanded fixture adds six explicitly named, approved, baseline-bound synthetic dependency variants. Each only adds a precedence constraint; it does not invent a safe construction relaxation. These are timing inputs, not planner approval of a construction method. The expanded search evaluates **128 of 168** configured combinations, discloses truncation and reports non-dominance only among evaluated candidates.

| Scenario comparison | 1,500 median / P95 (ms) | 3,000 median / P95 (ms) | Candidates evaluated |
|---|---:|---:|---|
| No sequencing variants | 801.61 / 836.52 | 3,117.55 / 3,184.95 | 24 / 24 |
| Six approved sequencing variants | 4,697.61 / 4,753.39 | 14,281.21 / 15,287.20 | 128 / 168, bounded cap reached |

All six dependency variants enter the bounded search; the baseline is retained. The exact scratch report is `work/scenario-benchmark.json`. At this size, full comparison is a multi-second operation. The product runs it in a module worker with progress/error state; that separates computation from the UI thread but does not make these calculations instantaneous. Worker launch and interactive responsiveness still require packaged verification.

These timings exclude Electron/React rendering, WebGL frame rate, picking, worker startup/message copying, native file dialogs, OS encryption, AI network latency, disks and professional review/correction. They do not establish an interactive 3,000-element product SLA, a memory ceiling or justify raising schema/import limits. Agree representative models, hardware and P95 editing thresholds with design partners, then measure those separately.

## Independent IFC evidence

The unmodified files in `tests/fixtures/ifc/` come from buildingSMART's specification-model repository at the commit pinned in `provenance.json`. Tests check SHA-256, byte length and source metadata before testing import behaviour. Attribution is in [THIRD_PARTY.md](THIRD_PARTY.md).

| Fixture | Observed supported behaviour |
|---|---|
| `wall-extruded-solid.ifc` | One editable 5 × 0.27 × 2 m wall, normalized from millimetres; external GlobalId, inherited type name/ID and flattened layered-material names retained. Imported construction rates remain unknown/unapproved. |
| `slab-tessellated-unique-vertices.ifc` | One read-only world bounding proxy retaining GlobalId. The proxy is excluded from measured construction quantities. |
| `slab-extruded-solid.ifc` | Arc-profile extrusion explicitly excluded: the current kernel does not invent rectangular geometry or an unsafe undersized proxy. |

An additional independently hand-authored straight L-profile regression verifies safe read-only extrusion bounds without charging the bounding box as slab area. None of these examples is a real office export corpus or certification. IFC layered assignments are flattened to names; curved, mapped and boolean models need their support report checked. Authored rectangular round trips and external examples test different things and must both remain in the suite.

## Desktop integration and external acceptance

The earlier local pilot demonstrated packaged launch, native settings, save/quit/reopen on a new ephemeral port, IFC import/undo, project JSON copy, parsed PDF/XLSX and a successful live window-replacement preview without persistent edits. That evidence predates the new identity/encryption/repetition/review-package changes and must not be presented as final verification of this hardened build.

The October 24 native 0.2.0 integration checkpoint added the following observed workflows. These results apply to the tested build; a final rebuild remains necessary after the latest integration changes.

| Native checkpoint | Recorded outcome |
|---|---|
| Live AI repeated modelling | A provider-generated two-room preview left the source at 43 elements/v1. Explicit acceptance created 45 elements/v2. Undo restored 43 elements/v3. |
| Immutable review snapshot | Published v3. The exported read-only review copy reopened successfully with its verified checksum, 43 elements and v3 metadata. |
| Native PDF export | `work/desktop-qa-artifacts/courtyard-house-review-v3.pdf`, 16 pages. Every page was visually inspected from its 1,100-pixel render: title/footer/version/units, plan/section/elevation, room/door/window tables, continued tables, quantities, cost/rate provenance, schedule and assumptions had no observed overlap, clipping, black squares or broken glyphs. |
| PDF content | v3, 43 elements, two levels, known estimated scope INR 3,070,492, 90% entered-scope completeness and 57 calendar days. Unknown allowance and missing specifications remain explicitly visible. |
| Native workbook export | Parsed eight sheets: Project, Quantities, Estimate, Rooms, Doors, Windows, Schedule and Assumptions; 8 room, 7 door and 10 window data rows. |

PDF inspection confirms this fixture's layout, not all future names, page sizes or project content. The review-copy checksum detects changed bytes; it does not authenticate a publisher. Native acceptance/undo evidence is one task, not the PRD's statistical AI-correctness pilot.

Before publishing the final rebuilt artifact, rerun or record the remaining final-artifact checks for:

1. Owner setup/login/logout, project membership roles, expired-session recovery and workspace-admin credential setup through the OS protector or explicitly selected external env file.
2. Save/quit/reopen, stale-writer conflict, encrypted per-user recovery, verified portable backup/restore and old plaintext-cache preservation/cleanup.
3. Model edit and repeated hosted geometry preview/accept/undo; a live provider request must leave the source unchanged until accepted.
4. Complete model schedules, revision comparison, PDF/XLSX/CSV/decision output and read-only review-copy opening without mutation of the active project.
5. Actual package/archive secret and private-data scans, relative framework symlinks, local signature verification and current-host launch. Record target/OS results individually; build configuration alone does not mean Windows/Linux were run.

Developer ID signing, notarization, Windows signing and trusted update deployment require publisher credentials/infrastructure. Independent BIM/QS/planner tolerances and the PRD's 3–5 firm pilot remain external acceptance gates. See [PRD_ACCEPTANCE.md](PRD_ACCEPTANCE.md) for the full distinction between implemented behaviour and those outcomes.
