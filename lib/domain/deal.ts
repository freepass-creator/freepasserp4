/**
 * 딜 도메인 — 소통(room·message)·계약(contract) 생성. erp3 검증 모델 이식.
 *   방 = 매물 × 영업자 결정키 CH_{매물}_{영업자} (2자: 영업자↔공급사, 관리자 오버시어).
 *   계약 = TMP-YYMMDD-NN 가계약 채번 + *_snapshot + 계약요청.
 * 로컬 세션 스텁: 실인증 전까지 역할·행위자를 localStorage로(3자 대화 테스트).
 */
import { getStore } from '@/lib/store';
import { getCompanyId } from '@/lib/tenant';
import { type EntityRecord, ROLE_LABEL_RAW } from '@/lib/intake/entities';
import { vehicleName, priceAt, creditDisplay } from '@/lib/domain/product';
import { resolveRates } from '@/lib/domain/settlement-engine';
import { getSession } from '@/lib/auth-session';
import { BRAND_MAIN } from '@/lib/brand';

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
// 역할: 실 로그인 세션 우선 → 없으면(둘러보기/로컬) localStorage 스텁.
export function getRole(): Role { const s = getSession(); if (s) return s.role; if (typeof window === 'undefined') return 'agent'; const r = localStorage.getItem(RKEY); return r === 'provider' || r === 'admin' ? r : 'agent'; }
export function setRole(r: Role): void { if (typeof window !== 'undefined') { localStorage.setItem(RKEY, r); window.dispatchEvent(new CustomEvent('fp:role', { detail: r })); } }
// 행위자: 세션 역할이 요청 역할과 같으면 실 사용자(귀속코드) → 아니면 데모 스텁.
// 영업자 code = 사람키(user_code). 채널은 session.agent_channel_code 로만.
export function actor(r: Role): { uid: string; code: string; name: string; channel?: string } {
  const s = getSession();
  if (s && s.role === r) {
    const code = r === 'agent'
      ? (s.user_code || s.code || ACTORS.agent.code)
      : (s.code || ACTORS[r].code);
    return {
      uid: s.uid,
      code,
      name: s.name || ACTORS[r].name,
      channel: s.agent_channel_code || undefined,
    };
  }
  return { ...ACTORS[r], channel: r === 'agent' ? 'chn_seoul' : undefined };
}

/** 채팅 표기명 — 역할 라벨 없이. 관리자=`freepass.이름`, 그 외=유저코드(없으면 이름). */
export function chatDisplayName(role: Role | string, name: string, code?: string): string {
  if (role === 'admin') {
    const n = String(name || '').trim();
    return n ? `${BRAND_MAIN}.${n}` : BRAND_MAIN;
  }
  return String(code || name || '').trim();
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

/** 방 보장 — 매물×문의자 결정키. 없으면 스냅샷과 함께 생성. asker 미지정=영업자(계약문의 경로). 관리자 간단문의 등은 asker=본인. */
export async function ensureRoom(product: EntityRecord, asker?: { uid: string; code: string; name: string; channel?: string }): Promise<string> {
  const co = getCompanyId();
  const store = getStore();
  const ag = asker || actor('agent'); // 기본=로그인 영업자(계약문의 방과 동일). 간단문의는 남기는 당사자(영업자·관리자)로 귀속.
  const roomKey = `CH_${product.product_code}_${ag.code}`;
  if (await store.get('room', co, roomKey)) return roomKey;
  const parties = requireParties({
    agent_uid: ag.uid,
    agent_channel_code: resolveChannel(ag),
    provider_company_code: product.provider_company_code,
  }, '방 생성');
  await store.save('room', co, [{
    _key: roomKey, room_code: roomKey,
    product_uid: String(product.product_code), product_code: String(product.product_code),
    car_number: product.car_number, vehicle_name: vehicleName(product),
    agent_uid: parties.agent_uid, agent_code: ag.code, agent_name: ag.name,
    agent_channel_code: parties.agent_channel_code,
    provider_company_code: parties.provider_company_code,
    last_message: '', last_message_at: 0,
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
      car_number: c.car_number_snapshot, vehicle_name: [c.maker_snapshot, c.sub_model_snapshot].filter(Boolean).join(' '),
      agent_uid: parties.agent_uid, agent_code: c.agent_code, agent_name: c.agent_name,
      agent_channel_code: parties.agent_channel_code,
      provider_company_code: parties.provider_company_code, linked_contract: c.contract_code,
      last_message: '', last_message_at: 0,
    }]);
  }
  return roomKey;
}

/** 가계약 생성 — TMP-YYMMDD-NN 채번 + 스냅샷 + 계약요청. */
export async function createContractRequest(product: EntityRecord, opt: { period: number; customerName: string; customerPhone: string }, roomId?: string, deliveryResponse?: string): Promise<string> {
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
  const pr = priceAt(product, opt.period);
  const { feeRate, payoutRate } = await resolveRates({ provider_company_code: product.provider_company_code, agent_code: ag.code }, product); // 율 계약시점 동결
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
    product_code: product.product_code, car_number_snapshot: product.car_number, maker_snapshot: product.maker, sub_model_snapshot: product.sub_model,
    rent_month_snapshot: opt.period, rent_amount_snapshot: pr?.rent ?? 0, deposit_amount_snapshot: pr?.deposit ?? 0,
    customer_name: opt.customerName, customer_phone: opt.customerPhone,
    agent_uid: parties.agent_uid, agent_code: ag.code, agent_name: ag.name, agent_channel_code: parties.agent_channel_code,
    provider_company_code: parties.provider_company_code,
    credit_grade_snapshot: creditDisplay(product), fee_rate_snapshot: feeRate, payout_rate_snapshot: payoutRate,
    // 출고문의를 소통에서 이미 마쳤으면 계약 1단계(출고문의·출고응답) 프리필 → 계약 진행은 서류부터.
    ...(deliveryResponse ? { agent_delivery_inquiry: 'yes', provider_delivery_response: deliveryResponse } : {}),
  }]);
  if (roomId) await store.update('room', co, roomId, { linked_contract: code });
  return code;
}
