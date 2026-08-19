/**
 * **공급사 제공시트 맨 뒤에 「차종마스터 정제칸」을 붙인다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★왜(사장님 2026-08-14)
 *   「공급사한테 입력시키는 건 단순해야 하니까 — 제조사 · 세부모델(트림) · 옵션 이렇게만 입력시키고,
 *    우리는 정제된 제조사 · 모델 · 세부모델 · 파워트레인 · 세부트림 · 선택옵션 이렇게 정제해서
 *    상품시트에 가져갈 준비를 하는 거지」
 *   「매뉴얼대로 미리 입력해두고 그 데이터를 가져가면 오류가 최소화될 듯」
 *
 *   지금은 발행할 때마다 공급사 원문을 다시 읽어 차종을 «추측»한다. 같은 차를 매주 새로 판단하고,
 *   고쳐 놔도 다음 발행에 되돌아간다. 그래서 파워트레인·세부트림이 영영 안 채워졌다.
 *   제공시트 칸에 적어 두면 그 자리에 남는다 — **차번당 한 번만** 하면 된다.
 *
 * ★**맨 뒤에만 붙인다. 있는 열은 한 칸도 안 옮긴다.**
 *   앞으로 당겨 봤다가 빌린카 정책코드 40칸이 날아갔다(실측 2026-08-14 · 스냅샷으로 되돌림).
 *   열을 안 옮기면 값이 밀릴 위험 자체가 없다. 공급사가 매일 보는 화면도 그대로다.
 * ★이미 있는 칸은 다시 만들지 않는다. 두 번 돌려도 안전하다.
 *
 * ⚠ 우리 제공시트만 손댄다. 가르는 표식은 열 이름 「차명(트림)」이다.
 * ⚠ 값은 안 채운다 — 채우는 것은 `fill-supplier-ai-columns.mts` 가 한다.
 *
 *   npx tsx scripts/add-supplier-ai-columns.mts
 *   npx tsx scripts/add-supplier-ai-columns.mts --apply
 *   npx tsx scripts/add-supplier-ai-columns.mts --apply --sheet=<ID>
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { INCLUDE_MIRROR, isMirrorSheet } from '../lib/domain/mirror-sources';
import { AI_TAIL_COLUMNS } from '../lib/domain/supplier-template-sheet';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => S(v).replace(/\s+/g, '');
const arg = (k: string, d = '') => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || d;
const APPLY = process.argv.includes('--apply');
const ONE = arg('sheet');
const NAME = arg('name', '프리패스 재고');
const MARK = '차명(트림)';

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({
  email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'],
  subject: 'pyh@teamjpk.com',
});
const call = async (u: string, init?: RequestInit): Promise<Rec> => {
  for (let n = 0; ; n++) {
    const tok = (await jwt.getAccessToken()).token;
    const r = await fetch(u, { ...init, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' } });
    const t = await r.text();
    if (r.ok) return t ? JSON.parse(t) : {};
    if ((r.status === 429 || r.status >= 500) && n < 6) {
      const wait = Math.min(60_000, 5_000 * 2 ** n);
      console.log(`       … ${r.status} — ${Math.round(wait / 1000)}초 쉬고 다시`);
      await new Promise((ok) => setTimeout(ok, wait));
      continue;
    }
    throw new Error(`${r.status} ${t.slice(0, 300)}`);
  }
};
const SH = 'https://sheets.googleapis.com/v4/spreadsheets';

const targets: string[] = [];
if (ONE) targets.push(ONE);
else {
  const q = `name contains '${NAME}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`;
  const r = await call(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=100&includeItemsFromAllDrives=true&supportsAllDrives=true`);
  for (const f of (r.files || []) as Rec[]) if (INCLUDE_MIRROR || !isMirrorSheet(S(f.id))) targets.push(S(f.id));
  if (!INCLUDE_MIRROR) console.log('  (정제시트는 제외 — 사장님 「너는 우리 제공 시트만 맡아」 · 포함하려면 --include-mirror)');
}
console.log(`■ 차종마스터 정제칸 붙이기 ${APPLY ? '반영' : '미리보기(dry-run)'} — 대상 ${targets.length}곳`);
console.log(`  붙일 칸: ${AI_TAIL_COLUMNS.map((c) => c.name).join(' · ')}\n`);

let added = 0, already = 0;
for (const id of targets) {
  let meta: Rec;
  try { meta = await call(`${SH}/${id}?fields=properties.title,sheets.properties(sheetId,title,hidden,gridProperties(columnCount))`); }
  catch (e) { console.log(`  ✗ ${id} — 못 읽음 ${(e as Error).message.slice(0, 60)}`); continue; }
  const book = S(meta.properties?.title);
  for (const s of (meta.sheets || []) as Rec[]) {
    const p = s.properties;
    if (p.hidden) continue;
    const tab = S(p.title);
    let v: { values?: string[][] };
    try { v = await call(`${SH}/${id}/values/${encodeURIComponent(`'${tab.replace(/'/g, "''")}'!A1:DZ8`)}`) as { values?: string[][] }; } catch { continue; }
    const rows = (v.values || []) as string[][];
    const hi = rows.findIndex((r) => r.some((c) => norm(c) === norm(MARK)));
    if (hi < 0) continue;                    // 우리 양식이 아니다
    const hdr = rows[hi].map(S);
    const missing = AI_TAIL_COLUMNS.filter((c) => !hdr.some((h) => norm(h) === norm(c.name)));
    if (!missing.length) { already++; console.log(`  = ${book} 「${tab}」 — 이미 있다`); continue; }

    console.log(`  → ${book} 「${tab}」 — ${hdr.length}열 뒤에 ${missing.length}칸 (${missing.map((c) => c.name).join(', ')})`);
    added++;
    if (!APPLY) continue;

    const reqs: Rec[] = [];
    const width = Number(p.gridProperties?.columnCount) || hdr.length;
    const start = hdr.length;
    // 자리가 모자라면 먼저 늘린다. 늘리는 것은 값에 손대지 않는다.
    if (start + missing.length > width) {
      reqs.push({ appendDimension: { sheetId: p.sheetId, dimension: 'COLUMNS', length: start + missing.length - width } });
    }
    missing.forEach((c, k) => {
      const at = start + k;
      reqs.push({ updateCells: {
        range: { sheetId: p.sheetId, startRowIndex: hi, endRowIndex: hi + 1, startColumnIndex: at, endColumnIndex: at + 1 },
        rows: [{ values: [{ userEnteredValue: { stringValue: c.name }, note: c.note }] }],
        fields: 'userEnteredValue,note',
      } });
      // 누가 채우는 칸인지 눈에 보이게 — 옅은 회색 바탕.
      reqs.push({ repeatCell: {
        range: { sheetId: p.sheetId, startRowIndex: hi, startColumnIndex: at, endColumnIndex: at + 1 },
        cell: { userEnteredFormat: { backgroundColor: { red: 0.96, green: 0.96, blue: 0.97 } } },
        fields: 'userEnteredFormat.backgroundColor',
      } });
    });
    try {
      await call(`${SH}/${id}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: reqs }) });
      console.log(`       붙였다 — ${start}열 → ${start + missing.length}열`);
    } catch (e) { console.log(`       ⚠ 실패 — ${(e as Error).message.slice(0, 180)}`); }
  }
}
console.log(`\n  붙임 ${added} · 이미 있음 ${already}`);
if (!APPLY) console.log('\n※ dry-run. 실제 반영은 --apply\n');
