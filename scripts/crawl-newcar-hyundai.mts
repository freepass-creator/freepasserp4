/**
 * 현대 신차 크롤러 — 「내 차 만들기」 정본을 우리 Firestore 신차마스터로 (사장님 2026-09-05).
 *   representative-cars(견적가능) → model-filters(엔진·바디·구동 조합) → trims(트림) → init(실가·색상·조합규칙).
 *   Node fetch 로 서버서 돈다(브라우저 불필요) → 매일 검수 모니터로 재실행해 «달라진 것»을 잡는다.
 *
 * 기본 = data/new-car/hyundai.json 에 씀(드라이런). --limit=N 으로 N모델만. --apply 는 Firestore 쓰기(별도).
 * ⚠ 제조사 서버 배려: 호출 간 딜레이. 매일 1회만.
 */
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const LIMIT = Number((process.argv.find((a) => a.startsWith('--limit=')) || '').split('=')[1] || 0);
const TO_FS = process.argv.includes('--apply');
const H = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36', 'Accept': 'application/json', 'Referer': 'https://www.hyundai.com/kr/ko/e/vehicles/estimation' };
const BASE = 'https://www.hyundai.com/kr/ko';
const S = (v: unknown) => String(v ?? '').trim();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const g = async (u: string) => { const r = await fetch(u, { headers: H }); await sleep(180); return r.ok ? r.json().catch(() => null) : null; };
const post = async (u: string, b: unknown) => { const r = await fetch(u, { method: 'POST', headers: { ...H, 'content-type': 'application/json' }, body: JSON.stringify(b) }); await sleep(180); return r.ok ? r.json().catch(() => null) : null; };
const arr = (x: any): any[] => (Array.isArray(x?.data) ? x.data : Array.isArray(x?.data?.data) ? x.data.data : []);
const enabled = (list: any[], flag: string) => list.filter((x) => S(x[flag]) !== 'N');

const OFF = Number((process.argv.find((a) => a.startsWith('--offset=')) || '').split('=')[1] || 0);
const rep = await g(`${BASE}/gw/product/v1/product/car/representative-cars?searchYn=Y`);
let models = arr(rep).filter((m) => S(m.estPossibleYn) === 'Y').map((m) => ({ carCode: S(m.carCode), carName: S(m.carName) }));
models = models.slice(OFF, LIMIT ? OFF + LIMIT : undefined);
console.log(`견적가능 모델 ${models.length} (offset ${OFF}${LIMIT ? ` limit ${LIMIT}` : ''})`);

let FS: FirebaseFirestore.Firestore | null = null;
if (TO_FS) {
  const sa = JSON.parse(readFileSync('tmp/firebase-auth/sa.json', 'utf8'));
  if (!getApps().length) initializeApp({ credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: sa.private_key.replace(/\\n/g, '\n') }) });
  FS = getFirestore();
}
const day = new Date().toISOString().slice(0, 10);
// ★연료축 분리(Codex #7): 세부모델에서 Hybrid/Electric 등 연료어를 뗀다. 원문명은 sourceName 에 보존.
// ★\b 는 한글 뒤에서 안 먹어 「쏘나타 하이브리드」가 안 지워졌다(Codex 보통) → (?=\s|$) 로 교체.
const stripFuel = (s: string) => S(s).replace(/\s*(플러그인\s*)?(하이브리드|hybrid|electric|일렉트릭|전기|ev|hev|phev)(?=\s|$)/gi, ' ').replace(/\s+/g, ' ').trim();
// ★세제혜택 후(Codex #4): 트림 행 taxIncentive = 개소세·교육세·취득세 감면액. 후 = 표시가 − 감면.
//   ⚠ 택시·모빌리티(영업용)는 taxIncentive 가 «음수»(가산)라 후>전 역전이 난다 → «양수 감면만» 적용(자체감사 2026-09-05).
const priceAfterOf = (t: any) => { const inc = Number(t.taxIncentive || 0); return inc > 0 ? Math.max(0, Number(t.price || 0) - inc) : Number(t.price || 0); };
// ★{merge:true} — 옵션은 별도 파이프(attach-hyundai-options)가 채우므로, 재크롤이 문서 통째 교체로 «옵션을 지우지 않게» 한다(Codex).
//   재크롤 뒤에도 options 필드는 살아남는다. 그래도 attach 는 매 크롤 뒤 재실행하는 게 정석(트림 바뀌면 옵션도 갱신).
const writeFS = async (rows: any[]) => { if (!FS || !rows.length) return; const batch = FS.batch(); for (const t of rows) batch.set(FS.collection('new_car_trim').doc(t.saleModelCode), { ...t, sub_model: stripFuel(t.carType), priceBefore: t.price, priceAfter: priceAfterOf(t), brandSource: 'hyundai.com', crawledAt: day }, { merge: true }); await batch.commit(); };

const trims: any[] = [];
for (const m of models) {
  const before = trims.length;
  const ab = m.carCode.replace(/[0-9]+$/, '');
  const f = await g(`${BASE}/gw/product/v1/product/model-filters/${m.carCode}?carCode=${m.carCode}&carPurposeCode=&carEnginCode=&carBodyCode=&carMissionCode=&carDriveCode=&carInteriorSpaceCode=&carLoadCode=&carVersionCode=&siteTypeCode=H`);
  const pc = S(f?.data?.carPurposeCode);
  const engines = enabled(f?.data?.carEnginType || [], 'carEnginEnableYn');
  const bodies = enabled(f?.data?.carBodyType || [], 'carBodyEnableYn');
  const missions = enabled(f?.data?.carMissionType || [], 'carMissionEnableYn');
  let n = 0;
  for (const e of engines) for (const b of (bodies.length ? bodies : [{ carBodyCode: '' }])) for (const ms of (missions.length ? missions : [{ carMissionCode: '' }])) {
    const tr = await g(`${BASE}/gw/product/v1/product/trims?carCode=${m.carCode}&carAbbreviation=${ab}&carPurposeCode=${pc}&carBodyCode=${S(b.carBodyCode)}&carEnginCode=${S(e.carEnginCode)}&carMissionCode=${S(ms.carMissionCode)}&carDriveCode=&carM5LoadCode=&carM5InteriorSpaceCode=&carVersionCode=`);
    for (const t of arr(tr)) {
      const smc = S(t.saleModelCode || t.saleMdlCd); if (!smc) continue;
      const init = await post(`${BASE}/e/api/bff/estimate/making/init`, { saleModelCode: smc, saleSpecCode: S(t.saleSpecCode) || 'A' });
      const d = init?.api_h_product_043?.data?.[0] || {};
      trims.push({
        maker: '현대', carType: m.carName, carCode: m.carCode,
        fuel: S(e.carEnginName), body: S(b.carBodyName), drive: S(ms.carMissionName),
        trim: S(t.carTrimName || t.saleModelName), saleModelCode: smc,
        sourceName: S(d.saleModelName),
        price: Number(t.carModelPrice || d.carPrice || 0),
        taxIncentive: Number(t.taxIncentive || 0),
        extColors: (init?.api_h_product_011?.data || []).map((c: any) => ({ name: S(c.exteriorColorName), code: S(c.exteriorColorCode), price: Number(c.exteriorColorPrice || 0), ok: S(c.choiceYn) })),
        intColors: (init?.api_h_product_012?.data || []).map((c: any) => ({ name: S(c.interiorColorName), code: S(c.interiorColorCode), ok: S(c.choiceYn) })),
      });
      n++;
    }
  }
  await writeFS(trims.slice(before));
  console.log(`  ${m.carCode} ${m.carName} — 트림 ${n}${TO_FS ? ' ✓FS' : ''}`);
}

mkdirSync('data/new-car', { recursive: true });
const payload = { _meta: { source: 'hyundai.com configurator API', crawledAt: new Date().toISOString().slice(0, 10), brand: '현대', modelCount: models.length, trimCount: trims.length }, trims };
writeFileSync('data/new-car/hyundai.json', JSON.stringify(payload, null, 1));
console.log(`\n✓ data/new-car/hyundai.json — 모델 ${models.length} · 트림 ${trims.length}${TO_FS ? ' · Firestore 반영 완료' : ''}`);
process.exit(0);
