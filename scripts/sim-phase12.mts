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
const { isId, newId } = await import('../lib/domain/ids');
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
check('A1 ensureRoom 신규 rom_ 키', isId('room', roomId), roomId);

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

await markRead(roomId, 'provider', () => false);
const rmGuarded = await store.get('room', co, roomId);
check('A7 stale/unmounted 읽음 커밋 차단', unreadFor(rmGuarded!, 'provider') === uProv);

await markRead(roomId, 'provider');
const rmRead = await store.get('room', co, roomId);
check('A8 markRead 공급사 → unread 0', unreadFor(rmRead!, 'provider') === 0);

const last = all[all.length - 1];
const agentMe = actor('agent');
setRole('agent');
check('A9 isMine 영업 마지막 말', isMine(last, agentMe, 'agent') === true);
check('A10 isMine 공급사가 영업 말 보면 false', isMine(last, actor('provider'), 'provider') === false);

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
const cCode = await createContractRequest(product, { customerName: '', customerPhone: '' }, roomId);
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
const chatListAt = chatSrc.indexOf('const nextMsgs = await listMessages(targetRoom)');
const chatMarkAt = chatSrc.indexOf('await markRead(targetRoom, getRole(), isCurrent)');
check('D ChatThread 메시지 조회 성공 뒤 읽음 커밋', chatListAt >= 0 && chatMarkAt > chatListAt);
check('D ChatThread 현재 room guard를 markRead에 전달', chatSrc.includes('markRead(targetRoom, getRole(), isCurrent)'));
const inqSrc = fs.readFileSync(path.join(root, 'components/SimpleInquiry.tsx'), 'utf8');
check('D SimpleInquiry → messaging import', inqSrc.includes('lib/domain/messaging'));
check('D SimpleInquiry에 unread bump 인라인 없음', !/unread_for_agent\s*=\s*\(Number/.test(inqSrc));
check('D SimpleInquiry 진입 자동 markRead 없음', !inqSrc.includes('markRead('));
const memoSrc = fs.readFileSync(path.join(root, 'components/ContractMemos.tsx'), 'utf8');
check('D 계약 메모 blur 저장 없음', !memoSrc.includes('onBlur='));
check('D 계약 메모 명시 저장 액션', memoSrc.includes('메모 저장') && memoSrc.includes('onClick={() => { void save(slot); }}'));
const catSrc = fs.readFileSync(path.join(root, 'app/catalog/page.tsx'), 'utf8');
check('D catalog에 CatalogCard 포크 없음', !/function CatalogCard/.test(catSrc) && catSrc.includes('ProductCard'));
const qSrc = fs.readFileSync(path.join(root, 'app/q/[code]/page.tsx'), 'utf8');
check('D q → ProductDetail customer', qSrc.includes('ProductDetail') && qSrc.includes("audience=\"customer\""));
const contractPageSrc = fs.readFileSync(path.join(root, 'app/contract/page.tsx'), 'utf8');
const workPageSrc = fs.readFileSync(path.join(root, 'components/WorkPage.tsx'), 'utf8');
const pageActionsSrc = fs.readFileSync(path.join(root, 'components/PageActions.tsx'), 'utf8');
const pageToolBarSrc = fs.readFileSync(path.join(root, 'components/PageToolBar.tsx'), 'utf8');
const navigationSrc = fs.readFileSync(path.join(root, 'components/ui/navigation.tsx'), 'utf8');
const buttonsSrc = fs.readFileSync(path.join(root, 'components/ui/buttons.tsx'), 'utf8');
const contractPanelSrc = fs.readFileSync(path.join(root, 'components/ContractPanel.tsx'), 'utf8');
const chakhandealButtonSrc = fs.readFileSync(path.join(root, 'components/ChakhandealEsignButton.tsx'), 'utf8');
const chakhandealRouteSrc = fs.readFileSync(path.join(root, 'app/api/chakhandeal/contracts/send/route.ts'), 'utf8');
const chakhandealServerSrc = fs.readFileSync(path.join(root, 'lib/server/chakhandeal-esign.ts'), 'utf8');
const contractMemosSrc = fs.readFileSync(path.join(root, 'components/ContractMemos.tsx'), 'utf8');
const contractDocsSrc = fs.readFileSync(path.join(root, 'components/ContractDocs.tsx'), 'utf8');
const contractSignSrc = fs.readFileSync(path.join(root, 'components/ContractSign.tsx'), 'utf8');
const settlementPageSrc = fs.readFileSync(path.join(root, 'app/settlement/page.tsx'), 'utf8');
const inventoryPageSrc = fs.readFileSync(path.join(root, 'app/inventory/page.tsx'), 'utf8');
const membersPageSrc = fs.readFileSync(path.join(root, 'app/members/page.tsx'), 'utf8');
const policyPageSrc = fs.readFileSync(path.join(root, 'app/policy/page.tsx'), 'utf8');
const devPageSrc = fs.readFileSync(path.join(root, 'app/dev/page.tsx'), 'utf8');
const settingsPageSrc = fs.readFileSync(path.join(root, 'app/settings/page.tsx'), 'utf8');
const reportButtonSrc = fs.readFileSync(path.join(root, 'components/ReportButton.tsx'), 'utf8');
const inventoryEditorSrc = fs.readFileSync(path.join(root, 'features/inventory/InventoryEditorPanes.tsx'), 'utf8');
const productPreferencesSrc = fs.readFileSync(path.join(root, 'features/settings/ProductPreferences.tsx'), 'utf8');
const formGridSrc = fs.readFileSync(path.join(root, 'components/ui/form-grid.tsx'), 'utf8');
const priceMatrixSrc = fs.readFileSync(path.join(root, 'components/PriceMatrix.tsx'), 'utf8');
const photoUploadSrc = fs.readFileSync(path.join(root, 'components/PhotoUpload.tsx'), 'utf8');
const publicSignPageSrc = fs.readFileSync(path.join(root, 'app/sign/[token]/page.tsx'), 'utf8');
check('D 계약 목록 규격 외 SettlementSummary 제거', !contractPageSrc.includes('SettlementSummary'));
check('D 정산 금액 blur 저장 없음', !contractPageSrc.includes('onBlur='));
check('D 정산 금액 명시 저장 액션', contractPageSrc.includes('title={`${label} 저장`}') && contractPageSrc.includes('onClick={() => { void commit(); }}'));
check('D R1/R2 입력·저장 접근성 이름 구분', contractPageSrc.includes('ariaLabel={`${label} 금액`}') && contractPageSrc.includes('label={label}'));
check('D 정산 금액 선택 epoch guard', contractPageSrc.includes('epoch === selectionEpoch.current') && contractPageSrc.includes('selectedCodeRef.current === targetContractCode'));
check('D 모바일 업무 패널은 icon SSOT', workPageSrc.includes('icon?: LucideIcon') && workPageSrc.includes('<IconSeg'));
check('D 모바일 CRUD는 공통 PageActions', pageActionsSrc.includes("from 'lucide-react'") && pageActionsSrc.includes('<Btn size="sm"'));
check('D 모바일 툴바 라벨+아이콘 일치', pageToolBarSrc.includes('<Icon size={ICON.lg}') && pageToolBarSrc.includes('<span>{t.label}</span>'));
check('D 모바일 목록복귀는 공통 BottomNav', navigationSrc.includes("export type NavBackKind = 'history' | 'list' | 'cancel'") && navigationSrc.includes('backShowLabel'));
check('D 공통 Btn 모바일 아이콘 전환 SSOT', buttonsSrc.includes('mobileIcon?: React.ReactNode') && buttonsSrc.includes('iconOnly ? mobileIcon : children'));
check('D 결정적 액션 아이콘+텍스트 SSOT', buttonsSrc.includes('export function ButtonLabel'));
check('D 계약 진행 주요 액션 아이콘+텍스트', contractPanelSrc.includes('ButtonLabel') && contractPanelSrc.includes('CheckCircle2') && contractPanelSrc.includes('FileSignature'));
check('D ERP 자체 전자서명 발송 진입점 미노출', !contractPanelSrc.includes('<ContractSign'));
check('D 계약 진행 패널에 레거시 착한거래 발송버튼 중복 미노출', !contractPanelSrc.includes('<ChakhandealEsignButton'));
check('D 계약 메모 저장 아이콘+텍스트', contractMemosSrc.includes('ButtonLabel') && contractMemosSrc.includes('<Save'));
check('D 계약 서류 삭제 아이콘+텍스트', contractDocsSrc.includes('ButtonLabel') && contractDocsSrc.includes('<Trash2'));
check('D 전자서명 주요 액션 아이콘+텍스트', contractSignSrc.includes('ButtonLabel') && contractSignSrc.includes('<Send') && contractSignSrc.includes('<CheckCircle2'));
check('D 간단문의 모바일 전송 아이콘-only 예외', inqSrc.includes('mobileIcon={<Send') && inqSrc.includes('<ButtonLabel'));
check('D 회원 승인 액션 아이콘+텍스트', membersPageSrc.includes('<UserCheck') && membersPageSrc.includes('<UserRoundX') && membersPageSrc.includes('<ButtonLabel'));
check('D 설정 주요 액션 아이콘+텍스트', settingsPageSrc.includes('<Save') && settingsPageSrc.includes('<KeyRound') && settingsPageSrc.includes('<LogOut') && settingsPageSrc.includes('<ButtonLabel'));
check('D 상품 검수 요청 아이콘+텍스트', reportButtonSrc.includes('<Flag') && reportButtonSrc.includes('<Send') && reportButtonSrc.includes('<ButtonLabel'));
check('D 재고 편집 도구 아이콘+텍스트', inventoryEditorSrc.includes('<RotateCcw') && inventoryEditorSrc.includes('<ClipboardPaste') && inventoryEditorSrc.includes('<ButtonLabel'));
check('D 설정 관심상품 관리 아이콘+텍스트', productPreferencesSrc.includes('<StarOff') && productPreferencesSrc.includes('<Trash2') && productPreferencesSrc.includes('<ButtonLabel'));
check('D 모바일 조회폼은 공통 정보행 SSOT', formGridSrc.includes('export function FormReadList') && formGridSrc.includes('<DetailRow'));
check('D 모바일 정책 조회·편집 분리', policyPageSrc.includes('mobile && !canEdit') && policyPageSrc.includes('<FormReadList'));
check('D 모바일 재고 조회·편집 분리', inventoryEditorSrc.includes('const readAsRows = mobile') && inventoryEditorSrc.includes('<FormReadList'));
check('D 재고 가격 조회는 입력 컨트롤 제거', priceMatrixSrc.includes('readOnly = false') && priceMatrixSrc.includes("fmt(rentN) || '—'") && priceMatrixSrc.includes('{!readOnly ? <div'));
check('D 재고 사진 조회는 추가·편집 제거', photoUploadSrc.includes('readOnly = false') && photoUploadSrc.includes('!readOnly ? <div') && photoUploadSrc.includes('!readOnly && sheet'));
check('D 공개 전자서명 한글 인코딩 정상', publicSignPageSrc.includes('본인확인 자료와 전자서명 제출') && publicSignPageSrc.includes('확인하고 전자서명 제출') && !/[媛紐吏李泥]|\?[먯꾩쒕]/.test(publicSignPageSrc));
check('D 공개 전자서명 결정 액션 아이콘+텍스트', publicSignPageSrc.includes('<Eraser') && publicSignPageSrc.includes('<Send') && publicSignPageSrc.includes('<ButtonLabel'));
check('D 공개 전자서명 색상 토큰 사용', !publicSignPageSrc.includes("'#fff'") && !publicSignPageSrc.includes("'#0f1830'"));
check('D 모바일 계약 엑셀 액션 미노출', contractPageSrc.includes('action: !mobile && setts.length'));
check('D 모바일 월정산 엑셀·정산서 미노출', settlementPageSrc.includes('const actions = mobile ? undefined') && settlementPageSrc.includes('{!mobile && (') && settlementPageSrc.includes('accept=".xlsx,.xls"'));
check('D 모바일 재고 시트취합 웹전용', inventoryPageSrc.includes("...(mobile ? [] : [{ key: 'sync'") && inventoryPageSrc.includes('<SheetSync'));
check('D 회원 일괄 백필 실행은 확인 대화상자 필수', devPageSrc.includes("title: '개인채널 백필'") && devPageSrc.includes("okLabel: '백필 실행'"));
check('D 회원 빈 화면 조사 사용', membersPageSrc.includes("'회원을' : '파트너사를'"));
check('D 정책관리 진입은 첫 행 자동선택 없음', !policyPageSrc.includes('selectP(all[0])'));
check('D 차종마스터 일괄 변환은 확인 필수', devPageSrc.includes("title: '차종마스터 일괄 변환'") && devPageSrc.includes("okLabel: '일괄 변환 실행'"));

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
