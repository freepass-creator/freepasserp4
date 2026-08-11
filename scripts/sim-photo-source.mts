import assert from 'node:assert/strict';
import { productExternalImages, scrapableSources } from '../lib/domain/product-photos';

const links = [
  'https://tinyurl.com/286k7tsz',
  'https://bit.ly/49jUQpv',
];

for (const photo_link of links) {
  const product = { photo_link };
  assert.deepEqual(productExternalImages(product), [], `${photo_link} must not render directly as an image`);
  assert.deepEqual(scrapableSources(product), [photo_link], `${photo_link} must use the server extractor`);
}

console.log('사진 단축링크 분류 4/4 PASS');
