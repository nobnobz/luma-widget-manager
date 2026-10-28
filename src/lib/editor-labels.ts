import type { WidgetType } from './types/widget';

export function rowTypeLabel(type: WidgetType, luma: boolean): string {
  if (type === 'collection.row') return luma ? 'Folder row' : 'Collection';
  return luma ? 'Catalog row' : 'Classic Row';
}
