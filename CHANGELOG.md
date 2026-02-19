# Changelog

## [0.6.0](https://github.com/Runbook-Agent/RunbookAI/compare/v0.5.0...v0.6.0) (2026-02-19)


### Features

* **agent:** add compact summarizers for k8s code and ops incidents ([#90](https://github.com/Runbook-Agent/RunbookAI/issues/90)) ([3c40c32](https://github.com/Runbook-Agent/RunbookAI/commit/3c40c32e7f30d65964d3d2b7bbd6aadd786fea5c))
* **cli:** add json output for status investigate and mcp tools ([#91](https://github.com/Runbook-Agent/RunbookAI/issues/91)) ([62e8135](https://github.com/Runbook-Agent/RunbookAI/commit/62e81353f7b74a1781c0a73ea8db24b5057b7244))
* **integrations:** persist hook tool usage and stop checkpoints ([#88](https://github.com/Runbook-Agent/RunbookAI/issues/88)) ([f8f08be](https://github.com/Runbook-Agent/RunbookAI/commit/f8f08beb9c02b1cf8d373782371b6b6978332fd0))


### Performance Improvements

* **integrations:** cache hook knowledge retriever between events ([#92](https://github.com/Runbook-Agent/RunbookAI/issues/92)) ([30a054d](https://github.com/Runbook-Agent/RunbookAI/commit/30a054d3ccf6d62a4204b36077e4833270ba87da))

## [0.5.0](https://github.com/Runbook-Agent/RunbookAI/compare/v0.4.1...v0.5.0) (2026-02-18)


### Features

* add asciinema demo recording to website and README ([#68](https://github.com/Runbook-Agent/RunbookAI/issues/68)) ([bab183b](https://github.com/Runbook-Agent/RunbookAI/commit/bab183bec6c67c73a34dc26dc273e958a52529c0))
* add generic API knowledge source ingestion ([#80](https://github.com/Runbook-Agent/RunbookAI/issues/80)) ([0169820](https://github.com/Runbook-Agent/RunbookAI/commit/0169820938e6c54be601718d7dcce8a55b3caa67))
* add github and gitlab code-fix pointers for investigations ([#69](https://github.com/Runbook-Agent/RunbookAI/issues/69)) ([9b905e3](https://github.com/Runbook-Agent/RunbookAI/commit/9b905e30d18387e0257cd7a8ed66c341e87463be))
* add notion knowledge source ingestion ([#79](https://github.com/Runbook-Agent/RunbookAI/issues/79)) ([2a7dc0a](https://github.com/Runbook-Agent/RunbookAI/commit/2a7dc0a08e8d1165a2253f84aec1bd18ba46a77d))
* add operability context adapter implementations ([#66](https://github.com/Runbook-Agent/RunbookAI/issues/66)) ([0fdf700](https://github.com/Runbook-Agent/RunbookAI/commit/0fdf70041c8110d1722589ecee999b5fa4429118))
* add operability context ingestion flow ([#64](https://github.com/Runbook-Agent/RunbookAI/issues/64)) ([d343a95](https://github.com/Runbook-Agent/RunbookAI/commit/d343a952286bc36a153ebdd65fb2c5f22c1870ac))
* configured knowledge sources + hybrid retrieval ([#77](https://github.com/Runbook-Agent/RunbookAI/issues/77)) ([d5d9ee3](https://github.com/Runbook-Agent/RunbookAI/commit/d5d9ee3a950a7e6b27bc4ed0b8a3a76ce00d7782))
* validate knowledge source credentials and fields ([#81](https://github.com/Runbook-Agent/RunbookAI/issues/81)) ([ead8850](https://github.com/Runbook-Agent/RunbookAI/commit/ead8850d3dee7ef25d74a3ee5655261e0069f6d0))


### Bug Fixes

* convert demo.cast timestamps from relative to absolute ([#72](https://github.com/Runbook-Agent/RunbookAI/issues/72)) ([b454070](https://github.com/Runbook-Agent/RunbookAI/commit/b454070ac3a1889cf247f4e192e7d3cc467c4a49))
* convert demo.cast to v2 format and add GIF to README ([#71](https://github.com/Runbook-Agent/RunbookAI/issues/71)) ([6cdae65](https://github.com/Runbook-Agent/RunbookAI/commit/6cdae6520346c9ff8ae14f032a1b70c67a256414))
* restore runbook_context adapter type in config enum ([#70](https://github.com/Runbook-Agent/RunbookAI/issues/70)) ([b209f63](https://github.com/Runbook-Agent/RunbookAI/commit/b209f63c351af53985deab356d22309346a4536d))

## [0.4.1](https://github.com/Runbook-Agent/RunbookAI/compare/v0.4.0...v0.4.1) (2026-02-12)


### Bug Fixes

* use tsup for ESM-compatible builds ([#61](https://github.com/Runbook-Agent/RunbookAI/issues/61)) ([40bd47f](https://github.com/Runbook-Agent/RunbookAI/commit/40bd47f4efe108a88b2c18c958e915c3e2078881))

## [0.4.0](https://github.com/Runbook-Agent/RunbookAI/compare/v0.3.0...v0.4.0) (2026-02-12)


### Features

* update homepage with demo command and simplified hero ([#56](https://github.com/Runbook-Agent/RunbookAI/issues/56)) ([b751f6c](https://github.com/Runbook-Agent/RunbookAI/commit/b751f6c2b29219274e1032e636d31a3a61e558dd))


### Bug Fixes

* add files field to include dist in npm publish ([#59](https://github.com/Runbook-Agent/RunbookAI/issues/59)) ([a497ed8](https://github.com/Runbook-Agent/RunbookAI/commit/a497ed858fc8c88d3e509752b80422648a0796e2))
* remove duplicate demo command from hero ([#58](https://github.com/Runbook-Agent/RunbookAI/issues/58)) ([c1d1e77](https://github.com/Runbook-Agent/RunbookAI/commit/c1d1e77ad50eb72d0abcc14bcbbd0c903cc81029))

## [0.3.0](https://github.com/Runbook-Agent/RunbookAI/compare/v0.2.3...v0.3.0) (2026-02-12)


### Features

* add demo command for zero-config experience ([#54](https://github.com/Runbook-Agent/RunbookAI/issues/54)) ([8527e4a](https://github.com/Runbook-Agent/RunbookAI/commit/8527e4ac7fa837102358eae2f246d332800753fb))

## [0.2.3](https://github.com/Runbook-Agent/RunbookAI/compare/v0.2.2...v0.2.3) (2026-02-12)


### Bug Fixes

* add npm provenance metadata and normalize bin path ([#49](https://github.com/Runbook-Agent/RunbookAI/issues/49)) ([4a1b5bc](https://github.com/Runbook-Agent/RunbookAI/commit/4a1b5bcf285b5988713a782ee1ead91c36027dff))

## [0.2.2](https://github.com/Runbook-Agent/RunbookAI/compare/v0.2.1...v0.2.2) (2026-02-12)


### Bug Fixes

* enforce tokenless npm trusted publishing in release workflow ([#45](https://github.com/Runbook-Agent/RunbookAI/issues/45)) ([fdcd375](https://github.com/Runbook-Agent/RunbookAI/commit/fdcd375b87c81320305a4034c7db3646cac361f6))

## [0.2.1](https://github.com/Runbook-Agent/RunbookAI/compare/v0.2.0...v0.2.1) (2026-02-12)


### Bug Fixes

* publish to npm inside release-please workflow ([#43](https://github.com/Runbook-Agent/RunbookAI/issues/43)) ([24d844d](https://github.com/Runbook-Agent/RunbookAI/commit/24d844d309f96749c04eba3471fad440d62e58b4))

## [0.2.0](https://github.com/Runbook-Agent/RunbookAI/compare/v0.1.0...v0.2.0) (2026-02-12)


### Features

* add one-command release automation ([#38](https://github.com/Runbook-Agent/RunbookAI/issues/38)) ([cbc2d45](https://github.com/Runbook-Agent/RunbookAI/commit/cbc2d45c86235159e3bd993ea5adb5e2af7faef0))
* Claude Code integration with context injection, MCP server, and checkpoints ([#26](https://github.com/Runbook-Agent/RunbookAI/issues/26)) ([ec8d2fa](https://github.com/Runbook-Agent/RunbookAI/commit/ec8d2faa86a16729ecdcc7d9b3ff18d47728fe83))


### Bug Fixes

* support release-please token fallback for org policy ([#40](https://github.com/Runbook-Agent/RunbookAI/issues/40)) ([72a43df](https://github.com/Runbook-Agent/RunbookAI/commit/72a43dfbb81d4a7ade094670e025196aea8734cb))
