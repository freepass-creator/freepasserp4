/**
 * **접수 폼 — 담당자 순서대로 서 있고, 값이 제대로 넘어가나.** 읽기만(시트에 안 쓴다).
 *
 * ★사장님 2026-08-26 「담당자가 취급하는 정보가
 *   **언제 · 어떤 차를 · 누가(영업자가) · 누구한테 · 어떤 조건으로 · 어떤 방식으로 · 어떤 상태인지**」
 *   「손님연락처 영업자연락처는 필수는 아닌데 동명이인때문에 / 일단 칸은 두자고 … 메모성으로」.
 *
 * ★★**칸의 «차례»가 규격이다.** 다음 사람이 칸을 하나 끼워 넣으면 흐름이 깨진다.
 *   그래서 순서를 여기서 못 박는다 — 바꾸려면 이 검사부터 고쳐야 한다.
 *
 *   npx tsx scripts/check-intake-form.mts
 */
import { readFileSync } from 'node:fs';

const src = readFileSync('app/settlement/ledger/page.tsx', 'utf8');
const store = readFileSync('lib/server/settlement-store.ts', 'utf8');

const fail: string[] = [];
const ok = (why: string, cond: boolean) => { console.log(`  ${cond ? '○' : '✕'} ${why}`); if (!cond) fail.push(why); };

/** `const NAME: Field[] = [...]` 안의 key 를 차례대로 뽑는다. */
const keysOf = (name: string): string[] => {
  const m = new RegExp(`const ${name}: Field\\[\\] = \\[([\\s\\S]*?)\\n\\];`).exec(src);
  if (!m) return [];
  return [...m[1].matchAll(/key: '([^']+)'/g)].map((x) => x[1]);
};

console.log('\n■ 접수 폼\n');

console.log('[언제 · 어떤 차를]');
ok('접수일 → 차량번호 → 공급사 → 모델명',
  keysOf('CAR_FIELDS').join('>') === 'receivedAt>plate>supplier>model');

console.log('\n[누가 팔았나]');
ok('★영업채널이 «먼저» — 담당자를 그 채널로 좁힌다',
  keysOf('SELLER_FIELDS')[0] === 'channel');
ok('채널 → 담당자 → 직접입력 → 연락처',
  keysOf('SELLER_FIELDS').join('>') === 'channel>agentCode>agent>agentPhone');
ok('채널을 바꾸면 담당자를 비운다 (다른 채널 사람이 남지 않게)',
  /k === 'channel'[\s\S]{0,220}agentCode: '',\s*agent: ''/.test(src));
ok('★연락처 칸을 접지 않는다 — 늘 보인다',
  /const sellerFields = SELLER_FIELDS;/.test(src));

console.log('\n[누구한테]');
ok('고객명 → 고객연락처', keysOf('CUSTOMER_FIELDS').join('>') === 'customer>phone');
ok('★연락처 둘 다 «안 적어도 된다»고 말한다',
  (src.match(/안 적어도 됩니다 — 동명이인 가릴 때 씁니다/g) || []).length === 2);
ok('연락처는 required 가 아니다',
  !/key: 'phone'[^}]*required/.test(src) && !/key: 'agentPhone'[^}]*required/.test(src));

console.log('\n[어떤 조건으로 · 어떤 방식으로]');
ok('상품 → 기간 → 렌탈료 → 보증금 → 차량가액 → 분납',
  keysOf('TERMS_FIELDS').join('>') === 'product>term>rent>deposit>price>payKind');
ok('렌탈료는 필수', /key: 'rent'[^}]*required: true/.test(src));

console.log('\n[어떤 상태인지]');
ok('계약서 → 인도완료 → 인도일', keysOf('STATE_FIELDS').join('>') === 'paper>delivered>deliveredAt');
ok('인도완료가 「예」일 때만 인도일을 세운다',
  /delivered === '예'/.test(src) && /f\.key !== 'deliveredAt' \|\| delivering/.test(src));
ok('계약취소·환수는 접수 폼에 «없다» (청구 뒤에 일어난다)',
  !keysOf('STATE_FIELDS').includes('cancelled') && !keysOf('STATE_FIELDS').includes('clawback'));

console.log('\n[구간 차례 — 사장님 문장 그대로]');
const order = ['언제 · 어떤 차를', '누가 팔았나', '누구한테', '어떤 조건으로 · 어떤 방식으로', '어떤 상태인지'];
const at = order.map((t) => src.indexOf(`title="${t}"`));
ok('다섯 구간이 다 있다', at.every((i) => i > 0));
ok('차례가 문장과 같다', at.every((v, i) => i === 0 || v > at[i - 1]));

console.log('\n[서버로 넘어가는 값]');
ok('★「아니오」를 참으로 읽지 않는다 (문자 예/아니오를 가른다)',
  /const YES = \(v: unknown\) =>/.test(store) && /paperOn = YES\(input\.paper\)/.test(store));
ok('인도완료를 켜면 인도일이 없을 때 막는다',
  /delivOn && !delivDay/.test(store));
ok('접수일은 사람이 준 값이 이긴다', /const asked = dayOf\(S\(input\.receivedAt\)\)/.test(store));
ok('★미래 날짜는 막는다 (줄 열쇠라 오타가 치명적)', /오늘\(\$\{today\}\) 이후일 수 없습니다/.test(store));
ok('접수 때는 취소·환수가 늘 꺼진 채 시작한다', /계약취소: 'FALSE', 환수: 'FALSE',/.test(store));

console.log(fail.length ? `\n✕ ${fail.length}건 어긋남 — ${fail.join(' / ')}\n` : '\n○ 다 맞음\n');
process.exit(fail.length ? 1 : 0);
