# Design studio workflows

This guide describes the bounded workflows implemented in the 0.7.0 source. It is not a claim that a new desktop release, every supported platform or a professional acceptance pilot has passed. Release-specific evidence belongs in [VALIDATION.md](VALIDATION.md).

Use the left workspace rail to open **Model**, **Design studio**, **Estimate**, **Construction**, **Services** and **Site checks**. Rail buttons provide descriptions on hover and keyboard focus. **Q** or **Cmd/Ctrl+K** opens searchable commands and model elements. Design studio has three working areas: **Model tools**, **Proposals & layers** and **Site & analysis**.

## 1. Navigate and inspect a design

In **Model**, right-drag orbits, middle-drag or Shift+right-drag pans, and the wheel zooms. Ctrl+right-drag swivels the 3D camera from its current eye position. Fit all and fit selection are separate controls; **F / Cmd/Ctrl+F** uses the current selection or fits the model when nothing is selected. Plan views support pan, cursor-anchored zoom and floor selection.

Open **View tools** to:

- Save a named 3D camera or drawing frame, then restore it with its floor, hidden/isolated model IDs and reference-context visibility mask. A saved view records framing and visibility, not a frozen model; later design changes remain visible. Persistent layer visibility still applies.
- Align to a selected wall/hosted opening, look from a picked surface point, or align to entered true north. Look-from positions the eye 0.05 m above the picked surface. If true north is unset, the compass uses model north.
- Pick two world points to measure distance in plan or 3D. This measures model coordinates; it is not a survey-accuracy claim.
- Configure grid/object-vertex/axis-guide snapping and a metric grid step.
- Apply a six-limit section box for display clipping. It changes the view, not geometry, quantities or costs, and does not create fabrication-quality capped sections.

An editor can save views and project view settings. Reviewers can inspect, measure and restore existing views. Escape cancels point tools. Use the existing undo/redo controls for accepted project changes.

## 2. Keep independent proposals and compare real plans

Open **Design studio → Proposals & layers → Start design proposals**. Name a clone of the active design with **Create independent proposal**. Changes to architecture, services, rates, reusable templates and programme belong to that branch. Opening another proposal first saves the active design, then restores the chosen branch as one undoable transaction. Current project identity, audit and access decisions are retained; locked/read-only changes can block switching. Changed geometry, types or services requires construction-scope review again.

Choose the left and right proposals below the list. These are actual floor plans drawn from each model, with one floor selector, shared scale, zoom and pan. Drag or scroll either pane to move both. **Fit both** restores their combined extent. Metrics use complete model scope, even when geometry is hidden: modelled slab area, known cost subtotal or complete entered estimate, and a usable construction duration only when its current review requirements are satisfied. Slab areas are model measurements, not statutory floor area; overlaps are not a GFA interpretation. Unknown or unresolved inputs are not presented as verified savings or dates.

There are at most six proposals, with architectural snapshots capped at 1 MB each. **Site context and terrain are stored once in a live shared base, omitted from branch snapshots and overlaid when switching/comparing.** Changing an imported neighbour or survey base affects all proposals; an old proposal does not restore old site assets. Published immutable review snapshots remain a separate workflow in Documents.

## 3. Organize persistent design and context layers

In **Persistent layers**, create a **Design geometry** or **Shared site context** layer. Choose existing model elements, imported context assets or the shared terrain, then assign them explicitly. Each item belongs to one layer of its kind; assignment can move it from an unlocked source layer. Use **Select members** to inspect a layer's assignment and select its current architectural members in Model.

Layer names, membership, visibility and locks persist with the project. Hiding architectural geometry does not remove it from estimates. Imported context/terrain stays separate from architectural construction quantities. A design-layer lock uses the existing element locks; unlocking removes locks created by that layer while preserving pre-existing manual locks. A context-layer lock protects its members' source data and placement, including terrain. Unlock explicitly before replacing, moving or removing those references.

Quick access's temporary Hide/Isolate/Show-all controls remain useful for inspection. They do not override a persistent hidden layer or delete model data. Named views retain their visibility masks; they do not change layer ownership or design permissions.

## 4. Model polygons, repeat floors and reuse units

Open **Design studio → Model tools**:

1. **Polygon & extrusion:** enter 3–128 simple XY corners in model metres, omitting a repeated closing point; choose the working floor, name, height and purpose. Concave footprints are supported. Holes, self-intersections and sloped surfaces are excluded. A concept mass is editable reference geometry and has no construction price. Slabs, flat roofs and rooms use their actual polygon area; their assembly rates and measurement scope still need review.
2. **Transform selection:** enter metric XYZ translation, rotation and uniform scale. Selection-centre plan bounds and minimum Z define the transform frame. Hosted openings accompany their selected wall, and invalid hosts or locks block the action.
3. **Floors & units:** duplicate a supported floor above the building, or save/place a reusable floor/unit template. Copies receive independent IDs and remapped opening hosts. Templates are independent copies, not linked instances. Stairs, services, structural connections, circulation and clashes require separate coordination; repetition does not create them automatically.
4. **Facade pattern:** repeat equally spaced rectangular windows on selected walls. Existing overlaps block the change unless replacement of the existing hosted doors/windows is explicitly selected. Geometry fitting is not structural, fire, access or daylight approval.

IFC exchange supports the existing horizontal rectangular extrusion subset plus bounded straight-polygon slabs, roofs and spaces. Editable polygon import requires a simple, explicitly closed planar `IfcPolyline` profile and a supported vertical extrusion. Unsupported curves, holes, arbitrary booleans, mapped geometry and other detail remain reported/reference-only or excluded. This is not a general solid-modeling kernel or a lossless proprietary-format conversion.

## 5. Bring surveyed context and screen exterior direct sun

Open **Design studio → Site & analysis**. In **Location & survey**, enter a verified WGS84 anchor, local UTC offset for the analysis date, true north, survey datum and provenance. North uses degrees counter-clockwise from model +Y and is shared with Site checks. Datum is recorded metadata; geometry is not automatically shifted. No map, surrounding buildings, terrain or municipality is downloaded or inferred.

In **Reference context**, import an ASCII OBJ or DXF, or a PNG/JPEG reference. Review its actual geometry, source report, units, optional OBJ Y-up/Z-up orientation, scale, rotation and metric origin before **Accept site changes**. Changes remain detached until accepted; concurrent project edits invalidate the preview.

- **OBJ:** exact vertices/lines and bounded planar convex faces; source appearance, external materials/textures and unsupported records are not reconstructed or fetched. Concave/warped faces require source triangulation.
- **DXF:** bounded straight LINE/LWPOLYLINE/POLYLINE records with supported world-plane placement. Curves, fitted/bulged records, blocks, text, hatches and unsupported planes are reported/excluded.
- **PNG/JPEG:** calibrated reference only. The initial 20 m width is illustrative; calibrate it against a known surveyed dimension. Image pixels do not supply building geometry, terrain heights or shadow obstructions.
- **Survey XYZ:** explicit model-metre points with provenance; no automatic triangulation. A placed imported mesh can become terrain only when it supplies explicit triangles.

Current text/image file limits, vertex/triangle budgets and pixel limits are enforced and surfaced by the importer. Read the fidelity report: accepted context is read-only reference data, not editable architectural BIM. Native RVT/DWG editing is not supported; prepare a supported IFC or reference export in the authoring tool and review the reported losses.

In **Sun & site**, choose a date, civil hour, exterior receiver point or 3 × 3 grid, and a sampling interval. **Calculate direct sun hours** samples geometric sun positions and tests rays against opaque model prisms and imported triangles. The NOAA fractional-year approximation, coordinate convention, references and limitations are visible. Results become stale after relevant inputs change. The browser worker keeps the sampled calculation separate from editing.

This screen does not calculate indoor daylight, irradiance, weather, glazing transmission, wind, thermal comfort or legal sunlight compliance. Wall openings are conservatively ignored during obstruction tests. Linework, rasters and untriangulated survey points do not block rays. Drawing shadow outlines are horizontal-plane illustrations; the sampled receiver results use the ray model. [NOAA equations](https://gml.noaa.gov/grad/solcalc/solareqns.PDF), [NOAA limitations](https://gml.noaa.gov/grad/solcalc/calcdetails.html)

Site JSON retains data and current analysis provenance. OBJ exports placed context/terrain in metres, excluding raster pixels and BIM semantics. GeoJSON exports supported non-raster reference context using a disclosed small-site approximation; terrain and rasters are excluded. It is not a surveyed projected-CRS transformation.

## Configure Kerala rule inputs separately

Use **Site checks → Configure site & rules** for the three-step setup: **Site essentials**, **Rules & source**, then optional **Preferences & notes**. Partial inputs can be saved; missing values stay unknown. Site-entry progress is not legal approval. Select the local body and applicable dated worksheet, then have the project team review sources, later amendments and entered limits. Vaastu is optional client-selected directional preference data, separate from legal/safety review.

The [connected services demonstration](SERVICES_DEMO.md) continues from architecture into editable electrical/plumbing proposals, traceable estimates and reviewed construction changes. These workflows together demonstrate integration; they do not establish full Autodesk Forma parity, measured competitor superiority, engineering certification or permit readiness.
