import { closeSync, mkdirSync, openSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fetchIronRentcarCatalog } from '../lib/server/ironrentcar-source';
import { sha256Utf8 } from '../lib/server/source-snapshot';

const outArg = process.argv.find((arg) => arg.startsWith('--out='));
if (!outArg) throw new Error('로컬 보존 경로가 필요합니다: --out=<새 JSONL 파일>');
const out = resolve(outArg.slice('--out='.length));
const temporary = `${out}.tmp`;
const atomPath = `${out}.atoms.jsonl`;
const atomTemporary = `${atomPath}.tmp`;
mkdirSync(dirname(out), { recursive: true });

const catalog = await fetchIronRentcarCatalog({ cacheMs: 0 });
const lines = catalog.sourceSnapshots.map((snapshot) => JSON.stringify(snapshot));
const body = `${lines.join('\n')}\n`;
const atomsBody = `${catalog.items.map((item) => JSON.stringify(item.inventoryAtom)).join('\n')}\n`;
const manifest = {
  schema_version: 'source_snapshot_capture_manifest_v1',
  provider_code: catalog.providerCode,
  fetched_at: new Date(catalog.fetchedAt).toISOString(),
  catalog_revision: catalog.revision,
  catalog_complete: catalog.complete,
  listings: catalog.listings,
  active: catalog.active,
  sold: catalog.sold,
  parsed_items: catalog.items.length,
  errors: catalog.errors,
  snapshots: catalog.sourceSnapshots.length,
  jsonl_sha256: sha256Utf8(body),
  atoms: catalog.items.length,
  unavailable_atoms: catalog.items.filter((item) => item.inventoryAtom.availability_status === 'unavailable').length,
  atoms_jsonl_sha256: sha256Utf8(atomsBody),
};

let handle: number | undefined;
try {
  handle = openSync(temporary, 'wx');
  writeFileSync(handle, body, 'utf8');
  closeSync(handle);
  handle = undefined;
  writeFileSync(atomTemporary, atomsBody, { encoding: 'utf8', flag: 'wx' });
  renameSync(temporary, out);
  renameSync(atomTemporary, atomPath);
  writeFileSync(`${out}.manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
} catch (error) {
  if (handle != null) closeSync(handle);
  rmSync(temporary, { force: true });
  rmSync(atomTemporary, { force: true });
  throw error;
}

console.log(JSON.stringify({ out, atomPath, manifestPath: `${out}.manifest.json`, ...manifest }, null, 2));
