import { readFileSync } from 'node:fs';

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

if (bad) process.exit(1);
console.log('✓ FreePassERP.com public catalog boundary is explicit');
