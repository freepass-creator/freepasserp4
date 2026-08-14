/**
 * **자체시트 공급사의 원본 → 우리 규격화시트 갱신.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★왜(사장님 2026-08-14)
 *   「아이카 것도 어차피 번호만 같으면 만들어 둘 수 있고, 대여료 변동만 우리 시트에 가져와서
 *    작업을 하면 되니까」 · 「그럼 결국 영업자 시트는 다 동일한 걸 갖고 온다는 거고」
 *
 *   아이카·오플·이안카는 자기 시트를 쓴다. 그쪽에 우리 양식을 강요하지 않는다.
 *   대신 **우리 규격화시트**를 하나 두고, 원본이 바뀌면 차량번호를 열쇠로 갱신한다.
 *   그러면 공급사가 어떻게 적든 영업자·ERP 가 받는 모양은 한 벌이 된다.
 *
 * ★**통째로 덮어쓰지 않는다.**
 *   정제칸 11개와 정책코드는 «우리가 써 넣은 것»이라 매번 덮으면 그 작업이 통째로 날아간다.
 *   그 밖(요금·보증금·상태·주행거리·색·차명…)은 공급사 것이라 늘 원본을 따른다.
 * ★**행을 지우지 않는다.**
 *   원본에서 사라진 차는 상태만 「출고불가」로 바꾸고 줄은 남긴다 —
 *   지우면 그 차에 해 둔 정제 작업이 같이 사라지고, 다시 들어오면 처음부터 해야 한다.
 * ★새 차번은 맨 아래에 더한다. 정제칸은 비어 있고 그게 «해야 할 일»의 목록이 된다.
 *
 * ⚠ 번호판이 없는 신차(선출고)는 열쇠가 없어 못 맞춘다. 그런 줄은 세어서 보여만 준다.
 * ⚠ 원본에서 차명이 바뀌면 정제칸이 낡은 값이 된다 — 바뀐 차를 목록으로 찍는다.
 *
 *   npx tsx scripts/sync-mirror-sheet.mts --from=<원본ID> --to=<우리시트ID>
 *   npx tsx scripts/sync-mirror-sheet.mts --from=… --to=… --apply
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { SHEET_GRID_FIELDS, readSupplierSheet } from '../lib/domain/supplier-sheet-read';
import { AI_TAIL_COLUMNS } from '../lib/domain/supplier-template-sheet';
import { HANDOVER_TAB, findLogEnd, nowKST } from '../lib/domain/supplier-handover-log';
import type { EntityRecord } from '../lib/intake/entities';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => S(v).replace(/\s+/g, '');
const arg = (k: string, d = '') => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || d;
const APPLY = process.argv.includes('--apply');
const FROM = arg('from');
const TO = arg('to');
const CODE = arg('code', 'RP000');
if (!FROM || !TO) throw new Error('--from=<원본ID> --to=<우리시트ID> 가 필요하다');

/** 우리가 써 넣는 칸 — 원본이 덮지 못한다. */
const OURS = new Set<string>([...AI_TAIL_COLUMNS.map((c) => c.name), '정책코드'].map(norm));

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
      await new Promise((ok) => setTimeout(ok, Math.min(60_000, 5_000 * 2 ** n)));
      continue;
    }
    throw new Error(`${r.status} ${t.slice(0, 300)}`);
  }
};
const SH = 'https://sheets.googleapis.com/v4/spreadsheets';
const colA1 = (i: number) => { let s = '', n = i + 1; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; };

console.log(`■ 규격화시트 갱신 ${APPLY ? '반영' : '미리보기(dry-run)'}\n`);

// ── ① 원본을 읽는다. 숨긴 행·숨긴 탭·어댑터는 readSupplierSheet 가 가려 준다.
const grid = await call(`${SH}/${FROM}?includeGridData=true&fields=${encodeURIComponent(SHEET_GRID_FIELDS)}`);
const read = readSupplierSheet(grid as never, { partner_code: CODE } as EntityRecord);
/** 원본 차번 → (열이름 → 값). 같은 차가 여러 탭에 있으면 먼저 나온 쪽. */
const src = new Map<string, Map<string, string>>();
for (const t of read.tabs) {
  const hdr = (t.table[0] || []).map(S);
  const pi = hdr.findIndex((h) => /^차량번호$|^차번$/.test(norm(h)));
  if (pi < 0) continue;
  for (const r of t.table.slice(1)) {
    const plate = norm(r[pi]);
    if (!plate || src.has(plate)) continue;
    const m = new Map<string, string>();
    hdr.forEach((h, i) => { if (S(h)) m.set(norm(h), S(r[i])); });
    src.set(plate, m);
  }
}
console.log(`  원본 ${read.tabs.length}탭 · 차 ${src.size}대${read.failures.length ? ` · 못 읽은 탭 ${read.failures.length}` : ''}`);

// ── ② 우리 시트를 읽는다.
const meta = await call(`${SH}/${TO}?fields=properties.title,sheets.properties(sheetId,title,hidden,gridProperties(rowCount))`);
const book = S(meta.properties?.title);
const tabProp = ((meta.sheets || []) as Rec[]).map((s) => s.properties).find((p) => !p.hidden);
if (!tabProp) throw new Error('우리 시트에서 탭을 못 찾았다');
const tab = S(tabProp.title);
const v = await call(`${SH}/${TO}/values/${encodeURIComponent(`'${tab.replace(/'/g, "''")}'`)}`) as { values?: string[][] };
const rows = (v.values || []) as string[][];
const hi = rows.findIndex((r) => r.some((c) => norm(c) === norm('차명(트림)')));
if (hi < 0) throw new Error('우리 시트에서 머리행(「차명(트림)」)을 못 찾았다');
const hdr = rows[hi].map(S);
const pi = hdr.findIndex((h) => norm(h) === '차량번호');
const si = hdr.findIndex((h) => norm(h) === '상태');
const ti = hdr.findIndex((h) => norm(h) === norm('차명(트림)'));
console.log(`  우리 시트 「${book}」 「${tab}」 ${hdr.length}열 · ${rows.length - hi - 1}줄\n`);

// ── ③ 줄마다 «공급사 것»만 갱신한다.
const data: { range: string; values: string[][] }[] = [];
let touched = 0, cells = 0, gone = 0, renamed = 0;
const renamedList: string[] = [];
/** 열마다 무엇이 무엇으로 바뀌는지 — «늘 갱신되는 열»을 잡아내는 눈이다. */
const byCol = new Map<string, string[]>();
const seen = new Set<string>();
rows.slice(hi + 1).forEach((r, k) => {
  const plate = norm(r[pi]);
  if (!plate) return;
  const rowAt = hi + 2 + k;
  const from = src.get(plate);
  if (!from) {
    // 원본에서 사라진 차 — 줄은 남기고 상태만 내린다.
    if (si >= 0 && S(r[si]) !== '출고불가') { gone++; data.push({ range: `'${tab}'!${colA1(si)}${rowAt}`, values: [['출고불가']] }); }
    return;
  }
  seen.add(plate);
  let hit = false;
  hdr.forEach((name, i) => {
    if (!S(name) || OURS.has(norm(name))) return;          // 우리 칸은 안 건드린다
    const now = S(r[i]);
    const next = from.get(norm(name));
    if (next === undefined || next === now) return;
    if (!next && now) return;                              // 원본이 비었다고 우리 값을 지우지 않는다
    data.push({ range: `'${tab}'!${colA1(i)}${rowAt}`, values: [[next]] });
    cells++; hit = true;
    if (!byCol.has(name)) byCol.set(name, []);
    byCol.get(name)!.push(`「${now || '(빈칸)'}」→「${next}」`);
    if (i === ti) { renamed++; renamedList.push(`${S(r[pi])} 「${now}」 → 「${next}」`); }
  });
  if (hit) touched++;
});

// ── ④ 원본에만 있는 새 차 — 맨 아래에 더한다.
const fresh = [...src.keys()].filter((p) => !seen.has(p));
const newRows: string[][] = fresh.map((plate) => {
  const from = src.get(plate)!;
  return hdr.map((name) => (OURS.has(norm(name)) ? '' : S(from.get(norm(name)))));
});

console.log(`  갱신할 차 ${touched}대 · 칸 ${cells}`);
if (byCol.size) {
  console.log('\n  어느 열이 갱신되나 — 여기서 «늘 갱신되는 열»이 보이면 우리 정규화를 되돌리는 중이다');
  for (const [name, list] of [...byCol].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`     ${name.padEnd(12)} ${String(list.length).padStart(3)}칸  ${list.slice(0, 2).join(' · ').slice(0, 90)}`);
  }
}
console.log(`  새 차 ${fresh.length}대 · 원본에서 사라진 차 ${gone}대(상태만 출고불가)`);
if (renamed) {
  console.log(`\n  ⚠ 차명이 바뀐 차 ${renamed} — 정제칸이 낡았을 수 있다`);
  for (const x of renamedList.slice(0, 10)) console.log(`     ${x}`);
}
if (!APPLY) { console.log('\n※ dry-run. 실제 반영은 --apply\n'); process.exit(0); }

for (let i = 0; i < data.length; i += 500) {
  await call(`${SH}/${TO}/values:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data: data.slice(i, i + 500) }),
  });
}
if (newRows.length) {
  const at = hi + 1 + rows.slice(hi + 1).filter((r) => S(r[pi])).length;
  await call(`${SH}/${TO}/values/${encodeURIComponent(`'${tab}'!A${at + 1}`)}?valueInputOption=USER_ENTERED`, {
    method: 'PUT', body: JSON.stringify({ values: newRows }),
  });
}
/**
 * ★숨긴 탭 「AI 인계」의 @이력에 한 줄 남긴다.
 *   동기화가 멈춘 채 영업자가 옛 값을 보는 것이 이 구조의 유일한 «조용한» 실패다.
 *   기록이 있어야 발행기가 「며칠째 안 돌았다」를 알린다.
 */
try {
  const logRange = `'${HANDOVER_TAB}'!A1:C400`;
  const cur = await call(`${SH}/${TO}/values/${encodeURIComponent(logRange)}`) as { values?: string[][] };
  const lines = (cur.values || []) as string[][];
  const endAt = findLogEnd(lines);
  if (endAt < 0) {
    console.log(`  ⚠ 「${HANDOVER_TAB}」에 @이력 자리가 없다 — publish-supplier-handover-tab 을 먼저 돌려라`);
  } else {
    await call(`${SH}/${TO}/values/${encodeURIComponent(`'${HANDOVER_TAB}'!A${endAt + 1}`)}?valueInputOption=RAW`, {
      method: 'PUT',
      body: JSON.stringify({ values: [
        ['', nowKST(), `동기 — 원본 ${src.size}대 · 갱신 ${cells}칸 · 새 차 ${newRows.length} · 사라진 차 ${gone}`],
        ['@이력끝', '', ''],
      ] }),
    });
  }
} catch (e) { console.log(`  ⚠ 이력을 못 남겼다 — ${(e as Error).message.slice(0, 80)}`); }
console.log(`\n  반영 완료 — 갱신 ${cells}칸 · 새 줄 ${newRows.length}\n`);
