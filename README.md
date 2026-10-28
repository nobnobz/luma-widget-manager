# Luma Widget Manager

[Open the manager](https://nobnobz.github.io/luma-widget-manager/)

The [Fusion Widget Manager](https://github.com/nobnobz/fusion-widget-manager) interface, adapted for Luma. The original welcome screen, widget cards, visual folder editor, drag-and-drop, manifest connection, import review, trash, responsive dialogs, theme controls and pack browsers are reused. Original Git history and MIT license are retained.

## Build UME v4.0

1. Import a Luma or Fusion export, choose a UME template, or **Create New**. **UME v4.0 Hub Starter** in the existing template picker gives you an empty structural starter.
2. Add folder cards to a **Folder row**. Choose their covers, tile shapes and catalogs in the familiar editor.
3. Open a folder and choose **Edit hub page** to add horizontal sections and a closing subfolder grid. Folder cards inside those sections use the same editor. Luma supports three folder levels.
4. Arrange catalog/section blocks in **Page order**. Duplicate or reorder subfolders, restore deleted folders/sections and undo page changes. Catalog settings remain in the folder card; appearance options remain in the page’s optional appearance section.
5. **Export → Luma → Folder rows** downloads a native `luma-collections.json` array, including nested structure, per-source options, animation fields and unknown imported provider fields. Incomplete catalogs block export instead of being dropped.

Empty starters contain no movie lists or finished artwork. Add your real catalogs and covers before publishing a UME pack. **Catalog row** shows one catalog directly as a poster row on Home and exports as `luma-catalog-rows.json` through Luma’s existing Fusion importer. Mixed layouts require both files; arrange their order in Luma after import. **Hub** means the page behind a folder, containing catalog rows, folder rows and a folder grid.

## Animated covers and tags

There is one existing pack browser for each feature:

- **Animated Covers:** preview a pack, then apply it to matching folder titles, including nested folders. Custom cover videos stay intact. The video and backdrop URLs are included in the regular Luma collections export; a second cover-pack import is unnecessary. If folders are missing, add the matching widgets through the normal import review.
- **Stream Badge Packs:** preview a variant, copy its original URL and import it in Luma’s Badge Packs settings under stream/source settings. Luma reads the Fusion UME badge format. Up to three URLs can be stored, with one active at a time. Badge packs are app preferences and use a separate importer; collection JSON cannot install them.

The inspected Luma tvOS code plays animated focus covers. Other platforms preserve the wire fields and static artwork; that alone does not establish equivalent animation playback.

## Import into Luma

The native export is a **bare collection array**, required by the current iOS backup importer and also accepted by macOS/tvOS.

- iOS: **Collection Backups → Import**.
- macOS: Collections import.
- tvOS flat collections: host the JSON at an HTTPS URL, then **Collections → Import → From URL**.

**Current tvOS limitation:** iOS and macOS render nested hub pages. The inspected tvOS folder model/browser does not yet render `sections`/`subfolders`. A valid JSON import does not supply this missing app capability.

Provider add-ons must be installed in Luma before catalogs can load. A connected AIOMetadata manifest is represented by Luma’s portable `preset:aiometadata` alias on native export; other add-on identities are retained. Browser manifest fetching requires server CORS support. Native Trakt/AniList editor shortcuts must be bridged through AIOMetadata before native Luma export; unsupported source kinds fail visibly.

Previous native-editor drafts migrate into the shared widget editor. Unknown native fields remain attached to their collection/folder/source. The previous native draft is retained locally as a recovery copy until an intentional restart. The `/fusion` compatibility route retains the legacy output workflow; native-only hubs cannot be silently downgraded to legacy exports.

## Development and storage

Node 22+ and npm. On this Mac **always** use the wrapper. Dependencies, Next build data, npm cache and temporary files use one persistent external root: `/Volumes/Jarvis SSD/DeveloperData/Caches/luma-widget-manager`. The wrapper fails if the SSD is missing. Evidence belongs in `build/evidence/`.

```sh
./scripts/with-external-cache.sh npm ci
./scripts/with-external-cache.sh npm run dev
./scripts/with-external-cache.sh npm run lint
./scripts/with-external-cache.sh npm run typecheck
./scripts/with-external-cache.sh npm run test:unit
./scripts/with-external-cache.sh npm run build
./scripts/with-external-cache.sh npm run test:e2e
```

GitHub Actions checks the code and deploys a static export to GitHub Pages. Native contracts were compared with current local Luma source; web verification is not a physical-device import test. This repository does not modify the Luma application.
