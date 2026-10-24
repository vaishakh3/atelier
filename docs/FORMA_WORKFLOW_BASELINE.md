# Familiar architectural workflows: Forma reference baseline

Research checked 24 October 2026. Original code audit baseline: Atelier 0.6.0, source commit `3abd3cd`. The source implementation update below records the subsequent navigation/command-access pass. Source inspection is not proof of interaction testing; release-specific verification belongs in [VALIDATION.md](VALIDATION.md).

## What was verified

Use familiar interaction conventions while retaining Atelier's identity and explicit residential BIM scope. Forma Site Design, Forma Building Design, Revit and the wider Forma construction platform are distinct products; do not combine their capabilities into an invented single feature list.

The public Autodesk Site Design guide documents a central design canvas, left navigation and contextual right panel. Its exact mouse mappings are below. [Autodesk Getting started with Forma Site Design](https://help.autodesk.com/cloudhelp/ENU/Forma-SD-Get-Started/files/Getting_Started_SD.html)

| Action | Verified Site Design control | Implementation implication |
|---|---|---|
| Orbit | Right mouse drag | Do not use left drag for both selection and camera movement. |
| Zoom | Scroll wheel | Retain conventional wheel zoom; make plan zoom anchor to the cursor. |
| Pan | Middle drag or Shift + right drag | Provide both for mouse/trackpad flexibility. |
| Swivel | Ctrl + right drag | Document only if implemented distinctly; ordinary orbit is not equivalent. |

Autodesk's 28 August 2026 overview documents the following commands and workflow affordances. These are Site Design findings, not verified Building Design keyboard mappings. [Autodesk Site Design tools overview](https://blogs.autodesk.com/forma/2026/08/28/forma-site-design-tools-overview/)

| Action | Verified control or workflow |
|---|---|
| Quick access | Q opens actions and shortcuts. |
| Fit | Cmd/Ctrl + F. |
| Align camera to facade | Cmd/Ctrl + E. |
| Look from a specific point | Cmd/Ctrl + L. |
| Camera state | Save/load views; switch 2D/3D. |
| Proposals | Create/duplicate named concepts; compare side by side. |
| Layer control | Hide/lock geometry; selecting a layer selects its objects. |
| Editing | Selection exposes contextual parameters on the right. |
| Copy between bases | Cmd/Ctrl + C, change base, Cmd/Ctrl + V. |

Quick access is searchable; Space repeats the last tool in Autodesk's tutorial. [Autodesk Quick access tutorial](https://www.autodesk.com/learn/ondemand/curated/forma-quick-start-guide/2Ytv8wCAN1SBdjGiKyUrtg)

Do not advertise `M`/`R` as verified current global Forma shortcuts. An older official 3D Sketch article documents `M` within its specific modeling mode; that does not establish a current global mapping. [Autodesk 3D Sketch tutorial, July 2023](https://blogs.autodesk.com/forma/2023/07/11/designing-cantilevered-buildings-with-formas-3d-sketch-tool/)

For interoperability, Autodesk's 24 April 2025 support article lists IFC/OBJ meshes, DXF vectors and PNG/JPEG images, with a 100 MB limit; DWG requires an intermediate workflow. This is a dated support baseline, not a guarantee for every 2026 product or subscription. [Autodesk supported import article](https://www.autodesk.com/support/technical/article/caas/sfdcarticles/sfdcarticles/Does-Autodesk-Forma-allow-the-import-of-DWG-or-DFX-file-format.html)

Building Design's April 2026 official workflow article describes schematic options, floor-plan/facade metrics, contextual site data and generic native Revit elements on handoff. It also distinguishes site-scale work from building development. Public detailed Building Design control documentation was not verified here: the product overview fetch timed out and linked Site Design help articles redirected to Autodesk sign-in. Do not infer keyboard parity or claim a tested full-product comparison. [Autodesk Building Design connected workflows](https://blogs.autodesk.com/forma/2026/04/14/connect-your-design-workflows-with-forma-building-design/)

## Current source implementation

The familiar-controls pass now implements the following in `App.tsx`, `CommandPalette.tsx`, `ModelViewport.tsx` and `PlanEditor.tsx`. This list describes code that exists; it does not claim new native QA has completed.

| Area | Implemented behavior | Remaining boundary |
|---|---|---|
| Command access | Q or Cmd/Ctrl+K opens searchable commands and model elements. Arrow keys navigate, Enter runs and Escape closes. Disabled actions show their reason. | This combines action discovery and element search; it is not an exact reproduction of Forma's command catalogue. |
| Project navigation | Commands open Model, Services, Estimate, Construction, Site checks, Scenarios and Documents, plus model views and supported exports. | Model transitions still use Atelier's existing page/state architecture. No new persistent proposal-branching system is implied. |
| 3D navigation | Right-drag orbit; middle-drag or Shift+right-drag pan; wheel zoom; explicit zoom buttons; perspective/top/south presets. | Forma's separate Ctrl+right swivel, facade alignment and look-from commands are not reproduced. |
| Framing | Fit all and fit selection buttons; F or Cmd/Ctrl+F fits selection, otherwise the whole model. | This context-sensitive fit choice is Atelier's behavior; the public Forma guide only establishes its fit shortcut. |
| Plan/projection navigation | Pan/zoom and fit controls in plan, section and elevation; cursor-anchored wheel zoom in the editable floor plan. | Section/elevation remain the supported fixed projections, not a free section-box editor. |
| Selection | Additive Shift/Ctrl/Meta selection; Cmd/Ctrl+A selects visible model elements (active level in plan). Searching for an element reveals it, selects its level and requests framing. | Geometry/properties remain bounded by current editing support and permissions. |
| Visibility | Hide selection, isolate selection and show all via Quick access; visible-state indication and reset. Hosted openings follow their hidden wall. | Visibility is temporary view state; it does not delete, exclude from costs or alter persisted model geometry. It is not a full proposal-layer manager. |
| Drawing continuation | Space returns to the last drawing tool; V selects, W draws walls, Escape cancels. Global drawing shortcuts avoid text fields and dialogs. | No freeform massing or face/edge modeling was added. |

Saved named cameras, synchronized side-by-side geometric alternatives and richer external-format preview remain future work. Existing bounded layout alternatives, construction scenarios and revision comparisons retain their different purposes.

## Original 0.6.0 audit and priorities

The following historical findings explain the implementation priorities. Read the current-source section above for controls added after this baseline. These are repository observations, not competitor claims.

| Workflow | Present in 0.6.0 | Gap and next step |
|---|---|---|
| Workspace arrangement | `App.tsx`: left levels/element browser, central canvas, right Copilot/Properties, top views, camera controls. | Preserve the arrangement. Keep frequent actions visible and labels clear; avoid reproducing Autodesk branding or iconography. |
| Navigation | `ModelViewport.tsx`: default Three.js left orbit, right pan; perspective/top/south; fit model button. | Reverse the conflicting mouse mapping; add explicit fit-selection action. Correct help/hints and verify cancellation during drawing. |
| Plan navigation | `PlanEditor.tsx`: editable plan, wheel zoom, right/middle pan, grid and dimensions. | Cursor-anchored zoom, fit selection and consistent behavior across plan/section/elevation. Test with translated and rotated geometry and different viewport aspect ratios. |
| Selection | Click and additive Shift/Ctrl/Meta selection in model views; selected count; element search. | Browser uses Shift/Meta but not Ctrl. Make modifiers consistent. Keep navigation gestures from changing selection or starting geometry. |
| Properties | Explicit Properties tab, precise dimensions/specifications, selected count. | Copilot is initially active. Consider a lightweight contextual selection summary or obvious Properties action; do not hide unsent AI work by switching panels unexpectedly. |
| Commands | `App.tsx`: V select, W wall, Cmd/Ctrl+K element search, undo/redo, duplicate, delete, Escape. | Add a searchable command palette using existing actions, Q for familiar quick access, visible shortcuts and disabled reasons. Guard text fields, dialogs and role restrictions. |
| Modeling | Rectangular walls/slabs/spaces, hosted openings, straight stairs, dimensions, repeat operation, review/undo. | No full freeform massing, face/edge editing, terrain tools or building-type editor. Don't imply these exist because the shell looks familiar. |
| Variants | Copilot offers bounded layout alternatives; Scenarios compares construction choices; Documents compares published revisions. | These are three different concepts. Expose clear destinations and names. Add synchronized geometric proposal comparison later; a cost scatter plot is not side-by-side model comparison. |
| Visibility | Grid toggle, upper-level ghosting, roof display behavior; locked model IDs. | No general per-layer hide/isolate/show-all workflow. Add view-only visibility separately from model deletion, with obvious reset and excluded-from-view indicators. |
| Viewpoints | Preset perspective/top/south and project floor/view selection. | User-named saved cameras and model-aligned orientation are useful later. A north glyph alone is not true-north camera alignment. |
| Import | IFC4/IFC2x3 supported subset with excluded/reference-only report; Atelier JSON and read-only review packets; 10 MB pilot limit. | Keep supported formats and fidelity visible before selection. Preserve reports. Do not claim native RVT/SKP/DWG or lossless Forma transfer. |
| Connected design review | Services proposals, fixtures/routes, transparent estimates, construction-scope review, acceptance and undo. | Keep this differentiated workflow one clear path; test that navigation and shortcuts never apply proposals or bypass reviews. |

## Implementation sequence and acceptance

1. **Navigation and selection:** verified orbit/pan mappings, fit model, fit selection, cursor-anchored plan zoom, clear Escape behavior. No changes to geometry from camera gestures.
2. **Command access:** searchable actions plus shortcuts, Q opening, keyboard navigation and truthful role/selection requirements. Keep Cmd/Ctrl+K element search available.
3. **Workflow continuity:** commands to Model, Services, Estimate, Construction and existing comparison/review pages; preserve project, selection and unapplied proposals when moving between appropriate views.
4. **Visibility:** temporary hide/isolate/show-all is now implemented in source. Persistent saved viewpoints, named geometric variants with synchronized comparisons and richer import previews remain later work and require their own state and persistence design.

Acceptance should include actual mouse/keyboard behavior in the desktop app; plain React render assertions cannot prove orbit direction or scene framing. Cover text-entry shortcuts, reviewer permissions, no-selection actions, negative/translated coordinates, rotated elements, two floors and Escape during a drawing gesture. Preserve undo history, existing project data and service-plan freshness gates.

This baseline establishes familiarity. It does not establish overall Forma parity, environmental/daylight-analysis equivalence, installation-ready engineering, or measured superiority. The pitch should demonstrate Atelier's verified residential design-to-services-to-cost-to-construction workflow and describe existing limits plainly.
