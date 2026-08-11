import assert from 'node:assert/strict';
import { createPhotoZip } from '../lib/client/download-photo-zip';

const zip = createPhotoZip([
  { name: '109호5369_01.jpg', bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]) },
  { name: '109호5369_02.png', bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]) },
]);
const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
const text = new TextDecoder().decode(zip);

assert.equal(view.getUint32(0, true), 0x04034b50, 'ZIP local header');
assert.equal(view.getUint32(zip.byteLength - 22, true), 0x06054b50, 'ZIP end record');
assert.equal(view.getUint16(zip.byteLength - 12, true), 2, 'ZIP entry count');
assert.ok(text.includes('109호5369_01.jpg'), 'UTF-8 filename 1');
assert.ok(text.includes('109호5369_02.png'), 'UTF-8 filename 2');
console.log('사진 ZIP 4/4 PASS');
