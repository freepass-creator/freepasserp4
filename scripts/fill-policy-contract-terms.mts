/**
 * 정책에 **계약서가 참조하는 기한·요율**을 채운다. 기본 dry-run, 반영은 --apply.
 *
 * ★왜 필요한가
 *   약관은 곳곳에서 「계약서에 정한 N일」이라고 미룬다(제2·3·4·12·14·17조).
 *   필드는 정의돼 있으나 **54개 정책 전부 값이 비어 있어** 그 조문이 빈 약속이 된다.
 *   계약서에 공란으로 인쇄되면 분쟁에서 「기준이 없었다」가 된다.
 *
 * ★이미 든 값은 건드리지 않는다
 *   공급사가 다르게 정한 값을 표준으로 덮으면 그 회사 계약이 통째로 틀어진다.
 *   빈 칸만 채운다(`--force` 없이는 덮어쓰지 않는다).
 *
 *   npx tsx scripts/fill-policy-contract-terms.mts
 *   npx tsx scripts/fill-policy-contract-terms.mts --apply
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';

/**
 * 프리패스 표준값. **사장님 승인 2026-08-11.**
 * 공급사가 다르게 쓰면 그 정책에서 덮어쓴다 — 여기 값은 «안 정해진 곳»의 바닥이다.
 */
const DEFAULTS: Record<string, number> = {
  /**
   * ★3일 / 10일이 **계약서 기본 양식의 값**이다(사장님 확인 2026-08-12).
   *   처음에 30일/60일로 채웠는데 그건 내가 「권고」라며 지어낸 값이었고 실무와 열 배 어긋났다.
   *   계약서 HTML 에 「각 납부기한 다음 날부터 3일째 시동제어 · 10일째 최고 후 해지·회수」로
   *   이미 인쇄돼 있었다 — 문서가 답을 갖고 있는데 데이터에 다른 값을 넣은 셈이다.
   */
  engine_control_overdue_days: 3,    // 약관 제24조 운행제한·시동제어
  auto_terminate_overdue_days: 10,   // 약관 제7조·제24조 해지·차량회수
  deposit_overdue_rounds: 2,         // 약관 제10·13조 보증금 분납 미납(회차)
  renewal_notice_days: 30,           // 약관 제10조 연장 사전통지
  buyout_notice_days: 30,            // 약관 제26조 인수 사전통지
  deposit_return_days: 30,           // 약관 제6조 보증금 반환기한
  impound_keep_days: 30,             // 약관 제22조 유류품 보관
  late_fee_rate: 0.24,               // 약관 제25조 연 24% (관계 법령상 허용 한도 내)
};

/**
 * 초과주행 단위 통일 — 약관·규격은 «1km당»인데 정책 실데이터는 «1만km당»만 있다.
 * 단위가 다르면 계산이 안 선다. 있는 값에서 환산해 1km당을 채운다(2만원/1만km → 2원/km).
 * 원본은 지우지 않는다 — 공급사가 준 표기 그대로 남겨 둔다.
 */
function perKmFrom(per10000: unknown): number | null {
  const raw = String(per10000 ?? '').trim();
  if (!raw) return null;
  /**
   * ★숫자로 «딱 떨어지는 것»만 환산한다. 나머지는 손대지 않는다.
   *   「협의」   → 아직 안 정해진 것이다. 0 을 넣으면 계약서에 「0원/km」가 인쇄된다.
   *              빈칸은 「안 정해짐」이지만 0 은 「공짜」라는 뜻이 된다(실측 POL-0021).
   *   「10%」   → 1km당 요금이 아니라 다른 축이다. 원 단위로 바꾸면 0.001원/km 가 된다(POL-0022).
   * 지어내지 않는다 — 못 읽는 값은 사람이 채운다.
   */
  if (/[%％]/.test(raw)) return null;
  const m = /^([\d,.]+)\s*(만원|원|만)?$/.exec(raw.replace(/\s/g, ''));
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ''));
  if (!Number.isFinite(n) || n <= 0) return null;
  const won = /만/.test(m[2] || '') ? n * 10000 : n;
  const perKm = won / 10000;
  return perKm > 0 ? Math.round(perKm * 100) / 100 : null;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const force = process.argv.includes('--force');

  const sa = JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS || 'tmp/firebase-auth/sa.json', 'utf8'));
  const jwt = new JWT({
    email: sa.client_email, key: sa.private_key,
    scopes: ['https://www.googleapis.com/auth/firebase.database', 'https://www.googleapis.com/auth/userinfo.email'],
  });
  const token = (await jwt.getAccessToken()).token;
  const get = async (node: string): Promise<Record<string, Rec>> => {
    const res = await fetch(`${DB}/${node}.json?access_token=${token}`);
    if (!res.ok) throw new Error(`${node} 읽기 실패 ${res.status}`);
    return (JSON.parse(await res.text()) || {}) as Record<string, Rec>;
  };

  // v4 를 쓴다 — 운영 정책의 정본이다. v3 는 읽기만 해서 대조에 쓴다.
  const [v4, v3] = await Promise.all([get('v4/policies'), get('policies')]);
  const keys = Object.keys(v4);

  console.log(`\n══ 정책 계약조건 채우기 ${apply ? '반영' : '미리보기(dry-run)'} ══\n`);
  console.log(`  v4/policies ${keys.length}개 · v3 ${Object.keys(v3).length}개(읽기만)\n`);

  const plan: { key: string; name: string; patch: Rec }[] = [];
  for (const key of keys) {
    const row = v4[key] || {};
    const patch: Rec = {};
    for (const [field, value] of Object.entries(DEFAULTS)) {
      const has = S(row[field]) !== '' && row[field] !== null;
      if (has && !force) continue;
      patch[field] = value;
    }
    // 초과주행 1km당 — 있는 값에서 환산한다. 원본이 없으면 손대지 않는다(지어내지 않는다).
    if (force || S(row.over_mileage_rate_per_km) === '') {
      const perKm = perKmFrom(row.mileage_upcharge_per_10000km);
      if (perKm !== null) patch.over_mileage_rate_per_km = perKm;
    }
    if (!Object.keys(patch).length) continue;
    plan.push({ key, name: S(row.policy_name) || S(row.policy_code) || key, patch });
  }

  const fieldCount = new Map<string, number>();
  for (const p of plan) for (const f of Object.keys(p.patch)) fieldCount.set(f, (fieldCount.get(f) || 0) + 1);

  console.log(`  채울 정책 ${plan.length} / ${keys.length}\n`);
  console.log('  필드별 채울 건수');
  for (const [f, c] of [...fieldCount.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${f.padEnd(30)} ${String(c).padStart(3)}건  기본값 ${f === 'over_mileage_rate_per_km' ? '(1만km당에서 환산)' : DEFAULTS[f]}`);
  }
  console.log('\n  예시 3건');
  for (const p of plan.slice(0, 3)) {
    console.log(`    ${p.key} ${p.name}`);
    console.log(`      ${JSON.stringify(p.patch)}`);
  }

  if (!apply) { console.log('\n※ dry-run. 반영은 --apply · 이미 든 값을 덮으려면 --force\n'); return; }

  let done = 0;
  for (const p of plan) {
    const res = await fetch(`${DB}/v4/policies/${encodeURIComponent(p.key)}.json?access_token=${token}`, {
      method: 'PATCH', body: JSON.stringify(p.patch),
    });
    if (!res.ok) throw new Error(`${p.key} 쓰기 실패 ${res.status} ${(await res.text()).slice(0, 200)}`);
    done += 1;
  }
  console.log(`\n  반영 완료 — ${done}개 정책\n`);
}

main().catch((e) => { console.error('\n실패 —', (e as Error)?.message || e, '\n'); process.exit(1); });
