/**
 * **판매시트 ↔ 차종마스터 정합성** — 시트에 찍힌 차명 축이 마스터에 있는가. 읽기 전용.
 *
 * ★기존 `audit-master-gap` 은 **ERP** 를 본다. 지금 판매시트는 공급사시트에서 직행으로 만들어져
 *   ERP 를 안 거치므로 그 감사로는 시트를 검증할 수 없다. 그래서 시트를 직접 본다.
 *
 * ★축은 마스터 구조 그대로 — 제조사 → 모델 → 세부모델 → 파워트레인 → 세부트림.
 *   어디서 끊겼는지로 가른다. 빈 칸은 «어긋남»이 아니라 «비었음»으로 따로 센다 —
 *   요즘 제네시스처럼 트림이 원래 없는 차가 있다.
 *
 *   npx tsx scripts/audit-sales-vs-master.mts
 *   npx tsx scripts/audit-sales-vs-master.mts --list
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { makerDisplay } from '../lib/domain/vehicle-master-match';
import type { MasterEntry } from '../lib/domain/vehicle-master-types';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const nk = (v: unknown) => S(v).replace(/[\s()\-·.]/g, '').toLowerCase();
const arg = (k: string, d = '') => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || d;
const LIST = process.argv.includes('--list');
const SHEET = arg('sheet', S(process.env.INVENTORY_EXPORT_SHEET_ID) || '1Y1Mx1EcEpAuNer0y50Dq4eK92CpVjThO_suZLmo2vVs');

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const tok = (await new JWT({
  email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'], subject: 'pyh@teamjpk.com',
}).getAccessToken()).token;
const api = async (u: string): Promise<Rec> => {
  const r = await fetch(u, { headers: { Authorization: `Bearer ${tok}` } });
  const t = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${t.slice(0, 200)}`);
  return JSON.parse(t);
};
const SH = 'https://sheets.googleapis.com/v4/spreadsheets';

const parsed = JSON.parse(readFileSync('public/data/vehicle-master.json', 'utf8')) as unknown;
const MASTER = (Array.isArray(parsed) ? parsed : ((parsed as Rec)?.entries || Object.values(parsed as Rec))) as MasterEntry[];
const byMaker = new Map<string, MasterEntry[]>();
for (const e of MASTER) {
  const k = nk(makerDisplay(e.maker));
  (byMaker.get(k) || byMaker.set(k, []).get(k)!).push(e);
}

const meta = await api(`${SH}/${SHEET}?fields=sheets.properties(title,hidden)`);
const tab = ((meta.sheets || []) as Rec[])
  .find((s) => !s.properties.hidden && S(s.properties.title).startsWith('상품리스트'))?.properties.title;
if (!tab) throw new Error('상품리스트 탭을 못 찾음');
const v = await api(`${SH}/${SHEET}/values/${encodeURIComponent(`'${String(tab).replace(/'/g, "''")}'`)}`) as { values?: string[][] };
const rows = (v.values || []) as string[][];
const hdr = (rows[0] || []).map(S);
const at = (r: string[], n: string) => S(r[hdr.indexOf(n)]);
console.log(`■ ${tab} ↔ 차종마스터 ${MASTER.length}건\n`);

type V = '✓' | '✗제조사' | '✗모델' | '✗세부모델' | '✗파워트레인' | '✗세부트림' | '-빈칸';
const tally = new Map<V, number>();
const gaps = new Map<string, number>();
const blanks = new Map<string, number>();
for (const r of rows.slice(1)) {
  const plate = at(r, '차량번호');
  if (!plate) continue;
  const maker = at(r, '제조사'), model = at(r, '모델'), sub = at(r, '세부모델');
  const pw = at(r, '파워트레인'), trim = at(r, '세부트림');
  // 빈 칸은 «어긋남»이 아니다 — 따로 센다.
  for (const [name, val] of [['제조사', maker], ['모델', model], ['세부모델', sub], ['파워트레인', pw], ['세부트림', trim]] as [string, string][]) {
    if (!val) blanks.set(name, (blanks.get(name) || 0) + 1);
  }
  const bump = (v: V, note = '') => {
    tally.set(v, (tally.get(v) || 0) + 1);
    if (v !== '✓' && v !== '-빈칸') gaps.set(`${v}|${note}`, (gaps.get(`${v}|${note}`) || 0) + 1);
  };
  if (!maker || !model) { bump('-빈칸'); continue; }
  const pool = byMaker.get(nk(makerDisplay(maker)));
  if (!pool) { bump('✗제조사', maker); continue; }
  const sameModel = pool.filter((e) => nk(e.model) === nk(model));
  if (!sameModel.length) { bump('✗모델', `${maker} ${model}`); continue; }
  if (!sub) { bump('-빈칸'); continue; }
  const sameSub = sameModel.filter((e) => nk(e.sub_model) === nk(sub) || nk(`${e.sub_model}${e.gen_code}`) === nk(sub));
  if (!sameSub.length) { bump('✗세부모델', `${maker} ${model} / ${sub}`); continue; }
  if (!pw) { bump('-빈칸'); continue; }
  const hitVar = sameSub.flatMap((e) => e.variants || []).filter((x) => nk(x.label) === nk(pw));
  if (!hitVar.length) { bump('✗파워트레인', `${maker} ${model} ${sub} / ${pw}`); continue; }
  if (!trim) { bump('✓'); continue; }
  const trims = new Set([...hitVar.flatMap((x) => x.trims || []), ...sameSub.flatMap((e) => e.trims || [])].map(nk));
  if (!trims.has(nk(trim))) { bump('✗세부트림', `${maker} ${model} ${sub} ${pw} / ${trim}`); continue; }
  bump('✓');
}
const total = rows.length - 1;
console.log(`■ ${total}대 판정`);
for (const [k, n] of [...tally].sort((a, b) => b[1] - a[1])) console.log(`   ${k.padEnd(10)} ${String(n).padStart(4)}대  ${(n / total * 100).toFixed(1)}%`);
console.log(`\n■ 빈 칸`);
for (const [k, n] of [...blanks].sort((a, b) => b[1] - a[1])) console.log(`   ${k.padEnd(10)} ${String(n).padStart(4)}대`);
console.log(`\n■ 마스터에 없는 것 — 같은 결손끼리 묶었다 (${gaps.size}종)`);
for (const [key, n] of [...gaps].sort((a, b) => b[1] - a[1]).slice(0, LIST ? 200 : 25)) {
  const [v, note] = key.split('|');
  console.log(`   ${String(n).padStart(3)}대  ${v.padEnd(8)} ${note}`);
}
if (!LIST && gaps.size > 25) console.log(`   … 그 밖 ${gaps.size - 25}종 (--list 로 전부)`);
