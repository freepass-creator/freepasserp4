import assert from 'node:assert/strict';
import { hasDeferredShadowBoundary } from './lib/freepass-shadow-boundary.mjs';

const imports = `import { after } from 'next/server';
import { observeFreepassDataShadow } from '@/lib/server/freepass-data-shadow';`;
const cases: [string, string, boolean][] = [
  ['returned promise', `${imports}\nafter(() => observeFreepassDataShadow(products));`, true],
  ['async diagnostics then observation', `${imports}\nafter(async () => { inspect(products); await observeFreepassDataShadow(products); });`, true],
  ['conditional scheduling', `${imports}\nif (enabled) after(() => observeFreepassDataShadow(products));`, true],
  ['import aliases', `import { after as defer } from 'next/server'; import { observeFreepassDataShadow as observe } from '@/lib/server/freepass-data-shadow'; defer(async () => { await observe(products); });`, true],
  ['request awaits shadow', `${imports}\nawait observeFreepassDataShadow(products);`, false],
  ['request fires shadow eagerly', `${imports}\nvoid observeFreepassDataShadow(products);`, false],
  ['immediate argument evaluation', `${imports}\nafter(observeFreepassDataShadow(products));`, false],
  ['deferred and eager mixed', `${imports}\nafter(() => observeFreepassDataShadow(products)); await observeFreepassDataShadow(products);`, false],
  ['comment cannot satisfy fence', `${imports}\n// after(() => observeFreepassDataShadow(products));`, false],
  ['unrelated after import', `${imports.replace("'next/server'", "'other-module'")}\nafter(() => observeFreepassDataShadow(products));`, false],
  ['missing observer import', `import { after } from 'next/server'; after(() => observeFreepassDataShadow(products));`, false],
];
for (const [name, source, expected] of cases) assert.equal(hasDeferredShadowBoundary(source), expected, name);
console.log(`PASS ${cases.length} shadow scheduling boundary cases`);
