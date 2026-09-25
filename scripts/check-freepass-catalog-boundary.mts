import { readFileSync } from 'node:fs';
// Keep the existing whitelabel gate and execute offline value regressions too.
import './sim-freepass-catalog-contract.mts';

const PUBLIC_SURFACE_FILES = [
  'app/(shop)/shop/ShopView.tsx',
  'components/shop/ShopCard.tsx',
  'lib/server/guest-listing.ts',
];

let bad = 0;
for (const file of PUBLIC_SURFACE_FILES) {
  const text = readFileSync(file, 'utf8');
  if (file !== 'lib/server/guest-listing.ts' && /\bEntityRecord\b/.test(text)) {
    bad += 1;
    console.error(`✗ ${file}: public surface must use FreepassCatalogProduct, not EntityRecord`);
  }
  if (!/FreepassCatalogProduct/.test(text)) {
    bad += 1;
    console.error(`✗ ${file}: FreepassCatalogProduct contract is not referenced`);
  }
}

const shop = readFileSync('app/(shop)/shop/ShopView.tsx', 'utf8');
if (!shop.includes('Array.isArray(body.products)')) {
  bad += 1;
  console.error('✗ shop client must reject malformed catalog products payloads');
}

const feed = readFileSync('app/api/catalog/feed/route.ts', 'utf8');
if (!feed.includes('FREEPASS_CATALOG_CONTRACT_VERSION')) {
  bad += 1;
  console.error('✗ catalog feed must publish FREEPASS_CATALOG_CONTRACT_VERSION');
}

const contract = readFileSync('lib/domain/freepass-catalog-contract.ts', 'utf8');
if (!contract.includes("FREEPASS_CATALOG_CONTRACT_VERSION = '1.0'")) {
  bad += 1;
  console.error('✗ public catalog contract version changed unexpectedly');
}
const productType = /export type FreepassCatalogProduct = \{([\s\S]*?)\n\};/.exec(contract)?.[1] || '';
if (!productType || /FreepassCatalogProduct\s*=\s*EntityRecord/.test(contract) || /\[key:\s*string\]/.test(productType)) {
  bad += 1;
  console.error('✗ FreepassCatalogProduct must be a narrow explicit public shape');
}
for (const forbidden of ['vehicle_price', 'fee', 'commission', 'account_number', 'provider_company_code', 'partner_code', 'source']) {
  if (new RegExp('\\b' + forbidden + '\\??:').test(productType)) {
    bad += 1;
    console.error(`✗ public contract exposes forbidden internal field: ${forbidden}`);
  }
}

const adapter = readFileSync('lib/domain/public-catalog.ts', 'utf8');
if (!adapter.includes('): FreepassCatalogProduct {')) {
  bad += 1;
  console.error('✗ public catalog adapter must return FreepassCatalogProduct');
}

if (bad) process.exit(1);
console.log('✓ FreePassERP.com public catalog boundary is explicit');
