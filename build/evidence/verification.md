# Luma Widget Manager — Fusion UI integration, 2026-10-28

## Result

The standalone Luma form editor was removed. The existing Fusion MainEditor, widget grid, collection editor, folder cards, import review, trash, manifest controls, theme controls and responsive dialogs are reused. Luma branding uses the existing Luma icon. The UME v4.0 structural starter appears in the existing template picker.

Native page editing opens from the existing folder card. Nested folders use CollectionItemEditor as well. Sections, closing subfolder grids, page order, duplicate/restore actions, page undo, per-catalog options and collection settings remain in their respective editing contexts. The third folder level cannot create more descendants.

## Verification

- Unit suite: 150 passed, 0 failed, including native preservation through partial-import normalization, storage, import review, catalog options and animated-cover application.
- TypeScript, ESLint and production static build passed.
- Existing browser suite passed alongside six new Luma workflow checks. Two additional cover-pack checks initially had an ambiguous status selector; the selector was corrected and the final focused Luma suite was rerun on desktop/mobile.
- Reference and implementation screenshots were captured at matching 1440×1080 dimensions and compared side by side: `fusion-luma-comparison.png`. Desktop widget/hub and mobile hub screenshots are local evidence in this directory.

## Import contracts and boundaries

- Native Luma collections export uses a bare array, with iOS's 4 MB / 500 collection bounds and LumaCore's maximum three folder levels.
- Unknown native folder/source fields and animation fields remain attached to editor projections, including through reload and import review. Incomplete sources block export visibly.
- The active AIOMetadata configuration URL becomes the portable `preset:aiometadata` reference on native export.
- Native-only pages cannot be silently downgraded to legacy Fusion/Omni output.
- Previous standalone-editor native drafts migrate into the unified editor; the original native draft remains as a recovery copy until intentional restart.

## Packs

- The existing animated-cover browser applies video/backdrop URLs to matching nested folder titles and preserves custom videos. Videos are included in the ordinary Luma collections export. Missing widget-template blueprints do not disable applying cover videos to existing folders.
- The existing tag-pack browser provides the original Fusion UME badge-pack URLs and Luma instructions. Badge packs use Luma's separate settings importer; they are not incorrectly placed in collection JSON.
- Confirmed against the current Luma source: shared StreamBadges parser/settings, native collection wire format and tvOS focus-video cells. Focus-video playback is implemented on tvOS. Persistence of animation fields on other platforms is not a playback claim.
- iOS/macOS render nested pages. The inspected tvOS folder browser still lacks that capability. No Luma application code or physical-device import was changed/performed.

## Add Folder crash fix

Reproduced on the deployed site: opening Add Folder passed an undefined source into DataSourceEditor, which read `.payload` and crashed the page. Luma intentionally starts a folder with no catalogs. AddItemDialog now renders an explicit catalog-free state and mounts the source editor only when a source exists. Catalogs can be added/removed before creation. The native folder snapshot uses the actual generated folder ID.

The dedicated browser regression passed on desktop and mobile: create a catalog-free folder in a collection, in a hub section and in a subfolder grid; add/remove an optional catalog; verify native export and absence of page errors. Production build and ESLint passed.
