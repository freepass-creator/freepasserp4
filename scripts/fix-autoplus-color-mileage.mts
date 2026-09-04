/**
 * 오토플러스(RP023) 색상·주행 교정 — 정제시트가 정본인데 원자가 «옛 시딩」으로 색상을 주행칸에 굳혔다.
 *   증상: 원자 mileage="블랙"(색상값) · ext_color="". 정제시트는 외장색상=블랙 · 주행거리=8,582 로 정확.
 *   색·주행은 write-once 라 정제시트가 맞아도 원자가 안 고쳐진다. 여기서 정제시트 → v4/products 로 교정.
 * 사장님 2026-09-04 「오토플러스 외장 색상 빠졌네 원자화 못한건가」.
 * 기본 dry-run · 반영은 --apply. 미러(mirror-to-firestore)가 v4 → Firestore SPEC 를 매번 복사하므로 이후 전파됨.
 */
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { JWT } from 'google-auth-library';

const APPLY = process.argv.includes('--apply');
const S = (v: unknown) => String(v ?? '').trim();
const sa = JSON.parse(readFileSync('tmp/firebase-auth/sa.json', 'utf8'));
initializeApp({ credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: sa.private_key.replace(/\\n/g, '\n') }), databaseURL: 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app' });
const rtdb = getDatabase();
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, scopes: ['https://www.googleapis.com/auth/spreadsheets'], subject: 'pyh@teamjpk.com' });
const api = async (u: string) => { const t = (await jwt.getAccessToken()).token; const r = await fetch(u, { headers: { Authorization: `Bearer ${t}` } }); return JSON.parse(await r.text()); };

// 정제시트에서 차번 → {색상, 주행} 을 읽는다(헤더 이름으로).
const REFINED = '1Tvd5IioF5y_yu3L1BQMRP4J1R8hcZHwkgl3vl-TsgY0';
const NKEY = (c: unknown) => S(c).replace(/\s/g, '');
const meta = await api(`https://sheets.googleapis.com/v4/spreadsheets/${REFINED}?fields=sheets.properties(title)`);
const truth = new Map<string, { color: string; mileage: string }>();
for (const sh of meta.sheets) {
  const title = S(sh.properties.title);
  const vv = await api(`https://sheets.googleapis.com/v4/spreadsheets/${REFINED}/values/${encodeURIComponent(`'${title}'!A1:BZ4000`)}`);
  const rows = vv.values || []; if (!rows.length) continue;
  const hd = (rows[0] || []).map(S);
  const ci = hd.indexOf('차량번호'), colI = hd.indexOf('외장색상'), kmI = hd.indexOf('주행거리');
  if (ci < 0 || colI < 0 || kmI < 0) continue;
  for (const r of rows.slice(1)) {
    const car = NKEY(r[ci]); if (!car) continue;
    truth.set(car, { color: S(r[colI]), mileage: S(r[kmI]) });
  }
}
console.log(`정제시트에서 오토플러스 차번 ${truth.size}대 색상·주행 읽음`);

// v4/products 중 RP023 을 교정.
const products = (await rtdb.ref('v4/products').get()).val() as Record<string, any> || {};
const NUM = /^[\d,]+(\.\d+)?$/;
let fixed = 0, skipMiss = 0, alreadyOk = 0;
const updates: Record<string, any> = {};
const samples: string[] = [];
for (const [key, v] of Object.entries(products)) {
  if (!v || typeof v !== 'object' || S(v.provider_company_code) !== 'RP023') continue;
  const car = NKEY(v.car_number); const t = truth.get(car);
  if (!t) { skipMiss++; continue; }
  const curColor = S(v.ext_color), curKm = S(v.mileage);
  // 교정 대상 = 색상이 비었거나, 주행칸에 숫자가 아닌 값(색상)이 들어간 것
  const needColor = t.color && curColor !== t.color;
  const needKm = t.mileage && curKm !== t.mileage && (!NUM.test(curKm) || !curKm);
  if (!needColor && !needKm) { alreadyOk++; continue; }
  if (needColor) updates[`v4/products/${key}/ext_color`] = t.color;
  if (needKm) updates[`v4/products/${key}/mileage`] = t.mileage;
  fixed++;
  if (samples.length < 12) samples.push(`  ${car}: ext_color 「${curColor}」→「${t.color}」 · mileage 「${curKm}」→「${t.mileage}」`);
}
console.log(`RP023 교정 대상 ${fixed}대 · 이미 정상 ${alreadyOk} · 정제시트에 없음 ${skipMiss}`);
for (const s of samples) console.log(s);
if (!APPLY) { console.log(`\n미리보기 — 실제 반영: --apply (${Object.keys(updates).length} 필드)`); process.exit(0); }
await rtdb.ref().update(updates);
console.log(`\n반영 완료 — v4/products ${fixed}대 색상·주행 교정(${Object.keys(updates).length} 필드). 다음 미러가 Firestore 로 전파.`);
process.exit(0);
