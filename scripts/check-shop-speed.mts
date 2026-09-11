/**
 * **조건칸이 «착착» 도는지 — 기계가 잰다.**
 *
 * ★★★사장님 2026-09-10 「**버벅이거나 뭐가 안 되거나 막 찜빠 나는 거 같거나 그러면 안 된다고.
 *   착착착착 대야지**」 · 「내가 지금 이거 **엄청 심혈을 기울여** 가지고 만들고 있는데
 *   이런 **소소한 것들이 문제가 생기면** 나로서는 상당히 달갑지가 않아」.
 *
 * ⚠⚠ **왜 «검사»로 만드나 — 느려지는 것은 «조용히» 오기 때문이다.**
 *   2026-09-10 실측 — 조건 없이 목록을 그릴 때 `runShopQuery` 가 **292ms** 였다.
 *   게이트도 빌드도 타입검사도 다 초록이었다. 화면만 굼떴고, 그건 **사장님이 먼저 알아채셨다.**
 *   원인은 정렬 비교(n log n 번)마다 사진·요금표를 다시 푼 것 — 줄마다 한 번만 재도록 고쳐
 *   **23ms** 가 됐다. 그 13배를 «지켜 주는 것»이 이 검사다.
 *
 * ★재는 것은 «셈»이지 화면이 아니다. 화면 그리기는 브라우저가 하고, 여기서는 못 잰다.
 *   그래도 이 셈이 목록·조건칸·건수를 다 만든다 — 여기가 굼뜨면 화면은 반드시 굼뜬다.
 * ★모수는 **지어낸다**(700대). 운영 데이터를 CI 로 들고 가지 않으려는 것이고,
 *   지어낸 값이라도 «같은 길»을 탄다(요금표 풀기·사진 풀기·구간 판정·교차 집계).
 * ⚠ 기계마다 빠르기가 다르므로 예산은 **넉넉히** 잡는다 — 잡으려는 것은 「조금 느려짐」이 아니라
 *   **「열 배 느려짐」**이다. 예산을 조이면 CI 가 남의 기계 사정으로 빨개져 아무도 안 믿게 된다.
 */
import { runShopQuery, emptyQuery, toggleAxis, SHOP_SORTS } from '../lib/shop/query';
import type { EntityRecord } from '../lib/intake/entities';

/**
 * **예산 둘.**
 *
 * ㉠ `TOUCH_PER_ROW` — **줄 하나당 비싼 칸을 몇 번 열어 보나.** 이게 진짜 잣대다.
 *   잣대를 줄마다 한 번 재면 «줄 수»만큼 열어 본다. 비교마다 재면 «n log n»만큼 열어 본다
 *   (700대면 열 배 넘게). **기계가 빠르든 느리든 이 수는 같다** — CI 가 남의 사정으로 안 흔들린다.
 * ㉡ `BUDGET_MS` — 뒷문. 위에서 못 잡는 종류(예: 셈 자체가 통째로 무거워짐)를 위해 넉넉히 둔다.
 *
 * ⚠⚠ **처음엔 ㉡ 만 뒀다가 «못 잡았다».** 292ms 였던 옛 코드를 넣어도 이 기계에서는 82ms 라
 *   예산 120ms 를 그냥 통과했다. 예산을 조이면 이번엔 느린 CI 에서 헛되이 빨개진다 —
 *   **시간으로는 이 둘을 동시에 만족시킬 수 없다.** 그래서 「몇 번 열어 보나」를 센다.
 */
const TOUCH_PER_ROW = 3;
const BUDGET_MS = 250;
const ROWS = 700;

const MAKERS = ['기아', '현대', '제네시스', '르노', '벤츠', 'KGM', '쉐보레', 'BMW'];
const CLASSES = ['준대형 세단', '중형 SUV', '대형 SUV', '경형 해치백', '준중형 세단'];
const FUELS = ['가솔린', '디젤', '하이브리드', '전기', 'LPG'];
const TYPES = ['중고렌트', '신차렌트', '픽업구독', '오공구독', '오플구독'];

/**
 * 운영 데이터와 **«같은 무게»**를 가진 가짜 매물.
 *
 * ⚠⚠ **가벼운 가짜로는 못 잡는다 — 실제로 못 잡았다.** 처음엔 사진 한 장·요금 여섯 줄짜리로
 *   지었더니, 292ms 였던 옛 코드를 넣어도 **17ms** 밖에 안 나왔다(예산 120ms 를 그냥 통과).
 *   비싼 것은 «줄 수»가 아니라 **줄 하나를 푸는 일**이다 — 사진 열여섯 장을 훑고 프록시 주소를
 *   만들고, 요금표 열몇 줄을 풀고, 정책 서른몇 칸을 뒤진다.
 * ⇒ 운영 실측(2026-09-10 · 694대)에 맞춘다:
 *   사진 **16.5장**(글자 1,542) · 정책 **37칸** · 요금 **10여 줄**(`"24_3만"` 꼴 열쇠) · photo_link 324자.
 */
function fakeRows(n: number): EntityRecord[] {
  const out: EntityRecord[] = [];
  for (let i = 0; i < n; i++) {
    const rent = 400000 + (i * 7919) % 900000;
    /* 요금 — 운영과 «같은 꼴»이다(개월_약정 열쇠의 객체). 배열이 아니다. */
    const price: Record<string, { rent: number; deposit: number }> = {};
    for (const m of [1, 12, 18, 24, 36, 48, 60]) {
      for (const km of ['2만', '3만']) {
        price[`${m}_${km}`] = { rent: rent + m * 1000, deposit: Math.round(rent * 0.3) };
      }
    }
    /* 사진 — 열여섯 장(운영 평균). 정렬의 «사진 먼저»가 이걸 푼다. 절반은 아예 없다. */
    const photos = i % 2
      ? Array.from({ length: 16 }, (_, k) => `https://cdn.example.test/photos/${i}/${k}-1600x1200-front-left.jpg`)
      : [];
    const policy: Record<string, string> = {};
    for (let k = 0; k < 37; k++) policy[`pol_${k}`] = `값${(i + k) % 97}`;
    Object.assign(policy, {
      deposit_installment: i % 2 ? '가능' : '',
      basic_driver_age: String(21 + (i % 5)),
      license_period: i % 4 ? '무관' : '1년',
      screening_criteria: i % 3 ? '무심사' : '소득심사',
      annual_mileage: `연간 ${2 + (i % 3)}만Km`,
    });
    out.push({
      _key: `veh_${i}`,
      product_code: `RP0${i % 40}_${i}가${1000 + i}`,
      car_number: `${100 + (i % 800)}가${1000 + i}`,
      maker: MAKERS[i % MAKERS.length],
      model: `모델${i % 60}`,
      sub_model: `세부${i % 30}`,
      vehicle_class: CLASSES[i % CLASSES.length],
      fuel_type: FUELS[i % FUELS.length],
      product_type: TYPES[i % TYPES.length],
      year: String(2018 + (i % 8)),
      mileage: String(5000 + (i * 137) % 200000),
      vehicle_status: '출고가능',
      accident_history: i % 3 ? '무사고' : '단순교환',
      ext_color: ['흰색', '검정', '회색', '파랑'][i % 4],
      options: Array.from({ length: 8 }, (_, k) => `옵션${(i + k) % 40}`),
      price,
      photo_link: i % 5 ? `https://drive.google.com/drive/folders/abc${i}defghijklmnop
https://cdn.example.test/x/${i}.jpg` : '',
      _policy: policy,
    } as unknown as EntityRecord);
    /*
     * ★★**사진 칸은 «열어 볼 때마다 센다».**
     *   `firstProductImage` 가 이 칸을 읽는다 — 정렬이 비교마다 부르면 이 수가 폭발하고,
     *   줄마다 한 번만 재면 줄 수만큼만 오른다. 화면을 안 열고도 그 차이를 «정확히» 안다.
     */
    Object.defineProperty(out[out.length - 1], 'image_urls', {
      enumerable: true,
      get() { touched++; return photos; },
    });
  }
  return out;
}

/** 비싼 칸을 몇 번 열어 봤나 — 위 `image_urls` 게터가 올린다. */
let touched = 0;

const time = (fn: () => void, n = 5): number => {
  fn();                                        // 예열 — 첫 회는 JIT 이 안 붙어 있다
  const t0 = performance.now();
  for (let i = 0; i < n; i++) fn();
  return (performance.now() - t0) / n;
};

const rows = fakeRows(ROWS);
const cases: [string, ReturnType<typeof emptyQuery>][] = [
  ['조건 없음', emptyQuery()],
  ['한 축', toggleAxis(emptyQuery(), 'vc', 'SUV')],
  ['검색어', { ...emptyQuery(), q: '모델3' }],
];
for (const s of SHOP_SORTS) cases.push([`정렬 ${s.key}`, { ...emptyQuery(), sort: s.key }]);

const fails: string[] = [];
console.log(`\n  가짜 매물 ${ROWS}대 · 줄당 ${TOUCH_PER_ROW}번까지 · 뒷문 ${BUDGET_MS}ms\n`);
for (const [name, q] of cases) {
  const ms = time(() => runShopQuery(rows, q));
  /* ★세는 것은 «한 번» 도는 동안이다 — 예열·반복이 섞이면 「줄당 몇 번」을 말할 수 없다. */
  touched = 0;
  runShopQuery(rows, q);
  const per = touched / ROWS;
  const okTouch = per <= TOUCH_PER_ROW;
  const okMs = ms <= BUDGET_MS;
  console.log(`   ${okTouch && okMs ? '·' : '✗'} ${name.padEnd(12)} ${ms.toFixed(0).padStart(4)}ms  줄당 ${per.toFixed(1)}번`);
  if (!okTouch) fails.push(`${name} — 줄당 ${per.toFixed(1)}번 열어 봤다 (${TOUCH_PER_ROW}번까지)`);
  if (!okMs) fails.push(`${name} — ${ms.toFixed(0)}ms (뒷문 ${BUDGET_MS}ms)`);
}

if (fails.length) {
  console.error(`\n✗ 조건칸이 굼뜹니다 — ${fails.length}건\n`);
  for (const f of fails) console.error(`   · ${f}`);
  console.error(`
  ⚠ 여기가 굼뜨면 화면은 반드시 굼뜹니다. **예산을 올리기 «전»에 왜 그런지 먼저 봅니다.**
    거의 항상 같은 원인 — **정렬 비교 함수 안에서 사진·요금표를 다시 푸는 것.**
    비교는 n log n 번 불립니다(700대면 만 번 넘게). 잣대는 «줄마다 한 번» 재서 숫자로 들고,
    비교는 숫자끼리만 해야 합니다(rankRows). docs/DESIGN_CONFIRMED_SHOP.md §14\n`);
  process.exit(1);
}
console.log('\n✓ 조건칸이 예산 안에서 돕니다 — 착착 답니다\n');
