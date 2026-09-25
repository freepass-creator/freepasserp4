/** Offline public-catalog contract regressions. No Firebase, network or source writes. */
import assert from 'node:assert/strict';
import {
  FREEPASS_CATALOG_CONTRACT_VERSION, FREEPASS_CATALOG_ISSUES,
  catalogProductId, catalogVehicleIdentity, diffFreepassCatalogIssues, inspectFreepassCatalogProduct,
  summarizeFreepassCatalogIssues, type FreepassCatalogContractIssue, type FreepassCatalogProduct,
} from '../lib/domain/freepass-catalog-contract.js';

const good: FreepassCatalogProduct = {
  _key: 'catalog-test-1', product_code: 'catalog-test-1', car_number: 'TEST-PLATE',
  price: { '12': { rent: 670_000, deposit: 0 } },
};
type Case = { name: string; value: unknown; expected: readonly FreepassCatalogContractIssue[] };
const cases: Case[] = [];
const add = (name: string, value: unknown, expected: readonly FreepassCatalogContractIssue[] = []) =>
  cases.push({ name, value, expected });
const withRate = (rate: unknown, key = '12') => ({ ...good, price: { [key]: rate } });
const rate = { rent: 670_000, deposit: 0 };

add('normal product, optional details absent', good);
for (const key of ['1', '6', '12', '60', '24_3만', '36_20000']) add(`valid term ${key}`, withRate(rate, key));
for (const key of ['0', '61', '-1', '1.5', '1e1', '12months', '12_', '']) {
  add(`invalid term ${key || '(empty)'}`, withRate(rate, key), ['invalid-term']);
}
for (const rent of [0, 99_999, 20_000_001, -1, NaN, Infinity, -Infinity, true, false, null, undefined, '', '670000', '670,000', [], {}]) {
  add(`invalid rent ${String(rent)}`, withRate({ ...rate, rent }), ['invalid-price']);
}
add('one good row cannot hide a bad row', {
  ...good, price: { '12': rate, '36': { rent: -1, deposit: 0 } },
}, ['invalid-price']);
for (const deposit of [-1, NaN, Infinity, true, false, null, undefined, '', '0']) {
  add(`invalid deposit ${String(deposit)}`, withRate({ ...rate, deposit }), ['invalid-deposit']);
}
add('explicit zero deposit stays valid', withRate(rate));
for (const value of [null, undefined, false, 'wrong', 42, []]) add('malformed product', value, ['invalid-product']);
add('missing price', { ...good, price: undefined }, ['missing-price']);
add('empty price', { ...good, price: {} }, ['missing-price']);
for (const price of [[], 'wrong', 42]) add('malformed price map', { ...good, price }, ['invalid-price']);
for (const value of [null, [], 'wrong']) add('malformed rate', withRate(value), ['invalid-price']);
add('whitespace identifier falls back to key', { ...good, product_code: '   ' });
add('identifier objects are not stringified', { ...good, product_code: {}, _key: false }, ['missing-product-id']);
add('blank plate falls back to VIN', { ...good, car_number: ' ', vin: 'TEST-VIN' });
add('missing vehicle identity', { ...good, car_number: '', vin: '' }, ['missing-vehicle-identity']);
add('vehicle identity object is invalid', { ...good, car_number: {} }, ['missing-vehicle-identity']);
for (const year of [undefined, null, '', 2019, '2019-03', '24년식', '99년식']) add('valid or absent year', { ...good, year });
for (const year of ['unknown', 1899, 2200]) add('invalid year', { ...good, year }, ['invalid-year']);
for (const mileage of [0, 83_000, undefined, null, '']) add('valid or absent mileage', { ...good, mileage });
for (const mileage of [-1, NaN, Infinity, true, '83000']) {
  add('invalid mileage', { ...good, mileage }, ['invalid-mileage']);
}
for (const image_url of [undefined, null, '', 'https://example.test/car.jpg', '/api/img?src=car', 'http://example.test/car.jpg']) {
  add('valid or absent image', { ...good, image_url });
}
for (const image_url of ['javascript:alert(1)', 'data:image/png;base64,x', '//evil.test/car', '/\\evil.test/car', 'https://u:p@example.test/car', 'https://', 'not-a-url', 42]) {
  add('invalid image URL', { ...good, image_url }, ['invalid-image-url']);
}
add('empty gallery', { ...good, image_urls: [] });
add('valid gallery', { ...good, image_urls: ['https://example.test/a', '/images/b.jpg'] });
add('bad gallery member', { ...good, image_urls: ['https://example.test/a', null] }, ['invalid-image-url']);
add('gallery is not an array', { ...good, image_urls: 'https://example.test/a' }, ['invalid-image-url']);
add('source folder list is not a resolved image', { ...good, photo_link: 'folder-a,folder-b' });
add('missing price does not hide other issues', { ...good, price: null, mileage: -1, image_url: 'javascript:x' },
  ['missing-price', 'invalid-mileage', 'invalid-image-url']);
add('same issue counted once per product', {
  ...good, price: { '12': { rent: -1, deposit: -1 }, '36': { rent: 0, deposit: -2 } },
  image_url: 'javascript:x', image_urls: ['bad', 'also-bad'],
}, ['invalid-price', 'invalid-deposit', 'invalid-image-url']);

for (const { name, value, expected } of cases) {
  assert.deepEqual([...inspectFreepassCatalogProduct(value)].sort(), [...expected].sort(), name);
}
assert.equal(FREEPASS_CATALOG_CONTRACT_VERSION, '1.0');
assert.equal(catalogProductId({ product_code: ' ', _key: 'fallback' }), 'fallback');
assert.equal(catalogVehicleIdentity({ car_number: ' ', vin: 'TEST-VIN' }), 'TEST-VIN');
assert.equal(catalogProductId(null), '');

const frozen = Object.freeze({ ...good, price: Object.freeze({ '12': Object.freeze({ ...rate }) }) });
const before = JSON.stringify(frozen);
inspectFreepassCatalogProduct(frozen);
assert.equal(JSON.stringify(frozen), before, 'inspection must not mutate input');
const counts = summarizeFreepassCatalogIssues([good, null, withRate({ rent: -1, deposit: -1 })]);
assert.equal(counts['invalid-product'], 1);
assert.equal(counts['invalid-price'], 1);
assert.equal(counts['invalid-deposit'], 1);
for (const issue of FREEPASS_CATALOG_ISSUES) assert.equal(typeof counts[issue], 'number');
assert.deepEqual(summarizeFreepassCatalogIssues([]), Object.fromEntries(FREEPASS_CATALOG_ISSUES.map((x) => [x, 0])));

const masked = diffFreepassCatalogIssues(
  { ...good, price: { '12': { rent: '670000', deposit: 0 } } },
  good,
);
assert.deepEqual(masked.inputIssues, ['invalid-price']);
assert.deepEqual(masked.published, []);
assert.deepEqual(masked.maskedByAdapter, ['invalid-price']);
assert.deepEqual(masked.introducedByAdapter, []);

const introduced = diffFreepassCatalogIssues(good, { ...good, mileage: -1 });
assert.deepEqual(introduced.inputIssues, []);
assert.deepEqual(introduced.published, ['invalid-mileage']);
assert.deepEqual(introduced.maskedByAdapter, []);
assert.deepEqual(introduced.introducedByAdapter, ['invalid-mileage']);

// Compile-time fence: assertions/casts are not a substitute for these checks.
type AssertFalse<T extends false> = T;
type NoOpenIndex = AssertFalse<string extends keyof FreepassCatalogProduct ? true : false>;
type NoPrivateKeys = AssertFalse<
  Extract<keyof FreepassCatalogProduct, 'fee' | 'commission' | 'account_number' | 'provider_company_code' | 'source'> extends never
    ? false : true
>;
function typeFence(product: FreepassCatalogProduct): void {
  // @ts-expect-error Internal source identifiers are not public properties.
  void product.provider_company_code;
  // @ts-expect-error Settlement bank details are not public properties.
  void product.account_number;
  // @ts-expect-error Rates must not expose commission.
  void product.price['12'].fee;
}
void typeFence;
console.log(`PASS ${cases.length} contract cases + identity/immutability/summary assertions`);
