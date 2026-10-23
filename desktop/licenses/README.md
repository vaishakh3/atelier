# Supplemental runtime license sources

These files fill omissions in the exact installed npm releases. `manifest.json` records each source URL, version and SHA256. The build copies them without modification and verifies their hashes alongside the original npm LICENSE/NOTICE files. Dependency upgrades require reviewing these exact-version mappings again.

- React Three Fiber 9.8.2: original LICENSE from upstream's matching release tag.
- Draco 1.5.9: complete upstream LICENSE, including its embedded third-party notices. The release tree supplies no separate NOTICE file.
- MediaPipe Tasks Vision 0.10.17: original copyright/license comment from the exact published `vision.d.ts`, plus the Apache Software Foundation's complete version 2 license text. No separate LICENSE or NOTICE is published in the npm package; a matching repository tag is unavailable, so no different release is represented as the exact source.
- maath 0.10.8: original published package metadata and full standard MIT license text from SPDX. The matching upstream tag `maath@0.10.8` resolves to 626d198fbae28ba82f2f1b184db7fcafd4d23846; its checked source tree and npm release contain no license text or copyright year. This absence is recorded instead of inventing a holder/year.
- stats-gl 2.4.2: original published package metadata and README attribution/license statement, plus full standard MIT text from SPDX. The npm gitHead c12b2e391d5a88616e0b30f3c7f0577966426239 tree contains no LICENSE or NOTICE. Standard-template placeholders remain explicit; upstream attribution is preserved separately.

The MIT standard text is a verbatim license template, and its placeholders are not assertions of copyright ownership. All copyright statements provided by the upstream packages are retained. These notices document redistribution provenance; they are not a claim that an upstream omission has been resolved by its author.
