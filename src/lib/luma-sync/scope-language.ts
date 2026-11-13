import type { PreferenceField } from './preferences';

const german: Record<string, string> = {
  'Per device': 'Gerätetyp', 'Device type': 'Gerätetyp',
  'Appearance': 'Darstellung', 'Home': 'Startseite', 'Playback': 'Wiedergabe',
  'Poster card size': 'Postergröße',
  'Use true black': 'Reines Schwarz verwenden',
  'Blur browsing backgrounds': 'Hintergründe beim Stöbern weichzeichnen',
  'Blur artwork in Home': 'Bilder auf der Startseite weichzeichnen',
  'Blur artwork in Catalogs': 'Bilder in Katalogen weichzeichnen',
  'Blur artwork in Search': 'Bilder in der Suche weichzeichnen',
  'Blur artwork in Details': 'Bilder in der Detailansicht weichzeichnen',
  'Blur artwork in People': 'Bilder in der Personenansicht weichzeichnen',
  'Fullscreen banner backdrop': 'Bannerhintergrund im Vollbild',
  'Rotate the featured banner automatically': 'Banner automatisch wechseln',
  'Featured banner items': 'Anzahl der Bannertitel',
  'Row card orientation': 'Kartenausrichtung in Reihen',
  'Skip forward and back': 'Sprungweite vor und zurück',
  'Preload sources': 'Quellen vorladen',
  'Badge placement': 'Badge-Position', 'Badge size': 'Badge-Größe',
  'Play previews in the featured banner': 'Vorschauen im Banner abspielen',
  'Play previews on detail pages': 'Vorschauen auf Detailseiten abspielen',
  'Play preview sound': 'Vorschauton abspielen', 'Preview volume': 'Vorschau-Lautstärke',
  'Compact': 'Kompakt', 'Large': 'Groß', 'Extra Large': 'Sehr groß', 'Huge': 'Riesig',
  'Portrait': 'Hochformat', 'Landscape': 'Querformat',
  'Above title': 'Über dem Titel', 'Below title': 'Unter dem Titel',
  'Sort sources': 'Quellen sortieren', 'Default': 'Standard', 'Quality': 'Qualität', 'Size': 'Größe',
  'On': 'Ein', 'Off': 'Aus',
  'Edit in Luma.': 'In Luma bearbeiten.',
  'Restore app default': 'App-Standard wiederherstellen',
  'Requires Luma 0.5.10 or later.': 'Benötigt Luma 0.5.10 oder neuer.',
  'These settings can’t be edited here. Open them in Luma.': 'Diese Einstellungen lassen sich hier nicht bearbeiten. Öffne sie in Luma.',
  'These settings apply only to devices of this type. Everything else applies to all devices of the profile.':
    'Diese Einstellungen gelten für alle Geräte dieses Typs. Die übrigen Einstellungen gelten für das ganze Profil.',
  'Applies to all devices of this profile. Screen, input and performance settings are under Per device.':
    'Gilt für alle Geräte dieses Profils. Einstellungen für Bildschirm, Eingabe und Leistung findest du unter „Gerätetyp“.',
  'Badge placement and size are set for each device type under Per device. The preview shows iPhone & iPad.':
    'Badge-Position und -Größe werden unter „Gerätetyp“ eingestellt. Die Vorschau zeigt iPhone und iPad.',
};

export function scopeText(label: string, useGerman: boolean): string {
  if (!useGerman) return label;
  const seconds = /^(\d+) seconds$/.exec(label);
  return seconds ? seconds[1] + ' Sekunden' : german[label] ?? label;
}

export function scopeField(field: PreferenceField, useGerman: boolean): PreferenceField {
  if (!useGerman) return field;
  const label = scopeText(field.label, true);
  if (field.kind === 'select') return { ...field, label, options: field.options.map(([value, text]) => [value, scopeText(text, true)] as const) };
  return { ...field, label };
}
