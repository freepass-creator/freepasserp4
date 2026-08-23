import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DATABASE_URL } from './deploy/_ctx.mts';
import {
  freepassSignTokenFromUrl,
  hashFreepassSignToken,
  canonicalLegacyFreepassSignUrl,
  configuredFreepassPublicBase,
  privateLinkDecision,
  publicLinkDecision,
  runCasTransaction,
  sameFreepassSignToken,
  verifyBackup,
  type Versioned,
} from './migrate-freepass-legacy-sign-urls.mts';

const token = `fps_${'a'.repeat(43)}`;
const rawUrl = `https://freepasserp.com/sign/${token}`;
const canonicalUrl = `https://freepasserp.com/sign/${token}`;
const hash = hashFreepassSignToken(token);
const candidate = { contractCode: 'C_MIGRATE_001', hash, rawUrl, canonicalUrl };
const backupText = '{}';
const backupSha256 = createHash('sha256').update(backupText, 'utf8').digest('hex');
const backupNode = { count: 0, bytes: Buffer.byteLength(backupText), sha256: backupSha256, capturedAt: new Date().toISOString() };
const rehearsal = () => ({ at: new Date().toISOString(), database: DATABASE_URL, node: 'v4', backupSha256 });
const migrationSource = readFileSync('scripts/migrate-freepass-legacy-sign-urls.mts', 'utf8');
const backupSource = readFileSync('scripts/deploy/rtdb-backup.mts', 'utf8');

assert.equal(freepassSignTokenFromUrl(rawUrl), token);
assert.equal(freepassSignTokenFromUrl(`https://freepasserp.com/${token}/document`), token);
assert.equal(freepassSignTokenFromUrl('https://example.com/not-a-freepass-link'), '');
assert.equal(sameFreepassSignToken(rawUrl, `https://preview.freepasserp.com/${token}`), true);
assert.equal(configuredFreepassPublicBase('https://freepasserp.com/sign/'), 'https://freepasserp.com/sign');
assert.equal(configuredFreepassPublicBase('http://freepasserp.com/sign'), '');
assert.equal(canonicalLegacyFreepassSignUrl(token, 'https://freepasserp.com/sign/'), canonicalUrl);
assert.equal(canonicalLegacyFreepassSignUrl(token, ''), '');
assert.match(migrationSource, /v4\/esign_issue_claims/);
assert.match(migrationSource, /const after = await scanCandidates\(publicBase\)/);
assert.match(backupSource, /const existingSandbox = await getNode\(SANDBOX\)/);
assert.match(backupSource, /if \(existingSandbox !== null\)/);

assert.deepEqual(privateLinkDecision(null, rawUrl), { status: 'write', next: { internal_sign_url: rawUrl } });
assert.equal(privateLinkDecision({ internal_sign_url: rawUrl }, rawUrl).status, 'unchanged');
assert.equal(privateLinkDecision({ internal_sign_url: `https://freepasserp.com/sign/fps_${'b'.repeat(43)}` }, rawUrl).status, 'aborted');
assert.deepEqual(privateLinkDecision({ internal_sign_url: `https://evil.example/${token}` }, rawUrl), { status: 'write', next: { internal_sign_url: rawUrl } });
assert.equal(publicLinkDecision({ esign_sign_url: rawUrl, esign_session_hash: hash }, candidate).status, 'write');
assert.equal(publicLinkDecision({ esign_sign_url: 'https://freepasserp.com/sign/fps_changed', esign_session_hash: hash }, candidate).status, 'aborted');
assert.equal(publicLinkDecision({ esign_sign_url: rawUrl, esign_session_hash: 'f'.repeat(64) }, candidate).status, 'aborted');

let row: Versioned = { value: { state: 'before' }, etag: '1' };
let writes = 0;
const retried = await runCasTransaction({
  readVersioned: async () => ({ ...row }),
  putIfMatch: async (_path, value, etag) => {
    writes++;
    if (writes === 1) {
      assert.equal(etag, '1');
      row = { value: { state: 'concurrent' }, etag: '2' };
      return 'conflict';
    }
    assert.equal(etag, '2');
    row = { value, etag: '3' };
    return 'written';
  },
}, 'v4/example', (current) => ({ status: 'write', next: { ...(current as Record<string, unknown>), migrated: true } }));
assert.deepEqual(retried, { status: 'written' });
assert.deepEqual(row.value, { state: 'concurrent', migrated: true });
assert.equal(writes, 2);

const root = mkdtempSync(join(tmpdir(), 'freepass-legacy-url-migration-'));
try {
  const fresh = join(root, 'fresh');
  mkdirSync(fresh);
  writeFileSync(join(fresh, 'v4.json'), backupText, 'utf8');
  writeFileSync(join(fresh, 'manifest.json'), JSON.stringify({
    at: new Date().toISOString(), database: DATABASE_URL, nodes: { v4: backupNode },
  }), 'utf8');
  writeFileSync(join(fresh, 'v4.rehearsal.json'), JSON.stringify(rehearsal()), 'utf8');
  assert.doesNotThrow(() => verifyBackup('fresh', root));

  const wrongDb = join(root, 'wrong-db');
  mkdirSync(wrongDb);
  writeFileSync(join(wrongDb, 'v4.json'), backupText, 'utf8');
  writeFileSync(join(wrongDb, 'manifest.json'), JSON.stringify({
    at: new Date().toISOString(), database: 'https://wrong.example', nodes: { v4: backupNode },
  }), 'utf8');
  writeFileSync(join(wrongDb, 'v4.rehearsal.json'), JSON.stringify(rehearsal()), 'utf8');
  assert.throws(() => verifyBackup('wrong-db', root), /DB가 이관 대상 DB와 다릅니다/);

  const stale = join(root, 'stale');
  mkdirSync(stale);
  writeFileSync(join(stale, 'v4.json'), backupText, 'utf8');
  writeFileSync(join(stale, 'manifest.json'), JSON.stringify({
    at: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(), database: DATABASE_URL, nodes: { v4: backupNode },
  }), 'utf8');
  writeFileSync(join(stale, 'v4.rehearsal.json'), JSON.stringify(rehearsal()), 'utf8');
  assert.throws(() => verifyBackup('stale', root), /2시간보다 오래되었습니다/);

  const corrupt = join(root, 'corrupt');
  mkdirSync(corrupt);
  writeFileSync(join(corrupt, 'v4.json'), '{"unexpected":true}', 'utf8');
  writeFileSync(join(corrupt, 'manifest.json'), JSON.stringify({
    at: new Date().toISOString(), database: DATABASE_URL, nodes: { v4: backupNode },
  }), 'utf8');
  writeFileSync(join(corrupt, 'v4.rehearsal.json'), JSON.stringify(rehearsal()), 'utf8');
  assert.throws(() => verifyBackup('corrupt', root), /byte·건수·sha256/);
} finally {
  // mkdtempSync로 막 만든 전용 경로만 정리한다.
  if (root.startsWith(tmpdir())) rmSync(root, { recursive: true, force: true });
}

console.log('PASS: legacy Freepass bearer-link migration guards 25/25');
