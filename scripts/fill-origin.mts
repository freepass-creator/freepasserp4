/**
 * **모든 공급사 시트의 「원산지」 빈 칸을 제조사로 채운다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★원산지는 표시값이 아니라 «돈»이다 — 보증금 배율(국산 ×2 · 수입 ×3)의 근거라
 *   비면 보증금 계산이 막히고 **요금이 통째로 사라진다**(`sheet-import.ts:67` · 2026-08-28 오플 실사고).
 *
 * ⚠ **왜 아무도 안 채우고 있었나**
 *   · 손오공은 `fill-supplier-ai-columns` 가 **스킵**한다(⓪ 손오공 정제가 정본이라). 그런데 ⓪ 는
 *     차종마스터에서 «이름만» 복사해서 원산지를 안 본다 → 담당이 없는 칸이 됐다(2026-09-02 실측 91칸).
 *   · 그 밖 공급사도 차종마스터 매칭이 안 되면 원산지가 빈 채로 남는다
 *     (2026-09-02 실측 상품리스트 46대 — 이안카 23 · 아이카 16 · 스타 6 · 아이언 1. **제조사는 46대 다 있다.**)
 *
 * ★값은 **제조사만 보고** 정한다 — `isImportBrand`(SSOT). 브랜드 목록을 여기서 새로 쓰지 않는다.
 *   차종마스터가 없어도 제조사만 있으면 국산/수입은 정해진다. **이건 짐작이 아니라 사실이다.**
 * ★**빈 칸만 채운다.** 사람·공급사가 적어 둔 값은 안 덮는다(정말 바꾸려면 `--overwrite`).
 * ★제조사가 없으면 **비운 채로 둔다** — 정할 근거가 없는 것을 지어내지 않는다.
 *
 *   npx tsx scripts/fill-origin.mts
 *   npx tsx scripts/fill-origin.mts --apply
 *   npx tsx scripts/fill-origin.mts --only=이안카,아이카 --apply
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { isImportBrand } from '../lib/domain/vehicle-origin';
import { SHEET_NAME_MATCH, isOurNonInventoryTab, supplierSheetLabel } from '../lib/domain/supplier-template-sheet';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => S(v).replace(/\s+/g, '');
const APPLY = process.argv.includes('--apply');
const OVERWRITE = process.argv.includes('--overwrite');
const ONLY = new Set((process.argv.find((a) => a.startsWith('--only=')) || '').slice('--only='.length).split(',').map(S).filter(Boolean));

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({
  email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com',
  scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'],
});
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
/**
 * ⚠ 이 도구는 공급사 시트 21곳의 탭을 전부 읽어 **요청이 많다.** 자동회차와 겹치면 429 가 난다
 *   (2026-09-02 실측 — 절반쯤 읽다 「Quota exceeded」로 여러 곳을 못 읽었다).
 *   429·5xx 는 «잠깐 밀린 것»이므로 쉬었다 다시 한다. 안 그러면 «못 읽은 곳»이 조용히 빠진다.
 */
const call = async (u: string, init?: RequestInit): Promise<Rec> => {
  for (let attempt = 1; ; attempt += 1) {
    const t = (await jwt.getAccessToken()).token;
    const r = await fetch(u, { ...init, headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json', ...(init?.headers || {}) } });
    const x = await r.text();
    if (r.ok) return x ? JSON.parse(x) : {};
    if ((r.status === 429 || r.status >= 500) && attempt <= 5) { await sleep(15_000 * attempt); continue; }
    throw new Error(`${r.status} ${x.slice(0, 200)}`);
  }
};
const col = (i: number): string => {
  let n = i + 1, s = '';
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
};

/** 대상 시트 — 공급사 시트 전부 + 손오공 재고시트(이름 규격이 달라 따로 넣는다). */
const q = `name contains '${SHEET_NAME_MATCH}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`;
const found = ((await call(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=100&supportsAllDrives=true&includeItemsFromAllDrives=true`)).files || []) as Rec[];
/**
 * ⚠ **폐기·구버전 시트에는 쓰지 않는다.** 2026-09-02 dry-run 에 「[구버전·폐기] 경진렌트카」가 걸렸다 —
 *   아무도 안 읽는 시트를 고치면 «고쳤다»는 착각만 남는다. 이름에 표식이 있으므로 이름으로 거른다.
 *   (실측: SA·퍼시픽처럼 공급사 레코드가 폐기 시트를 가리키는 곳이 있다 — 2026-09-02)
 */
const RETIRED = /구버전|폐기|안\s*씀|백업|복사본|test|샘플/i;
const books = found.map((f) => ({ id: S(f.id), name: S(f.name), label: supplierSheetLabel(S(f.name)) || S(f.name) }))
  .filter((b) => !RETIRED.test(b.name))
  .filter((b) => !ONLY.size || [...ONLY].some((o) => b.label.includes(o)))
  .sort((a, b) => a.label.localeCompare(b.label));

console.log(`■ 원산지 빈 칸 채우기 — 시트 ${books.length}곳 ${APPLY ? '(반영)' : '(dry-run)'}`);
let 총빈칸 = 0; let 총채움 = 0; let 제조사없음 = 0;
for (const b of books) {
  let meta: Rec;
  try { meta = await call(`https://sheets.googleapis.com/v4/spreadsheets/${b.id}?fields=sheets.properties(title,hidden)`); }
  catch (e) { console.log(`  ✗ ${b.label} — 못 읽음: ${(e as Error).message.slice(0, 60)}`); continue; }
  const updates: { range: string; values: string[][] }[] = [];
  let 빈칸 = 0;
  for (const sh of (meta.sheets || []) as Rec[]) {
    const tab = S(sh.properties?.title);
    if (sh.properties?.hidden || isOurNonInventoryTab(tab)) continue;
    let v: Rec;
    try { v = await call(`https://sheets.googleapis.com/v4/spreadsheets/${b.id}/values/${encodeURIComponent(tab)}`); } catch { continue; }
    const rows = ((v.values || []) as string[][]); if (rows.length < 2) continue;
    const hi = rows.findIndex((r) => r.some((c) => /차량?번호|차번/.test(norm(c)))); if (hi < 0) continue;
    const hdr = rows[hi].map(norm);
    const pi = hdr.findIndex((h) => /차량?번호|차번/.test(h));
    const mi = hdr.findIndex((h) => /^제조사$/.test(h));
    const oi = hdr.findIndex((h) => /^(원산지|국산수입)$/.test(h));
    if (pi < 0 || mi < 0 || oi < 0) continue;
    for (let r = hi + 1; r < rows.length; r++) {
      const plate = norm(rows[r][pi]); if (!/\d{2,3}[가-힣]\d{4}/.test(plate)) continue;
      const cur = S(rows[r][oi]);
      if (cur && cur !== '-' && !OVERWRITE) continue;
      const maker = S(rows[r][mi]);
      if (!maker) { 제조사없음 += 1; continue; }   // 정할 근거가 없다 — 지어내지 않는다
      빈칸 += 1;
      updates.push({ range: `'${tab}'!${col(oi)}${r + 1}`, values: [[isImportBrand(maker) ? '수입' : '국산']] });
    }
  }
  총빈칸 += 빈칸;
  if (!빈칸) continue;
  console.log(`  ${b.label.padEnd(16)} 빈 칸 ${빈칸}개`);
  if (!APPLY) continue;
  await call(`https://sheets.googleapis.com/v4/spreadsheets/${b.id}/values:batchUpdate`, {
    method: 'POST', body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data: updates }),
  });
  총채움 += updates.length;
  console.log(`     ✓ ${updates.length}칸 반영`);
}
console.log(`\n${APPLY ? `끝 — ${총채움}칸 채웠다` : `※ dry-run — 채울 칸 ${총빈칸}개. 반영은 --apply`}${제조사없음 ? ` · 제조사가 없어 못 정한 차 ${제조사없음}대` : ''}`);
console.log('   판매시트·ERP 반영은 다음 자동동기 회차가 한다(시트가 정본).');
