/**
 * 신차 견적 실증 — 그랜저 한 대를 찍어 옵션까지 얹은 금액을 «Firestore 기준»으로 (사장님 2026-09-05).
 *   ① 현대 GN11(더 뉴 그랜저) 크롤 → Firestore `new_car_trim` 쓰기
 *   ② Firestore 에서 읽어 «픽한 구성»(트림+외장색)의 확정 금액 계산 + 조합규칙(choiceYn) 검증
 * 기본 = 크롤+계산만(Firestore 안 씀). --apply 로 Firestore 쓰기 후 그 기준으로 계산.
 */
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'node:fs';

const APPLY = process.argv.includes('--apply');
const H = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36', 'Accept': 'application/json', 'Referer': 'https://www.hyundai.com/kr/ko/e/vehicles/estimation' };
const B = 'https://www.hyundai.com/kr/ko';
const S = (v: unknown) => String(v ?? '').trim();
const won = (n: number) => n.toLocaleString('ko-KR') + '원';
const g = async (u: string) => (await fetch(u, { headers: H })).json().catch(() => null);
const post = async (u: string, b: unknown) => (await fetch(u, { method: 'POST', headers: { ...H, 'content-type': 'application/json' }, body: JSON.stringify(b) })).json().catch(() => null);

// ① GN11 가솔린 2.5 크롤
const engines = [['R', '가솔린 2.5']];
const trims: any[] = [];
for (const [ec, fuel] of engines) {
  const tr = await g(`${B}/gw/product/v1/product/trims?carCode=GN11&carAbbreviation=GN&carPurposeCode=J&carBodyCode=S&carEnginCode=${ec}&carMissionCode=T&carDriveCode=&carM5LoadCode=&carM5InteriorSpaceCode=&carVersionCode=`);
  for (const t of (tr?.data || [])) {
    const smc = S(t.saleModelCode || t.saleMdlCd);
    const init = await post(`${B}/e/api/bff/estimate/making/init`, { saleModelCode: smc, saleSpecCode: S(t.saleSpecCode) || 'A' });
    const d = init?.api_h_product_043?.data?.[0] || {};
    trims.push({
      id: smc, maker: '현대', carType: '그랜저', modelDisplay: '더 뉴 그랜저', fuel, trim: S(t.carTrimName),
      price: Number(t.carModelPrice || d.carPrice || 0),
      extColors: (init?.api_h_product_011?.data || []).map((c: any) => ({ name: S(c.exteriorColorName), price: Number(c.exteriorColorPrice || 0), ok: S(c.choiceYn) })),
      intColors: (init?.api_h_product_012?.data || []).map((c: any) => ({ name: S(c.interiorColorName), ok: S(c.choiceYn) })),
    });
  }
}
console.log(`크롤: 그랜저 가솔린2.5 트림 ${trims.length} — ${trims.map((t) => `${t.trim} ${won(t.price)}`).join(' · ')}`);

let source = trims; // 계산 기준
if (APPLY) {
  const sa = JSON.parse(readFileSync('tmp/firebase-auth/sa.json', 'utf8'));
  if (!getApps().length) initializeApp({ credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: sa.private_key.replace(/\\n/g, '\n') }) });
  const fs = getFirestore();
  const batch = fs.batch();
  for (const t of trims) batch.set(fs.collection('new_car_trim').doc(t.id), t);
  await batch.commit();
  console.log(`✓ Firestore new_car_trim 에 ${trims.length}건 씀`);
  // Firestore 에서 «다시 읽어» 계산 = 진짜 Firestore 기준
  const snap = await fs.collection('new_car_trim').where('carType', '==', '그랜저').get();
  source = snap.docs.map((d) => d.data());
  console.log(`Firestore 에서 읽음: ${source.length}건`);
}

// ② «픽한 구성» — 그랜저 캘리그래피 가솔린2.5 + 세레니티 화이트 펄(외장)
const pickTrim = '캘리그래피';
const pickExt = '세레니티 화이트 펄';
const car = source.find((t: any) => t.trim === pickTrim);
if (!car) { console.log('트림 못 찾음'); process.exit(1); }
const ext = (car.extColors || []).find((c: any) => c.name === pickExt);
const base = car.price;
const extPrice = ext ? ext.price : 0;
const total = base + extPrice;
console.log(`\n=== 픽: 현대 그랜저 · 가솔린 2.5 · ${pickTrim} · 외장 ${pickExt} ===  ${APPLY ? '[Firestore 기준]' : '[크롤 기준·--apply로 Firestore]'}`);
console.log(`  차량가(${pickTrim})   ${won(base)}`);
console.log(`  외장 ${pickExt}   +${won(extPrice)}${ext ? ` (선택가능 ${ext.ok})` : ' (색상 못 찾음)'}`);
console.log(`  ─────────────────`);
console.log(`  확정 차량가        ${won(total)}`);
process.exit(0);
