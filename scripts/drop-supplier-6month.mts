/**
 * **공급사 제공시트에서 「6개월」 열을 걷어낸다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★왜(사장님 2026-08-14 — 「6개월은 운영 안 하는 거야. 한다면 기타기간? 거기서 운영하는 거임」)
 *   웰릭스를 표본으로 대조하니 5곳(렌트존·빌린카·스위치플랜·에코렌트카·제이앤제이)만
 *   「12개월」과 「장기보증」 사이에 「6개월」이 하나 더 있어 **뒤 12열이 통째로 한 칸씩 밀려 있었다.**
 *   양식이 갈리면 매핑이 시트마다 다르게 걸리고, 그게 곧 «값이 밀리는» 원인이다.
 *
 * ★값을 버리지 않는다 — 실측 빌린카 47대·제이앤제이 4대에 6개월 요금이 적혀 있다.
 *   지우기 전에 **여백 칸(기타기간①②③)으로 옮긴다.** 여백 칸은 «제목을 바꿔 쓰는» 칸이라
 *   (`supplier-template-sheet.FREE_PERIOD_SLOTS`) 제목을 「6개월」로 갈면 파서가 그대로 되읽는다.
 *   ⚠ 여백 칸은 장기보증 블록 오른쪽이다 — 6개월은 원래 단기라 보증금 관할이 바뀐다.
 *     운영하지 않는 기간이라 보관 목적이면 무해하지만, 되살릴 땐 이 점을 먼저 본다.
 *
 * ⚠ **우리가 만든 제공시트만 손댄다.** 가르는 표식은 열 이름 「차명(트림)」이다
 *   (`move-supplier-column.mts` 와 같은 규칙 — 소유자로 거르면 우리 것까지 막힌다).
 * ⚠ 이미 6개월 열이 없으면 건너뛴다. 두 번 돌려도 안전하다.
 * ⚠ 열을 지우면 표(Table)의 열 번호가 밀린다 — 끝나고 `fix-supplier-table.mts --apply` 를 돌린다.
 *
 *   npx tsx scripts/drop-supplier-6month.mts
 *   npx tsx scripts/drop-supplier-6month.mts --apply
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => S(v).replace(/\s+/g, '');
const arg = (k: string, d = '') => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || d;
const APPLY = process.argv.includes('--apply');
const ONE = arg('sheet');
const NAME = arg('name', '프리패스 재고');
const MARK = arg('mark', '차명(트림)');
/** 걷어낼 열. */
const DROP = arg('drop', '6개월');

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const tok = (await new JWT({
  email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'],
  subject: 'pyh@teamjpk.com',
}).getAccessToken()).token;
const call = async (u: string, init?: RequestInit) => {
  const r = await fetch(u, { ...init, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' } });
  const t = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${t.slice(0, 300)}`);
  return t ? JSON.parse(t) : {};
};
const SH = 'https://sheets.googleapis.com/v4/spreadsheets';
/** 0-based 열 번호 → A1 열 문자. */
const colA1 = (i: number) => { let s = '', n = i + 1; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; };
const q1 = (tab: string) => `'${tab.replace(/'/g, "''")}'`;

const targets: string[] = [];
if (ONE) targets.push(ONE);
else {
  const q = `name contains '${NAME}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`;
  const r = await call(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=100&includeItemsFromAllDrives=true&supportsAllDrives=true`) as Rec;
  for (const f of (r.files || []) as Rec[]) targets.push(S(f.id));
}
console.log(`■ 「${DROP}」 열 걷어내기 ${APPLY ? '반영' : '미리보기(dry-run)'} — 대상 ${targets.length}곳\n`);

let dropped = 0, movedCars = 0, none = 0, blocked = 0;
for (const id of targets) {
  let meta: Rec;
  try { meta = await call(`${SH}/${id}?fields=properties.title,sheets.properties(sheetId,title,hidden)`); } catch (e) { console.log(`  ✗ ${id} — 못 읽음 ${(e as Error).message.slice(0, 60)}`); continue; }
  const book = S(meta.properties?.title);
  for (const s of (meta.sheets || []) as Rec[]) {
    const p = s.properties;
    if (p.hidden) continue;
    const tab = S(p.title);
    let v: { values?: string[][] };
    try { v = await call(`${SH}/${id}/values/${encodeURIComponent(q1(tab))}`) as { values?: string[][] }; } catch { continue; }
    const rows = (v.values || []) as string[][];
    const hi = rows.findIndex((r) => r.some((c) => norm(c) === norm(MARK)));
    if (hi < 0) continue;                     // 우리 양식이 아니다
    const hdr = rows[hi].map(S);
    const di = hdr.findIndex((c) => norm(c) === norm(DROP));
    if (di < 0) { none++; continue; }

    const body = rows.slice(hi + 1);
    const keep = body.map((r, i) => ({ row: hi + 1 + i, val: S(r[di]) })).filter((x) => x.val);
    console.log(`  → ${book} 「${tab}」 — ${DROP} ${di}열 · 값 ${keep.length}개`);

    // 값이 있으면 먼저 여백 칸으로 옮긴다. 아직 «제목 그대로»인(=안 쓰는) 칸만 쓴다.
    let slot = -1;
    if (keep.length) {
      slot = hdr.findIndex((c) => /^기타기간[①②③]?$/.test(norm(c)));
      if (slot < 0) {
        blocked++;
        console.log(`       ⚠ 옮길 여백 칸(기타기간)이 없다 — 건드리지 않는다`);
        continue;
      }
      const busy = body.map((r) => S(r[slot])).filter(Boolean).length;
      if (busy) {
        blocked++;
        console.log(`       ⚠ 「${hdr[slot]}」에 이미 값 ${busy}개가 있다 — 덮어쓰지 않는다`);
        continue;
      }
      console.log(`       「${hdr[slot]}」(${slot}열) 제목을 「${DROP}」로 갈고 값 ${keep.length}개를 옮긴다`);
      movedCars += keep.length;
    }
    dropped++;
    if (!APPLY) continue;

    if (slot >= 0) {
      const A = colA1(slot);
      const data = [
        { range: `${q1(tab)}!${A}${hi + 1}`, values: [[DROP]] },
        ...keep.map((x) => ({ range: `${q1(tab)}!${A}${x.row + 1}`, values: [[x.val]] })),
      ];
      await call(`${SH}/${id}/values:batchUpdate`, {
        method: 'POST',
        body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data }),
      });
    }
    await call(`${SH}/${id}:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({ requests: [{ deleteDimension: { range: { sheetId: p.sheetId, dimension: 'COLUMNS', startIndex: di, endIndex: di + 1 } } }] }),
    });
    console.log(`       걷어냈다 — 이제 ${hdr.length - 1}열`);
  }
}
console.log(`\n  걷어냄 ${dropped} · 옮긴 요금 ${movedCars}대 · 이미 없음 ${none}${blocked ? ` · 막힘 ${blocked}` : ''}`);
if (!APPLY) console.log('\n※ dry-run. 실제 반영은 --apply\n');
if (APPLY && dropped) console.log('※ 열이 밀렸다 — 이어서 `npx tsx scripts/fix-supplier-table.mts --apply` 를 돌릴 것\n');
