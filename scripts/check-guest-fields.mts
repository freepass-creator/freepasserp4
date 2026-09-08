/**
 * **손님 화면이 «샘»의 공통 칸을 다 싣는가** — 원자가 늘었는데 손님만 못 받는 일을 막는다.
 *
 * 사장님 2026-09-08 「**상품 샘에서 설정 다 해놨을 거야, 뭘 갖고 가야 하는지**」.
 *
 * ⚠ 무슨 일이 있었나 — 손님 응답 칸이 `public-catalog.ts` 에 **손으로 적힌 두 번째 목록**이었다.
 *   그래서 2026-09-05 에 `battery_capacity` 가 ERP 원자에는 있는데(`atom-fields`·재고시트·판매축)
 *   그 목록에 없어 **손님 화면까지 오지를 못했다.** 전기차 제원이 한 칸 빈 채로 나갔고,
 *   아무도 모르다가 사장님이 「배터리 정보」를 물으셔서 드러났다.
 * ⇒ 이제 목록은 샘(`atom-fields` `COMMON_ORDER`)에서 **파생**한다. 이 검사는 그 파생이
 *   실제로 «나가는지»를 **동작으로** 확인한다 — 목록을 다시 손으로 적어 넣으면 여기서 멈춘다.
 *
 * ★검사 방법 — 공통 칸을 전부 채운 가짜 매물 하나를 손님용으로 정제해 보고, 그 결과에
 *   공통 칸이 다 들어 있는지 본다. 「목록에 글자가 있나」가 아니라 **「손님에게 실제로 가나」**를 본다.
 * ★일부러 빼는 칸은 여기 `EXPECT_HIDDEN` 에 이유와 함께 적는다 — 말없이 빠지는 길을 막는다.
 *
 * 실행 = `npm run check:guest-fields`
 */
import { COMMON_ORDER } from '../lib/domain/atom-fields';
import { sanitizeProductForGuest } from '../lib/domain/public-catalog';

/** 공통이지만 손님에게 «일부러» 안 보내는 칸 — 이유를 남긴다. */
const EXPECT_HIDDEN: Record<string, string> = {
  origin: '원천(어느 공급사에서 왔나) — 손님이 볼 값이 아니다. 영업자 전용 칸이 따로 받는다.',
};

/** 샘의 공통 칸(목록 순서) + 목록 밖 공통 둘. */
const COMMON = [...COMMON_ORDER, 'photo_link', 'first_registration_date'];

/* 공통 칸을 전부 «값이 있는» 상태로 채운 가짜 매물 — 빈 값은 정제기가 그냥 버리므로 못 쓴다. */
const filled: Record<string, unknown> = {};
for (const k of COMMON) filled[k] = k === 'engine_cc' || k === 'seats' || k === 'year' ? 1 : `값-${k}`;
filled.price = { 60: { rent: 500000, deposit: 1000000 } };
filled.mileage = 1000;

const out = sanitizeProductForGuest('veh_test', filled) as Record<string, unknown>;

const missing = COMMON.filter((k) => !(k in EXPECT_HIDDEN) && (out[k] === undefined || out[k] === ''));
const leaked = Object.keys(EXPECT_HIDDEN).filter((k) => out[k] !== undefined && out[k] !== '');

if (missing.length || leaked.length) {
  console.error('\n손님 화면이 샘(원자 역할표)과 어긋납니다:\n');
  for (const k of missing) {
    console.error(`  ✗ 샘의 공통 칸 «${k}» 이 손님에게 안 갑니다.`);
    console.error('      → `lib/domain/public-catalog.ts` 가 샘에서 파생하는지 보세요(손으로 적은 목록이면 여기서 멈춥니다).');
    console.error('      → 일부러 빼는 것이면 이 검사의 `EXPECT_HIDDEN` 에 «이유»를 적습니다.');
  }
  for (const k of leaked) {
    console.error(`  ✗ 일부러 빼기로 한 «${k}» 이 손님에게 나갔습니다 — ${EXPECT_HIDDEN[k]}`);
  }
  console.error('');
  process.exit(1);
}

console.log(`손님 화면 — 샘의 공통 칸 ${COMMON.length - Object.keys(EXPECT_HIDDEN).length}개 전부 전달 ✓`
  + ` (일부러 뺀 것 ${Object.keys(EXPECT_HIDDEN).length}: ${Object.keys(EXPECT_HIDDEN).join(', ')})`);
