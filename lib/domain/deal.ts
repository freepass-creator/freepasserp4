/**
 * 딜 도메인 — 소통(room·message)·계약(contract) 생성. erp3 검증 모델 이식.
 *   방 = 매물 × 영업자 결정키 CH_{매물}_{영업자} (2자: 영업자↔공급사, 관리자 오버시어).
 *   계약 = TMP-YYMMDD-NN 가계약 채번 + *_snapshot + 계약요청.
 * 로컬 세션 스텁: 실인증 전까지 역할·행위자를 localStorage로(3자 대화 테스트).
 */
import { getStore } from '@/lib/store';
import { getCompanyId } from '@/lib/tenant';
import { type EntityRecord, ROLE_LABEL_RAW } from '@/lib/intake/entities';
import { priceAt, creditDisplay } from '@/lib/domain/product';
import { resolveRates } from '@/lib/domain/settlement-engine';
import { getSession } from '@/lib/auth-session';
import { BRAND_MAIN } from '@/lib/brand';
import { requirePositiveRentAmount } from '@/lib/domain/contract-money';
import { hasTermFrozen } from '@/lib/domain/contract';
import { vehicleNameOf } from '@/lib/domain/vehicle-name';
import { CONSULT_LABEL } from '@/features/chat/room-display';

export type Role = 'agent' | 'provider' | 'admin';
// v4 3역할 라벨 = 원본 5역할 라벨(entities.ROLE_LABEL_RAW SSOT)에서 파생. 값 복붙 금지.
export const ROLE_LABEL: Record<Role, string> = {
  agent: ROLE_LABEL_RAW.agent, provider: ROLE_LABEL_RAW.provider, admin: ROLE_LABEL_RAW.admin,
};
// 로컬/둘러보기 데모용 기본 행위자(실 로그인 시 세션이 우선).
const ACTORS: Record<Role, { uid: string; code: string; name: string }> = {
  agent: { uid: 'usr_park', code: 'usr_park', name: '박영업' },        // = seed usr_park
  provider: { uid: 'sup_jeil', code: 'sup_jeil', name: '제일오토렌탈' }, // 공급사 계정코드=파트너코드(sup_jeil)
  admin: { uid: 'usr_admin', code: 'usr_admin', name: '관리자' },
};
const RKEY = 'fp4_role';
/** 역할: 실 로그인 세션 → 없으면 로컬 시드 역할. UI 역할 덮어쓰기는 사용하지 않는다. */
export function getRole(): Role {
  const s = getSession(); if (s) return s.role; if (typeof window === 'undefined') return 'agent'; const r = localStorage.getItem(RKEY); return r === 'provider' || r === 'admin' ? r : 'agent';
}
/**
 * 역할 두 글자 표기 SSOT — 계약 단계·메모·목록이 **같은 말**을 쓰게 한다.
 *
 * 공급사는 시트로 관리한다(앱에 안 들어온다, 2026-08-07 결정). 그래서 «공급 몫»은 실제로
 * 운영자가 처리하고, 영업자·관리자 화면에서는 「운영」이라 부른다 — 앱에 있지도 않은 회사를
 * 기다리는 것처럼 읽히면 안 되기 때문이다. 다만 공급사 계정 본인에게는 그대로 「공급」이다.
 *
 * ★이 함수 밖에서 라벨을 만들지 마라. 실제로 갈라진 적이 있다(2026-08-08 점검):
 *   계약 단계는 「운영」인데 바로 아래 메모칸은 「공급」이라, 한 화면에서 두 이름이 보였다.
 */
export function roleSlotLabel(slot: Role, viewer: Role): string {
  if (slot === 'agent') return '영업';
  if (slot === 'admin') return '관리자';
  return viewer === 'provider' ? '공급' : '운영';
}

export function setRole(r: Role): void { if (typeof window !== 'undefined') { localStorage.setItem(RKEY, r); window.dispatchEvent(new CustomEvent('fp:role', { detail: r })); } }
// 행위자: 세션 역할이 요청 역할과 같으면 실 사용자(귀속코드) → 아니면 데모 스텁.
// 영업자 code = 사람키(user_code). 채널은 session.agent_channel_code 로만.
export function actor(r: Role): { uid: string; code: string; name: string; channel?: string } {
  const s = getSession();
  if (s && s.role === r) {
    // 실 세션인데 귀속코드가 비면 데모 스텁(공유코드 sup_jeil 등)으로 폴백 금지 —
    // uid로(고유) 격리해 타테넌트 오염 차단. 미설정 세션은 스코프 리더에서 자연히 막힘(fail-safe).
    const code = r === 'agent'
      ? (s.user_code || s.code || s.uid)
      : (s.code || s.uid);
    return {
      uid: s.uid,
      code,
      name: s.name || ACTORS[r].name,
      channel: s.agent_channel_code || undefined,
    };
  }
  return { ...ACTORS[r], channel: r === 'agent' ? 'chn_seoul' : undefined };
}

/**
 * 채팅 표기명 — 실제 표시명이 있으면 이름, 없으면 역할명. 관리자=`freepass.이름`.
 *
 * 계약문의는 공급사·영업자·관리자가 한 방에서 만난다. 거기에 실명이 줄줄이 남으면
 * 회사 밖 사람에게 우리 직원·거래처 담당자 이름이 그대로 쌓인다. 대화 목록도 같은 규격이다
 * (`work-list-display.agentLabel` preferCode).
 *
 * 내부코드·UID는 대화 상대 이름으로 노출하지 않는다. 이관 레코드에 이름이 없으면 역할명으로 닫는다.
 */
export function chatDisplayName(role: Role | string, name: string, code?: string): string {
  if (role === 'admin') {
    const n = String(name || '').trim();
    return n ? `${BRAND_MAIN}.${n}` : BRAND_MAIN;
  }
  const clean = (value: unknown) => {
    const text = String(value ?? '').trim();
    return text === 'undefined' || text === 'null' ? '' : text;
  };
  const displayName = clean(name);
  if (displayName) return displayName;
  void code;
  if (role === 'provider') return '공급사';
  if (role === 'agent') return '영업 담당자';
  return '담당자';
}

/** 당사자 3필드 — 빈 문자열 금지(전환 후 스코프 접근 불가). 누락 시 저장하지 않고 throw. */
function requireParties(
  fields: { agent_uid: unknown; agent_channel_code: unknown; provider_company_code: unknown },
  ctx: string,
): { agent_uid: string; agent_channel_code: string; provider_company_code: string } {
  const agent_uid = String(fields.agent_uid || '').trim();
  const agent_channel_code = String(fields.agent_channel_code || '').trim();
  const provider_company_code = String(fields.provider_company_code || '').trim();
  const missing = (
    [
      !agent_uid && 'agent_uid',
      !agent_channel_code && 'agent_channel_code',
      !provider_company_code && 'provider_company_code',
    ] as const
  ).filter(Boolean);
  if (missing.length) throw new Error(`${ctx}: 당사자 필드 누락 (${missing.join(', ')})`);
  return { agent_uid, agent_channel_code, provider_company_code };
}

/** 채널 해석 — 세션·행위자 채널 우선, 없으면 code(관리자·공급사 문의도 비우지 않음). */
function resolveChannel(ag: { code: string; channel?: string }): string {
  return String(ag.channel || getSession()?.agent_channel_code || ag.code || '').trim();
}

/** 매물×문의자 결정키. 빈 식별자로 CH_undefined_* 같은 고아 방을 만들지 않는다. */
export function productRoomKey(productCode: unknown, agentCode: unknown): string {
  const product = String(productCode || '').trim();
  const agent = String(agentCode || '').trim();
  return product && agent ? `CH_${product}_${agent}` : '';
}

/** 상세 진입용 읽기 전용 조회 — 없는 방을 만들지 않는다. */
export async function findExistingRoom(
  productCode: unknown,
  asker?: { uid: string; code: string; name: string; channel?: string },
): Promise<string | null> {
  const ag = asker || actor('agent');
  const roomKey = productRoomKey(productCode, ag.code);
  if (!roomKey) return null;
  return await getStore().get('room', getCompanyId(), roomKey) ? roomKey : null;
}

/** 방 보장 — 매물×문의자 결정키. 없으면 스냅샷과 함께 생성. asker 미지정=영업자(계약문의 경로). 관리자 간단문의 등은 asker=본인. */
export async function ensureRoom(product: EntityRecord, asker?: { uid: string; code: string; name: string; channel?: string }): Promise<string> {
  const co = getCompanyId();
  const store = getStore();
  const ag = asker || actor('agent'); // 기본=로그인 영업자(계약문의 방과 동일). 간단문의는 남기는 당사자(영업자·관리자)로 귀속.
  const roomKey = productRoomKey(product.product_code, ag.code);
  if (!roomKey) throw new Error('방 생성: 상품코드 또는 영업자 코드 누락');
  if (await store.get('room', co, roomKey)) return roomKey;
  const parties = requireParties({
    agent_uid: ag.uid,
    agent_channel_code: resolveChannel(ag),
    provider_company_code: product.provider_company_code,
  }, '방 생성');
  await store.save('room', co, [{
    _key: roomKey, room_code: roomKey,
    product_uid: String(product.product_code), product_code: String(product.product_code),
    car_number: String(product.car_number || ''),
    vehicle_name: vehicleNameOf({ kind: 'product', product }, { tier: 'short', fallback: 'none' }),
    maker: String(product.maker || ''),
    model: String(product.model || ''),
    sub_model: String(product.sub_model || ''),
    variant: String(product.variant || ''),
    trim_name: String(product.trim_name || ''),
    trim_extra: String(product.trim_extra || ''),
    agent_uid: parties.agent_uid, agent_code: ag.code, agent_name: ag.name,
    agent_channel_code: parties.agent_channel_code,
    provider_company_code: parties.provider_company_code,
    last_message: '', last_message_at: 0,
  }]);
  return roomKey;
}

/**
 * 견적기 상담방 공급사 — 손오공=중고(RP012) · 웰릭스=신차(RP013).
 * 제목은 CONSULT_LABEL(room-display) 에서 가져온다 — 목록이 만드는 이름과 저장값을 같게 둔다.
 * (목록은 저장된 subject 를 믿지 않고 공급사로 다시 만든다. 여기서 저장하는 건 기록용이다.)
 */
const CONSULT_APP = {
  sonogong: { provider: 'RP012' },
  welrix: { provider: 'RP013' },
} as const;
export type ConsultApp = keyof typeof CONSULT_APP;

/** 예측 불가 CS_ 키 접미사 — 고정키 선점 시 삭제·소유자변경 불가. */
function consultRoomSuffix(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const a = new Uint8Array(8);
    crypto.getRandomValues(a);
    return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/** 상담방을 열 수 없는 사유 — 화면이 조용히 비지 않게 호출부가 그대로 보여준다. */
export type ConsultBlock =
  | { ok: false; reason: 'signin' }      // 미로그인
  | { ok: false; reason: 'pending' }     // 가입 승인 대기
  | { ok: false; reason: 'provider' };   // 공급사 본인 — 자기 자신과의 대화

/**
 * 견적기 상담방 보장 — 키 CS_{PROVIDER}_{랜덤}.
 * 찾기 = (공급사, 로그인 uid) 스코프 목록에서 consult 방. 없으면 생성.
 *
 * ⚠ 역할을 'agent' 로 고정하지 않는다. erp4 는 3자 구조라 상담 조합이 둘이다 —
 *    영업자↔공급사, **관리자↔공급사**. actor('agent') 를 쓰면 관리자로 들어왔을 때
 *    데모 스텁으로 떨어져 uid 누락 throw → 채팅이 껍데기로 뜬다(2026-08-06 게이트 차단 1).
 *    방의 상대편 당사자 자리(agent_uid)에 로그인한 사람이 앉는 구조이므로 역할만 안 박으면 된다.
 *    uid 가 사람마다 달라 방은 자연히 분리되고, 공급사는 provider 스코프로 한 목록에서 본다.
 *
 * · 공급사 본인은 만들지 않는다(자기 자신과의 대화). /chat 에서 기존 방을 본다.
 * · is_admin_chat 세우지 않음(select 예/아니오 — '아니오' 저장 시 목록에서 사라짐).
 * · agent_channel_code = uid (실제 채널코드 금지 — SP999 등 채널 관리자 경쟁사 열람 방지).
 * · provider_company_code · name · uid 비면 저장하지 않고 throw.
 */
export async function ensureConsultRoom(app: ConsultApp): Promise<string | ConsultBlock> {
  const cfg = CONSULT_APP[app];
  const provider = String(cfg.provider || '').trim();
  if (!provider) throw new Error('상담방 생성: provider_company_code 누락');

  const s = getSession();
  if (!s) return { ok: false, reason: 'signin' };
  if (String(s.status || '') === 'pending') return { ok: false, reason: 'pending' };
  if (s.role === 'provider') return { ok: false, reason: 'provider' };

  const co = getCompanyId();
  const store = getStore();
  const agentName = String(s.name || '').trim();
  if (!agentName) throw new Error('상담방 생성: 이름 누락');
  const agentUid = String(s.uid || '').trim();
  if (!agentUid) throw new Error('상담방 생성: uid 누락');
  const agentCode = String(s.user_code || s.code || s.uid || '').trim();

  const rooms = await store.list('room', co);
  const existing = rooms.find((r) => {
    if (r._deleted) return false;
    const kindOk = r.room_kind === 'consult' || String(r._key || '').startsWith('CS_');
    if (!kindOk) return false;
    return String(r.provider_company_code || '') === provider
      && String(r.agent_uid || '') === agentUid;
  });
  if (existing) return String(existing._key);

  // 채널코드 자리에 agent_uid — 실제 채널(chn_/SP999)을 넣으면 그 채널 관리자가 상담 전문을 읽게 됨.
  const parties = requireParties({
    agent_uid: agentUid,
    agent_channel_code: agentUid,
    provider_company_code: provider,
  }, '상담방 생성');

  const roomKey = `CS_${provider}_${consultRoomSuffix()}`;
  await store.save('room', co, [{
    _key: roomKey,
    room_code: roomKey,
    room_kind: 'consult',
    subject: CONSULT_LABEL[provider] || '구독견적기',
    agent_uid: parties.agent_uid,
    agent_channel_code: parties.agent_channel_code,
    provider_company_code: parties.provider_company_code,
    agent_code: agentCode,
    agent_name: agentName,
    last_message: '',
    last_message_at: 0,
  }]);
  return roomKey;
}

/** 계약에서 방 보장 — 계약의 매물×영업자 결정키로 방이 없으면 생성(계약페이지 채팅용). */
export async function ensureRoomForContract(c: EntityRecord): Promise<string> {
  const co = getCompanyId();
  const store = getStore();
  const roomKey = `CH_${c.product_code}_${c.agent_code}`;
  if (!(await store.get('room', co, roomKey))) {
    // 레거시 계약에 agent_uid 없으면 agent_code로 승계(빈 문자열 금지).
    const parties = requireParties({
      agent_uid: c.agent_uid || c.agent_code,
      agent_channel_code: c.agent_channel_code,
      provider_company_code: c.provider_company_code,
    }, '계약방 생성');
    await store.save('room', co, [{
      _key: roomKey, room_code: roomKey,
      product_uid: String(c.product_code), product_code: String(c.product_code),
      car_number: String(c.car_number_snapshot || ''),
      vehicle_name: vehicleNameOf({ kind: 'contract', contract: c }, { tier: 'short', fallback: 'none' }),
      maker: String(c.maker_snapshot || c.maker || ''),
      model: String(c.model_snapshot || c.model || ''),
      sub_model: String(c.sub_model_snapshot || c.sub_model || ''),
      variant: String(c.variant_snapshot || c.variant || ''),
      trim_name: String(c.trim_name_snapshot || c.trim_name || ''),
      trim_extra: String(c.trim_extra_snapshot || c.trim_extra || ''),
      agent_uid: parties.agent_uid, agent_code: c.agent_code, agent_name: c.agent_name,
      agent_channel_code: parties.agent_channel_code,
      provider_company_code: parties.provider_company_code, linked_contract: c.contract_code,
      last_message: '', last_message_at: 0,
    }]);
  }
  return roomKey;
}

/** 가계약 생성 — TMP-YYMMDD-NN 채번 + 차량 스냅샷 + 계약요청.
 *  기간·월대여료·보증금은 여기 안 굳힌다 → 약정(`freezeContractTerm`)에서. */
export async function createContractRequest(
  product: EntityRecord,
  opt: { customerName?: string; customerPhone?: string } = {},
  roomId?: string,
  deliveryResponse?: string,
): Promise<string> {
  const co = getCompanyId();
  const store = getStore();
  // 계약의 영업자 = 그 방(딜)의 영업자에 귀속(공급사·관리자가 눌러 만들어도 방 영업자에 붙음). 방 없으면 세션 영업자(actor) fallback.
  let ag = actor('agent');
  if (roomId) {
    const rm = await store.get('room', co, roomId);
    if (rm?.agent_code) {
      ag = {
        uid: String(rm.agent_uid || rm.agent_code || ''),
        code: String(rm.agent_code),
        name: String(rm.agent_name || ''),
        channel: String(rm.agent_channel_code || '') || undefined,
      };
    }
  }
  const { feeRate, payoutRate, feeResolved } = await resolveRates({ provider_company_code: product.provider_company_code, agent_code: ag.code }, product); // 율은 생성 시 스냅샷(공급사율 해석 가능할 때만)
  const d = new Date();
  const p2 = (n: number) => String(n).padStart(2, '0');
  const yymmdd = `${String(d.getFullYear()).slice(2)}${p2(d.getMonth() + 1)}${p2(d.getDate())}`;
  // NN 은 표시용 순번. 계약 read가 역할 스코프(영업자=본인 것만)라 NN 이 전역 고유가 아니다
  //  → 두 영업자가 같은 날 각자 첫 계약이면 둘 다 -01 이 되어 키 충돌·덮어쓰기. 전역 고유는 뒤 짧은 토큰으로 보장.
  const todays = (await store.list('contract', co)).filter((c) => String(c.contract_code || '').startsWith(`TMP-${yymmdd}`)).length;
  const uniq = Math.random().toString(36).slice(2, 6);
  const code = `TMP-${yymmdd}-${p2(todays + 1)}-${uniq}`;
  const parties = requireParties({
    agent_uid: ag.uid || ag.code,
    agent_channel_code: resolveChannel(ag),
    provider_company_code: product.provider_company_code,
  }, '계약 생성');
  await store.save('contract', co, [{
    contract_code: code, contract_status: '계약요청', contract_date: `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`,
    product_code: String(product.product_code || ''),
    car_number_snapshot: String(product.car_number || ''),
    maker_snapshot: String(product.maker || ''),
    model_snapshot: String(product.model || ''),
    sub_model_snapshot: String(product.sub_model || ''),
    variant_snapshot: String(product.variant || ''),
    trim_name_snapshot: String(product.trim_name || ''),
    trim_extra_snapshot: String(product.trim_extra || ''),
    vehicle_name_snapshot: vehicleNameOf({ kind: 'product', product }, { tier: 'full', fallback: 'none' }),
    year_snapshot: String(product.year || product.model_year || ''),
    fuel_type_snapshot: String(product.fuel_type || ''),
    customer_name: String(opt.customerName || ''), customer_phone: String(opt.customerPhone || ''),
    agent_uid: parties.agent_uid, agent_code: ag.code, agent_name: ag.name, agent_channel_code: parties.agent_channel_code,
    provider_company_code: parties.provider_company_code,
    credit_grade_snapshot: creditDisplay(product), payout_rate_snapshot: payoutRate,
    // ⚠ 공급사율을 못 찾았으면 **굽지 않는다.** fee_rate_snapshot 은 규칙상 생성 시 1회 확정이라
    //  기본 0.1 을 넣는 순간 그 계약은 영구히 10% 다(관리자도 못 고침). 요율이 아직 미정인 지금
    //  이걸 그대로 두면 오픈 첫날 계약이 전부 10% 로 굳는다.
    //  비워 두면 정산 생성 시점에 다시 해석하고, 정산 금액은 관리자가 고칠 수 있다.
    ...(feeResolved ? { fee_rate_snapshot: feeRate } : {}),
    // 출고문의를 소통에서 이미 마쳤으면 계약 1단계(출고문의·출고응답) 프리필 → 계약 진행은 서류부터.
    ...(deliveryResponse ? { agent_delivery_inquiry: 'yes', provider_delivery_response: deliveryResponse } : {}),
  }]);
  if (roomId) await store.update('room', co, roomId, { linked_contract: code });
  return code;
}

/**
 * 매물 없이 계약을 만든다 — **계약서만 보내는 경우**.
 *
 * ★왜 필요한가
 *   보통은 매물에서 계약이 파생된다(`createContractRequest`). 그런데 우리 재고에 없는 차이거나
 *   다른 경로로 이미 팔린 건인데 **계약서만 필요한** 경우가 있다.
 *   그때 매물을 억지로 만들면 재고에 없는 차가 상품 목록에 뜬다.
 *
 * ★그래도 못 비우는 것
 *   당사자 3필드(영업자 uid·채널·공급사)는 비울 수 없다 — 비면 그 계약을 **아무도 못 본다**
 *   (역할 스코프가 이 값으로 걸린다). 그래서 공급사는 받아야 한다.
 *
 * ★수수료율은 굽지 않는다
 *   매물이 없으면 공급사율을 해석할 근거가 없다. 기본값을 넣는 순간 그 계약은 영구히 그 율이다
 *   (`createContractRequest` 주석과 같은 이유). 비워 두면 정산 시점에 다시 해석한다.
 *
 * 차량은 나중에 채운다 — 신차라 번호가 아직 없는 경우와 같은 자리다.
 */
export async function createBlankContract(opt: {
  providerCompanyCode: string;
  customerName?: string;
  customerPhone?: string;
  carNumber?: string;
  vehicleName?: string;
}): Promise<string> {
  const co = getCompanyId();
  const store = getStore();
  const ag = actor('agent');

  const d = new Date();
  const p2 = (n: number) => String(n).padStart(2, '0');
  const yymmdd = `${String(d.getFullYear()).slice(2)}${p2(d.getMonth() + 1)}${p2(d.getDate())}`;
  const todays = (await store.list('contract', co))
    .filter((c) => String(c.contract_code || '').startsWith(`TMP-${yymmdd}`)).length;
  const uniq = Math.random().toString(36).slice(2, 6);
  const code = `TMP-${yymmdd}-${p2(todays + 1)}-${uniq}`;

  const parties = requireParties({
    agent_uid: ag.uid || ag.code,
    agent_channel_code: resolveChannel(ag),
    provider_company_code: opt.providerCompanyCode,
  }, '계약 생성(매물 없음)');

  await store.save('contract', co, [{
    contract_code: code,
    contract_status: '계약요청',
    contract_date: `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`,
    // 매물에서 파생하지 않았음을 남긴다 — 나중에 「왜 상품코드가 없나」를 되짚을 근거.
    contract_origin: '직접등록',
    product_code: '',
    car_number_snapshot: String(opt.carNumber || ''),
    vehicle_name_snapshot: String(opt.vehicleName || ''),
    customer_name: String(opt.customerName || ''),
    customer_phone: String(opt.customerPhone || ''),
    agent_uid: parties.agent_uid,
    agent_code: ag.code,
    agent_name: ag.name,
    agent_channel_code: parties.agent_channel_code,
    provider_company_code: parties.provider_company_code,
  }]);
  return code;
}

/**
 * 계약서관리에서 매물 없이 전자계약 초안을 만든다.
 *
 * 일반 `createBlankContract`와 달리 이 레코드는 곧바로 계약서 발행 후보가 되므로
 * 기간·월대여료·정책을 생성 시점에 함께 동결한다. 계약 스냅샷 필드는 Rules에서
 * 최초 저장 뒤 잠기므로, 빈 셸을 먼저 만들고 나중에 덧붙이는 두 단계 저장은 쓰지 않는다.
 */
export async function createDirectEsignContract(opt: {
  source?: 'excel' | 'direct';
  importTemplateId?: string;
  importAdapterId?: string;
  providerCompanyCode: string;
  policyCode: string;
  standardTemplateId?: string;
  contractKind?: string;
  maturity?: '반납형' | '인수형';
  contractDate: string;
  customerName: string;
  customerPhone: string;
  customerAddress?: string;
  customerIsBusiness?: string;
  customerCompanyName?: string;
  customerBusinessNumber?: string;
  productCode?: string;
  carNumber?: string;
  vehicleName: string;
  modelYear?: string;
  fuel?: string;
  rentMonths: number;
  rentAmount: number;
  depositAmount?: number;
  paymentTiming?: '선불' | '후불' | '';
  driverAge?: string;
  templateFields?: Record<string, string>;
}): Promise<string> {
  const source = opt.source === 'excel' ? 'excel' : 'direct';
  const providerCompanyCode = String(opt.providerCompanyCode || '').trim();
  const policyCode = String(opt.policyCode || '').trim();
  const contractDate = String(opt.contractDate || '').trim();
  const customerName = String(opt.customerName || '').trim();
  const customerPhone = String(opt.customerPhone || '').trim();
  const vehicleName = String(opt.vehicleName || '').trim();
  const rentMonths = Number(opt.rentMonths) || 0;
  const rentAmount = Number(opt.rentAmount) || 0;
  const depositAmount = Math.max(0, Number(opt.depositAmount) || 0);
  const paymentTiming = String(opt.paymentTiming || '').trim();
  if (!providerCompanyCode) throw new Error('공급사를 골라 주세요.');
  if (!policyCode) throw new Error('계약 정책을 골라 주세요.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(contractDate)) throw new Error('계약일을 확인해 주세요.');
  if (!customerName) throw new Error('고객명을 입력해 주세요.');
  if (!/^\d{10,11}$/.test(customerPhone.replace(/\D/g, ''))) throw new Error('고객 연락처를 확인해 주세요.');
  if (!vehicleName) throw new Error('차량명을 입력해 주세요.');
  if (rentMonths <= 0) throw new Error('대여기간을 입력해 주세요.');
  if (!['선불', '후불'].includes(paymentTiming)) throw new Error('대여료 선불·후불 조건을 선택해 주세요.');
  requirePositiveRentAmount(rentAmount, '계약서 생성');

  const co = getCompanyId();
  const store = getStore();
  const session = getSession();
  // 관리자 직접 계약을 데모 영업자에게 귀속시키면 고객정보가 그 영업자 목록에 노출된다.
  // 실 로그인에서는 생성한 관리자 본인으로 격리하고, 비로그인 로컬 데모만 기존 영업자 스텁을 쓴다.
  const creator = session?.role === 'admin' ? actor('admin') : actor('agent');
  const parties = requireParties({
    agent_uid: creator.uid || creator.code,
    agent_channel_code: resolveChannel(creator),
    provider_company_code: providerCompanyCode,
  }, '전자계약 직접 생성');

  const d = new Date();
  const p2 = (n: number) => String(n).padStart(2, '0');
  const yymmdd = `${String(d.getFullYear()).slice(2)}${p2(d.getMonth() + 1)}${p2(d.getDate())}`;
  const todays = (await store.list('contract', co))
    .filter((c) => String(c.contract_code || '').startsWith(`TMP-${yymmdd}`)).length;
  const uniq = Math.random().toString(36).slice(2, 6);
  const code = `TMP-${yymmdd}-${p2(todays + 1)}-${uniq}`;

  await store.save('contract', co, [{
    contract_code: code,
    contract_status: '계약요청',
    contract_date: contractDate,
    contract_origin: source === 'excel' ? '계약서엑셀등록' : '계약서직접등록',
    contract_source: source,
    esign_import_template_id: String(opt.importTemplateId || '').trim(),
    esign_import_adapter_id: String(opt.importAdapterId || '').trim(),
    product_code: String(opt.productCode || '').trim(),
    policy_code: policyCode,
    standard_template_id: String(opt.standardTemplateId || '').trim(),
    contract_kind: String(opt.contractKind || '').trim(),
    esign_maturity: String(opt.maturity || '').trim(),
    car_number_snapshot: String(opt.carNumber || '').trim(),
    vehicle_name_snapshot: vehicleName,
    rent_month_snapshot: rentMonths,
    rent_amount_snapshot: rentAmount,
    deposit_amount_snapshot: depositAmount,
    payment_timing_snapshot: paymentTiming,
    driver_age_snapshot: String(opt.driverAge || '').trim(),
    customer_name: customerName,
    customer_phone: customerPhone,
    customer_address: String(opt.customerAddress || '').trim(),
    customer_is_business: String(opt.customerIsBusiness || '').trim(),
    customer_company_name: String(opt.customerCompanyName || '').trim(),
    customer_business_number: String(opt.customerBusinessNumber || '').trim(),
    year_snapshot: String(opt.modelYear || '').trim(),
    fuel_type_snapshot: String(opt.fuel || '').trim(),
    agent_uid: parties.agent_uid,
    agent_code: creator.code,
    agent_name: creator.name,
    agent_channel_code: parties.agent_channel_code,
    provider_company_code: parties.provider_company_code,
    contract_draft: JSON.stringify(opt.templateFields || {}),
    sign_status: '미발송',
    is_draft: '예',
  }]);
  return code;
}

/** 약정 직전 — 대여기간으로 월대여료·보증금 1회 동결. 이미 굳힌 계약은 덮어쓰지 않는다. */
export async function freezeContractTerm(
  contract: EntityRecord,
  product: EntityRecord,
  period: number,
): Promise<void> {
  const code = String(contract.contract_code || '').trim();
  if (!code) throw new Error('약정 동결: 계약코드 없음');
  if (hasTermFrozen(contract)) {
    throw new Error('약정 동결: 이미 기간·금액이 확정된 계약입니다.');
  }
  const m = Number(period) || 0;
  if (m <= 0) throw new Error('약정 동결: 대여기간을 선택해 주세요.');
  const pr = priceAt(product, m);
  const rentAmount = requirePositiveRentAmount(pr?.rent, '약정 동결');
  await getStore().update('contract', getCompanyId(), code, {
    rent_month_snapshot: m,
    rent_amount_snapshot: rentAmount,
    deposit_amount_snapshot: pr?.deposit ?? 0,
  });
}
