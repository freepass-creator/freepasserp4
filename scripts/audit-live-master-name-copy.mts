/**
 * **정제칸·판매 이름이 라이브 「차종마스터」 행인가** — 읽기 전용. 코덱스 검사.
 *
 * 정본(2026-09-01): 모델·세부모델·세부트림은 라이브 탭에 있는 행을 그대로 복사.
 * F03 이름 생성·FL 가공·상품시트/ERP만 수정은 버그. 고치지 말고 보고.
 *
 *   npm run audit:live-master-names
 *
 * exit 1 = 375어8085 게이트 실패, 또는 라이브에 없는 이름이 남아 있음.
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { MASTER_SHEET_ID, MASTER_TAB } from '../lib/domain/vehicle-master-sheet';
import { SALES_SHEET_ID } from '../lib/domain/legacy-sheets';
import { liveNameMembership } from '../lib/domain/live-master-name-copy';

const S = (v: unknown) => String(v ?? '').trim();
const tuple = (model: string, sub: string, trim: string) => `${model}\t${sub}\t${trim}`;
const SONO = '1WIFn5ObK_nCVGLTjj6rO96i6vxub1QzJmiVW0BpJLcA';
const SENTINEL = '375어8085';
const SENTINEL_WANT = tuple('G80', 'G80 RG3', '기본형');

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({
  email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com',
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const get = async (id: string, range: string) => {
  for (let n = 0; ; n++) {
    const tok = (await jwt.getAccessToken()).token;
    const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${encodeURIComponent(range)}`, {
      headers: { Authorization: `Bearer ${tok}` },
    });
    const j = await r.json() as { values?: string[][]; error?: { message?: string } };
    if (r.ok) return (j.values || []).map((row) => (row || []).map((c) => S(c)));
    const msg = j.error?.message || JSON.stringify(j).slice(0, 200);
    if ((r.status === 429 || /Quota exceeded/i.test(msg)) && n < 6) {
      await sleep(Math.min(60_000, 8_000 * 2 ** n));
      continue;
    }
    throw new Error(msg);
  }
};

type Hit = { src: string; plate: string; model: string; sub: string; trim: string; fuel: string };

function scanTab(src: string, grid: string[][]): { sentinel?: Hit; evGas: Hit[] } {
  const hi = grid.findIndex((r) => r.includes('차량번호') && (r.includes('세부모델') || r.includes('모델')));
  if (hi < 0) return { evGas: [] };
  const h = grid[hi];
  const i = (n: string) => h.indexOf(n);
  const pi = i('차량번호'), mi = i('모델'), si = i('세부모델'), ti = i('세부트림');
  const fi = i('연료(정제)') >= 0 ? i('연료(정제)') : i('연료');
  const evGas: Hit[] = [];
  let sentinel: Hit | undefined;
  for (const row of grid.slice(hi + 1)) {
    const plate = row[pi];
    if (!plate) continue;
    const model = row[mi] || '', sub = row[si] || '', trim = row[ti] || '';
    const fuel = fi >= 0 ? (row[fi] || '') : '';
    if (!(model || sub || trim)) continue;
    const hit: Hit = { src, plate, model, sub, trim, fuel };
    if (plate.replace(/\s/g, '') === SENTINEL) sentinel = hit;
    if (/일렉트리파이드/.test(sub) && /가솔린/.test(fuel)) evGas.push(hit);
  }
  return { sentinel, evGas };
}

function offMaster(src: string, grid: string[][], tuples: Set<string>, modelSub: Set<string>, models: Set<string>): Hit[] {
  const hi = grid.findIndex((r) => r.includes('차량번호') && (r.includes('세부모델') || r.includes('모델')));
  if (hi < 0) return [];
  const h = grid[hi];
  const i = (n: string) => h.indexOf(n);
  const out: Hit[] = [];
  for (const row of grid.slice(hi + 1)) {
    const plate = row[i('차량번호')];
    if (!plate) continue;
    const model = row[i('모델')] || '', sub = row[i('세부모델')] || '', trim = row[i('세부트림')] || '';
    const why = liveNameMembership(model, sub, trim, tuples, modelSub, models);
    if (why.startsWith('bad')) {
      out.push({ src, plate, model, sub, trim, fuel: row[i('연료')] || row[i('연료(정제)')] || '' });
    }
  }
  return out;
}

const liveGrid = await get(MASTER_SHEET_ID, `'${MASTER_TAB}'!A1:AF`);
const lh = liveGrid[0];
const li = (n: string) => lh.indexOf(n);
const live = new Set(liveGrid.slice(1).map((r) => tuple(r[li('모델')], r[li('세부모델')], r[li('세부트림')])));
const liveMS = new Set(liveGrid.slice(1).map((r) => `${r[li('모델')]}\t${r[li('세부모델')]}`));
const liveM = new Set(liveGrid.slice(1).map((r) => r[li('모델')]));

const pickup = await get(SONO, "'픽업재고'");
const sub = await get(SONO, "'구독재고'");
const pickupScan = scanTab('픽업재고', pickup);
const pickupOff = offMaster('픽업재고', pickup, live, liveMS, liveM);
const subOff = offMaster('구독재고', sub, live, liveMS, liveM);
const salesOff: Hit[] = [];
let salesWarn = '';
try {
  const salesMeta = await (await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SALES_SHEET_ID}?fields=sheets.properties(title,hidden)`,
    { headers: { Authorization: `Bearer ${(await jwt.getAccessToken()).token}` } },
  )).json() as { sheets?: { properties: { title: string; hidden?: boolean } }[]; error?: { message?: string } };
  if (salesMeta.error) throw new Error(salesMeta.error.message);
  const salesTabs = (salesMeta.sheets || []).map((s) => s.properties).filter((p) => !p.hidden).map((p) => p.title);
  for (const title of salesTabs) {
    await sleep(400);
    const grid = await get(SALES_SHEET_ID, `'${title.replace(/'/g, "''")}'`);
    salesOff.push(...offMaster(`판매:${title}`, grid, live, liveMS, liveM));
  }
} catch (e) {
  salesWarn = String((e as Error).message).slice(0, 180);
}

const sent = pickupScan.sentinel;
const sentOk = !!sent && tuple(sent.model, sent.sub, sent.trim) === SENTINEL_WANT && live.has(SENTINEL_WANT);
const evGas = pickupScan.evGas;
const gateFail = !sentOk || evGas.length > 0 || pickupOff.length > 0 || subOff.length > 0 || salesOff.length > 0;

const out = {
  liveRows: live.size,
  pickupBad: pickupOff.length,
  sonoSubBad: subOff.length,
  salesBad: salesOff.length,
  sentinel: sent ? { plate: sent.plate, model: sent.model, sub: sent.sub, trim: sent.trim, onLive: live.has(tuple(sent.model, sent.sub, sent.trim)), want: SENTINEL_WANT } : null,
  sentinelOk: sentOk,
  pickupGasolineElectrified: evGas.map((x) => x.plate),
  samplePickupOff: pickupOff.slice(0, 8).map((x) => `${x.plate} ${x.model}/${x.sub}/${x.trim}`),
  sampleSalesOff: salesOff.slice(0, 8).map((x) => `${x.src} ${x.plate} ${x.model}/${x.sub}/${x.trim}`),
  salesWarn: salesWarn || undefined,
  note: 'bad=라이브에 없는 이름. 트림 빈칸+세부모델 실재는 허용. 게이트=8085 + 일렉트리파이드 가솔린 0 + bad 0.',
};

console.log(JSON.stringify(out, null, 2));
if (gateFail) {
  if (!sentOk) console.error(`게이트 실패: ${SENTINEL} 가 라이브 행 ${SENTINEL_WANT} 가 아님`);
  if (evGas.length) console.error(`게이트 실패: 픽업 가솔린이 일렉트리파이드 ${evGas.map((x) => x.plate).join(', ')}`);
  if (pickupOff.length || subOff.length || salesOff.length) {
    console.error(`게이트 실패: 라이브에 없는 이름 픽업 ${pickupOff.length} · 구독 ${subOff.length} · 판매 ${salesOff.length}`);
  }
  process.exit(1);
}
