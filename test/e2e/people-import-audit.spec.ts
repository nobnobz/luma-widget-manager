import { test, expect } from '@playwright/test';
import { mockTemplateRepository } from '../support/app-harness';

test('imports and preserves the generated Actors hub', async ({ page }) => {
  await mockTemplateRepository(page);
  const people = ['Adam Sandler', 'Angelina Jolie', 'Anne Hathaway', 'Arnold Schwarzenegger'].map((title, i) => ({
    id: `person-${i}`, title, tileShape: 'POSTER', openTarget: 'tmdb_person', tmdbPersonId: i === 0 ? 19292 : i,
    tmdbPersonName: title, coverImageUrl: 'https://i.postimg.cc/example/cover.webp',
  }));
  const input = JSON.stringify([{ id: 'actors-widget', title: 'UME v4.0 – Actors', folders: [{
    id: 'actors', title: 'Actors', sources: [], sections: [{ id: 'letter-a', title: 'A', folders: people }],
    blockOrder: ['section:letter-a'],
  }] }]);
  await page.goto('/');
  await page.getByTestId('welcome-import-textarea').fill(input);
  await page.getByTestId('welcome-load-configuration').click();
  const widget = page.locator('[data-testid^="widget-card-"]').first();
  await expect(widget).toContainText('UME v4.0 – Actors');
  await widget.getByRole('button', { name: 'Expand widget', exact: true }).filter({ visible: true }).click();
  await widget.getByRole('button', { name: /Expand item/i }).filter({ visible: true }).first().click();
  await widget.getByRole('button', { name: 'Edit hub page', exact: true }).click();
  const hub = page.getByRole('dialog').filter({ hasText: 'Folder level 1 of 3' });
  await expect(hub).toContainText('A · 4 folders');
  await hub.getByText('A · 4 folders').click();
  await expect(hub).toContainText('Adam Sandler');
  await hub.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByTestId('export-button').click();
  await page.getByRole('button', { name: /^Folder rows \(/ }).click();
  const output = JSON.parse(await page.getByTestId('export-preview-textarea').inputValue());
  const actor = output[0].folders[0].sections[0].folders[0];
  expect(actor.title).toBe('Adam Sandler');
  expect(actor.openTarget).toBe('tmdb_person');
  expect(actor.tmdbPersonId).toBe(19292);
  expect(actor.coverImageUrl).toContain('postimg.cc');
});
