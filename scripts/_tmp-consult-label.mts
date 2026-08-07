// 상담방 목록 표기 — 옛 방(subject 박제)과 새 방이 같은 이름으로 나오는지
import { roomTitle, roomModel, roomPlate, chatCodeOf, isVehicleLessRoom } from '@/features/chat/room-display';

const empty = { byId: new Map(), byCar: new Map() };
const ROOMS: Array<[string, any]> = [
  ['새 방 (손오공)', { _key: 'CS_RP012_ab12cd34', room_kind: 'consult', provider_company_code: 'RP012', subject: '중고 구독견적기' }],
  ['옛 방 (문구 박제)', { _key: 'CS_RP012_zz99', room_kind: 'consult', provider_company_code: 'RP012', subject: '중고구독 상담' }],
  ['옛 방 (subject 없음)', { _key: 'CS_RP012_qq11', room_kind: 'consult', provider_company_code: 'RP012' }],
  ['웰릭스', { _key: 'CS_RP013_ff77', room_kind: 'consult', provider_company_code: 'RP013', subject: '신차구독 상담' }],
  ['모르는 공급사', { _key: 'CS_RP999_xx', room_kind: 'consult', provider_company_code: 'RP999' }],
  ['관리자 상담(레거시)', { _key: 'ADMIN_RP012_u1', is_admin_chat: true, agent_name: '홍길동' }],
  ['일반 매물방', { _key: 'CH_P0001_SP001', car_number: '12가3456', agent_code: 'SP001' }],
];

let fail = 0;
console.log('  방                      목록 제목            차번        대화코드');
console.log('  ' + '-'.repeat(74));
for (const [name, room] of ROOMS) {
  const title = roomTitle(room, empty as any, empty as any, []);
  const model = roomModel(room, empty as any, empty as any, []);
  const plate = roomPlate(room, empty as any, empty as any, []);
  const code = chatCodeOf(room);
  console.log(`  ${name.padEnd(22)} ${title.padEnd(20)} ${(plate || '—').padEnd(11)} ${code || '—'}`);
  // 차량 없는 방만 두 값이 같아야 한다. 일반 매물방은 title=차번+차명, model=차명이라 다른 게 정상.
  if (isVehicleLessRoom(room) && title !== model) {
    console.log(`     ❌ 상담방인데 목록 두 줄이 어긋난다: ${title} / ${model}`); fail++;
  }
  if (isVehicleLessRoom(room) && plate) { console.log('     ❌ 차량 없는 방에 차번이 나온다'); fail++; }
}

console.log('\n  ■ 핵심 확인');
const t = (i: number) => roomTitle(ROOMS[i][1], empty as any, empty as any, []);
const same = t(0) === t(1) && t(1) === t(2);
console.log(`  ${same ? '✓' : '❌'} 새 방·옛 방·subject 없는 방이 모두 「${t(0)}」`);
if (!same) fail++;
console.log(`  ${t(3) !== t(0) ? '✓' : '❌'} 손오공(${t(0)})과 웰릭스(${t(3)})가 구분된다`);
if (t(3) === t(0)) fail++;
console.log(`  ${t(4) === '구독견적기' ? '✓' : '❌'} 모르는 공급사 → 「${t(4)}」`);
if (t(4) !== '구독견적기') fail++;

console.log('\n' + '='.repeat(74));
console.log(fail === 0 ? '✅ 통과' : `❌ ${fail}건`);
process.exit(fail ? 1 : 0);
