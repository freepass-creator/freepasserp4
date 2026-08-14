/**
 * **공급사 제공시트의 표(Table)를 머리행에 맞춰 다시 세운다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★왜(사장님 2026-08-14 — 「칩 안 나오는데??」)
 *   표는 열 **번호**로 타입을 기억한다. 열을 옮기거나 시트를 손보면 이름과 자리가 어긋나
 *   드롭다운이 엉뚱한 칸을 가리키고 칩이 사라진다.
 *   실측: 손오공 「구독재고」 표가 [5]차종·[6]차명(트림) 인데 머리행은 [5]차명(트림)·[6]외부색상 —
 *   한 칸씩 밀려 있었다. 웰릭스는 표가 아예 없었다.
 *
 * ★고치는 법 — **머리행을 정본으로** 표를 지우고 다시 만든다.
 *   드롭다운 목록은 `VALUE_LISTS`(상태·분류·연료·외부색상·내부색상) + 제조사·연식.
 * ⚠ 값은 안 건드린다. 표는 «어떻게 보이나»만 정한다.
 * ⚠ 필터가 걸려 있으면 표 조작이 400 으로 막힌다 — 지우고 → 세우고 → 다시 건다.
 * ⚠ 표 이름은 문서 안에서 겹치면 안 된다(겹치면 구글이 「Internal error」로 거절한다).
 *
 *   npx tsx scripts/fix-supplier-table.mts
 *   npx tsx scripts/fix-supplier-table.mts --apply
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { VALUE_LISTS, yearOptions } from '../lib/domain/supplier-template-sheet';
import { HANDLED_MAKER_OPTIONS } from '../lib/domain/handled-makers';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => S(v).replace(/\s+/g, '');
const arg = (k: string, d = '') => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || d;
const APPLY = process.argv.includes('--apply');
const ONE = arg('sheet');
const NAME = arg('name', '프리패스 재고');
/** 표는 **드롭다운 칸까지만** 덮는다 — 그 오른쪽(금액·주행)은 표 밖이어야 천단위 콤마가 산다. */
const STOP_AT = /보증|개월|주행거리|배기량|차량가격|^기타기간/;

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const tok = (await new JWT({
  email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'],
  subject: 'pyh@teamjpk.com',
}).getAccessToken()).token;
/**
 * ⚠ 시트 API 는 «분당 읽기» 쿼터가 있다 — 17곳을 훑으면 중간에 429 로 끊긴다(실측 2026-08-14).
 *   끊기면 어떤 시트는 고쳐지고 어떤 시트는 안 고쳐져 양식이 더 갈린다. 기다렸다 다시 친다.
 */
const call = async (u: string, init?: RequestInit) => {
  for (let n = 0; ; n++) {
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

/** 제조사·연식은 목록이 코드에서 만들어진다(`VALUE_LISTS` 에 없다). 여기서 합쳐 준다. */
const LISTS: Record<string, readonly string[]> = {
  ...VALUE_LISTS,
  제조사: HANDLED_MAKER_OPTIONS,
  연식: yearOptions(new Date().getFullYear()),
};

const targets: string[] = [];
if (ONE) targets.push(ONE);
else {
  const q = `name contains '${NAME}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`;
  const r = await call(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=100&includeItemsFromAllDrives=true&supportsAllDrives=true`) as Rec;
  for (const f of (r.files || []) as Rec[]) targets.push(S(f.id));
}
console.log(`■ 표 다시 세우기 ${APPLY ? '반영' : '미리보기(dry-run)'} — 대상 ${targets.length}곳\n`);

let fixed = 0, okCount = 0;
for (const id of targets) {
  const meta = await call(`${SH}/${id}?fields=properties.title,sheets(properties(sheetId,title,hidden,gridProperties(rowCount)),tables,basicFilter,bandedRanges(bandedRangeId))`) as Rec;
  const book = S(meta.properties?.title);
  for (const s of (meta.sheets || []) as Rec[]) {
    const p = s.properties;
    if (p.hidden) continue;
    const tab = S(p.title);
    const v = await call(`${SH}/${id}/values/${encodeURIComponent(`'${tab.replace(/'/g, "''")}'!A1:BZ12`)}`) as { values?: string[][] };
    const rows = (v.values || []) as string[][];
    // 머리행 — 우리 양식의 표식(「차명(트림)」)이 있는 줄. 없으면 우리 시트가 아니다.
    const hi = rows.findIndex((r) => r.some((c) => norm(c) === norm('차명(트림)')));
    if (hi < 0) continue;
    const hdr = rows[hi].map(S);
    // 표가 덮을 폭 — 금액·주행 칸을 만나면 거기서 멈춘다.
    let width = hdr.length;
    for (const [i, name] of hdr.entries()) if (STOP_AT.test(name)) { width = i; break; }
    const cols = hdr.slice(0, width);

    const table = ((s.tables || []) as Rec[])[0];
    const cur = ((table?.columnProperties || []) as Rec[]).map((c) => S(c.columnName));
    const same = table && cur.length === cols.length && cols.every((c, i) => norm(c) === norm(cur[i]))
      && (table.range?.startRowIndex ?? 0) === hi;
    if (same) { okCount++; console.log(`  = ${book} 「${tab}」 — 표가 머리행과 맞는다`); continue; }
    fixed++;
    console.log(`  → ${book} 「${tab}」 — ${table ? '어긋나 다시 세운다' : '표가 없어 새로 세운다'} (열 ${cols.length})`);
    if (table && cur.length) {
      const bad = cols.map((c, i) => (norm(c) === norm(cur[i]) ? '' : `[${i}] 표「${cur[i] ?? '없음'}」 ≠ 머리행「${c}」`)).filter(Boolean);
      for (const b of bad.slice(0, 4)) console.log(`       ${b}`);
    }
    if (!APPLY) continue;

    const rowCount = Number(p.gridProperties?.rowCount) || 500;
    const reqs: Rec[] = [];
    // ⚠ 필터가 표 범위와 겹치면 400 이 난다. 먼저 걷어낸다.
    if (s.basicFilter) reqs.push({ clearBasicFilter: { sheetId: p.sheetId } });
    /**
     * ⚠ **줄무늬(교차 배경색)가 남아 있으면 표를 못 세운다** —
     *   「이미 교차되는 배경 색상이 있는 범위에는 교차 배경 색상을 추가할 수 없습니다」(실측 2026-08-14).
     *   표가 제 줄무늬를 갖고 오므로 옛 줄무늬는 걷어낸다.
     */
    for (const b of ((s.bandedRanges || []) as Rec[])) reqs.push({ deleteBanding: { bandedRangeId: b.bandedRangeId } });
    if (table?.tableId) reqs.push({ deleteTable: { tableId: table.tableId } });
    reqs.push({ addTable: { table: {
      // 문서 안에서 겹치지 않게 탭 이름을 쓴다.
      name: tab,
      range: { sheetId: p.sheetId, startRowIndex: hi, endRowIndex: rowCount, startColumnIndex: 0, endColumnIndex: cols.length },
      rowsProperties: {
        headerColorStyle: { rgbColor: { red: 0.13, green: 0.20, blue: 0.33 } },
        firstBandColorStyle: { rgbColor: { red: 1, green: 1, blue: 1 } },
        secondBandColorStyle: { rgbColor: { red: 0.97, green: 0.97, blue: 0.98 } },
      },
      columnProperties: cols.map((name, i) => {
        const values = LISTS[name];
        if (values?.length) {
          return {
            columnIndex: i, columnName: name, columnType: 'DROPDOWN',
            dataValidationRule: { condition: { type: 'ONE_OF_LIST', values: values.map((x) => ({ userEnteredValue: x })) } },
          };
        }
        return { columnIndex: i, columnName: name, columnType: 'TEXT' };
      }),
    } } });
    try {
      await call(`${SH}/${id}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: reqs }) });
      console.log(`       세웠다 — 드롭다운 ${cols.filter((c) => LISTS[c]?.length).length}칸`);
    } catch (e) { console.log(`       ⚠ 실패 — ${(e as Error).message.slice(0, 140)}`); }
  }
}
console.log(`\n  다시 세움 ${fixed} · 이미 맞음 ${okCount}`);
if (!APPLY) console.log('\n※ dry-run. 실제 반영은 --apply\n');
