/**
 * **테스트 계약 한 건**을 만든다. 기본 dry-run, 실제 쓰기는 --apply.
 *
 * 전자계약 발송·서명 같은 흐름은 계약이 하나 있어야 눌러 볼 수 있다.
 * 그렇다고 실계약으로 시험하면 손님에게 진짜 문서가 나가고, 자리를 비우려고
 * 실계약을 지우면 정산·문의가 참조하던 것이 사라진다.
 * 그래서 **지우지 않고 표식으로 가른다** — `is_test: true`.
 * 목록·정산·발송은 `isTestContract`(lib/domain/contract) 하나만 보고 판정한다.
 *
 * ★안전 계약
 *   · 손님 이름·연락처는 **가짜**를 쓴다. 실존 번호를 넣으면 시험 문자가 진짜로 간다.
 *   · 기존 계약은 **읽기만** 한다. 지우거나 고치지 않는다.
 *   · 같은 코드가 이미 있으면 덮어쓰지 않고 멈춘다.
 *
 *   npx tsx scripts/make-test-contract.mts
 *   npx tsx scripts/make-test-contract.mts --apply
 *   npx tsx scripts/make-test-contract.mts --product=RP004_109호4772 --apply
 *   npx tsx scripts/make-test-contract.mts --list          이미 있는 테스트 계약만 본다
 *   npx tsx scripts/make-test-contract.mts --remove=CT-TEST-01 --apply   테스트 건만 지운다
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
const arg = (name: string, fallback = '') =>
  (process.argv.find((a) => a.startsWith(`--${name}=`)) || '').slice(name.length + 3) || fallback;

/**
 * 시험용 손님. **실존 번호를 쓰지 않는다** — 010-0000-0000 은 어디에도 닿지 않는다.
 * 이름도 한눈에 시험임을 알아야 한다.
 */
const TEST_CUSTOMER = {
  customer_name: '테스트 고객',
  customer_phone: '01000000000',
  customer_birth: '900101',
  customer_is_business: false,
  delivery_address: '서울특별시 강남구 테헤란로 1 (시험용 주소)',
};

async function main() {
  const apply = process.argv.includes('--apply');
  const listOnly = process.argv.includes('--list');
  const remove = arg('remove');
  const wantProduct = arg('product');

  const sa = JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS || 'tmp/firebase-auth/sa.json', 'utf8'));
  const jwt = new JWT({
    email: sa.client_email,
    key: sa.private_key,
    scopes: ['https://www.googleapis.com/auth/firebase.database', 'https://www.googleapis.com/auth/userinfo.email'],
  });
  const token = (await jwt.getAccessToken()).token;
  const get = async (node: string): Promise<Rec> => {
    const res = await fetch(`${DB}/${node}.json?access_token=${token}`);
    if (!res.ok) throw new Error(`${node} 읽기 실패 ${res.status}`);
    return (JSON.parse(await res.text()) || {}) as Rec;
  };

  const contracts = await get('v4/contracts');
  const rows = Object.entries(contracts).map(([k, v]) => ({ ...(v as Rec), _key: k }));
  const tests = rows.filter((c) => c.is_test === true || String(c.is_test) === 'true');
  const real = rows.length - tests.length;

  console.log(`\n══ 테스트 계약 ${apply ? '반영' : '미리보기(dry-run)'} ══\n`);
  console.log(`  v4/contracts — 전체 ${rows.length}건 · 실계약 ${real} · 테스트 ${tests.length}`);
  for (const c of tests) {
    console.log(`   · ${S(c.contract_code) || c._key}  ${S(c.customer_name)}  ${S(c.contract_status)}  ${S(c.product_code)}`);
  }
  if (listOnly) { console.log(''); return; }

  if (remove) {
    const hit = rows.find((c) => S(c.contract_code) === remove || c._key === remove);
    if (!hit) throw new Error(`그런 계약이 없다 — ${remove}`);
    // ★실계약은 이 명령으로 지울 수 없다. 표식이 없으면 멈춘다.
    if (!(hit.is_test === true || String(hit.is_test) === 'true')) {
      throw new Error(`중단 — ${remove} 은 테스트 계약이 아니다(is_test 없음). 실계약은 여기서 지우지 않는다.`);
    }
    console.log(`\n  지울 것 — ${remove} (${S(hit.customer_name)})`);
    if (!apply) { console.log('\n※ dry-run. 실제 삭제는 --apply\n'); return; }
    const res = await fetch(`${DB}/v4/contracts/${encodeURIComponent(hit._key)}.json?access_token=${token}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`삭제 실패 ${res.status} ${(await res.text()).slice(0, 200)}`);
    console.log('  삭제 완료\n');
    return;
  }

  // 붙일 매물 — 지정이 없으면 값이 온전한 것 하나를 고른다(요금·차번이 있어야 흐름이 돈다).
  const products = await get('v4/products');
  const candidates = Object.entries(products)
    .map(([k, v]) => ({ ...(v as Rec), _key: k }))
    .filter((p) => !p._deleted && S(p.car_number) && p.price && Object.keys(p.price).length);
  const product = wantProduct
    ? candidates.find((p) => S(p.product_code) === wantProduct || p._key === wantProduct)
    : candidates[0];
  if (!product) throw new Error(wantProduct ? `그런 매물이 없다 — ${wantProduct}` : '쓸 만한 매물이 없다');

  const priced = Object.entries(product.price as Rec)
    .map(([k, v]) => ({ m: Number(String(k).split('_')[0]) || 0, rent: Number((v as Rec)?.rent) || 0, deposit: Number((v as Rec)?.deposit) || 0 }))
    .filter((x) => x.rent > 0)
    .sort((a, b) => a.rent - b.rent);
  const best = priced[0];

  // 코드는 **한눈에 시험임을 말해야** 한다 — CT-260808-01 사이에 섞이면 못 가른다.
  let code = 'CT-TEST-01';
  for (let i = 2; rows.some((c) => S(c.contract_code) === code || c._key === code); i += 1) code = `CT-TEST-${String(i).padStart(2, '0')}`;

  const now = Date.now();
  const record: Rec = {
    contract_code: code,
    is_test: true,
    contract_status: '계약요청',
    is_draft: false,
    contract_date: new Date(now + 9 * 3600 * 1000).toISOString().slice(0, 10),
    created_at: now,
    created_by: 'script:make-test-contract',
    ...TEST_CUSTOMER,
    product_code: S(product.product_code) || product._key,
    product_uid: S(product.product_uid) || product._key,
    car_number_snapshot: S(product.car_number),
    maker_snapshot: S(product.maker),
    model_snapshot: S(product.model),
    ext_color_snapshot: S(product.ext_color),
    fuel_type_snapshot: S(product.fuel_type),
    provider_company_code: S(product.provider_company_code),
    policy_code: S(product.policy_code),
    rent_amount_snapshot: best ? String(best.rent) : '',
    deposit_amount_snapshot: best ? String(best.deposit) : '',
    contract_term_snapshot: best ? String(best.m) : '',
  };

  console.log(`\n  만들 계약 — ${code}`);
  console.log(`   손님   ${record.customer_name} (${record.customer_phone})  ← 가짜`);
  console.log(`   매물   ${record.product_code} · ${record.maker_snapshot} ${record.model_snapshot} · ${record.car_number_snapshot}`);
  console.log(`   요금   ${best ? `${best.m}개월 ${best.rent.toLocaleString('ko-KR')}원 · 보증금 ${best.deposit.toLocaleString('ko-KR')}원` : '(요금 없음)'}`);
  console.log(`   상태   ${record.contract_status} · is_test true`);

  if (!apply) { console.log('\n※ dry-run. 실제 생성은 --apply\n'); return; }

  const res = await fetch(`${DB}/v4/contracts/${encodeURIComponent(code)}.json?access_token=${token}`, {
    method: 'PUT', body: JSON.stringify(record),
  });
  if (!res.ok) throw new Error(`생성 실패 ${res.status} ${(await res.text()).slice(0, 300)}`);
  console.log(`\n  생성 완료 — 계약 화면에서 「테스트」 칩으로 찾는다.\n`);
}

main().catch((e) => { console.error('\n실패 —', (e as Error)?.message || e, '\n'); process.exit(1); });
