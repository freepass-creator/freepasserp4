/**
 * **차번 하나 → 그 차에 딸린 원자 한 벌.** 읽기 전용.
 *
 * ★사장님 2026-09-08 「차량번호 하나에 쓸 원자를 나열해 놓고 그걸 그냥 칸에만 박으면 되잖아.
 *   그럼 탭이 어떠든 그 차량번호에 해당하는 원자값들은 그 번호에 딸려서 오는 거니까」
 *   · 「내가 차량번호 말하면 이제 원자 보강된 걸로 말해 줘봐」
 *
 * ★**판매시트 칸 이름 그대로** 보여 준다 — 원자 필드명이 아니라. 그래야 「이 칸이 왜 비었나」를
 *   시트를 보며 바로 짚는다. 값이 비면 «어디서 와야 하는지»를 같이 적는다.
 *
 *   npx tsx --require ./scripts/lib/server-only-shim.cjs scripts/peek-car-atom.mts 109호1739
 */
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getDatabase } from './lib/disabled-rtdb.mts';
import nextEnv from '@next/env';

nextEnv.loadEnvConfig(process.cwd());
const S = (v: unknown) => String(v ?? '').trim();
const NKEY = (v: unknown) => S(v).replace(/\s/g, '');
const want = NKEY(process.argv.slice(2).find((a) => !a.startsWith('--')));
if (!want) { console.log('\n  차번을 주세요 — npx tsx … scripts/peek-car-atom.mts 109호1739\n'); process.exit(1); }
const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const app = initializeApp({
  credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: sa.private_key.replace(/\\n/g, '\n') }),
  databaseURL: 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app',
});
const fs = getFirestore(app);

/** 판매시트 칸 → 원자 필드. 「어디서 오나」는 비었을 때 무엇을 챙길지 말해 준다. */
const MAP: [string, string, string][] = [
  ['배차상태', 'vehicle_status', '공급사 시트 「상태」 · 정산원장(계약중/출고불가)'],
  ['구분', 'product_type', '공급사 시트 「분류」 — 탭 가르기가 이 칸을 본다'],
  ['차량번호', 'car_number', '공급사 시트'],
  ['제조사', 'maker', '차종마스터 행'],
  ['모델', 'model', '차종마스터 행'],
  ['세부모델', 'sub_model', '차종마스터 행 — 없으면 마스터에 그 차종이 없다'],
  ['세부트림', 'trim_name', '그 세부모델의 마스터 trims · 없으면 「기본형」'],
  ['외장', 'ext_color', '공급사 원본'],
  ['내장', 'int_color', '공급사 원본(T카는 롯데 제원)'],
  ['연식', 'year', '공급사 원본'],
  ['Km', 'mileage', '공급사 원본(매시간)'],
  ['연료', 'fuel_type', '공급사 원본(정제)'],
  ['배기량', 'engine_cc', '차종마스터'],
  ['차종구분', 'vehicle_class', '차종마스터 정제칸'],
  ['원산지', 'origin', '차종마스터'],
  ['구동', 'drive_type', '차종마스터(T카는 롯데)'],
  ['인승', 'seats', '차종마스터(T카는 롯데)'],
  ['최초등록', 'first_registration_date', '공급사 원본'],
  ['소비자가격', 'consumer_price', '공급사 원본'],
  ['차명(원문)', 'supplier_vehicle_name', '공급사 원본 — 가공 안 함'],
  ['옵션(원문)', 'options', '유상옵션 원문(SON 은 원천에 없음)'],
  ['사진', 'photo_link', '공급사 사진(픽업 외는 우리 드라이브)'],
  ['차번링크', 'detail_url', '픽업만 — 티카 상세페이지'],
  ['공급사', 'provider_company_code', '문패 「공급사시트정리」에서 이름으로'],
];

const d = await fs.collection('products').doc(want).get();
if (!d.exists) {
  console.log(`\n✗ Firestore 원자에 ${want} 가 없다.`);
  const v4 = (await getDatabase(app).ref('v4/products').get()).val() as Record<string, any> || {};
  const hit = Object.values(v4).find((x: any) => x && NKEY(x.car_number) === want);
  console.log(hit ? '  ⚠ RTDB(v4/products)에는 있다 — 미러·직접수집이 아직 안 실어 온 차다.' : '  RTDB 에도 없다.');
  process.exit(1);
}
const v = d.data() as any;
const 찬칸 = MAP.filter(([, f]) => S(v[f])).length;
console.log(`\n■ ${S(v.car_number)}  —  원자 ${찬칸}/${MAP.length}칸\n`);
for (const [col, f, from] of MAP) {
  const val = S(v[f]);
  console.log(val ? `  ${col.padEnd(11)} ${val}` : `  ${col.padEnd(11)} —          ← ${from}`);
}
/** 요금 — 기간마다 보증금·대여료가 한 벌이다. */
const P = v.price && typeof v.price === 'object' ? v.price as Record<string, any> : null;
console.log(`\n■ 요금 ${P ? Object.keys(P).length : 0}벌`);
if (!P) console.log('  — 없다 ← 공급사 시트 기간별 대여료(팔 수 있는데 없으면 견적을 못 낸다)');
else for (const [k, leg] of Object.entries(P)) {
  const g = leg as any;
  console.log(`  ${k.padEnd(10)} 대여료 ${S(g?.rent) || '—'}   보증금 ${S(g?.deposit) || '—'}`);
}
/** 정책 — 공급사 「운영정책」 탭에서 조인된다. */
const pol = v.policy && typeof v.policy === 'object' ? v.policy as Record<string, any> : null;
console.log(`\n■ 정책 ${pol ? Object.keys(pol).length : 0}칸  ${pol ? '' : '← 공급사 「운영정책」 탭 · 정책코드로 조인'}`);
if (pol) for (const [k, x] of Object.entries(pol).slice(0, 20)) console.log(`  ${k.padEnd(14)} ${S(x)}`);
console.log(`\n  상태 ${S(v.vehicle_status) || '—'} · 팔 수 있나 ${/출고불가/.test(S(v.vehicle_status)) ? '아니오' : '예'}`);
process.exit(0);
