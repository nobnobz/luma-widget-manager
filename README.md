# Luma Widget Manager

A native Luma collection builder for UME v4.0, derived from [Fusion Widget Manager](https://github.com/nobnobz/fusion-widget-manager) with its Git history and MIT license preserved.

[Open the manager](https://nobnobz.github.io/luma-widget-manager/)

Create Home collections containing hub folders. Each folder can open a page with catalog rows, horizontal sections of folders, and a closing subfolder grid. Folders can nest to three levels, matching LumaCore's editor limit.

- Create, rename, enable, reorder, delete and move folders between hubs, sections and grids. Undo the last 30 edits.
- Arrange catalog and section blocks in a folder page. Set tile shapes, folder view mode, covers, focus videos, hero backdrops and logos.
- Load an add-on manifest to pick catalogs, or enter catalog routes directly. Manifest IDs are exported without embedding the fetched configuration URL.
- Import Fusion v1 widgets, native collection arrays, or `{ "collections": [...] }` documents. Unknown native fields remain intact.
- Export validated native Luma JSON, copy it, and resume browser-local drafts. Invalid imports never replace your draft.
- Use **Fusion tools** for the original manager, its templates and integrations, then **Use current Fusion workspace** to bring its export into the Luma builder.

## Start UME v4.0

Choose **Load UME starter** for a structural example: UME → Movies → Explore → Genres → Science fiction / Thriller, plus Series and Anime entry folders. These are empty layout placeholders; add real catalogs and artwork before publishing your pack. The starter replaces the current draft; Undo restores it.

A Home collection is a row of entry cards. An entry folder becomes a hub page when it contains sections or subfolders. Catalog and section blocks follow `blockOrder`; the subfolder grid always renders last.

Download `ume-v4-luma-collections.json`. The export is a bare collection array, required by iOS and also accepted by macOS/tvOS. On iOS use **Collection Backups → Import**; on macOS use Collections import. For flat collections on tvOS, host the file at an HTTPS URL and choose **Collections → Import → From URL**. An editor URL or GitHub HTML page is not the JSON URL.

**Current platform limit:** the inspected iOS and macOS browsers render nested pages. The current tvOS folder model/browser does not decode/render `sections` or `subfolders`; importing a valid file there does not make nested hubs usable. A separate Luma tvOS implementation is still required.

## Compatibility

Luma already imports Fusion `collection.row` and add-on `row.classic` widgets. Its Fusion v1 importer does not carry nested pages. This builder exports nested structures using Luma's existing **native collections** contract, not extra Fusion fields that older importers would ignore.

When converting Fusion to native collections, `row.classic` becomes a catalog folder in its own collection, with an explicit notice: native collection files do not describe independent Home catalog-row placement. Unsupported Fusion widget/source kinds are rejected; nothing is silently dropped. Keep the original Fusion export if you need its precise Home shelf placement.

Provider configuration and catalog availability still belong to Luma. A layout-only folder has no playable content until sources are attached and the corresponding add-on is installed. Browser manifest fetching requires server CORS support. Local drafts can include source addresses, so review downloaded JSON before publishing it.

The wire keys were checked against the local Luma source on 2026-10-28: `CollectionFolderPage`, `CollectionSyncDocument`, `MediaCollectionWire`, `FusionWidgetExport`, and the tvOS native collection import. No physical-device import is implied by the web tests. This project does not modify the Luma app.

## Development and storage

Node 22+ and npm. On this Mac **always** use the wrapper; one shared cache root is `/Volumes/Jarvis SSD/DeveloperData/Caches/luma-widget-manager`. It stores dependencies, Next build data, npm cache and temporary files externally and fails if the SSD is missing.

```sh
./scripts/with-external-cache.sh npm ci
./scripts/with-external-cache.sh npm run dev
./scripts/with-external-cache.sh npm run lint
./scripts/with-external-cache.sh npm run typecheck
./scripts/with-external-cache.sh npm run test:unit
./scripts/with-external-cache.sh npm run build
./scripts/with-external-cache.sh npm run test:e2e
```

The existing `/fusion` tools retain their tests. GitHub Actions builds a static export and deploys GitHub Pages under this repository's name. Build/test evidence belongs in `build/evidence/`.
