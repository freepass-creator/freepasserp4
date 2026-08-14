/**
 * **「ERP4 차종마스터 원천대장」을 본다 — 규모·무결성·구멍.** 읽기 전용.
 *
 * ★왜(사장님 2026-08-14 — 「니가 구글 시트 한번 보면서 너도 차종마스터 확인해봐」)
 *   차번에 코드를 박으려면 **박을 코드가 있어야** 한다. 마스터에 그 차가 없으면
 *   코드를 못 박고, 못 박으면 그 차는 영영 «매번 알아맞히는» 자리에 남는다.
 *   그래서 이 감사는 «마스터가 좋은가»가 아니라 **«우리 재고를 다 덮는가»**를 본다.
 *
 * ★세 가지를 본다.
 *   ① 규모와 상태 — 몇 줄이고, 검증이 어디까지 됐나
 *   ② 무결성 — 코드가 겹치거나, 값이 서로 모순되지 않나
 *   ③ **구멍** — 우리 재고에 있는데 마스터에 없는 차종. 이게 실제 할 일 목록이다.
 *
 * ⚠ 「없는 것」을 셀 때 **우리 재고를 기준**으로 센다. 마스터 전체의 빈 칸을 세면
 *   숫자만 크고 할 일이 안 보인다 — 안 파는 차의 빈 칸은 급하지 않다.
 *
 *   npx tsx scripts/audit-master-sheet.mts
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { companyAlias } from '../lib/domain/identity';
import { MASTER_SHEET_ID, MASTER_TAB, liters, readMasterSheet, type MasterRow } from '../lib/domain/vehicle-master-sheet';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const arg = (k: string, d = '') => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || d;
const DOC_NAME = arg('name', '프리패스 재고');
const norm = (v: unknown) => S(v).replace(/\s+/g, '').toLowerCase();

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const gT = (await new JWT({ email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'], subject: 'pyh@teamjpk.com' }).getAccessToken()).token;
const api = async (url: string): Promise<Rec> => {
  for (let n = 0; ; n++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${gT}` } });
    const body = await res.json().catch(() => ({})) as Rec;
    if (res.ok) return body;
    if ((res.status === 429 || res.status >= 500) && n < 6) { await new Promise((ok) => setTimeout(ok, Math.min(60_000, 5_000 * 2 ** n))); continue; }
    throw new Error(body?.error?.message || `HTTP ${res.status}`);
  }
};
const a1Tab = (t: string) => `'${t.replace(/'/g, "''")}'`;
const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - [...s].reduce((a, c) => a + (c.charCodeAt(0) > 127 ? 2 : 1), 0)));

const raw = ((await api(`https://sheets.googleapis.com/v4/spreadsheets/${MASTER_SHEET_ID}/values/${encodeURIComponent(a1Tab(MASTER_TAB))}`) as { values?: string[][] }).values || []) as string[][];
const BOOK = readMasterSheet(raw);
const rows = BOOK.rows;
const live = rows.filter((r) => r.state !== '제외');

console.log(`\n■ 차종마스터 원천대장 — ${MASTER_TAB}\n`);

// ── ① 규모와 상태
const by = <T>(f: (r: MasterRow) => T) => { const m = new Map<T, number>(); for (const r of rows) m.set(f(r), (m.get(f(r)) || 0) + 1); return m; };
const subModels = new Set(live.map((r) => `${r.maker}|${r.model}|${r.subModel}`));
console.log(`  트림행키 ${rows.length}줄 · 쓸 수 있는 줄(제외 뺀) ${live.length}`);
console.log(`  제조사 ${new Set(live.map((r) => r.maker)).size} · 모델 ${new Set(live.map((r) => `${r.maker}|${r.model}`)).size} · 세부모델 ${subModels.size}`);
console.log(`  관리상태  ${[...by((r) => r.state)].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k || '(빈)'} ${v}`).join(' · ')}`);

// ── ② 무결성
console.log(`\n  ── 무결성`);
const dupCode = new Map<string, number>();
for (const r of raw.slice(1)) { const c = S(r[(raw[0] || []).map(S).indexOf('트림행키')]); if (c) dupCode.set(c, (dupCode.get(c) || 0) + 1); }
const dups = [...dupCode].filter(([, n]) => n > 1);
console.log(`  같은 트림행키가 두 번 이상 ${dups.length}건${dups.length ? ` — ${dups.slice(0, 4).map(([c, n]) => `${c}×${n}`).join(' · ')}` : ''}`);
const badShape = live.filter((r) => !/^.+::v\d+::t\d+$/.test(r.code));
console.log(`  코드 모양이 «마스터ID::v##::t##» 이 아닌 줄 ${badShape.length}${badShape.length ? ` — ${badShape.slice(0, 3).map((r) => r.code).join(' · ')}` : ''}`);
const midMismatch = live.filter((r) => r.masterId && !r.code.startsWith(`${r.masterId}::`));
console.log(`  코드와 마스터ID가 어긋난 줄 ${midMismatch.length}`);

/** 값끼리 모순 — 여기가 틀리면 코드를 박아도 틀린 값이 나간다. */
const isEv = (r: MasterRow) => /전기|수소/.test(`${r.fuel} ${r.powertrain}`);
const evWithCc = live.filter((r) => isEv(r) && r.cc);
const iceNoCc = live.filter((r) => !isEv(r) && !r.cc);
const fuelClash = live.filter((r) => r.fuel && r.powertrain && !norm(r.powertrain).includes(norm(r.fuel))
  && !(norm(r.fuel) === 'lpg' && /lpg/i.test(r.powertrain)));
const ccClash = live.filter((r) => {
  if (!r.cc) return false;
  const m = r.powertrain.match(/(\d\.\d)/);
  return m ? liters(r.cc) !== Number(m[1]).toFixed(1) : false;
});
console.log(`  전기·수소인데 배기량이 적힌 줄 ${evWithCc.length}${evWithCc.length ? ` — ${evWithCc.slice(0, 3).map((r) => `${r.subModel} ${r.powertrain} ${r.cc}`).join(' · ')}` : ''}`);
console.log(`  엔진차인데 배기량이 빈 줄 ${iceNoCc.length}${iceNoCc.length ? ` — ${iceNoCc.slice(0, 3).map((r) => `${r.subModel} ${r.powertrain}`).join(' · ')}` : ''}`);
console.log(`  연료와 파워트레인 라벨이 어긋난 줄 ${fuelClash.length}${fuelClash.length ? ` — ${fuelClash.slice(0, 3).map((r) => `${r.subModel} 「${r.powertrain}」 연료 ${r.fuel}`).join(' · ')}` : ''}`);
console.log(`  배기량과 라벨 숫자가 어긋난 줄 ${ccClash.length}${ccClash.length ? ` — ${ccClash.slice(0, 3).map((r) => `${r.subModel} 「${r.powertrain}」 ${r.cc}cc`).join(' · ')}` : ''}`);
const noTrim = live.filter((r) => !r.trim);
console.log(`  트림이 빈 줄 ${noTrim.length} — 트림이 없는 차는 정상이지만, 있는 차가 비면 코드를 못 고른다`);

// ── ③ 구멍 — 우리 재고 기준
console.log(`\n  ── 우리 재고를 덮는가 (여기가 할 일 목록이다)`);
const files = await api(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(`name contains '${DOC_NAME}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`)}&fields=files(id,name)&pageSize=100&includeItemsFromAllDrives=true&supportsAllDrives=true`);
type Need = { maker: string; model: string; sub: string; cars: string[] };
const need = new Map<string, Need>();
let stock = 0;
for (const f of ((files.files || []) as Rec[])) {
  const id = S(f.id);
  const who = companyAlias(S(f.name).replace(DOC_NAME, '').trim()) || S(f.name).replace(DOC_NAME, '').trim();
  let meta: Rec;
  try { meta = await api(`https://sheets.googleapis.com/v4/spreadsheets/${id}?fields=${encodeURIComponent('sheets.properties(title)')}`); } catch { continue; }
  const titles = ((meta.sheets || []) as Rec[]).map((s) => S(s.properties?.title)).filter(Boolean);
  if (!titles.length) continue;
  let got: Rec;
  try { got = await api(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values:batchGet?${titles.map((x) => `ranges=${encodeURIComponent(a1Tab(x))}`).join('&')}&majorDimension=ROWS`); } catch { continue; }
  for (const vr of ((got.valueRanges || []) as Rec[])) {
    const grid = ((vr.values || []) as string[][]);
    const h = grid.findIndex((r) => r.some((c) => S(c) === '차량번호'));
    if (h < 0) continue;
    const hdr = (grid[h] || []).map(S);
    const at = (n: string) => hdr.indexOf(n);
    const pi = at('차량번호'), mk = at('제조사(정제)'), md = at('모델'), sb = at('세부모델');
    if (pi < 0 || sb < 0) continue;
    for (const r of grid.slice(h + 1)) {
      const plate = S(r[pi]); if (!plate) continue;
      stock++;
      const maker = mk >= 0 ? S(r[mk]) : '', model = md >= 0 ? S(r[md]) : '', sub = S(r[sb]);
      if (!sub) continue;
      const key = `${norm(maker)}|${norm(model)}|${norm(sub)}`;
      const hit = live.some((x) => `${norm(x.maker)}|${norm(x.model)}|${norm(x.subModel)}` === key);
      if (hit) continue;
      const cur = need.get(key) || { maker, model, sub, cars: [] };
      cur.cars.push(`${who} ${plate}`);
      need.set(key, cur);
    }
  }
}
const missing = [...need.values()].sort((a, b) => b.cars.length - a.cars.length);
const missCars = missing.reduce((a, x) => a + x.cars.length, 0);
console.log(`  제공시트 ${stock}대 중 **마스터에 세부모델이 없는 차 ${missCars}대** · 차종 ${missing.length}종\n`);
console.log(`  ${pad('대수', 6)}${pad('제조사', 12)}${pad('모델', 14)}세부모델`);
for (const m of missing.slice(0, 25)) {
  console.log(`  ${pad(`${m.cars.length}대`, 6)}${pad(m.maker || '?', 12)}${pad(m.model || '?', 14)}${m.sub}`);
}
if (missing.length > 25) console.log(`  … 그 밖 ${missing.length - 25}종`);
console.log(`\n  ★이 목록이 곧 «원천대장에 넣어야 할 차»다. 넣으면 그만큼 코드를 박을 수 있다.\n`);
