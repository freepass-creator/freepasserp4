import assert from 'node:assert/strict';
import fs from 'node:fs';
import { productImages } from '../lib/domain/product-photos';

const driveUrl = '/api/drive-photo?id=drive_file_12345';
const originalUrl = 'https://example.com/original.jpg';
assert.deepEqual(
  productImages({ drive_image_urls: [driveUrl], image_urls: [originalUrl] } as any).slice(0, 2),
  [driveUrl, originalUrl],
  'Drive backup images must be shown before the original supplier images',
);

const syncSource = fs.readFileSync(new URL('../lib/server/photo-drive-sync.ts', import.meta.url), 'utf8');
for (const expected of ['RP023', '오토플러스', 'RP031', '이안카', 'PT-0023', "'SA'"]) {
  assert.ok(syncSource.includes(expected), `supplier mapping is missing: ${expected}`);
}
assert.match(syncSource, /v4\/products\//, 'photo references must only be written to v4 products');
assert.doesNotMatch(syncSource, /(?:ref|update|set)\(['"`]v3\//, 'v3 writes are forbidden');

const proxySource = fs.readFileSync(new URL('../app/api/drive-photo/route.ts', import.meta.url), 'utf8');
assert.ok(proxySource.includes("metadata.appProperties?.source !== 'freepasserp4-photo-sync'"));
assert.ok(proxySource.includes("metadata.mimeType?.startsWith('image/')"));

const vercel = JSON.parse(fs.readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
assert.ok(vercel.crons.some((job: any) => job.path === '/api/photo-drive-sync'));

console.log('PASS photo Drive sync: mapping, v4-only writes, proxy guard, display priority, daily cron');
