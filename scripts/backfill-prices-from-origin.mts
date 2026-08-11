/**
 * **우리 시트의 빈 요금 칸만** 공급사 옛 시트에서 채운다. 기본 dry-run, 반영은 `--apply`.
 *
 * ★왜(2026-08-11)
 *   정본을 우리 시트로 넘길 때, ERP 에 없던 차(=대여료가 없어 유입이 버린 차)는
 *   공급사 원본에서 «스펙만» 옮겨졌다. 그래서 요금 칸이 빈 채로 실렸고 그대로 못 파는 차가 됐다 —
 *   리더스 34호9093·34호9182 가 그랬다(옛 시트에는 12개월 620,000 이 있었다).
 *
 * ★**빈 칸만** 채운다. 값이 있으면 손대지 않는다 — 우리 시트가 이미 정본이고,
 *   공급사가 고친 값을 옛 시트로 되돌리면 안 된다.
 * ★옛 주소는 넘길 때 `sheet_note` 에 적어 뒀다. 없으면 `--from=<시트ID>` 로 준다.
 *
 *   npx tsx scripts/backfill-prices-from-origin.mts --code=RP008
 *   npx tsx scripts/backfill-prices-from-origin.mts --code=RP008 --apply
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { SHEET_GRID_FIELDS, readSupplierSheet } from '../lib/domain/supplier-sheet-read';
import { autoMapHeaders } from '../lib/domain/sheet-import';
import type { EntityRecord } from '../lib/intake/entities';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => S(v).replace(/\s+/g, '');
const APPLY = process.argv.includes('--apply');
const CODE = (process.argv.find((a) => a.startsWith('--code=')) || '').slice('--code='.length).trim();
const FROM = (process.argv.find((a) => a.startsWith('--from=')) || '').slice('--from='.length).trim();
const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
if (!CODE) { console.log('■ --code=RP008 처럼 공급사를 지정해야 한다\n'); process.exit(1); }

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const dbT = (await new JWT({ email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/firebase.database', 'https://www.googleapis.com/auth/userinfo.email'] }).getAccessToken()).token;
const gT = (await new JWT({ email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/drive', 'https://www.googleapis.com/auth/spreadsheets'],
  subject: 'pyh@teamjpk.com' }).getAccessToken()).token;
const api = async (url: string, init?: RequestInit): Promise<Rec> => {
  const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${gT}`, 'Content-Type': 'application/json', ...(init?.headers || {}) } });
  const body = await res.json().catch(() => ({})) as Rec;
  if (!res.ok) throw new Error(body?.error?.message || `HTTP ${res.status}`);
  return body;
};

const [t3, t4] = await Promise.all(['partners', 'v4/partners'].map(async (n) =>
  JSON.parse(await (await fetch(`${DB}/${n}.json?access_token=${dbT}`)).text()) || {}));
const dead = (p: Rec) => p?._deleted === true || !!p?.deletedAt || S(p?.status) === 'deleted';
let partner: Rec | null = null;
for (const src of [t3, t4] as Rec[]) for (const [k, v] of Object.entries<Rec>(src)) {
  if (v && typeof v === 'object' && !dead(v) && S(v.partner_code) === CODE) partner = { ...(partner || {}), ...v, _key: k };
}
if (!partner) { console.log(`■ ${CODE} 파트너가 없다\n`); process.exit(1); }
const liveId = (S(partner.sheet_url).match(/\/d\/([\w-]+)/) || [])[1];
const oldId = FROM || (S(partner.sheet_note).match(/\/d\/([\w-]+)/) || [])[1] || '';
console.log(`■ ${S(partner.partner_name || partner.name) || CODE}(${CODE}) 빈 요금 칸 채우기 ${APPLY ? '(반영)' : '(dry-run)'}\n`);
console.log(`  지금 시트 ${liveId}\n  옛 시트  ${oldId || '(못 찾음 — --from= 으로 주세요)'}\n`);
if (!liveId || !oldId) process.exit(1);

/** 옛 시트에서 차번별 요금 칸(열 이름 → 값)을 모은다. */
const oldGrid = await api(`https://sheets.googleapis.com/v4/spreadsheets/${oldId}?includeGridData=true&fields=${encodeURIComponent(SHEET_GRID_FIELDS)}`);
const oldPrices = new Map<string, Map<string, string>>();
for (const t of readSupplierSheet(oldGrid as never, { partner_code: CODE } as EntityRecord).tabs) {
  const hdr = (t.table[0] || []).map(S);
  const prof = autoMapHeaders(hdr) as Record<string, number | undefined>;
  const pi = prof.car_number;
  if (typeof pi !== 'number') continue;
  // 요금·보증금 칸만 본다. 나머지는 손대지 않는다.
  const money = hdr.map((h, i) => ({ h, i })).filter((x) => /보증|개월|^기타기간/.test(x.h));
  for (const row of t.table.slice(1)) {
    const pl = norm(row[pi]);
    if (!pl) continue;
    const m = oldPrices.get(pl) || new Map<string, string>();
    for (const { h, i } of money) { const v = S(row[i]); if (v && !m.has(h)) m.set(h, v); }
    oldPrices.set(pl, m);
  }
}
console.log(`  옛 시트에서 요금을 찾은 차 ${oldPrices.size}대`);

/** 지금 시트에서 «요금이 통째로 빈» 줄을 찾는다. */
const vals = await api(`https://sheets.googleapis.com/v4/spreadsheets/${liveId}/values/${encodeURIComponent('재고!A1:BZ600')}`);
const rows = ((vals.values || []) as string[][]);
const hdr = (rows[0] || []).map(S);
const iPlate = hdr.indexOf('차량번호');
const moneyCols = hdr.map((h, i) => ({ h, i })).filter((x) => /보증|개월|^기타기간/.test(x.h));
const A = (i: number) => (i < 26 ? String.fromCharCode(65 + i) : String.fromCharCode(64 + Math.floor(i / 26)) + String.fromCharCode(65 + (i % 26)));

const writes: { range: string; values: string[][] }[] = [];
let touched = 0;
for (let r = 1; r < rows.length; r++) {
  const pl = norm(rows[r][iPlate]);
  if (!pl) continue;
  const filled = moneyCols.filter((c) => S(rows[r][c.i])).length;
  if (filled) continue;                    // 값이 하나라도 있으면 손대지 않는다
  const src = oldPrices.get(pl);
  if (!src?.size) { console.log(`  · ${pl} 옛 시트에도 요금이 없다`); continue; }
  const put: string[] = [];
  for (const c of moneyCols) put.push(S(src.get(c.h)));
  if (!put.some(Boolean)) continue;
  touched++;
  console.log(`  ★ ${pl} — ${moneyCols.map((c, k) => (put[k] ? `${c.h} ${put[k]}` : '')).filter(Boolean).join(' · ')}`);
  // 요금 칸은 붙어 있지 않을 수 있다 — 칸마다 따로 쓴다.
  moneyCols.forEach((c, k) => { if (put[k]) writes.push({ range: `재고!${A(c.i)}${r + 1}`, values: [[put[k]]] }); });
}
console.log(`\n  채울 차 ${touched}대 · 칸 ${writes.length}개`);
if (!APPLY) { console.log('\n※ dry-run. 실제 반영은 --apply\n'); process.exit(0); }
if (!writes.length) { console.log('\n  채울 것 없음\n'); process.exit(0); }
await api(`https://sheets.googleapis.com/v4/spreadsheets/${liveId}/values:batchUpdate`, {
  method: 'POST', body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data: writes }),
});
console.log('\n  채움 완료 — 다음 동기화에 그 차들이 올라온다\n');
