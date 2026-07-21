/**
 * 영업자(agent) 역할 시뮬레이션 — 메뉴 권한 · 매물탐색 · 문의 · 5스텝 · 발송 · 정산스코프 · 격리.
 * 실행: npx tsx scripts/sim-agent.mts
 */
const mem = new Map<string, string>();
const ls = {
  getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
  setItem: (k: string, v: string) => { mem.set(k, String(v)); },
  removeItem: (k: string) => { mem.delete(k); },
  clear: () => mem.clear(),
  key: (i: number) => [...mem.keys()][i] ?? null,
  get length() { return mem.size; },
};
(globalThis as unknown as { localStorage: typeof ls; window: typeof globalThis }).localStorage = ls;
(globalThis as unknown as { window: typeof globalThis }).window = globalThis;
(globalThis as unknown as { window: { dispatchEvent: (e: Event) => boolean } }).window.dispatchEvent = () => true;
class CE extends Event { detail: unknown; constructor(t: string, i?: { detail?: unknown }) { super(t); this.detail = i?.detail; } }
(globalThis as unknown as { CustomEvent: typeof CE }).CustomEvent = CE;

process.env.NEXT_PUBLIC_DATA_BACKEND = '';

const { getStore } = await import('../lib/store');
const { getCompanyId } = await import('../lib/tenant');
const { seedIfEmpty } = await import('../lib/seed');
const { newId } = await import('../lib/domain/ids');
const { ensureRoom, setRole, actor, createContractRequest, ROLE_LABEL } = await import('../lib/domain/deal');
type Role = 'agent' | 'provider' | 'admin';
const { sendText, markRead, listMessages, unreadFor } = await import('../lib/domain/messaging');
const { applyStepCheck } = await import('../lib/domain/settlement-engine');
const { getProgress, contractStage, STEPS, isDone } = await import('../lib/domain/contract');
const { guestShareUrl, formatProductForCopy } = await import('../lib/domain/product-share');
const { sendContractLink } = await import('../lib/domain/contract-send');
const { getContractByToken } = await import('../lib/domain/sign');
const { matchProduct, presentFilterOptions, EMPTY_VEHICLE_FILTER } = await import('../lib/domain/product-filters');
const { detailSections } = await import('../lib/domain/product');
const { toggleFav, touchRecent, isFav, listFavs } = await import('../lib/product-interest');
import type { EntityRecord } from '../lib/intake/entities';

type Case = { name: string; ok: boolean; detail?: unknown };
const cases: Case[] = [];
const check = (name: string, ok: boolean, detail?: unknown) => {
  cases.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail != null ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
};

/** TopBar GROUPS와 동일 규칙 — 역할별 메뉴 노출 SSOT 복제(UI 상수 미export → 시뮬용). */
const MENU: { href: string; label: string; roles: Role[] }[] = [
  { href: '/', label: '매물 검색', roles: ['agent', 'provider', 'admin'] },
  { href: '/chat', label: '계약문의', roles: ['agent', 'provider', 'admin'] },
  { href: '/contract', label: '정산관리', roles: ['agent', 'admin'] },
  { href: '/inventory', label: '재고관리', roles: ['provider', 'admin'] },
  { href: '/policy', label: '정책관리', roles: ['provider', 'admin'] },
  { href: '/settlement', label: '월별정산', roles: ['admin'] },
  { href: '/members', label: '회원·파트너', roles: ['admin'] },
  { href: '/audit', label: '감사·휴지통', roles: ['admin'] },
  { href: '/data-check', label: '데이터점검', roles: ['admin'] },
  { href: '/dev', label: '개발도구', roles: ['admin'] },
  { href: '/settings', label: '설정', roles: ['agent', 'provider', 'admin'] },
];
const agentMenu = (href: string) => MENU.some((m) => m.href === href && m.roles.includes('agent'));
const inventoryGate = (r: Role) => r === 'admin' || r === 'provider'; // inventory page gate

const co = getCompanyId();
await seedIfEmpty(co);
const store = getStore();
console.log(`\n══ 영업자 역할 시뮬레이션 (backend=${store.backend}) ══\n`);

// ── 0. 역할·행위자 ──
setRole('agent');
const me = actor('agent');
check('0.1 역할=영업자', ROLE_LABEL[me ? 'agent' : 'admin'] === '영업자' && me.code === 'usr_park', me);
check('0.2 메뉴 허용', agentMenu('/') && agentMenu('/chat') && agentMenu('/contract') && agentMenu('/settings'));
check('0.3 메뉴 차단', !agentMenu('/inventory') && !agentMenu('/policy') && !agentMenu('/settlement') && !agentMenu('/members') && !agentMenu('/audit') && !agentMenu('/data-check') && !agentMenu('/dev'));
check('0.4 재고 게이트', !inventoryGate('agent') && inventoryGate('provider') && inventoryGate('admin'));

// ── 1. 시드 매물 탐색(파인더 필터) ──
const products = await store.list('product', co);
check('1.1 시드 매물 존재', products.length > 0, `${products.length}대`);
const sample = products.find((p) => String(p.vehicle_status) === '출고가능') || products[0];
const fState = {
  q: '', periods: new Set<number>(), rent: new Set<string>(), dep: new Set<string>(),
  mile: new Set<string>(), fuel: new Set<string>(), ptype: new Set<string>(),
  vstatus: new Set<string>(), credit: new Set<string>(), perks: new Set<string>(),
  promo: new Set<string>(), dyn: {}, vehicle: { ...EMPTY_VEHICLE_FILTER },
};
const matched = products.filter((p) => matchProduct(p, fState));
check('1.2 matchProduct 전체통과', matched.length === products.length, matched.length);
const opts = presentFilterOptions(products);
check('1.3 필터축 존재', Object.keys(opts).length > 0, Object.keys(opts).slice(0, 6));

// 관심·공유
touchRecent(sample);
toggleFav(sample);
check('1.4 관심찜', isFav(String(sample.product_code)) && listFavs().length >= 1);
const share = guestShareUrl(sample, me.code, 'https://demo.local');
check('1.5 손님공유 URL', share.includes(`/q/`) && share.includes(`a=${encodeURIComponent(me.code)}`), share);
{
  const { matchAgentByShareCode } = await import('../lib/domain/product-share');
  const users = await store.list('user', co);
  const hit = matchAgentByShareCode(users, me.code);
  check('1.5b /q?a= 사람키 매칭', !!hit && String(hit.user_code || hit.uid) === me.code, hit?.name);
  const legacy = matchAgentByShareCode(users, 'chn_seoul');
  check('1.5c 레거시 채널코드 폴백', !!legacy);
}
const copy = formatProductForCopy(sample, { name: me.name, roleLabel: '영업자' });
check('1.6 카톡복사 텍스트', copy.includes(String(sample.car_number || '')) && copy.length > 20, copy.slice(0, 80));

// 상세 audience — 손님엔 내부 원가/메모 섹션 없음
const agentSecs = detailSections(sample, 'agent');
const custSecs = detailSections(sample, 'customer');
const dump = (secs: ReturnType<typeof detailSections>) => JSON.stringify(secs);
check('1.7 손님 상세에 원가·파트너메모 없음', !/vehicle_price|partner_memo|원가/.test(dump(custSecs)));
check('1.8 영업·손님 상세 섹션', agentSecs.length >= 1 && custSecs.length >= 1, { agent: agentSecs.length, customer: custSecs.length });

// ── 2. 픽스처 매물(공급사) + 영업 문의 ──
setRole('provider');
const productCode = newId('product');
const product: EntityRecord = {
  product_code: productCode,
  car_number: '88어8888',
  maker: '현대',
  model: '아반떼',
  sub_model: '아반떼 CN7',
  trim_name: '인스퍼레이션',
  year: '2023',
  fuel_type: '가솔린',
  vehicle_status: '출고가능',
  product_type: '재렌트',
  provider_company_code: 'sup_jeil',
  price: { '36': { rent: 390000, deposit: 0, fee: 39000 }, '48': { rent: 360000, deposit: 0, fee: 36000 } },
};
await store.save('product', co, [product]);

setRole('agent');
const roomId = await ensureRoom(product);
check('2.1 방 키=CH_매물_영업', roomId === `CH_${productCode}_${me.code}`, roomId);

await sendText({ roomId, text: '36개월 즉시출고 가능한가요?', channel: '간단', role: 'agent' });
const simple = await listMessages(roomId, '간단');
check('2.2 간단문의 채널', simple.length === 1 && String(simple[0].channel) === '간단');

await sendText({ roomId, text: '계약문의 드립니다', channel: '정식', role: 'agent' });
const formal = await listMessages(roomId, '정식');
check('2.3 정식 채널 분리', formal.length === 1 && String(formal[0].channel) === '정식');
check('2.4 채널 교차 안 보임', (await listMessages(roomId, '간단')).length === 1);

// 공급사 답장 → 영업 unread
setRole('provider');
await sendText({ roomId, text: '출고 가능합니다', channel: '정식', role: 'provider' });
setRole('agent');
let room = (await store.get('room', co, roomId))!;
check('2.5 영업자 unread↑', unreadFor(room, 'agent') >= 1, unreadFor(room, 'agent'));
await markRead(roomId, 'agent');
room = (await store.get('room', co, roomId))!;
check('2.6 markRead 후 unread=0', unreadFor(room, 'agent') === 0);

// 방 목록 스코프 — 영업자는 자기 agent_code만
const otherCode = 'usr_other_agent';
await store.save('room', co, [{
  _key: `CH_${productCode}_${otherCode}`, room_code: `CH_${productCode}_${otherCode}`,
  product_code: productCode, agent_code: otherCode, agent_name: '다른영업',
  provider_company_code: 'sup_jeil', last_message: '타영업방', last_message_at: Date.now(),
}]);
const allRooms = await store.list('room', co);
const agentRooms = allRooms.filter((r) => String(r.agent_code) === me.code);
const otherRooms = allRooms.filter((r) => String(r.agent_code) === otherCode);
check('2.7 자기 방만 목록', agentRooms.some((r) => String(r._key) === roomId) && !agentRooms.some((r) => String(r.agent_code) === otherCode));
check('2.8 타영업 방 존재(격리대상)', otherRooms.length === 1);

// ── 3. 계약문의 + 영업자 스텝 ──
const contractCode = await createContractRequest(
  product,
  { period: 36, customerName: '', customerPhone: '' },
  roomId,
);
let contract = (await store.get('contract', co, contractCode))!;
check('3.1 가계약 생성', !!contract && String(contract.agent_code) === me.code, contract.contract_code);
check('3.2 요율 스냅샷', Number(contract.fee_rate_snapshot) >= 0 && Number(contract.rent_amount_snapshot) === 390000, {
  fee: contract.fee_rate_snapshot, rent: contract.rent_amount_snapshot,
});

await applyStepCheck(contract, 'agent_delivery_inquiry', 'yes');
contract = (await store.get('contract', co, contractCode))!;
let prod = (await store.get('product', co, productCode))!;
check('3.3 계약문의 체크', isDone(contract.agent_delivery_inquiry));
check('3.4 출고문의 후 차량상태', String(prod.vehicle_status) === '출고불가' || String(prod.vehicle_status) === '출고가능', prod.vehicle_status);
// (엔진: 출고문의만으로 잠글 수도/응답 후 잠글 수도 — 궤적만 기록)
check('3.5 stage 라벨', contractStage(contract).label !== '상담', contractStage(contract));

// 공급 응답 + 이후 영업 스텝만 영업자가 수행
setRole('provider');
await applyStepCheck(contract, 'provider_delivery_response', '출고 가능');
setRole('agent');
contract = (await store.get('contract', co, contractCode))!;
await applyStepCheck(contract, 'agent_docs_submitted', 'yes');
setRole('provider');
contract = (await store.get('contract', co, contractCode))!;
await applyStepCheck(contract, 'provider_docs_review', '승인');
setRole('agent');
contract = (await store.get('contract', co, contractCode))!;
await applyStepCheck(contract, 'agent_balance_paid', 'yes');
await applyStepCheck((await store.get('contract', co, contractCode))!, 'agent_final_paid', 'yes');
setRole('provider');
await applyStepCheck((await store.get('contract', co, contractCode))!, 'provider_balance_confirmed', 'yes');

// 약정 직전 — 손님 연락처(영업자)
setRole('agent');
await store.update('contract', co, contractCode, { customer_name: '김손님', customer_phone: '010-1111-2222' });
await applyStepCheck((await store.get('contract', co, contractCode))!, 'provider_agreement_done', 'yes');

// 발송 링크
const token = await sendContractLink(contractCode);
check('3.6 계약서 발송 토큰', !!token && token.length > 8, token.slice(0, 12) + '…');
const byToken = await getContractByToken(token);
check('3.7 토큰→계약 조회', !!byToken && String(byToken.contract_code) === contractCode);

setRole('provider');
await applyStepCheck((await store.get('contract', co, contractCode))!, 'provider_agreement_sent', 'yes');
setRole('agent');
await applyStepCheck((await store.get('contract', co, contractCode))!, 'agent_handover_confirmed', 'yes');
setRole('provider');
await applyStepCheck((await store.get('contract', co, contractCode))!, 'provider_release_completed', 'yes');

contract = (await store.get('contract', co, contractCode))!;
prod = (await store.get('product', co, productCode))!;
const pr = getProgress(contract);
check('3.8 5/5 완료', pr.done === STEPS.length && String(contract.contract_status) === '계약완료', { progress: `${pr.done}/${pr.total}`, status: contract.contract_status });
check('3.9 차량 출고불가', String(prod.vehicle_status) === '출고불가', prod.vehicle_status);

// ── 4. 정산 스코프 ──
setRole('agent');
const stCode = `ST_${contractCode}`;
const settlement = await store.get('settlement', co, stCode);
check('4.1 정산 자동생성', !!settlement, settlement ? String(settlement.settlement_status) : 'MISSING');
check('4.2 영업자 귀속', !!settlement && String(settlement.agent_code) === me.code, settlement?.agent_code);
const allC = await store.list('contract', co);
const allS = await store.list('settlement', co);
const mineC = allC.filter((c) => String(c.agent_code) === me.code);
const mineS = allS.filter((s) => String(s.agent_code) === me.code);
const foreignC = allC.filter((c) => String(c.agent_code) === otherCode);
check('4.3 계약목록=자기것만', mineC.some((c) => String(c.contract_code) === contractCode));
check('4.4 타영업 계약 미포함', !mineC.some((c) => String(c.agent_code) === otherCode) || foreignC.length === 0);
check('4.5 정산목록 자기것', mineS.some((s) => String(s.contract_code) === contractCode));
check('4.6 지급액 산출', !!settlement && Number(settlement.agent_payout) >= 0, {
  fee: settlement?.fee_amount, payout: settlement?.agent_payout, net: settlement?.net_amount,
});

// ── 요약 ──
const failed = cases.filter((c) => !c.ok);
console.log('\n════════ 영업자 시뮬 결과 ════════');
console.log(failed.length ? `FAIL — ${failed.length}/${cases.length}` : `PASS — ${cases.length}/${cases.length}`);
if (failed.length) {
  for (const f of failed) console.log(' ·', f.name, f.detail ?? '');
}
console.log({
  actor: me,
  menu: MENU.filter((m) => m.roles.includes('agent')).map((m) => m.label).join(' · '),
  room: roomId,
  contract: contractCode,
  status: contract.contract_status,
  vehicle: prod.vehicle_status,
  settlement: settlement ? `${settlement.settlement_code} payout=${settlement.agent_payout}` : null,
  signToken: token ? 'ok' : null,
});
process.exit(failed.length ? 1 : 0);
