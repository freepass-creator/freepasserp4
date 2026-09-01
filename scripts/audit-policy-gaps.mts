/**
 * 공급사별 정책 빈칸 표 — **사장님이 채워 주실 칸의 목록**.
 *
 * 사장님 2026-08-28 「정책은 내가 공급사별로 확정값을 말해 줄게 · 없는 데는 없다고 해 ·
 * 계약서를 주든가 하겠음」.
 *
 * 그래서 이 도구는 «무엇을 지어낼까»가 아니라 **«무엇이 비어 있나»**를 뽑는다.
 * 상세 화면의 계약조건·보험조건이 실제로 읽는 칸만 본다 — 안 쓰는 칸까지 물으면 답이 늘어진다.
 *
 * 읽기만 한다.
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';

const S = (v: unknown) => String(v ?? '').trim();
const sa = JSON.parse(readFileSync('tmp/firebase-auth/sa.json', 'utf8'));
const t = (await new JWT({ email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/firebase.database', 'https://www.googleapis.com/auth/userinfo.email'] }).getAccessToken()).token;
const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
const read = async (p: string) => JSON.parse(await (await fetch(`${DB}/${p}.json?access_token=${t}`)).text()) || {};

const products = await read('v4/products');
const policies = { ...(await read('policies')), ...(await read('v4/policies')) } as Record<string, any>;
const partners = { ...(await read('partners')), ...(await read('v4/partners')) } as Record<string, any>;
const dead = (p: any) => p?._deleted === true || !!p?.deletedAt || S(p?.status) === 'deleted';

/** 상세 화면이 실제로 읽는 칸만. 라벨은 화면에 찍히는 그대로. */
const ASKED: [string, string][] = [
  ['screening_criteria', '심사'],
  ['insurance_included', '보험 포함 여부'],
  ['annual_mileage', '주행 약정'],
  ['basic_driver_age', '기본 운전연령'],
  ['license_period', '면허 경력'],
  ['deposit_installment', '보증금 분납'],
  ['rental_card_payment', '대여료 카드결제'],
  ['penalty_condition', '중도해지 위약'],
  ['injury_compensation_limit', '대인 한도'],
  ['property_compensation_limit', '대물 한도'],
  ['own_damage_compensation', '자차 보상'],
  ['maintenance_service', '정비'],
  ['replacement_car_policy', '대차'],
];

type Row = { code: string; name: string; cars: number; policy: string; filled: number; blanks: string[] };
const byProv = new Map<string, Row>();
for (const p of Object.values<any>(products)) {
  if (!p || typeof p !== 'object' || dead(p)) continue;
  const code = S(p.provider_company_code) || '(공급사없음)';
  let row = byProv.get(code);
  if (!row) {
    const partner = Object.values<any>(partners).find((x) => S(x?.partner_code) === code || S(x?.provider_company_code) === code);
    row = { code, name: S(partner?.name || partner?.company_name), cars: 0, policy: '', filled: 0, blanks: [] };
    byProv.set(code, row);
  }
  row.cars++;
  const pc = S(p.policy_code);
  if (pc && policies[pc] && !row.policy) row.policy = pc;
}
for (const row of byProv.values()) {
  // 연결이 끊겼어도 그 공급사 앞으로 만들어 둔 정책이 있으면 그걸 본다.
  const shell = row.policy || Object.keys(policies).find((k) => k === `FP-${row.code}-RENT`) || '';
  const pol = shell ? policies[shell] : null;
  row.policy = shell ? `${shell}${row.policy ? '' : ' (연결 끊김)'}` : '(정책 없음)';
  for (const [key, label] of ASKED) {
    if (pol && S(pol[key])) row.filled++;
    else row.blanks.push(label);
  }
}

const rows = [...byProv.values()].sort((a, b) => b.cars - a.cars);
console.log(`공급사 ${rows.length}곳 · 매물 ${rows.reduce((n, r) => n + r.cars, 0)}대`);
console.log(`묻는 칸 ${ASKED.length}개 — 상세 화면(계약조건·보험조건)이 실제로 읽는 것만\n`);
for (const r of rows) {
  const head = `${r.code}${r.name ? ` ${r.name}` : ''}`;
  console.log(`── ${head}  ${r.cars}대  · ${r.policy}`);
  if (!r.blanks.length) { console.log('   ✓ 다 채워져 있음\n'); continue; }
  console.log(`   채워짐 ${r.filled}/${ASKED.length} · **비어 있는 칸 ${r.blanks.length}**`);
  console.log(`   ${r.blanks.join(' · ')}\n`);
}
console.log('※ 값을 주시면 정책에 넣습니다. 「없음」이라고 하시면 화면에 「미입력」으로 섭니다 —');
console.log('   지어내지 않습니다(사장님 2026-08-28 「없는 데는 없다고 해」).');

/**
 * ★**«채워져 있다»와 «확인됐다»는 다르다.**
 *
 * FP-* 정책 21건은 원래 이름·코드 6칸만 다른 **똑같은 기본 묶음**이었다(실측 2026-08-28).
 * 그중 프리패스 표준과 «글자까지 같은» 531칸은 걷어냈지만, 나머지는 그대로 남아 있다.
 * 남은 값이 여러 공급사에서 **한 글자도 안 틀리고 같다면**, 그건 그 공급사가 준 값이 아니라
 * 우리가 깔아 둔 값일 가능성이 크다. 그 구분을 여기서 보여 준다 — 채운 척하지 않기 위해서.
 */
console.log('\n── 채워진 값 중 «여러 공급사가 똑같이 들고 있는 것» ──');
const fpCodes = Object.keys(policies).filter((k) => /^FP-RP\d{3}-RENT$/.test(k));
for (const [key, label] of ASKED) {
  const vals = new Map<string, number>();
  for (const k of fpCodes) {
    const v = S(policies[k]?.[key]);
    if (v) vals.set(v, (vals.get(v) || 0) + 1);
  }
  if (!vals.size) { console.log(`  ${label.padEnd(14)} 전부 빈칸`); continue; }
  const top = [...vals].sort((a, b) => b[1] - a[1])[0];
  const uniq = vals.size;
  const mark = top[1] >= 10 ? '★같은 값 다수' : uniq >= 5 ? '  공급사마다 다름' : '  일부만 다름';
  console.log(`  ${label.padEnd(14)} ${mark}  ${top[1]}곳이 「${top[0].slice(0, 22)}」 · 서로 다른 값 ${uniq}가지`);
}
console.log('\n※ 「★같은 값 다수」 = 그 공급사가 확인해 준 값이 아니라 우리가 깔아 둔 기본값일 수 있다.');
console.log('   사장님이 공급사별 확정값을 주시면 그때 «확인된 값»이 된다.');
