/**
 * **정제시트(4곳)를 「링크가 있는 모든 사용자: 편집자」로 연다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★사장님 2026-08-20 「공급사 시트 편집권한 링크 있으면 누구나 편집할 수 있게끔 해 줘 · 정제시트 말하는 거야」.
 *   정제시트 = 원본이 자체시트·홈페이지인 공급사의 우리 규격 시트(아이카·오토플러스·이안카·아이언, `mirror-sources.ts`).
 *   2026-08-18 에 anyone=reader 로 내려 뒀는데(사고 뒤 보호), 이제 링크만 있으면 고칠 수 있어야 한다.
 *   · 제공시트(공급사가 직접 적는 17곳)는 이 도구가 건드리지 않는다 — 필요하면 `--include-supplied`.
 *   ⚠ 링크를 아는 사람은 누구나 고칠 수 있다 — 개인정보는 적지 않는다(차량·요금·정책만).
 *     되돌리기: `--role=reader --apply`(읽기 전용) · `--revoke --apply`(링크 공유 해제).
 *
 *   npx tsx scripts/share-mirror-sheets-anyone.mts
 *   npx tsx scripts/share-mirror-sheets-anyone.mts --apply
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { MIRROR_SOURCES } from '../lib/domain/mirror-sources';
import { SHEET_NAME_MATCH, supplierSheetLabel } from '../lib/domain/supplier-template-sheet';
type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const APPLY = process.argv.includes('--apply');
const REVOKE = process.argv.includes('--revoke');
const INCLUDE_SUPPLIED = process.argv.includes('--include-supplied');
const ROLE = ((process.argv.find((a) => a.startsWith('--role=')) || '').slice(7) || 'writer') as 'writer' | 'reader';
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, scopes: ['https://www.googleapis.com/auth/drive'], subject: 'pyh@teamjpk.com' });
const call = async (u: string, init?: RequestInit): Promise<Rec> => {
  for (let n = 0; ; n++) {
    const tok = (await jwt.getAccessToken()).token;
    const r = await fetch(u, { ...init, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' } });
    const t = await r.text();
    if (r.ok) return t ? JSON.parse(t) : {};
    if ((r.status === 429 || r.status >= 500) && n < 5) { await sleep(4000 * 2 ** n); continue; }
    return { _error: `${r.status} ${t.slice(0, 160)}` };
  }
};
/** 정제시트 = mirror-sources 의 `to` 문서 */
const mirrorIds = new Set(MIRROR_SOURCES.map((m) => S((m as Rec).to)).filter(Boolean));
const q = `name contains '${SHEET_NAME_MATCH}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`;
const found = await call(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=100&includeItemsFromAllDrives=true&supportsAllDrives=true`);
const all = ((found.files || []) as Rec[]).map((f) => ({ id: S(f.id), name: S(f.name), label: supplierSheetLabel(S(f.name)) }));
const books = all.filter((b) => INCLUDE_SUPPLIED || mirrorIds.has(b.id)).sort((a, b) => a.label.localeCompare(b.label));
console.log(`■ 대상 ${books.length}곳(${INCLUDE_SUPPLIED ? '제공+정제 전부' : '정제시트만'}) — ${REVOKE ? '링크 공유 해제' : `링크 있는 모든 사용자: ${ROLE === 'writer' ? '편집자' : '뷰어'}`} ${APPLY ? '반영' : '미리보기'}\n`);
let changed = 0, already = 0, failed = 0;
for (const b of books) {
  const perms = await call(`https://www.googleapis.com/drive/v3/files/${b.id}/permissions?fields=permissions(id,type,role,emailAddress)&supportsAllDrives=true`);
  if (perms._error) { console.log(`   ✗ ${b.label.padEnd(9)} 권한 조회 실패 ${perms._error}`); failed++; continue; }
  const anyone = ((perms.permissions || []) as Rec[]).find((p) => S(p.type) === 'anyone');
  const now = anyone ? `anyone:${S(anyone.role)}` : '링크공유 없음';
  if (REVOKE) {
    if (!anyone) { console.log(`   · ${b.label.padEnd(9)} 이미 ${now}`); already++; continue; }
    console.log(`   ${APPLY ? '✓' : '·'} ${b.label.padEnd(9)} ${now} → 해제`);
    if (APPLY) { const r = await call(`https://www.googleapis.com/drive/v3/files/${b.id}/permissions/${S(anyone.id)}?supportsAllDrives=true`, { method: 'DELETE' }); if (r._error) { console.log(`      ✗ ${r._error}`); failed++; continue; } }
    changed++; continue;
  }
  if (anyone && S(anyone.role) === ROLE) { console.log(`   · ${b.label.padEnd(9)} 이미 ${now}`); already++; continue; }
  console.log(`   ${APPLY ? '✓' : '·'} ${b.label.padEnd(9)} ${now} → anyone:${ROLE}`);
  if (APPLY) {
    const r = anyone
      ? await call(`https://www.googleapis.com/drive/v3/files/${b.id}/permissions/${S(anyone.id)}?supportsAllDrives=true`, { method: 'PATCH', body: JSON.stringify({ role: ROLE }) })
      : await call(`https://www.googleapis.com/drive/v3/files/${b.id}/permissions?supportsAllDrives=true&sendNotificationEmail=false`, { method: 'POST', body: JSON.stringify({ type: 'anyone', role: ROLE }) });
    if (r._error) { console.log(`      ✗ ${r._error}`); failed++; continue; }
  }
  changed++;
}
console.log(`\n■ ${APPLY ? '반영' : '예정'} ${changed} · 그대로 ${already}${failed ? ` · 실패 ${failed}` : ''}`);
if (!APPLY) console.log('※ dry-run — --apply 로 반영');
