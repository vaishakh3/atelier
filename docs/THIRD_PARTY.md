# Third-party notices

## buildingSMART IFC test examples

Copyright © buildingSMART International Ltd.

The three files below are unmodified informative examples from the [buildingSMART IFC4.x specification-model repository](https://github.com/buildingSMART/IFC4.x-specification-models), pinned at commit **`ef22440ec501551ccc9689309560bbc7e26aa9d7`** and retrieved October 24, 2026. They declare the final `IFC4X3_ADD2` schema. Source bytes are retained unchanged; the SHA-256 and size checks are recorded in `tests/fixtures/ifc/provenance.json` and exercised by `tests/ifc-external.test.ts`.

Upstream's [license statement at the pinned commit](https://github.com/buildingSMART/IFC4.x-specification-models/blob/ef22440ec501551ccc9689309560bbc7e26aa9d7/README.md#license) identifies final IFC under **Creative Commons Attribution-NoDerivatives 4.0 International (CC BY-ND 4.0)** and reserves rights before formal release. The license text and conditions are available from [Creative Commons](https://creativecommons.org/licenses/by-nd/4.0/). These source snapshots are not modified derivatives; this notice does not claim a license to unpublished content beyond upstream's stated terms.

| Local fixture | Original source | Bytes | SHA-256 |
|---|---|---:|---|
| `tests/fixtures/ifc/wall-extruded-solid.ifc` | [Wall extrusion example](https://github.com/buildingSMART/IFC4.x-specification-models/blob/ef22440ec501551ccc9689309560bbc7e26aa9d7/models/building-elements/wall-extrusion/wall-extruded-solid.ifc) | 3,313 | `7e1c9a3147300d3d9e787b657766cadb2d578930eccf8956313f2f4ee976ff99` |
| `tests/fixtures/ifc/slab-extruded-solid.ifc` | [Slab extrusion example](https://github.com/buildingSMART/IFC4.x-specification-models/blob/ef22440ec501551ccc9689309560bbc7e26aa9d7/models/building-elements/slab-extrusion/slab-extruded-solid.ifc) | 3,189 | `0e4b80b98d8f1576d0c997af24b9486eb638de9f8428959fb6067a3bb74a4aca` |
| `tests/fixtures/ifc/slab-tessellated-unique-vertices.ifc` | [Tessellated slab example](https://github.com/buildingSMART/IFC4.x-specification-models/blob/ef22440ec501551ccc9689309560bbc7e26aa9d7/models/tessellated-shape/slab-tessellated-unique-vertices/slab-tessellated-unique-vertices.ifc) | 5,060 | `b1611154ea511526e5de5a58ea90e6cfb5abb2d8a6294d8c5f63cd6e297e912b` |

buildingSMART identifies these models as informative examples supporting implementation and learning. Their presence does not imply buildingSMART endorsement, certification of Atelier, or completeness for an IFC model-view definition. Application import may retain a supported element, create a read-only bounding proxy, or explicitly exclude unsupported geometry; the original test files remain unchanged.

The straight-polygon, malformed-file and other inline regression fixtures authored for this project are separate from those upstream files. Exported application models are not presented as copies of the buildingSMART source examples.

## Runtime and development dependencies

Atelier uses Electron and third-party JavaScript packages, including React, Three.js, Express, Zod, OpenAI's JavaScript client, jsPDF and SheetJS. Their own licenses and notices apply independently of this document.

The desktop packaging workflow generates `THIRD_PARTY_NOTICES.txt`, `third-party-licenses.json` and a `third-party-licenses/` directory from the resolved release dependency graph. The JSON inventory records the lockfile SHA-256 and preserved files' SHA-256/source provenance. Original LICENSE, LICENCE, NOTICE, COPYING and COPYRIGHT files are retained, including Electron's Chromium notices. `node scripts/third-party-notices.mjs` independently generates and verifies these files; `scripts/verify-desktop-package.mjs` checks their bytes in the actual ASAR.

The current resolved inventory contains 161 runtime packages and 178 preserved source files. Five package omissions have explicit checked-in supplements under `desktop/licenses/manifest.json`; the accompanying README records their exact upstream/published sources. In particular, no copyright holder or year is invented where the published package/upstream tree omits one. A dependency update can change these counts, so regenerate the inventory for every release.

This static file attributes the external IFC fixtures; it does not replace the generated inventory or individual license texts. Final archive/ASAR verification is recorded separately in [VALIDATION.md](VALIDATION.md), and publisher review of applicable redistribution terms remains a release responsibility.
