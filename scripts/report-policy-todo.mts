/**
 * **공급사별 «정책 안 채운 항목» 목록.** 읽기 전용.
 *
 * ★왜(사장님 2026-08-14 — 「직원들한테 공급사 정책 안내하고 입력시키게끔 하자」)
 *   「정책 좀 채워 주세요」로는 아무도 안 채운다. **그 공급사가 뭘 안 채웠는지** 짚어 줘야 채운다.
 *   직원이 그대로 붙여 넣을 수 있게 공급사별로 뽑는다.
 *
 * ★블록별로 «왜 필요한지»를 같이 적는다 — 영업자 화면인가 계약서 조문인가.
 * ⚠ 「(프리패스 기본)」 줄은 우리가 채운 표준값이다. 그건 «채웠다»로 세지 않는다 —
 *   공급사가 자기 조건을 적어야 그 집 값이 된다.
 *
 *   npx tsx scripts/report-policy-todo.mts
 *   npx tsx scripts/report-policy-todo.mts --msg      (공급사에 보낼 글까지)
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { POLICY_SHEET_FIELDS, USE_LABEL } from '../lib/domain/policy-sheet-layout';
import { readPolicyTab } from '../lib/domain/supplier-policy-read';
import { supplierSheetLabel } from '../lib/domain/supplier-template-sheet';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const MSG = process.argv.includes('--msg');
const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({
  email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'],
  subject: 'pyh@teamjpk.com',
});
const get = async (u: string): Promise<Rec> => {
  for (let n = 0; ; n++) {
    const tok = (await jwt.getAccessToken()).token;
    const r = await fetch(u, { headers: { Authorization: `Bearer ${tok}` } });
    const t = await r.text();
    if (r.ok) return JSON.parse(t) as Rec;
    if ((r.status === 429 || r.status >= 500) && n < 5) { await new Promise((ok) => setTimeout(ok, 5000 * 2 ** n)); continue; }
    throw new Error(`${r.status} ${t.slice(0, 120)}`);
  }
};
const SH = 'https://sheets.googleapis.com/v4/spreadsheets';

const q = "name contains '프리패스 재고' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false";
const files = ((await get(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=100&includeItemsFromAllDrives=true&supportsAllDrives=true`)).files || []) as Rec[];

type Row = { who: string; id: string; policies: number; filled: number; total: number; missing: { name: string; use: string }[] };
const rows: Row[] = [];
for (const f of files) {
  const who = supplierSheetLabel(S(f.name));
  let book: Map<string, Map<string, string>>;
  try {
    let pv: { values?: string[][] } = {};
    for (const tab of ['운영정책', '정책']) { try { pv = await get(`${SH}/${f.id}/values/${encodeURIComponent(`'${tab}'`)}`) as { values?: string[][] }; if (pv.values?.length) break; } catch { /* 다음 별칭 */ } }
    book = readPolicyTab((pv.values || []) as string[][]);
  } catch { continue; }
  // ⚠ 「(프리패스 기본)」은 우리가 채운 표준값이다 — 그 집 정책으로 세지 않는다.
  const own = [...book.entries()].filter(([k]) => k);
  const missing: { name: string; use: string }[] = [];
  let filled = 0;
  for (const fld of POLICY_SHEET_FIELDS) {
    const has = own.some(([, m]) => S(m.get(fld.name)));
    if (has) filled++;
    else missing.push({ name: fld.name, use: USE_LABEL[fld.use] });
  }
  rows.push({ who, id: S(f.id), policies: own.length, filled, total: POLICY_SHEET_FIELDS.length, missing });
}
rows.sort((a, b) => a.filled / a.total - b.filled / b.total);

console.log(`■ 공급사 정책 채움 — ${rows.length}곳 · 항목 ${POLICY_SHEET_FIELDS.length}개\n`);
console.log('  공급사        정책수   채움          안 채운 항목');
for (const r of rows) {
  const pct = Math.round(r.filled / r.total * 100);
  const mark = r.policies === 0 ? ' ⛔정책 없음' : (pct < 70 ? ' ▲' : '');
  console.log(`  ${r.who.padEnd(12)} ${String(r.policies).padStart(4)}   ${String(r.filled).padStart(2)}/${r.total} ${String(pct).padStart(3)}%${mark.padEnd(10)} ${r.missing.length}개`);
}
const noPolicy = rows.filter((r) => !r.policies);
console.log(`\n  정책 줄이 아예 없는 곳 ${noPolicy.length}: ${noPolicy.map((r) => r.who).join(' · ') || '(없음)'}`);
console.log('  ★그 곳은 지금 «프리패스 표준값»이 영업자 화면에 나가고 있다. 그 집 조건이 아니다.');

if (!MSG) { console.log('\n※ 공급사에 보낼 글까지 보려면 --msg\n'); process.exit(0); }

console.log('\n\n══════ 공급사에 보낼 글 (그대로 복사) ══════');
for (const r of rows) {
  if (!r.missing.length) continue;
  const byUse = new Map<string, string[]>();
  for (const m of r.missing) { if (!byUse.has(m.use)) byUse.set(m.use, []); byUse.get(m.use)!.push(m.name); }
  console.log(`\n\n──────── ${r.who} ────────`);
  console.log(`안녕하세요, 프리패스입니다.`);
  console.log(`영업자들이 손님 앞에서 보는 상품표에 ${r.who}님의 계약 조건을 그대로 싣고 있습니다.`);
  console.log(`아래 시트의 「운영정책」 탭에 ${r.missing.length}개 항목이 비어 있어 안내드립니다.`);
  console.log(`\nhttps://docs.google.com/spreadsheets/d/${r.id}/edit`);
  console.log(`\n· 「운영정책」 탭 한 줄만 채우시면 됩니다. 차마다 적으실 필요 없습니다.`);
  console.log(`· 대부분 칸은 눌러서 고르시면 됩니다(드롭다운). 목록에 없으면 직접 적으셔도 됩니다.`);
  console.log(`· 첫 줄 「(프리패스 기본)」은 참고용 표준값입니다. 다르면 아래 줄에 적어 주세요.`);
  console.log(`\n[비어 있는 항목]`);
  for (const [use, names] of byUse) console.log(`  · ${use} — ${names.join(', ')}`);
  console.log(`\n적어 주신 값은 영업자 화면과 계약서에 그대로 들어갑니다.`);
  console.log(`비어 있으면 저희 표준값으로 나가서 실제 조건과 다를 수 있습니다.`);
}
console.log('');
