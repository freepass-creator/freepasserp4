/** 르노 필랑트 신차 → Firestore new_car_trim (사장님 2026-09-05 「바로바로 넣어」). 브라우저 추출분. */
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'node:fs';

const D = {
  maker: '르노', model: '필랑트',
  trims: [{ name: 'techno', price: 43949000 }, { name: 'iconic', price: 47639000 }, { name: 'esprit Alpine', price: 50439000 }],
  extColors: [{ code: 'GXA', name: '메탈릭 블랙', price: 0, ok: 'Y' }, { code: 'KAD', name: '어반 그레이', price: 0, ok: 'Y' }, { code: 'QXD', name: '클라우드 펄', price: 300000, ok: 'Y' }],
  intColors: [{ code: '0', name: '다크 블루 나파 인조 가죽 시트', ok: 'Y' }],
  options: [{ code: 'O----', name: '12.3” 동승석 디스플레이 패키지 (+게임/오토파킹/후방긴급제동)', price: 1650000, group: '패키지' }],
  acc: [{ code: 'RF6', name: "디자이너's 패키지I", price: 538000 }, { code: 'RF7', name: "디자이너's 패키지II", price: 708000 }, { code: 'RF3', name: '스탠다드 패키지', price: 372000 }, { code: 'RF0', name: '프로텍션 패키지', price: 141000 }, { code: 'RD1', name: '전동 사이드스텝', price: 890000 }, { code: 'RC5', name: '트렁크 빌트인 냉장고', price: 590000 }, { code: 'RF4', name: '전동 썬쉐이드', price: 690000 }, { code: 'RF2', name: 'R-cam', price: 350000 }],
};

const sa = JSON.parse(readFileSync('tmp/firebase-auth/sa.json', 'utf8'));
if (!getApps().length) initializeApp({ credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: sa.private_key.replace(/\\n/g, '\n') }) });
const fs = getFirestore();
const safe = (s: string) => s.replace(/[/#.$\[\]]/g, '_');
const batch = fs.batch();
for (const t of D.trims) {
  const id = safe(`renault_${D.model}_${t.name}`);
  batch.set(fs.collection('new_car_trim').doc(id), {
    maker: D.maker, sub_model: D.model, sourceName: `르노 ${D.model} ${t.name}`, trim: t.name,
    priceBefore: t.price, priceAfter: t.price,
    extColors: D.extColors, intColors: D.intColors, options: D.options, accessories: D.acc,
    brandSource: 'renault.co.kr', crawledAt: new Date().toISOString().slice(0, 10),
  });
}
await batch.commit();
console.log(`✓ 르노 필랑트 ${D.trims.length}트림 → Firestore new_car_trim`);
// 확인: 읽어서 견적 하나 뽑기
const snap = await fs.collection('new_car_trim').where('maker', '==', '르노').get();
const car = snap.docs.map((d) => d.data()).find((x: any) => x.trim === 'esprit Alpine');
const opt = car.options[0];
console.log(`\n픽: 르노 필랑트 esprit Alpine + ${opt.name}`);
console.log(`  차량가 ${car.priceBefore.toLocaleString()}원 + 옵션 ${opt.price.toLocaleString()}원 = ${(car.priceBefore + opt.price).toLocaleString()}원 [Firestore 기준]`);
process.exit(0);
