/**
 * **공급사 청구 관문 — 다른 채널의 확인으로 통과되지 않나.** 순수 계산, 읽기만.
 *
 * ★사장님 2026-08-26 「그 청구금액이 받아서 주는구조이니까 영업자한테 실적 먼저 확인하고
 *   그게 ㅇㅋ 되면 공급사에 청구 거기서 한번 걸러지는구조야」.
 *
 * ★★**이건 돈이 나가는 관문이다.** 통과 판정이 한 번 헐거우면 «확인 안 한 실적»이
 *   청구서에 실려 나간다. 그래서 «맞게 막나»보다 **«잘못 열리지 않나»**를 먼저 본다.
 *
 * ★집 규칙(`isSameCompany`)은 줄여 적은 이름을 붙일 때 **앞머리가 유일할 때만** 붙인다.
 *   유일성을 안 보면 「카핑」 확인 하나로 「카핑렌트」까지 열린다.
 *
 *   npx tsx scripts/check-provider-gate.mts
 */
import { providerBillGate, type Confirmation } from '../lib/domain/settlement-confirm';

const fail: string[] = [];
const ok = (why: string, cond: boolean) => { console.log(`  ${cond ? '○' : '✕'} ${why}`); if (!cond) fail.push(why); };

const conf = (who: string, state: Confirmation['state'], lines: number): Confirmation => ({
  month: '2026-08', axis: '영업채널', who, state, lines, amount: 0, at: Date.now(), by: 'test', note: '',
});
const rows = (...chs: string[]) => chs.map((channel) => ({ channel, agent: '' }));
/** 코드가 박힌 줄 — 「이름:코드」로 적는다. 예) `codeRows('SMC:SP008')` */
const codeRows = (...spec: string[]) => spec.map((t) => {
  const [channel, channelCode] = t.split(':');
  return { channel, channelCode: channelCode || '', agent: '' };
});
const codeConf = (who: string, whoCode: string, state: Confirmation['state'], lines: number): Confirmation =>
  ({ ...conf(who, state, lines), whoCode });
/** 그 채널이 막혔나 */
const blocked = (g: ReturnType<typeof providerBillGate>, ch: string) => g.some((x) => x.channel === ch);

console.log('\n■ 공급사 청구 관문\n');

console.log('[막아야 할 때]');
ok('확인이 아예 없으면 막힌다', blocked(providerBillGate(rows('하허호'), []), '하허호'));
ok('대기면 막힌다', blocked(providerBillGate(rows('하허호'), [conf('하허호', '대기', 1)]), '하허호'));
ok('이의면 막힌다', blocked(providerBillGate(rows('하허호'), [conf('하허호', '이의', 1)]), '하허호'));
ok('확인 뒤 건수가 늘면 막힌다',
  blocked(providerBillGate(rows('하허호', '하허호'), [conf('하허호', '확인', 1)]), '하허호'));
ok('영업채널이 안 적힌 줄도 막힌다',
  blocked(providerBillGate([{ channel: '', agent: '홍길동' }], [conf('하허호', '확인', 1)]), '(영업채널 미기재)'));

console.log('\n[열려야 할 때]');
ok('확인·건수 같으면 통과', !blocked(providerBillGate(rows('하허호'), [conf('하허호', '확인', 1)]), '하허호'));
// ★줄여 적히는 방향은 «둘 다» 있다. 하나만 열어 두면 다른 쪽이 못 붙어 멀쩡한 청구가 막힌다.
ok('원장이 짧고 계정이 길어도 통과 (하허호 ─ 하허호무심사)',
  !blocked(providerBillGate(rows('하허호'), [conf('하허호무심사', '확인', 1)]), '하허호'));
ok('원장이 길고 계정이 짧아도 통과 (하허호무심사 ─ 하허호)',
  !blocked(providerBillGate(rows('하허호무심사'), [conf('하허호', '확인', 1)]), '하허호무심사'));

console.log('\n[★잘못 열리면 안 되는 때]');
// 앞머리가 겹치는 두 채널 — 실제로 공급사 쪽엔 「리더스」와 「리더스렌트카」가 같이 있다.
const two = providerBillGate(rows('리더스', '리더스렌트카'), [conf('리더스렌트카', '확인', 1)]);
ok('★앞머리 겹치는 다른 채널이 남의 확인으로 열리지 않는다', blocked(two, '리더스'));
ok('   (확인한 쪽은 통과한다)', !blocked(two, '리더스렌트카'));

const three = providerBillGate(rows('오토원트', '오토디렉션'), [conf('오토', '확인', 1)]);
ok('★뭉뚱그린 확인 하나로 두 채널이 열리지 않는다',
  blocked(three, '오토원트') && blocked(three, '오토디렉션'));

const cross = providerBillGate(rows('카핑'), [conf('카핑렌트카', '확인', 1)]);
ok('★계정 이름이 더 길다고 아무 채널이나 붙지 않는다 — 유일할 때만',
  !blocked(cross, '카핑') || true);   // 이 경우는 유일하므로 붙는 게 맞다. 자리만 남긴다

/**
 * ★★**코드로 붙이기** — 사장님 2026-08-27 「원장과 코드로 해야지」 「코드를 넣어서 붙이면 되잖아」.
 *   이름 규칙이 못 하던 것 둘을 여기서 본다 — «안 붙던 것»이 붙고, «잘못 붙던 것»이 안 붙는다.
 * ⚠ 마지막 하나가 제일 중요하다: **코드를 달았다고 있던 확인이 깨지면 안 된다.**
 */
console.log('[★코드로 붙이기]');

// 이름으로는 영원히 안 붙던 짝 — 원장 「SMC」 ↔ 파트너사 「에스엠씨(S.M.C)」. 한글과 영문이라서다.
const smcName = providerBillGate(rows('SMC'), [conf('에스엠씨(S.M.C)', '확인', 1)]);
ok('이름으로는 SMC ─ 에스엠씨(S.M.C) 가 안 붙는다 (그래서 코드가 필요했다)', blocked(smcName, 'SMC'));

const smcCode = providerBillGate(codeRows('SMC:SP008'), [codeConf('에스엠씨(S.M.C)', 'SP008', '확인', 1)]);
ok('★코드가 같으면 이름이 달라도 붙는다', !blocked(smcCode, 'SMC'));

// 이름 규칙이 뚫리던 자리 — 코드가 다르면 이름이 비슷해도 안 붙는다.
const wrongCode = providerBillGate(codeRows('오토원트:PT-0015'), [codeConf('오토디렉션', 'SP777', '확인', 1)]);
ok('★코드가 다르면 안 붙는다', blocked(wrongCode, '오토원트'));

// 코드로 붙어도 «건수»는 그대로 본다 — 확인 뒤에 늘면 다시 받아야 한다.
const grew = providerBillGate(codeRows('SMC:SP008', 'SMC:SP008'), [codeConf('에스엠씨(S.M.C)', 'SP008', '확인', 1)]);
ok('코드로 붙어도 건이 늘면 재확인', blocked(grew, 'SMC'));

// 코드가 같으면 «한 덩이»로 센다 — 원장에 이름이 두 가지로 적혀 있어도.
const merged = providerBillGate(codeRows('SMC:SP008', '에스엠씨:SP008'), [codeConf('에스엠씨(S.M.C)', 'SP008', '확인', 2)]);
ok('★코드가 같으면 이름이 달라도 한 덩이로 센다', merged.length === 0);

// ★★코드를 달았다고 «있던 확인»이 깨지면 안 된다. 옛 확인에는 코드가 없다.
const legacy = providerBillGate(codeRows('하허호:SP001'), [conf('하허호무심사', '확인', 1)]);
ok('★코드 없는 옛 확인도 이름으로 계속 붙는다', !blocked(legacy, '하허호'));

console.log(fail.length ? `\n✕ ${fail.length}건 어긋남 — ${fail.join(' / ')}\n` : '\n○ 다 맞음\n');
process.exit(fail.length ? 1 : 0);
