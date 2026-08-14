/**
 * **우리 제공시트와 문패가 가리키는 시트를 견준다 — 문패를 넘겨도 되는지 판정한다.** 읽기 전용.
 *
 * ★왜(사장님 2026-08-14 — 「공급사 시트를 잘 연동시키는 거」)
 *   정제칸은 우리 제공시트 「<공급사> 프리패스 재고」에 채워져 있다. 그런데 **문패는 아직
 *   열여섯 곳이 공급사 자체 시트를 가리킨다.** 그래서 채운 값이 영업자 표에 안 보인다.
 *   문패를 우리 시트로 넘기면 그날로 살아나지만, 우리 시트가 낡았으면 **영업자가 옛 요금을
 *   보게 된다** — 이 구조에서 제일 나쁜 실패다(아무도 안 죽고 화면에도 표시가 없다).
 *   그래서 넘기기 전에 «같은 차가 같은 돈으로 들어 있는가»를 이 감사가 판정한다.
 *
 * ★**돈만 본다.** 차종·색은 우리가 일부러 다르게(정제해서) 갖고 있다 — 그건 어긋남이 아니다.
 *   어긋나면 안 되는 것은 요금·보증금·주행거리·차량가격처럼 **공급사가 정하는 값**이다.
 * ★판정은 셋뿐이다 — 넘겨도 됨 / 아직 / 못 견줌. 애매한 것을 «됨»으로 세지 않는다.
 *
 *   npx tsx scripts/audit-ours-vs-hub.mts
 *   npx tsx scripts/audit-ours-vs-hub.mts --who=빌린카
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { SALES_ALIAS } from '../lib/domain/sales-sheet-mapping';
import { companyAlias, supplierNameKeys } from '../lib/domain/identity';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const arg = (k: string, d = '') => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || d;
const ONLY = new Set(arg('who').split(/[,\s]+/).map(S).filter(Boolean));
const INDEX_SHEET = arg('index', '1TVeVXyJJRx0SzD2vxqy3eEjSojmMIWXSu7AdsKmpfmY');
const DOC_NAME = arg('name', '프리패스 재고');

/** ★공급사가 정하는 값만. 차종·색·옵션은 우리가 일부러 정제해서 다르게 갖고 있다. */
const MONEY = ['단기보증', '1개월', '12개월', '장기보증', '24개월', '36개월', '48개월', '60개월', 'Km', '소비자가격'];

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const gT = (await new JWT({ email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'], subject: 'pyh@teamjpk.com' }).getAccessToken()).token;

const api = async (url: string): Promise<Rec> => {
  for (let n = 0; ; n++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${gT}` } });
    const body = await res.json().catch(() => ({})) as Rec;
    if (res.ok) return body;
    if ((res.status === 429 || res.status >= 500) && n < 6) {
      await new Promise((ok) => setTimeout(ok, Math.min(60_000, 5_000 * 2 ** n)));
      continue;
    }
    throw new Error(body?.error?.message || `HTTP ${res.status}`);
  }
};

const a1Tab = (t: string) => `'${t.replace(/'/g, "''")}'`;
/** 돈 비교용 — 콤마·원·공백을 털어 «숫자로 같은가»를 본다. 「1,200,000」과 「1200000」은 같다. */
const money = (v: unknown) => { const d = S(v).replace(/[,\s원₩]/g, ''); return /^\d+(\.\d+)?$/.test(d) ? String(Number(d)) : S(v); };
const plate = (v: unknown) => S(v).replace(/\s/g, '');

/** 시트 하나를 차번 → {열이름: 값} 으로 읽는다. 여러 탭이면 먼저 나온 차를 쓴다(발행기와 같다). */
async function readBook(id: string) {
  const meta = await api(`https://sheets.googleapis.com/v4/spreadsheets/${id}?fields=${encodeURIComponent('sheets.properties(title)')}`);
  const titles = ((meta.sheets || []) as Rec[]).map((s) => S(s.properties?.title)).filter(Boolean);
  if (!titles.length) return new Map<string, Record<string, string>>();
  const qs = titles.map((x) => `ranges=${encodeURIComponent(a1Tab(x))}`).join('&');
  const got = await api(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values:batchGet?${qs}&majorDimension=ROWS`);
  const book = new Map<string, Record<string, string>>();
  for (const vr of ((got.valueRanges || []) as Rec[])) {
    const grid = ((vr.values || []) as string[][]);
    const hRow = grid.findIndex((r) => r.some((c) => S(c) === '차량번호' || S(c) === '차번'));
    if (hRow < 0) continue;
    const hdr = (grid[hRow] || []).map(S);
    const at = new Map<string, number>();
    hdr.forEach((h, i) => { if (h && !at.has(h)) at.set(h, i); });
    /** 발행기와 **같은 별칭**을 쓴다 — 다른 이름표를 쓰면 없는 어긋남이 만들어진다. */
    const pick = (name: string, row: string[]) => {
      for (const c of (SALES_ALIAS[name] || [name])) { const i = at.get(c); if (i !== undefined) { const v = S(row[i]); if (v) return v; } }
      return '';
    };
    const pAt = at.get('차량번호') ?? at.get('차번') ?? -1;
    if (pAt < 0) continue;
    for (const row of grid.slice(hRow + 1)) {
      const p = plate(row[pAt]);
      if (!p || book.has(p)) continue;
      book.set(p, Object.fromEntries(MONEY.map((c) => [c, pick(c, row)])));
    }
  }
  return book;
}

/** 문패 — 공급사명·코드·주소. */
const hub: { name: string; raw: string; code: string; id: string }[] = [];
{
  const v = await api(`https://sheets.googleapis.com/v4/spreadsheets/${INDEX_SHEET}/values/A1:Z300`) as { values?: string[][] };
  for (const r of ((v.values || []) as string[][])) {
    const id = (S(r[2]).match(/\/d\/([\w-]+)/) || [])[1];
    if (!id || !S(r[1])) continue;
    hub.push({ name: companyAlias(S(r[0])) || S(r[0]), raw: S(r[0]), code: S(r[1]), id });
  }
}
/** 이름 맞추기 열쇠는 `identity.supplierNameKeys` 하나에서 나온다 — 도구마다 따로 적으면 답이 갈린다. */
const keys = supplierNameKeys;

/** 우리 제공시트 — 드라이브에서 이름으로. 채우기 도구와 같은 방식이다. */
const ours = new Map<string, string>();
{
  const q = `name contains '${DOC_NAME}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`;
  const r = await api(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=100&includeItemsFromAllDrives=true&supportsAllDrives=true`);
  for (const f of ((r.files || []) as Rec[])) {
    const nm = S(f.name).replace(DOC_NAME, '').trim();
    for (const k of keys(nm)) if (!ours.has(k)) ours.set(k, S(f.id));
  }
}

console.log('\n■ 우리 제공시트 ↔ 문패 시트 — 문패를 넘겨도 되나 (읽기 전용)\n');
const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - [...s].reduce((a, c) => a + (c.charCodeAt(0) > 127 ? 2 : 1), 0)));
const go: string[] = [], wait: string[] = [], unknown: string[] = [];
/**
 * ★**어긋난 것을 파일로도 뽑는다** — `--json=tmp/ours-vs-hub.json`.
 *   화면은 예시 세 줄만 보여 준다. 어느 쪽이 옳은지 가리려면 어긋난 칸을 **전부** 봐야 하고,
 *   그건 시트를 다시 읽지 않고 파일로 하는 것이 맞다(쿼터를 또 태우지 않는다).
 */
const detail: Rec = {};

for (const h of hub) {
  if (ONLY.size && !ONLY.has(h.name)) continue;
  let mine = '';
  for (const k of keys(h.raw)) { const hit = ours.get(k); if (hit) { mine = hit; break; } }
  if (!mine) { unknown.push(`${h.name} — 우리 제공시트가 없다`); continue; }
  if (mine === h.id) { go.push(`${h.name} — 이미 우리 시트를 가리킨다`); continue; }
  let A: Map<string, Record<string, string>>, B: Map<string, Record<string, string>>;
  try { A = await readBook(h.id); B = await readBook(mine); }
  catch (e) { unknown.push(`${h.name} — 못 읽었다: ${String((e as Error).message).slice(0, 40)}`); continue; }
  if (!A.size) { unknown.push(`${h.name} — 문패 시트에서 차를 못 읽었다`); continue; }

  const missing = [...A.keys()].filter((p) => !B.has(p));   // 문패엔 있는데 우리 시트엔 없는 차
  const extra = [...B.keys()].filter((p) => !A.has(p));
  let cells = 0, compared = 0;
  const ex: string[] = [];
  const diffs: Rec[] = [];
  for (const [p, a] of A) {
    const b = B.get(p);
    if (!b) continue;
    for (const c of MONEY) {
      const x = money(a[c]), y = money(b[c]);
      if (!x && !y) continue;
      compared++;
      if (x !== y) { cells++; diffs.push({ 차번: p, 열: c, 문패: a[c], 우리: b[c] }); if (ex.length < 3) ex.push(`${p} ${c} 「${a[c]}」↔「${b[c]}」`); }
    }
  }
  detail[h.name] = { 코드: h.code, 문패시트: h.id, 우리시트: mine, 문패대수: A.size, 우리대수: B.size, 견준돈칸: compared, 빠진차: missing, 남는차: extra, 어긋난칸: diffs };
  const line = `${pad(h.name, 12)}문패 ${String(A.size).padStart(3)}대 · 우리 ${String(B.size).padStart(3)}대 · 견준 돈칸 ${String(compared).padStart(4)}`;
  if (!compared) { unknown.push(`${line} — 한 칸도 못 견줬다`); continue; }
  /**
   * ⚠ **남는 차도 어긋남이다.** 우리 시트에만 있는 차는 공급사 목록에서 빠진 차다 —
   *   넘기면 영업자가 «없는 차»를 팔러 간다. 빠진 차만 세면 이게 안 보인다.
   */
  if (!missing.length && !extra.length && !cells) { go.push(`${line}  ✔`); continue; }
  const say = (label: string, arr: string[]) => `${label} ${arr.length}${arr.length ? ` (${arr.slice(0, 4).join(' ')}${arr.length > 4 ? ' …' : ''})` : ''}`;
  wait.push(`${line}\n      ${say('빠진 차', missing)} · ${say('남는 차', extra)} · 어긋난 돈칸 ${cells}${ex.length ? `\n      ${ex.join('\n      ')}` : ''}`);
}

{
  const out = arg('json');
  if (out) { writeFileSync(out, JSON.stringify(detail, null, 1), 'utf8'); console.log(`  어긋난 것을 ${out} 에 뽑았다
`); }
}
console.log(`  ● 넘겨도 됨 ${go.length}곳 — 우리 시트에 같은 차가 같은 돈으로 다 있다`);
for (const l of go) console.log(`     ${l}`);
console.log(`\n  ● 아직 ${wait.length}곳 — 넘기면 영업자가 옛 값을 본다`);
for (const l of wait) console.log(`     ${l}`);
if (unknown.length) {
  console.log(`\n  ● 못 견줌 ${unknown.length}곳 — «맞음»이 아니라 «모름»이다`);
  for (const l of unknown) console.log(`     ${l}`);
}
console.log('');
