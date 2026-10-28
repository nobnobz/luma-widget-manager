# Luma Widget Manager verification — 2026-10-28

- Original: `nobnobz/fusion-widget-manager`, main at `7def0a0` (see upstream Git history for exact base).
- New public repository: `nobnobz/luma-widget-manager`; original history and MIT license retained.
- Unit suite: 143 passed, 0 failed.
- Browser suite: 27 passed, 5 pre-existing conditional skips across desktop Chromium and mobile Chrome.
- Final focused Luma browser suite: 4 passed, including folder move, JSON download content, three-level nesting, invalid import rejection, export validation, local persistence and undo.
- ESLint, TypeScript and static production build passed.
- Desktop/mobile screenshots: `build/evidence/luma-desktop.png`, `build/evidence/luma-mobile.png` (local evidence).

## Native contract checked

Compared against the current local Luma source (`NuvioTVOS`, branch `codex/core-person-collections`):

- LumaDomain `CollectionFolderPage.swift`: `sections`, `subfolders`, `subfolderTileShape`, `blockOrder`, three folder levels, closing subfolder grid.
- LumaCatalog `MediaCollectionWire.swift`: native folder artwork fields, sources and view mode.
- iOS `NativeCollectionEditor.swift` backup import: bare collection array, 4 MB and 500 collection limits. Export uses that bare array; the manager can additionally read the historical wrapper.
- macOS `MacCollections.swift`: bare arrays and `{collections: [...]}` accepted.
- LumaCatalog `FusionWidgetExport.swift`: flat Fusion v1 groups and add-on catalog rows; nested pages require native JSON.

## Known limitation

The inspected iOS/macOS browsers render nested folder pages. The tvOS `LumaCollectionFolder` decoder/browser currently does not render nested `sections`/`subfolders`. A successful tvOS file import therefore does not imply nested-page support. The manager and README state this explicitly. No Luma application changes or physical-device imports were performed.

Native collection exports cannot carry independent Home catalog-row placement. Fusion `row.classic` conversion explicitly reports its conversion into a collection folder.

Local caches and temporary files use one persistent root on the external SSD. The webpack build avoids Turbopack's rejection of external dependency symlinks.
