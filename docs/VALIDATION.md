# Validation evidence

Evidence is separated into automated checks, measured synthetic performance, final desktop integration and external professional acceptance. A passing unit test, configured credential or build command alone does not establish a working packaged user workflow.

## 0.4.0 residential planning candidate

Runtime source [`6dc9016`](https://github.com/vaishakh3/atelier/commit/6dc901616a900b791bdda7f65ca47944d4dc4b4f) adds bounded compact-hub planning, coordinated one/two-storey concepts and exact reviewed concept replacement. Requested rooms remain separate BIM spaces; bedrooms and attached bathrooms stay together, public/service links have physical doors, and exterior windows use actual outside walls. Tight programmes or fixed envelopes can still use an explicitly labelled gallery fallback. A selected slab is unchanged. Dedicated circulation counts automatic foyers, landings and branches, excluding paths inside requested living/dining rooms; these metrics do not establish a design, cost or time optimum.

| Check | Recorded result |
|---|---|
| Final automated suite | **329 tests across 31 files passed**, including physical door/window adjacency, private access, stair arrivals and upper-slab voids, explicit floors, protected cross-level collisions, complete replacement boundaries, locks/tampered diffs, undo/redo and two-storey IFC/quantity checks. TypeScript and the production build passed. |
| Live provider and browser: existing programme | GPT-6.1 Sol retained the three bedrooms, three ensuites, kitchen, library and pool zone. The preview proposed **58 creations / 43 replacements**, an **11.5 × 13.3 m** envelope, a **4.2 × 2.8 m** central foyer and a **4.15 m** entrance branch instead of the earlier full-length gallery. Dedicated circulation was **12.6%**; all six habitable rooms had exterior windows. Preview/rejection left 43 elements/v1 unchanged. Acceptance, undo and redo produced 58/v2 → 43/v3 → 58/v4 in the isolated browser fixture. |
| Live provider and browser: two storeys | The reported four-bedroom/two-storey request produced both floor plans, a reviewed upper level and a coordinated straight stair instead of refusing multi-level planning. One live gallery-fallback proposal accepted 81 elements/two levels; one undo restored zero elements/one level. The later twelve-room pantry/service case is covered by the final automated hub tests; final packaged live-provider acceptance is still pending below. |
| Standard service-room case | The recorded twelve-room four-bedroom programme, including a pantry and separate laundry, replays through the final engine as a **10 × 13.5 m** compact hub with **84 creations**, all twelve rooms, a real kitchen–pantry doorway, exterior windows for all seven habitable rooms and a stair/upper-slab void. Explicit floor requests remain binding. This is bounded packing, not global architectural optimisation. |
| Review rendering | The expanded plan fills its available width; the measured SVG was 618 × 673 px instead of the earlier small stamp. At 1100 × 800, the document had no horizontal overflow, the room table retained 550.5 px of content height, and the modal body scrolled normally. The replacement jump focused all 43 exact before-object records. Final browser error logs were empty. |
| CI | [Run 40046793099](https://github.com/vaishakh3/atelier/actions/runs/40046793099) passed for exact runtime commit `6dc901616a900b791bdda7f65ca47944d4dc4b4f`: all 329 tests/31 files, typecheck/build, a zero-vulnerability production audit and all four package jobs, with macOS arm64/x64, Windows x64 and Linux x64 artifacts. No reruns were needed. |
| Local macOS package | Version 0.4.0 built once with the retained local certificate. Strict deep verification passed; CDHash `37f09dec0bd666f5edfdcd50cc4dccc046da8890`. Package inspection verified 161 dependency notices and scanned all 194 ASAR files against the approved credential and private workspace path without displaying them. ASAR SHA-256: `6993a7e64fa56c9e3427809b16a4853a35064325969389edf6f229d9f3169616`. |

**Native acceptance is currently blocked by the local OS credential state.** The installed 0.4.0 candidate received `errSecAuthFailed` while opening the existing Safe Storage item, before an authorization dialog appeared. The unchanged, strict-verified 0.3.3 executable also received the same failure after restoration to its original `/Applications/Atelier.app` path. The login keychain reports unlocked; Keychain Access could not read the item's access information and its login-lock action was disabled. No credential-item permissions were changed, no password was collected, and the existing vault key was not replaced. Seven protected key/project/access files remain byte-identical to the immediate pre-update hashes. The retained 0.3.3 is restored in Applications; the 0.4.0 candidate remains in `outputs/` pending a human OS sign-in/session refresh and retest. No successful native 0.4.0 smoke run, live walkthrough or prompt-free relaunch is claimed.

`Atelier-0.4.0-darwin-arm64.zip` SHA-256: `94c3e791e9e6599b95923bb3e221dc05fd089b5026cbb524e3f0ddd8375ad7b0`. This locally signed package is separate from CI artifacts, and has no Apple TeamIdentifier or notarization. Publisher signing, other-platform native acceptance, independent architectural/daylight/cost/schedule review and the PRD pilot remain external gates.

## 0.3.3 installed startup and session verification

The installed `/Applications/Atelier.app` is version **0.3.3** with the retained local signer. Targeted macOS audit events and non-secret item metadata distinguished two independent gates on the existing Safe Storage item: the trusted application's decrypt permission and the signature partition permission. Both persistent approvals are now saved for this installed build. Two complete native quit/relaunch cycles opened the real profile on new backend ports without a SecurityAgent process or the reported workspace error. The account form is expected: this profile has no studio account record. No account was created or password changed during verification.

The production browser partition is now in memory. Authentication cookies last for the running app, matching the embedded server's process-local sessions. Previous persistent browser files are left intact; project records and saved credentials retain their existing encryption. This also avoids Chromium's separate persistent-cookie encryptor. It is not evidence that cookies alone caused the observed prompts: the saved permissions above were independently necessary.

The exact installed binary passed the isolated packaged smoke test with **17 checks true**, plus `packaged: true`, and exited 0 without an authorization dialog. The checks include actual OS-protected storage, backend and renderer identity readiness, an ephemeral browser session, real renderer login with an HttpOnly cookie, protected project access, denied anonymous access and role self-assignment, credential IPC authorization, sandbox, context isolation and unavailable renderer Node.js. The expected pre-login credential IPC denial is a successful assertion. The test used only the guarded QA profile and its existing fixture account. All **281 tests across 28 files** and the TypeScript/production frontend build passed locally.

The installed binary and output app have the same strict-verified signature, with CDHash `b4c70e4ac32b3f2c520351218b9d5147d7826ee1`. `Atelier-0.3.3-darwin-arm64.zip` SHA-256 is `759fd674da71b32e2c84226268d7139cdc0966a5d1c6c492d7a600718e5b9de7`. This self-signed identity has no Apple TeamIdentifier: unchanged-build relaunch is verified, while a changed build can require new partition authorization. Supported continuity across public updates requires genuine Developer ID signing; notarization and other external release gates remain separate. Existing vault item ACLs were not widened.

[CI run 40036537095](https://github.com/vaishakh3/atelier/actions/runs/40036537095) passed on its first attempt for exact runtime source commit `a8d8807ef563878ff219430e2de69b997fc7ec70`: all 281 tests across 28 files, typecheck/build, zero reported vulnerabilities and all four packaging jobs (macOS arm64/x64, Windows x64 and Linux x64), with their artifacts uploaded. Those CI packages are separate from the locally signed installed binary. Final local package inspection verified 161 dependency notice manifests and checked all 194 ASAR files against the approved credential without displaying it. The original protected key, canonical project and access ciphertext are still byte-identical to their pre-repair hashes.

## 0.3.2 startup and local signing repair

The reported 0.3.1 launches reached `desktop-ready`, while the renderer hid every failed identity request behind one connection message. The existing profile contains both encrypted records and valid legacy plaintext projects; the former migration aborts on a changed legacy copy. New migration tests reproduce that state through the real protected identity API. Migration now keeps verified encrypted canonical/access records unchanged, encrypts and verifies original legacy bytes, and preserves a conflicting model/history in a distinct recovery project. Snapshot/comment references are remapped, imported attribution is visibly unverified, and recovery copies inherit no old permissions. Deterministic import markers make restarts idempotent even after a copy is edited. Old plaintext generations remain separate recovery copies, never rollback generations of the encrypted canonical. Corrupt inputs, changed sources, symlinks, missing protected identities and migration bounds fail closed.

All **281 tests across 28 files**, TypeScript, the production frontend build and the zero-vulnerability audit passed locally. The desktop now preflights the protected identity/migration route before declaring readiness; the packaged smoke check also checks the renderer's identity route. Explicit retry can reattempt repaired initialization, and malformed identity status cannot enable development mode. Safe errors distinguish connection, authorization, migration and integrity failures; failed/stale requests do not open locked workspace drafts.

A retained self-signed local certificate was created in a dedicated private build keychain. Actual provisioning exposed and fixed the imported private-key label/resume issue. The initial OS rejected this untrusted certificate, and Packager only warned on signing failure; the candidate is now strictly checked before output replacement. The user approved and completed authorization for a new user-domain trust entry limited to this exact certificate, CodeSigning policy and /usr/bin/codesign. No TLS trust or existing vault ACL was changed. A native probe established that macOS also requires the private build keychain in its search list while signing; builds temporarily append only that entry and remove it afterward, preserving other entries. The final package passed strict verification with the designated requirement `identifier "com.atelier.bim" and certificate leaf = H"bfd01ab6f5e9860dc4407958c1cc9512b5d6269f"` and was installed in Applications. The original user search list matches its pre-build bytes. On the existing profile, protected identity/migration preflight passed, both legacy primary files were encrypted/preserved, and the original protected data-key plus canonical project/access ciphertext hashes remain unchanged. Three project records, two encrypted source archives and one completed recovery import are present. At that 0.3.2 checkpoint, renderer completion and prompt-free relaunch were still awaiting existing-item authorization; the later 0.3.3 verification above resolves the unchanged-build check. See [local signing operations](LOCAL_SIGNING.md). Public Developer ID signing/notarization remains separate.

[CI run 40034957395](https://github.com/vaishakh3/atelier/actions/runs/40034957395) passed all 281 tests across 28 files, typecheck/build, the zero-vulnerability audit and all four platform packaging jobs for code commit `a956ef18386cb5616fb832ed693c0c58f66649ba`. The local certificate-signed build is separate from the CI machines' ad-hoc macOS candidates. Two local builds have different code hashes (`32ba633572ab5aed73e76a5049497bb55abbf05d` and `8547cb1b4d23c507ff36f7629507c148fc646c77`) and the same certificate-pinned designated requirement. The first was installed at that checkpoint; the second was prepared but never installed. Version 0.3.3 now supersedes both. Certificate reuse does not establish changed-build Keychain partition continuity. The historical build-B `Atelier-0.3.2-darwin-arm64.zip` SHA-256 is `c089b75abeb42817ad6ffb7d6d5ee66aa4da25b25a59f992cc72a17e86ef4387`. Preparing these builds does not establish a successful native relaunch.

## 0.3.1 expanded review layout repair

Source commit `75553273280654eb7eb6e3b70a673524de5f565d` changes only the product CSS for the expanded review dialog (plus release version/documentation). Native 0.3.0 QA exposed an actual rendering defect: height-constrained automatic grid rows collapsed the scrollable room and element tables into thin lines. Content-sized rows (`grid-auto-rows: max-content`) and start alignment now preserve the tables and let the surrounding dialog body scroll.

The seven focused UI regressions passed after the repair; TypeScript and the production build passed. Visual QA against the rebuilt production UI confirmed a 454.5-pixel room table with ten rows (header plus nine spaces), and a 1,864.5-pixel creation table with forty rows inside its intended 250-pixel scroll container. The room schedule scrolled into view with dimensions, target areas and bedroom access visible. The real GPT-6.1 Sol request still produced the complete eight-room proposal without source edits. These are browser rendering measurements, not jsdom layout assertions.

The final frontend is `index-Br8SzTMW.js`, CSS `index-CZ3anthd.css`, and scenario worker `scenarios.worker-DffuKv35.js`. The 0.3.1 macOS package passed actual ASAR/license inspection, exact approved-key exclusion and strict deep ad-hoc signature verification. Its `desktop-runtime/main.cjs` SHA-256 is byte-identical to the native-verified 0.3.0 runtime: `d1435c54ae6aaa974df0f231d2f376434f880557e7ff922f2384a5321c26546e`. Native model creation/undo/redo evidence below belongs to 0.3.0; the CSS repair was checked in the rebuilt production browser UI, without claiming a second complete native walkthrough of the new archive.

`Atelier-0.3.1-darwin-arm64.zip` SHA-256: `1afcec0fbaa57c598ca4ad633c372452202bcc47910d8234e02e56df74e77e06`. [CI run 40030500629](https://github.com/vaishakh3/atelier/actions/runs/40030500629) passed for the exact final code commit: all 246 tests across 25 files, TypeScript, production build, the zero-vulnerability audit and all four packaging jobs (macOS arm64/x64, Windows x64, Linux x64). The first macOS arm64 attempt failed because both Electron download hosts timed out during DNS resolution, after compilation and notice preservation passed. Retrying that failed job without source changes succeeded; the final run conclusion is success. Signing/notarization and professional/platform acceptance gates remain separate.

## 0.3.0 model and layout update

Runtime source commit `99ac51c9d2ce13afd9b79283278afe0a78b5cd69` adds a new room-program layout operation and upgrades the shared server, desktop and settings default to **GPT-6.1 Sol** (`gpt-6.1-sol`). Missing or former `gpt-4.1-mini` defaults resolve to this model; other deliberate model overrides and historical proposal provenance are preserved. The Responses request uses supported medium reasoning, a 16,000-token output budget, a 120-second timeout and `store: false`; it never falls back to another model silently. Model access, timeout, incomplete output and provider authentication errors remain distinct from local identity expiry. Compatibility was checked against [OpenAI's model documentation](https://developers.openai.com/api/docs/models/gpt-6.1-sol).

| Check | Recorded 0.3.0 result |
|---|---|
| Full automated suite | **246 tests passed across 25 files**, including 17 layout engine, seven layout transaction and seven copilot UI regressions. |
| TypeScript and production build | Passed; final frontend `index-DFJzLW1u.js`, scenario worker `scenarios.worker-DffuKv35.js`. |
| Dependency audit | Zero reported vulnerabilities, all severities, at this checkpoint. |
| Live GPT-6.1 Sol, empty project | The reported program produced two bedrooms, two attached bathrooms, one common bathroom, living room, home theater and indoor pool zone. It proposed a 10.4 × 14.7 m envelope and 39 BIM elements. The source stayed empty until explicit acceptance; the accepted result passed geometry validation. |
| Live GPT-6.1 Sol, selected slab | The same eight-room program produced 38 creations within an existing 16 × 20 m slab rotated 20 degrees. Acceptance retained that slab unchanged and produced 39 total elements with valid hosted openings. |
| macOS arm64 archive | Version 0.3.0 package/ASAR inspection, 161-package/178-file runtime notice verification, strict deep ad-hoc signature verification and exact approved-credential exclusion passed. Thirteen bundled source/configuration files were checked against the approved key without displaying it. |
| Native packaged smoke | After the user completed macOS Keychain authorization, all 14 isolated packaged smoke checks passed and the process exited 0. These checks include actual protected storage, authenticated fixture access, denied anonymous access/role self-assignment, protected loopback, credential IPC authorization, renderer Node isolation, sandbox and context isolation. |
| Native live layout walkthrough | Logged into the isolated existing QA account, created an empty project, and submitted the exact eight-room request. The native plan showed 39 proposed elements while the source remained zero/v1. Closing the dialog preserved zero/v1; acceptance created 39/v2, native Undo returned to zero/v3, and Redo restored 39/v4. The project then reported Saved locally with model validation Clear and GPT-6.1 Sol displayed. Actual native 3D rendering and save were observed. The expanded-table defect discovered during this run is repaired separately in 0.3.1. |
| Full UI flow (isolated browser, production frontend) | The exact reported prompt produced the 39-element proposal from an empty v1 project. Closing the review modal retained zero elements/v1. Acceptance created 39 elements/v2; Undo returned to zero/v3; Redo restored 39/v4, which saved successfully. Model validation was clear, GPT-6.1 Sol was displayed, and no browser error logs were observed. The real plan/room table and complete creation list were visible before acceptance. This is browser-based evidence for the shared production UI, not a native 0.3.0 desktop run. |
| Cross-platform CI | [Run 40026873105](https://github.com/vaishakh3/atelier/actions/runs/40026873105) passed source verification and all four packaging jobs (macOS arm64/x64, Windows x64, Linux x64), with four uploaded artifacts for the exact runtime commit. Native workflow acceptance is separate. |

The local `Atelier-0.3.0-darwin-arm64.zip` SHA-256 is `1dbc116430dea44ed875520af259fb0ed798eb96441147b1b66731c0402f9939`. It has an ad-hoc signature, not an Apple Developer ID signature or notarization.

The new generator proposes one rectangular storey with a central circulation template and up to 16 program spaces. An explicit room list is preserved; unspecified dimensions use disclosed planning defaults. It retains a selected empty slab's position, orientation and size, rejects occupied/insufficient footprints and geometry locks, reuses approved existing component types, and never invents rates or removes source geometry. Attached bathrooms have bedroom access; other program rooms connect to circulation, with an entrance to outside. Complete creation diffs are independently regenerated and checked again at acceptance. Closing/rejecting the preview leaves the model unchanged; acceptance is one undoable transaction. Pool and garage rooms reserve architectural zones only and exclude specialist construction/vehicle access design. No roof, foundations, structural analysis, detailed MEP or compliance approval is generated.

The user completed the rebuilt binary's macOS Keychain prompt, allowing the native smoke run to pass, and then completed a new prompt when the app was reopened for its native layout walkthrough. The walkthrough above then passed in the isolated QA profile. Process sampling of the initial wait identified `SecItemCopyMatching` waiting on OS authorization before backend startup; this was not an AI or layout failure. Computer Use blocks access to Apple's SecurityAgent. No password, keychain access rule or encryption setting was changed to bypass it. The QA app was quit after the generated model reported Saved locally; the user's separately running older app/profile was not changed.

## 0.2.0 recorded release evidence

On October 24, 2026, the following checks completed. The final runtime source is commit `75939f71279234901502ae4996782fd681ce49d9`; subsequent release-evidence edits do not change the packaged application.

| Check | Recorded result |
|---|---|
| Full automated suite | **206 tests passed across 22 files**, Vitest 5.0.5, in the final-source CI verification job. The preceding local full run passed 205 tests; the additional test covers portable ASAR paths on Windows/POSIX. |
| `npm run typecheck` | Passed |
| Dependency advisory audit | **0 reported vulnerabilities** at this checkpoint; advisories can change after the run |
| PDF and workbook regressions | Passed using jsPDF 4.2.1 and the official SheetJS 0.20.3 package |
| Approved sequencing | Seven baseline-bound sequencing tests included; locks, cycles, stale approval and the disclosed search cap covered |
| Final desktop 0.2.0 package | macOS arm64 ASAR inspection passed (161 runtime packages, 178 preserved notice/license files); strict deep local ad-hoc signature verification passed; all 14 isolated packaged smoke checks passed, exit 0. The package contains frontend `index-RZCG2hmD.js` and module worker `scenarios.worker-DffuKv35.js`. |
| Final production build | TypeScript, Vite frontend, embedded service and Electron packaging passed. The final archive was checked for credential/private-data exclusion and expected ASAR contents. |
| Cross-platform CI | [Run 40023883460](https://github.com/vaishakh3/atelier/actions/runs/40023883460) passed source verification and built/uploaded all four packages: macOS arm64, macOS x64, Windows x64 and Linux x64. This is build evidence; native workflow QA was performed on macOS arm64 only. |
| Native final-artifact checks | Login, repeated save commands, quit/reopen, saved project/name/revision, worker scenario comparison, baseline revision comparison and native encrypted-backup restore passed. Restoring created a separate 43-element/v3 project; switching back retained the original 43-element/v4 project. |
| Earlier 0.2.0 live provider/UI checkpoint | Live two-room repetition preview preserved 43 elements at v1; acceptance produced 45/v2; undo restored 43/v3. Published immutable v3 and reopened its read-only review file. These flows were observed before the final file-picker and persistence hardening, not all rerun against the final ZIP. |
| Earlier 0.2.0 native report checkpoint | PDF: all 16 rendered pages visually inspected without overlap, clipping or broken glyphs. XLSX: eight sheets parsed; Rooms 8, Doors 7, Windows 10 data rows. |

The locally verified `Atelier-0.2.0-darwin-arm64.zip` SHA-256 is `43e28cd00b5ab94b21df428b21a72c7a7ef1da4d8336cd0e47751a36b4fddea4`. CI archives are separate builds and have their own checksums. The local macOS signature is ad hoc; it is not an Apple Developer ID signature or notarization.

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

The final packaged smoke run separately exercised actual macOS protected storage, an isolated test identity, denied anonymous access, blocked role self-assignment, encrypted storage, capability protection, renderer Node isolation, sandbox/context isolation and administrator authorization for credential IPC. A guarded isolated fixture account is test setup, not a built-in production account. This is stronger than an adapter test, but it does not replace the professional and platform acceptance gates below.

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

All six dependency variants enter the bounded search; the baseline is retained. The exact scratch report is `work/scenario-benchmark.json`. At this size, full comparison is a multi-second operation. The product runs it in a module worker with progress/error state; that separates computation from the UI thread but does not make these calculations instantaneous. The final macOS package launched the worker and completed the demonstration's 24/24 combinations. This does not establish responsiveness for the 3,000-element benchmark in the native UI.

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

The October 24 native 0.2.0 integration checkpoint added the following observed workflows. These provider/export/review observations preceded the final file-picker and persistence hardening. They are retained as integration evidence, rather than labelled as a complete rerun of every workflow from the final ZIP.

| Native checkpoint | Recorded outcome |
|---|---|
| Live AI repeated modelling | A provider-generated two-room preview left the source at 43 elements/v1. Explicit acceptance created 45 elements/v2. Undo restored 43 elements/v3. |
| Immutable review snapshot | Published v3. The exported read-only review copy reopened successfully with its verified checksum, 43 elements and v3 metadata. |
| Native PDF export | `work/desktop-qa-artifacts/courtyard-house-review-v3.pdf`, 16 pages. Every page was visually inspected from its 1,100-pixel render: title/footer/version/units, plan/section/elevation, room/door/window tables, continued tables, quantities, cost/rate provenance, schedule and assumptions had no observed overlap, clipping, black squares or broken glyphs. |
| PDF content | v3, 43 elements, two levels, known estimated scope INR 3,070,492, 90% entered-scope completeness and 57 calendar days. Unknown allowance and missing specifications remain explicitly visible. |
| Native workbook export | Parsed eight sheets: Project, Quantities, Estimate, Rooms, Doors, Windows, Schedule and Assumptions; 8 room, 7 door and 10 window data rows. |

PDF inspection confirms this fixture's layout, not all future names, page sizes or project content. The review-copy checksum detects changed bytes; it does not authenticate a publisher. Native acceptance/undo evidence is one task, not the PRD's statistical AI-correctness pilot.

The final macOS arm64 distribution additionally passed these native checks in an isolated profile:

| Final-artifact workflow | Recorded outcome |
|---|---|
| Login and persistence | Logged into the isolated test account, renamed the original project, issued overlapping native save commands and quit/reopened the application on a new ephemeral backend port. The name, 43 elements and v4 remained saved without a false revision conflict. |
| Scenario worker | Compared all 24 configured combinations. The demonstration's 90% entered-scope cost completeness correctly prevented ranking/adoption as verified savings. No sequencing variants were configured in this native fixture. |
| Revision comparison | Compared immutable baseline v3 with current v4: no element additions/removals/changes, zero known subtotal delta and zero schedule-day delta. The renamed project input remained visible; incomplete pricing was still disclosed. |
| Native encrypted backup restore | The `.atelier-backup` file was selectable in the native macOS chooser with Open enabled. Its existing test passphrase decrypted the fixture, restoring a separate project with 43 elements/v3 and current-user administrator access. Switching back confirmed the original 43-element/v4 project was unchanged. |
| Package boundary | The final archive passed ASAR, runtime-license hash, credential/private-data exclusion, relative framework-link, strict deep ad-hoc signature and isolated smoke verification. |

During integration, an explicitly selected existing `.env.local` file configured live AI through the native picker. Only its path was retained; the key was not displayed or copied into the package. The production profile remains first-time setup, with no built-in account. Account creation, membership handover, expired-session recovery, stale-writer conflict, crash/corruption recovery and legacy-cache migration have automated coverage; they have not all received a complete final-artifact native GUI drill. Native Windows/Linux/Intel macOS workflows, formal accessibility evaluation and independent recovery drills remain acceptance work.

Developer ID signing, notarization, Windows signing and trusted update deployment require publisher credentials/infrastructure. Independent BIM/QS/planner tolerances and the PRD's 3–5 firm pilot remain external acceptance gates. See [PRD_ACCEPTANCE.md](PRD_ACCEPTANCE.md) for the full distinction between implemented behaviour and those outcomes.
