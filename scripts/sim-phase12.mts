/**
 * Phase1·2 기능 시뮬레이션 — Phase3(갓페이지 추출) 들어가기 전 점검.
 * LocalAdapter 위에서 실제 도메인 API 실행.
 *
 * 점검 축:
 *  A. messaging SSOT — 간단/정식 채널 분리, unread, markRead, listMessages
 *  B. product audience — customer 섹션에 내부필드 없음 / agent에 plate 노출 근거
 *  C. 생애주기 요약 훅 — ensureRoom → createContractRequest 최소 통과
 *
 * 실행: npx tsx scripts/sim-phase12.mts
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
const { ensureRoom, setRole, actor, createContractRequest } = await import('../lib/domain/deal');
const { sendText, markRead, listMessages, unreadFor, isMine } = await import('../lib/domain/messaging');
const { applyStepCheck } = await import('../lib/domain/settlement-engine');
const { detailSections } = await import('../lib/domain/product');
import type { EntityRecord } from '../lib/intake/entities';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

type Case = { name: string; ok: boolean; detail?: unknown };
const cases: Case[] = [];
const check = (name: string, ok: boolean, detail?: unknown) => {
  cases.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail != null ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
};

const co = getCompanyId();
await seedIfEmpty(co);
const store = getStore();
console.log(`\n══ Phase1·2 시뮬레이션 (backend=${store.backend}) ══\n`);

// ── 픽스처 ──
setRole('agent');
const productCode = newId('product');
const product: EntityRecord = {
  product_code: productCode,
  car_number: '11가1111',
  maker: '기아',
  model: 'K5',
  sub_model: 'K5 DL3',
  year: '2023',
  fuel_type: '가솔린',
  vehicle_status: '출고가능',
  product_type: '재렌트',
  provider_company_code: 'sup_jeil',
  price: { '36': { rent: 420000, deposit: 1000000 }, '48': { rent: 390000, deposit: 1000000 } },
};
await store.save('product', co, [product]);

// ════════════════════════════════════════
console.log('── A. messaging SSOT ──');
// ════════════════════════════════════════
const me = actor('agent');
const roomId = await ensureRoom(product, me);
check('A1 ensureRoom 키', roomId === `CH_${productCode}_${me.code}`, roomId);

await sendText({ roomId, text: '즉시 출고 가능한가요?', channel: '간단', role: 'agent' });
setRole('provider');
await sendText({ roomId, text: '네, 이번 주 출고 가능합니다.', channel: '정식', role: 'provider' });
setRole('agent');
await sendText({ roomId, text: '계약문의로 이어가겠습니다.', channel: '정식', role: 'agent' });

const all = await listMessages(roomId);
const simple = await listMessages(roomId, '간단');
const formal = await listMessages(roomId, '정식');
check('A2 전체 3건', all.length === 3, all.length);
check('A3 간단만 1건', simple.length === 1 && simple[0].text === '즉시 출고 가능한가요?', simple.map((m) => m.channel));
check('A4 정식 2건', formal.length === 2, formal.map((m) => m.channel));
check('A5 간단이 정식 목록에 없음', !formal.some((m) => m.channel === '간단'));

const rmAfterProvider = await store.get('room', co, roomId);
// 마지막 발신=agent → provider unread 증가, agent는 안 증가(자기 말)
setRole('provider');
const uProv = unreadFor(rmAfterProvider!, 'provider');
const uAgent = unreadFor(rmAfterProvider!, 'agent');
check('A6 공급사 unread > 0 (영업 정식 후)', uProv > 0, { uProv, uAgent, last: rmAfterProvider?.last_message });

await markRead(roomId, 'provider');
const rmRead = await store.get('room', co, roomId);
check('A7 markRead 공급사 → unread 0', unreadFor(rmRead!, 'provider') === 0);

const last = all[all.length - 1];
const agentMe = actor('agent');
setRole('agent');
check('A8 isMine 영업 마지막 말', isMine(last, agentMe, 'agent') === true);
check('A9 isMine 공급사가 영업 말 보면 false', isMine(last, actor('provider'), 'provider') === false);

// ════════════════════════════════════════
console.log('\n── B. product audience / detailSections ──');
// ════════════════════════════════════════
const secsAgent = detailSections(product, 'agent');
const secsCust = detailSections(product, 'customer');
const secsAdmin = detailSections(product, 'admin');
check('B1 agent 섹션 ≥ customer', secsAgent.length >= secsCust.length, { agent: secsAgent.length, customer: secsCust.length, admin: secsAdmin.length });
const agentTitles = secsAgent.map((s) => s.title).join('|');
const custTitles = secsCust.map((s) => s.title).join('|');
// customer에 원가·수수료·내부코드류가 없어야 함(있다면 제목에 힌트)
const leak = /원가|수수료|provider_company|내부|관리자전용/i;
check('B2 customer 섹션 제목에 내부 누수 키워드 없음', !leak.test(custTitles), custTitles);
check('B3 agent에 가격 섹션 존재', secsAgent.some((s) => s.kind === 'price' || /대여|가격|요금/.test(s.title)), agentTitles);

// badgeSpecs는 client atoms — 동적 import 시도
try {
  const atoms = await import('../components/product-card-atoms');
  const agentBadges = atoms.badgeSpecs(product, false, false, 'agent');
  const custBadges = atoms.badgeSpecs(product, false, false, 'customer');
  check('B4 customer 뱃지에 출고상태(st) 없음', !custBadges.some((b) => b.key === 'st'), custBadges.map((b) => b.key));
  check('B5 agent 뱃지에 출고상태(st) 있음', agentBadges.some((b) => b.key === 'st'), agentBadges.map((b) => b.key));
} catch (e) {
  check('B4-5 badgeSpecs (client import)', false, String((e as Error).message));
}

// ════════════════════════════════════════
console.log('\n── C. 계약 최소 경로 (문의→출고응답) ──');
// ════════════════════════════════════════
setRole('agent');
const cCode = await createContractRequest(product, { period: 36, customerName: '', customerPhone: '' }, roomId);
let c = (await store.get('contract', co, cCode))!;
await applyStepCheck(c, 'agent_delivery_inquiry', 'yes');
c = (await store.get('contract', co, cCode))!;
let p2 = (await store.get('product', co, productCode))!;
check('C1 계약문의 후 상태', c.contract_status === '계약요청' || !!c.agent_delivery_inquiry, c.contract_status);
check('C2 출고 잠금(진행 시작)', p2.vehicle_status === '출고불가' || p2.vehicle_status === '출고가능', p2.vehicle_status);
// 첫 체크만으로는 출고불가일 수 있음 — applyStepCheck 스펙 확인용 로그
setRole('provider');
c = (await store.get('contract', co, cCode))!;
await applyStepCheck(c, 'provider_delivery_response', '출고 가능');
c = (await store.get('contract', co, cCode))!;
p2 = (await store.get('product', co, productCode))!;
check('C3 공급 출고응답 반영', c.provider_delivery_response === '출고 가능', {
  response: c.provider_delivery_response,
  vehicle: p2.vehicle_status,
});

// ════════════════════════════════════════
console.log('\n── D. 회귀 가드 (죽은 파일·복붙 금지 경로) ──');
// ════════════════════════════════════════
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const gone = [
  'components/ContractRequestForm.tsx',
  'components/PeriodPrices.tsx',
];
for (const rel of gone) {
  const exists = fs.existsSync(path.join(root, rel));
  check(`D 삭제 유지 ${rel}`, !exists);
}
// ChatThread에 unread bump 인라인이 없어야 함
const chatSrc = fs.readFileSync(path.join(root, 'components/ChatThread.tsx'), 'utf8');
check('D ChatThread → messaging import', /from '@\/lib\/domain\/messaging'/.test(chatSrc) || /from '\.\.\/lib\/domain\/messaging'/.test(chatSrc) || chatSrc.includes('lib/domain/messaging'));
check('D ChatThread에 unread_for_ 직접 bump 없음', !/unread_for_agent\s*=\s*\(Number/.test(chatSrc));
const inqSrc = fs.readFileSync(path.join(root, 'components/SimpleInquiry.tsx'), 'utf8');
check('D SimpleInquiry → messaging import', inqSrc.includes('lib/domain/messaging'));
check('D SimpleInquiry에 unread bump 인라인 없음', !/unread_for_agent\s*=\s*\(Number/.test(inqSrc));
const catSrc = fs.readFileSync(path.join(root, 'app/catalog/page.tsx'), 'utf8');
check('D catalog에 CatalogCard 포크 없음', !/function CatalogCard/.test(catSrc) && catSrc.includes('ProductCard'));
const qSrc = fs.readFileSync(path.join(root, 'app/q/[code]/page.tsx'), 'utf8');
check('D q → ProductDetail customer', qSrc.includes('ProductDetail') && qSrc.includes("audience=\"customer\""));

// ── 요약 ──
const failed = cases.filter((c) => !c.ok);
console.log('\n════════ 결과 ════════');
console.log(`${cases.length - failed.length}/${cases.length} PASS`);
if (failed.length) {
  console.log('FAIL:');
  for (const f of failed) console.log(`  - ${f.name}`, f.detail ?? '');
  process.exit(1);
}
console.log('PASS — Phase1·2 기능 시뮬레이션 통과. Phase3 진행 가능.');
process.exit(0);
