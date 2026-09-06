/**
 * 원자 규격 게이트 — 「한 번만 잘 만든」 불변이 안 움직이는지 검사한다(사장님 2026-09-04 「안 움직이게」).
 *   어긋나면 exit 1. 매뉴얼 = docs/원자화-매뉴얼.md §6.
 * Firestore products(=v4/products 미러)를 읽어 검사만 한다 — 고치지 않는다(치유는 fix-atoms-from-refined-sheets).
 */
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const S = (v: unknown) => String(v ?? '').trim();
/*
 * ★★**열쇠가 없으면 «건너뛴다» — 터지지 않는다**(2026-09-06 검수).
 *   전에는 `tmp/firebase-auth/sa.json` 이 없는 자리에서 `ENOENT` 로 통째로 죽었다.
 *   그러면 「이 검사가 도는지」를 아무도 모른다 — 죽은 검사는 없는 검사와 같다.
 *   ⇒ 열쇠가 있으면 검사하고, 없으면 «왜 못 했는지»를 말하고 0 으로 끝낸다.
 * ⚠ 데이터를 «읽어야» 하는 검사라 CI(시크릿 없음)에서는 애초에 못 돈다 — 사람이 손으로 돌리는 자다.
 */
const saPath = S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json';
let saRaw: string;
try { saRaw = readFileSync(saPath, 'utf8'); } catch {
  console.log(`⏭ 원자 규격 검사를 건너뜁니다 — 서비스 계정 열쇠가 없습니다(${saPath}).`);
  console.log('   GOOGLE_APPLICATION_CREDENTIALS 를 걸거나 tmp/firebase-auth/sa.json 을 두고 다시 부르세요.');
  process.exit(0);
}
const sa = JSON.parse(saRaw);
initializeApp({ credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: sa.private_key.replace(/\\n/g, '\n') }), databaseURL: 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app' });

const COLORS = /^(블랙|화이트|흰색|검정|검정색|블루|하늘색|그레이|회색|쥐색|실버|은색|레드|빨강|펄|진주|남색|네이비|브라운|베이지|골드|녹색|카키|퍼플)/;
const CANON = new Set(['중고렌트', '신차렌트', '중고구독', '픽업구독', '오플구독', '신차구독']);
const docs = (await getFirestore().collection('products').get()).docs.map((d) => d.data());

type Fail = { rule: string; cars: string[] };
const fails: Fail[] = [];
const add = (rule: string, rows: any[]) => { if (rows.length) fails.push({ rule, cars: rows.slice(0, 8).map((v) => `${S(v.car_number)}[${S(v.provider_company_code)}]`) }); return rows.length; };

// ① mileage 에 색상값(칸밀림)
const c1 = add('mileage 에 색상값(칸밀림)', docs.filter((v) => COLORS.test(S(v.mileage))));
// ② listable 인데 model 또는 sub_model 빔
const c2 = add('listable 인데 model/sub_model 빔', docs.filter((v) => v.listable === true && (!S(v.model) || !S(v.sub_model))));
// ③ ext_color 에 「/」(외장/내장 미분리)
const c3 = add('ext_color 에 「/」(미분리)', docs.filter((v) => S(v.ext_color).includes('/')));
// ④ product_type 가 5캐논 밖(빈 것 제외 — 검수대기는 빔 허용)
const c4 = add('product_type 5캐논 밖', docs.filter((v) => S(v.product_type) && !CANON.has(S(v.product_type))));
// ⑤ listable 인데 원문없음
const c5 = add('listable 인데 원문없음', docs.filter((v) => v.listable === true && S(v.검수상태) === '원문없음'));

const listable = docs.filter((v) => v.listable === true).length;
console.log(`원자 ${docs.length}개(listable ${listable}) 검사:`);
console.log(`  ① 칸밀림 ${c1} · ② 빈식별(listable) ${c2} · ③ 색미분리 ${c3} · ④ 구분 캐논밖 ${c4} · ⑤ 원문없음(listable) ${c5}`);
if (fails.length) {
  console.error(`\n✗ 원자 규격 어긋남 ${fails.length}건 — 치유(fix-atoms-from-refined-sheets) 또는 오버라이드로 고쳐라:`);
  for (const f of fails) console.error(`  · ${f.rule}: ${f.cars.join(' ')}${f.cars.length >= 8 ? ' …' : ''}`);
  process.exit(1);
}
console.log('\n✓ 원자 규격 정상 — 불변이 안 움직였다.');
process.exit(0);
