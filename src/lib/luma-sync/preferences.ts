import { libraryRowField, readLibraryRow } from './library-row';
import { libraryOrderField, libraryShelves, validLibraryOrder } from './library-layout';
import { parseGenrePreference, personGenreDefaultsField, personGenreField, searchAddonField, searchGenreField, validMetadataLanguage, validSearchAddon } from './metadata-preferences';
import { personLayoutField, readPersonLayout } from './person-layout';

// Portable fields from LumaCore SharedPreferenceCatalog. Identifiers that
// require an installed provider, its credentials or a platform slot stay native.
export type Scalar = string | number | boolean;
export type PreferenceSettings = Record<string, Scalar | null | undefined>;
export type PreferenceField = { id: string; label: string } & (
  { kind: 'toggle'; fallback: boolean } |
  { kind: 'select'; fallback: Scalar | null; options: readonly (readonly [Scalar, string])[] } |
  { kind: 'locale'; fallback: string; options: readonly (readonly [string, string])[] } |
  { kind: 'languages'; fallback: string; options: readonly string[] } |
  { kind: 'number'; fallback: number | null; min: number; max: number; step: number; unit?: string }
);
const toggle = (id: string, label: string, fallback = true): PreferenceField => ({ id, label, fallback, kind: 'toggle' });
const select = (id: string, label: string, fallback: Scalar | null, options: readonly (readonly [Scalar, string])[]): PreferenceField =>
  ({ id, label, fallback, options, kind: 'select' });
const numeric = (id: string, label: string, fallback: number | null, min: number, max: number, step = 1, unit?: string): PreferenceField =>
  ({ id, label, fallback, min, max, step, unit, kind: 'number' });
const options = (values: readonly (number | string)[]) => values.map(value => [value, String(value)] as const);
const languages = [['', 'System'], ['en', 'English'], ['de', 'Deutsch'], ['es', 'Español'], ['fr', 'Français'], ['it', 'Italiano'], ['pt-BR', 'Português (Brasil)'],
  ['zh-CN', '简体中文'], ['ja', '日本語'], ['ko', '한국어'], ['ru', 'Русский']] as const;
export const subtitleLanguages = ['English', 'Arabic', 'Bulgarian', 'Chinese', 'Croatian', 'Czech', 'Danish', 'Dutch', 'Finnish', 'French', 'German', 'Greek', 'Hebrew',
  'Hindi', 'Hungarian', 'Indonesian', 'Italian', 'Japanese', 'Korean', 'Norwegian', 'Polish', 'Portuguese', 'Romanian', 'Russian', 'Spanish', 'Swedish', 'Thai', 'Turkish',
  'Ukrainian', 'Vietnamese'];
const providerChoices = [['LOCAL', 'Luma'], ['TRAKT', 'Trakt'], ['SIMKL', 'Simkl'], ['MDBLIST', 'MDBList'], ['PUBLICMETADB', 'PublicMetaDB']] as const;
export const formatterPresentationFields = [
  toggle('playback.formatter.showTitles', 'Show Stream Titles'),
  toggle('playback.formatter.showDetails', 'Show Stream Details'),
  select('playback.formatter.placement', 'Badge Placement', 'BOTTOM', [['TOP', 'Above title'], ['BOTTOM', 'Below title']]),
  select('playback.formatter.size', 'Badge Size', 'COMPACT',
    [['COMPACT', 'Compact'], ['STANDARD', 'Standard'], ['LARGE', 'Large'], ['EXTRA_LARGE', 'Extra Large'], ['HUGE', 'Huge']]),
];

export const trackingGroups = [
  { title: 'Sources', fields: [select('progress.source', 'Watch progress', 'LOCAL', providerChoices), select('library.source', 'Watchlist', 'LOCAL', providerChoices)] },
  { title: 'Continue Watching', fields: [
    toggle('progress.visible', 'Show on Home'),
    select('progress.sortMode', 'Sort order', 'Default', options(['Default', 'Streaming Style'])),
    select('progress.maxItems', 'Maximum items', 0, [[0, 'Unlimited'], ...options(Array.from({ length: 10 }, (_, i) => 5 * (i + 1)))]),
    select('progress.historyDays', 'History window', 60, [[0, 'All history'], ...[14, 30, 60, 90, 180, 365].map(n => [n, `${n} days`] as const)]),
    toggle('progress.furthest', 'Start Next Up from the furthest watched episode'), toggle('progress.unaired', 'Include unaired episodes'),
    toggle('progress.separateUpcoming', 'Show upcoming episodes in a separate row', false), toggle('progress.blurUpcoming', 'Blur upcoming episode art', false),
    toggle('progress.episodeThumbnails', 'Show episode thumbnails'), toggle('progress.directSources', 'Open directly to sources', false),
  ] },
  { title: 'Library', fields: [
    toggle('library.rememberFilters', 'Remember library filters', false),
    numeric('library.upcomingHorizon', 'Upcoming window', 30, 7, 90, 1, 'days'),
    select('library.upcomingMovieRelease', 'Movie release dates', 'general', [['general', 'General release'], ['digital', 'Digital release']]),
  ] },
];
export const skipSchemaField = 'playback.skip.schema';
export const skipFields = [
  ...[['intro', 'Intros'], ['recap', 'Recaps'], ['credits', 'Credits']].flatMap(([kind, label]) => [
    select(`playback.skip.${kind}.mode`, label, null, [['off', 'Off'], ['manual', 'Show skip button'], ['automatic', 'Skip automatically']]),
    numeric(`playback.skip.${kind}.delay`, `${label}: automatic skip delay`, 5, 0, 30, 1, 'seconds'),
  ]),
  toggle('playback.skip.protectBonusScenes', 'Protect bonus scenes'),
];
const skipIds = new Set(skipFields.map(field => field.id));
export const isSkipField = (id: string) => skipIds.has(id);
export const preferenceGroups = [
  { title: 'Appearance', fields: [
    select('language', 'App language', '', languages),
    select('appearance.background', 'App background', 'Charcoal', options(['Charcoal', 'Black', 'Midnight', 'Forest', 'Plum', 'Slate', 'Wine', 'Ocean', 'Indigo', 'Crimson', 'Rust', 'Teal'])),
    toggle('appearance.oled', 'Use true black', false), toggle('appearance.browseBlur', 'Blur browsing backgrounds'),
    ...['Home', 'Catalogs', 'Search', 'Details', 'People'].map(label => toggle(`appearance.blur.${label.toLowerCase()}`, `Blur artwork in ${label}`)),
  ] },
  { title: 'Playback', fields: [
    toggle('playback.autoNext', 'Play the next episode automatically'), numeric('playback.nextCountdown', 'Next episode countdown', 10, 1, 120, 1, 'seconds'),
    toggle('playback.postPlay', 'Show recommendations after playback'), toggle('playback.seekThumbnails', 'Show thumbnails while seeking'),
    toggle('playback.introSkip', 'Look up intro and credits markers'), toggle('playback.cachedOnly', 'Only show cached streams', false),
    toggle('playback.preloadSources', 'Preload sources'), toggle('playback.sourceFallback', 'Try another source when playback fails'),
    toggle('playback.showEpisodes', 'Show episode picker'), toggle('playback.showSources', 'Show source picker'),
  ] },
  { title: 'Skip scenes', fields: skipFields },
  { title: 'Audio and subtitles', fields: [
    select('playback.audioLanguage', 'Preferred audio language', 'System', options(['System', ...subtitleLanguages])),
    toggle('playback.subtitleMatching', 'Match subtitles to the selected audio'),
    toggle('playback.forcedSubtitles', 'Only show forced subtitles', false),
    { id: 'playback.subtitleLanguages', label: 'Preferred subtitle languages', kind: 'languages', fallback: '[]', options: subtitleLanguages } as PreferenceField,
  ] },
  { title: 'Trailers', fields: [
    toggle('playback.trailersEnabled', 'Enable trailers'), toggle('playback.englishTrailers', 'Prefer English trailers'),
    select('playback.trailerLanguage', 'Trailer language', null, languages),
    toggle('trailers.heroPreviews', 'Play previews in the featured banner'), toggle('trailers.heroWatched', 'Play previews for watched items in the banner'),
    toggle('trailers.detailPreviews', 'Play previews on detail pages'), toggle('trailers.detailMovies', 'Play previews for movies'),
    toggle('trailers.detailSeries', 'Play previews for series'), toggle('trailers.detailWatched', 'Play previews for watched items on detail pages', false),
    toggle('trailers.detailInProgress', 'Play previews for items in progress', false), toggle('trailers.sound', 'Play preview sound', false),
    numeric('trailers.delay', 'Preview delay', 3, 0, 30, 1, 'seconds'), numeric('trailers.volume', 'Preview volume', 100, 0, 100, 1, '%'),
  ] },
  { title: 'Details and ratings', fields: [
    toggle('content.hideUnreleased', 'Hide unreleased titles', false), toggle('content.showFullDates', 'Show full release dates'),
    toggle('content.comments', 'Show comments'), select('details.castLimit', 'Maximum cast members', 15, [[0, 'Unlimited'], ...options([10, 15, 20, 25])]),
    toggle('ratings.enabled', 'Show ratings', false),
    ...[['imdb', 'IMDb'], ['tmdb', 'TMDB'], ['tomatoes', 'Rotten Tomatoes'], ['metacritic', 'Metacritic'], ['trakt', 'Trakt'], ['letterboxd', 'Letterboxd'], ['audience', 'Audience scores']]
      .map(([id, label]) => toggle(`ratings.${id}`, `Show ${label}`)),
  ] },
  { title: 'Metadata', fields: [
    toggle('metadata.enabled', 'Use TMDB metadata', false), toggle('metadata.applyToHome', 'Apply TMDB metadata to Home', false),
    { id: 'metadata.language', label: 'TMDB language', kind: 'locale', fallback: 'en-US',
      options: [['en-US', 'English (US)'], ...languages.slice(1)] } as PreferenceField,
    ...[['Trailers', 'trailers'], ['Artwork', 'artwork'], ['BasicInfo', 'basic information'], ['Details', 'details'], ['Credits', 'cast and crew'],
      ['Episodes', 'episode details'], ['MoreLikeThis', 'recommendations'], ['Productions', 'production companies'], ['Networks', 'networks'],
      ['SeasonPosters', 'season posters'], ['Collections', 'collections']].map(([id, label]) => toggle(`metadata.use${id}`, `Use TMDB for ${label}`)),
    select('metadata.moreLikeThisSource', 'Related titles', 'TMDB', [['TMDB', 'TMDB'], ['TRAKT', 'Trakt'], ['SIMKL', 'Simkl']]),
  ] },
  { title: 'Search', fields: [
    select('metadata.searchProvider', 'Search provider', 'tmdb', [['tmdb', 'TMDB'], ['aiometadata', 'AIOMetadata'], ['addons', 'Add-ons']]),
    toggle('search.includePeople', 'Include people in search'), toggle('search.peopleRequirePhoto', 'Require a photo for people', false),
    toggle('search.requireArtwork', 'Require artwork for titles', false), toggle('search.hideLowQuality', 'Hide low-quality results'),
    numeric('search.minimumRating', 'Minimum search rating', null, 0, 10, 0.1),
    numeric('search.minimumVoteCount', 'Minimum search votes', null, 0, 1_000_000_000),
  ] },
  { title: 'Person pages', fields: [
    select('metadata.personMovieBilling', 'Cast position', '20', [
      ['10', 'First 10'], ['15', 'First 15'], ['20', 'First 20'], ['30', 'First 30'], ['all', 'Any position'],
    ]),
    toggle('metadata.personExcludeSelf', 'Exclude self appearances'),
    toggle('metadata.personExcludeArchiveFootage', 'Exclude archive footage'),
    toggle('metadata.personApplyQualityToUnreleased', 'Apply rating and vote filters to unreleased titles'),
    numeric('metadata.minimumPersonRating', 'Minimum filmography rating', null, 0, 10, 0.1),
    numeric('metadata.minimumPersonVoteCount', 'Minimum filmography votes', null, 0, 1_000_000_000),
    toggle('metadata.hidePersonTitlesWithoutPoster', 'Hide titles without a TMDB poster', false),
  ] },
];
const fields = new Map([...trackingGroups, ...preferenceGroups].flatMap(group => group.fields).map(field => [field.id, field]));
for (const field of formatterPresentationFields) fields.set(field.id, field);
for (const row of libraryShelves) fields.set(row.field, toggle(row.field, row.label));
fields.set('progress.chosen', toggle('progress.chosen', '', false));
fields.set(skipSchemaField, select(skipSchemaField, '', null, [[1, 'Version 1']]));
for (const id of [personGenreDefaultsField, 'metadata.personShowKnownFor', 'metadata.personShowTimeline']) fields.set(id, toggle(id, ''));
const specialFields = new Set([libraryRowField, libraryOrderField, personGenreField, searchGenreField, searchAddonField, personLayoutField]);
export const isPreferenceField = (name: string) => specialFields.has(name) || fields.has(name);
export function validPreferenceValue(name: string, value: unknown): value is Scalar | null {
  if (name === libraryRowField) return value === null || value === '' || readLibraryRow(value) !== null;
  if (name === libraryOrderField) return value === null || validLibraryOrder(value);
  if (name === personLayoutField) return value === null || readPersonLayout(value) !== null;
  if (name === personGenreField || name === searchGenreField) return value === null || parseGenrePreference(value, name === personGenreField) !== null;
  if (name === searchAddonField) return value === null || validSearchAddon(value);
  const field = fields.get(name);
  if (!field) return false;
  if (value === null) return true;
  if (field.kind === 'toggle') return typeof value === 'boolean';
  if (field.kind === 'select') return field.options.some(([option]) => option === value);
  if (field.kind === 'locale') return validMetadataLanguage(value);
  if (field.kind === 'languages') {
    if (typeof value !== 'string' || value.length > 4096) return false;
    try {
      const list: unknown = JSON.parse(value);
      return Array.isArray(list) && list.length <= 100 && new Set(list).size === list.length &&
        list.every(item => field.options.includes(item));
    } catch { return false; }
  }
  return typeof value === 'number' && Number.isFinite(value) && value >= field.min && value <= field.max &&
    (field.step < 1 || Number.isInteger(value));
}
