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
/** 숫자로 같은가 — 콤마·공백을 떼고 견준다. 둘 다 숫자일 때만 «같다»로 본다. */
const sameNumber = (a: string, b: string) => {
  const n = (v: string) => (/^[\d,\s]+$/.test(v) && /\d/.test(v) ? v.replace(/[,\s]/g, '') : null);
  const x = n(a);
  const y = n(b);
  return x !== null && y !== null && x === y;
};
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

// ── ② 우리 시트를 읽는다. **탭이 여럿일 수 있다**(손오공 = 렌트재고 + 구독재고).
const meta = await call(`${SH}/${TO}?fields=properties.title,sheets.properties(sheetId,title,hidden,gridProperties(rowCount))`);
const book = S(meta.properties?.title);
const visible = ((meta.sheets || []) as Rec[]).map((s) => s.properties)
  .filter((p) => !p.hidden && !/^정책$|AI 인계/.test(S(p.title)));

type Tab = { title: string; rows: string[][]; hi: number; hdr: string[]; pi: number; si: number; ti: number };
const tabs: Tab[] = [];
for (const p of visible) {
  const title = S(p.title);
  let v: { values?: string[][] };
  try { v = await call(`${SH}/${TO}/values/${encodeURIComponent(`'${title.replace(/'/g, "''")}'`)}`) as { values?: string[][] }; } catch { continue; }
  const rows = (v.values || []) as string[][];
  const hi = rows.findIndex((r) => r.some((c) => norm(c) === norm('차명(트림)')));
  if (hi < 0) continue;
  const hdr = rows[hi].map(S);
  const pi = hdr.findIndex((h) => norm(h) === '차량번호');
  /**
   * ⚠ **차량번호 열이 없으면 멈춘다.** 없으면 «기존 줄이 하나도 없다»로 읽혀 원본 전량이
   *   «새 차»가 되고 머리행 바로 아래부터 통째로 덮어쓴다 — 122줄이 한 번에 갈린다.
   */
  if (pi < 0) throw new Error(`「${title}」 에 차량번호 열이 없다 — 덮어쓰면 기존 줄이 통째로 갈린다`);
  tabs.push({ title, rows, hdr, hi, pi, si: hdr.findIndex((h) => norm(h) === '상태'), ti: hdr.findIndex((h) => norm(h) === norm('차명(트림)')) });
}
if (!tabs.length) throw new Error('우리 시트에서 재고 탭을 못 찾았다');
console.log(`  우리 시트 「${book}」 ${tabs.map((t) => `「${t.title}」 ${t.rows.length - t.hi - 1}줄`).join(' · ')}
`);

// ── ③ 줄마다 «공급사 것»만 갱신한다. 차번은 시트 전체에서 하나뿐이라고 본다.
const data: { range: string; values: string[][] }[] = [];
let touched = 0, cells = 0, gone = 0, renamed = 0;
const renamedList: string[] = [];
/** 열마다 무엇이 무엇으로 바뀌는지 — «늘 갱신되는 열»을 잡아내는 눈이다. */
const byCol = new Map<string, string[]>();
/** 값이 아니라 «잡음»이라 안 옮긴 것 — 무엇을 걸렀는지 보여 준다. */
const junk: string[] = [];
const seen = new Set<string>();
for (const t of tabs) {
  t.rows.slice(t.hi + 1).forEach((r, k) => {
    const plate = norm(r[t.pi]);
    if (!plate) return;
    const rowAt = t.hi + 2 + k;
    const from = src.get(plate);
    if (!from) {
      // 원본에서 사라진 차 — 줄은 남기고 상태만 내린다.
      if (t.si >= 0 && S(r[t.si]) !== '출고불가') { gone++; data.push({ range: `'${t.title}'!${colA1(t.si)}${rowAt}`, values: [['출고불가']] }); }
      return;
    }
    seen.add(plate);
    let hit = false;
    t.hdr.forEach((name, i) => {
      if (!S(name) || OURS.has(norm(name))) return;          // 우리 칸은 안 건드린다
      const now = S(r[i]);
      const next = from.get(norm(name));
      if (next === undefined || next === now) return;
      if (!next && now) return;                              // 원본이 비었다고 우리 값을 지우지 않는다
      /**
       * ⚠ **숫자로 같으면 안 건드린다.** 「93,000」과 「93000」은 같은 값이다.
       *   표기만 되돌리면 그 칸이 매번 «갱신 대상»으로 떠서, 진짜 바뀐 값이 그 속에 묻힌다.
       *   실측 2026-08-14 손오공 주행거리 한 칸이 그랬다.
       */
      if (sameNumber(now, next)) return;
      /**
       * ⚠ **날짜 칸에 날짜 아닌 값을 넣지 않는다.**
       *   이안카 원본은 「입고일자」 칸에 상태(「재고확인」)를 복사해 뒀다(실측 2026-08-14 · 77대).
       *   그대로 옮기면 재고일수 계산이 통째로 깨진다 — 그 칸으로 «며칠째 안 나가는지»를 센다.
       * ⚠ 「배기량 0」도 안 받는다. 전기차라 배기량이 없는 것이지 0cc 인 차는 없다.
       */
      if (/입고일자|최초등록/.test(name) && next && !/\d/.test(next)) { junk.push(`${name}「${next}」`); return; }
      if (/배기량/.test(name) && /^0+$/.test(next)) { junk.push(`${name}「0」`); return; }
      data.push({ range: `'${t.title}'!${colA1(i)}${rowAt}`, values: [[next]] });
      cells++; hit = true;
      if (!byCol.has(name)) byCol.set(name, []);
      byCol.get(name)!.push(`「${now || '(빈칸)'}」→「${next}」`);
      if (i === t.ti) { renamed++; renamedList.push(`${S(r[t.pi])} 「${now}」 → 「${next}」`); }
    });
    if (hit) touched++;
  });
}

/**
 * ── ④ 원본에만 있는 새 차.
 * ★탭이 **하나면** 맨 아래에 더한다.
 * ⚠ 탭이 **여럿이면 더하지 않는다.** 어느 탭에 넣을지는 짐작할 일이 아니다 —
 *   손오공은 렌트인지 구독인지에 따라 탭이 갈리고, 잘못 넣으면 요금 규격이 다른 표에 선다.
 *   목록으로 보여 주고 사람이 넣게 한다.
 */
const fresh = [...src.keys()].filter((p) => !seen.has(p));
const one = tabs.length === 1 ? tabs[0] : null;
const newRows: string[][] = one
  ? fresh.map((plate) => {
    const from = src.get(plate)!;
    return one.hdr.map((name) => (OURS.has(norm(name)) ? '' : S(from.get(norm(name)))));
  })
  : [];

console.log(`  갱신할 차 ${touched}대 · 칸 ${cells}`);
if (byCol.size) {
  console.log('');
  console.log('어느 열이 갱신되나 — 여기서 «늘 갱신되는 열»이 보이면 우리 정규화를 되돌리는 중이다');
  for (const [name, list] of [...byCol].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`     ${name.padEnd(12)} ${String(list.length).padStart(3)}칸  ${list.slice(0, 2).join(' · ').slice(0, 90)}`);
  }
}
console.log(`  새 차 ${fresh.length}대 · 원본에서 사라진 차 ${gone}대(상태만 출고불가)`);
if (junk.length) {
  const tally = new Map<string, number>();
  for (const j of junk) tally.set(j, (tally.get(j) || 0) + 1);
  console.log('');
  console.log(`  ▲ 값이 아니라 «잡음»이라 안 옮긴 칸 ${junk.length}`);
  for (const [k, n] of [...tally].sort((a, b) => b[1] - a[1]).slice(0, 6)) console.log(`     ${k} × ${n}`);
  console.log('     공급사 원본이 그 칸을 다른 뜻으로 쓰고 있다 — 공급사에 물어볼 일이다.');
}
if (fresh.length && !one) {
  console.log('');
  console.log(`  ▲ 탭이 ${tabs.length}개라 새 차는 «자동으로 안 넣는다» — 어느 탭인지는 짐작할 일이 아니다`);
  console.log(`     ${fresh.slice(0, 20).map((p) => S(src.get(p)!.get('차량번호')) || p).join(' · ')}${fresh.length > 20 ? ` … 모두 ${fresh.length}` : ''}`);
  console.log(`     탭: ${tabs.map((t) => t.title).join(' · ')} — 손으로 넣고 다시 돌리면 그때부터 갱신된다`);
}
if (renamed) {
  console.log(``);
  console.log(`⚠ 차명이 바뀐 차 ${renamed} — 정제칸이 낡았을 수 있다`);
  for (const x of renamedList.slice(0, 10)) console.log(`     ${x}`);
}
if (!APPLY) {
  console.log('');
  console.log('※ dry-run. 실제 반영은 --apply');
  process.exit(0);
}

for (let i = 0; i < data.length; i += 500) {
  await call(`${SH}/${TO}/values:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data: data.slice(i, i + 500) }),
  });
}
if (newRows.length && one) {
  /**
   * ★붙일 자리는 «값이 있는 마지막 줄» 다음이다.
   * ⚠ 예전엔 «차번이 있는 줄 수»로 셌다. 사람이 중간에 빈 줄이나 구분줄을 하나만 넣어도
   *   그만큼 위에서부터 덮어써 기존 줄이 갈렸다. 줄 수가 아니라 «마지막 자리»로 센다.
   */
  let last = one.hi;
  one.rows.forEach((r, i) => { if (i > one.hi && r.some((c) => S(c))) last = i; });
  const at = last + 1;
  // ⚠ 쓰기 직전에 그 자리가 정말 비었는지 되읽는다. 안 비었으면 멈춘다.
  const guard = await call(`${SH}/${TO}/values/${encodeURIComponent(`'${one.title}'!A${at + 1}:A${at + newRows.length}`)}`) as { values?: string[][] };
  const busy = ((guard.values || []) as string[][]).filter((r) => S(r[0])).length;
  if (busy) throw new Error(`새 차를 붙일 자리(${at + 1}행부터 ${newRows.length}줄)에 이미 ${busy}줄이 있다 — 덮어쓰지 않는다`);
  await call(`${SH}/${TO}/values/${encodeURIComponent(`'${one.title}'!A${at + 1}`)}?valueInputOption=USER_ENTERED`, {
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
        ['', nowKST(), `동기 — 원본 ${src.size}대 · 갱신 ${cells}칸 · 새 차 ${newRows.length}${fresh.length && !one ? `(수동 ${fresh.length})` : ''} · 사라진 차 ${gone}`],
        ['@이력끝', '', ''],
      ] }),
    });
  }
} catch (e) { console.log(`  ⚠ 이력을 못 남겼다 — ${(e as Error).message.slice(0, 80)}`); }
console.log(``);
console.log(`반영 완료 — 갱신 ${cells}칸 · 새 줄 ${newRows.length}
`);
