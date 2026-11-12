import { test } from 'node:test';
import assert from 'node:assert/strict';
import { previewArtworkURL } from './preview-artwork';

test('synced artwork previews reject credentials, signed URLs and local addresses without rewriting them', () => {
  assert.equal(previewArtworkURL(' https://art.example.com/covers/film.jpg ', true), 'https://art.example.com/covers/film.jpg');
  for (const input of ['http://art.example.com/a.png', 'https://u:p@art.example.com/a.png', 'https://art.example.com/a.png?token=secret', 'https://art.example.com/a.png#private',
    'https://192.168.0.1/a.png', 'https://[::1]/a.png', 'https://media.home.arpa/a.png', 'https://media.local./a.png', 'https://127.1/a.png', '//media.example.org/a.png']) {
    assert.equal(previewArtworkURL(input, true), null);
  }
  assert.equal(previewArtworkURL('http://local.test/a.png', false), 'http://local.test/a.png');
  assert.equal(previewArtworkURL('/artwork/folder.png', false), '/artwork/folder.png');
  assert.equal(previewArtworkURL('javascript:alert(1)', false), null);
});
