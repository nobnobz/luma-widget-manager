# Luma Widget Manager

[Open the manager](https://nobnobz.github.io/luma-widget-manager/)

The [Fusion Widget Manager](https://github.com/nobnobz/fusion-widget-manager) interface, adapted for Luma. The original welcome screen, widget cards, visual folder editor, drag-and-drop, manifest connection, import review, trash, responsive dialogs, theme controls and pack browsers are reused. Original Git history and MIT license are retained.

## Build UME v4.0

1. Import a Luma or Fusion export, choose a UME template, or **Create New**. **UME v4.0 Hub Starter** in the existing template picker gives you an empty structural starter.
2. Add folder cards to a **Folder row**. Choose their covers, tile shapes and catalogs in the familiar editor.
3. Open a folder and choose **Edit hub page** to add horizontal folder rows and a closing subfolder grid. Folder cards inside those rows use the same editor. Luma supports three folder levels.
4. In **Edit hub page → Catalogs & sections**, create add-on, TMDB, Trakt-list or Jellyfin catalog copies. Set media/genre/release filters, local order, year, minimum rating and ranking numbers. TMDB Discover has its own filter fields; advanced provider JSON preserves additional options. Create **Catalog sections**, name them and assign catalogs to show headings and jump links. A catalog belongs to one section at a time.
5. Arrange catalog and folder rows in **Row order**. Duplicate or reorder subfolders, restore deleted folders and rows and undo page changes. Folder rows can follow a server collection ID from a Luma export, with stored fallback folders. Row headings, cover animation, hero video, title logos and automatic catalog artwork are editable; appearance options remain in the page’s optional appearance section.
6. **Export → Luma → Complete Home** downloads one `Luma-Home.json` using the current local Luma Home contract (`lumaCollection` / `lumaWidget`). Import it through Home → Import in a Luma build with native Home extension support. It retains nested sections, genre collections, renamed rows/catalogs, filters, repeated catalog instances and unknown native fields. Luma Home exports can be imported back into the manager without flattening their native configurations.
7. **Export → Luma → Folder rows** downloads a native `luma-collections.json` array, including nested structure, per-source options, animation fields and unknown imported provider fields. Incomplete catalogs block export instead of being dropped.

Empty starters contain no movie lists or finished artwork. Add your real catalogs and covers before publishing a UME pack. **Catalog row** shows one catalog directly as a poster row on Home and exports as `luma-catalog-rows.json` through Luma’s existing Fusion importer. The compatibility exports require both files for mixed layouts; arrange their order in Luma after import. Complete Home handles both kinds in one file. **Hub** means the page behind a folder, containing catalog rows, folder rows and a folder grid.

## Animated covers and tags

There is one existing pack browser for each feature:

- **Animated Covers:** preview a pack, then apply it to matching folder titles, including nested folders. Custom cover videos stay intact. The video and backdrop URLs are included in the regular Luma collections export; a second cover-pack import is unnecessary. If folders are missing, add the matching widgets through the normal import review.
- **Stream Badge Packs:** preview a variant, copy its original URL and import it in Luma’s Badge Packs settings under stream/source settings. Luma reads the Fusion UME badge format. Up to three URLs can be stored, with one active at a time. Badge packs are app preferences and use a separate importer; collection JSON cannot install them.

The inspected Luma tvOS code plays animated focus covers. Other platforms preserve the wire fields and static artwork; that alone does not establish equivalent animation playback.

## Import into Luma

**Complete Home** requires the native Home extensions implemented in local Luma commit `02cd3c068` or a later build containing that change. Older Fusion importers flatten the outer rows and cannot retain the complete tree. The manager cannot update an installed Luma app.

The **Folder rows** compatibility export is a **bare collection array**, accepted by iOS, macOS and tvOS.

- iOS: **Collection Backups → Import**.
- macOS: Collections import.
- tvOS flat collections: host the JSON at an HTTPS URL, then **Collections → Import → From URL**.

**Current app support:** the inspected iOS, macOS and tvOS code renders nested pages and `catalogGroups` headings/quick links. This source comparison does not replace a physical-device import test.

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
