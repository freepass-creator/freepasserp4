/**
 * 정체성·소속·귀속 해석 SSOT — 식별코드(ids.ts) 위에서 "누구/어느 조직/누가 계약/담당자"를 잇는다.
 *   · 조직 2종 = partner 엔티티가 겸함: 공급사(sup_, partner_type 공급사) · 영업채널(chn_, partner_type 영업채널).
 *   · 사람(usr_) 소속 = 영업자→agent_channel_code(chn_) / 공급사직원→company_code(sup_).  소속직원 = 그 org로 역조회.
 *   · 계약/방/공유가 다 이 resolver로 당사자를 해석 → 화면·정산·손님공유가 한 소스.
 */
import { getStore } from '@/lib/store';
import { type EntityRecord } from '@/lib/intake/entities';
import { entityCodeAliases, matchesEntityCode } from '@/lib/domain/code-identity';

export type Kind = 'user' | 'supplier' | 'channel' | 'product' | 'policy' | 'contract' | 'settlement' | 'customer' | 'unknown';
export type OrgType = 'supplier' | 'channel' | 'platform';
export type OrgRef = { id: string; type: OrgType; name: string; contact?: string };
export type AgentInfo = { id: string; name: string; contact?: string; channel: OrgRef | null };

/**
 * 공급사 명단 조회가 부분 실패해도 화면에 내부 코드가 노출되지 않게 하는 최소 안전망.
 * 이름의 정본은 partner 레코드이며, 이 표는 운영에서 실제 코드 노출이 확인된 공급사만 둔다.
 */
const PROVIDER_NAME_FALLBACKS: Readonly<Record<string, string>> = {
  RP031: '이안카',
};

/** 코드 접두사로 종류 판별(거래코드 레거시 접두사도 인식). */
export function kindOf(code: unknown): Kind {
  const s = String(code || '');
  if (s.startsWith('usr_')) return 'user';
  if (s.startsWith('sup_')) return 'supplier';
  if (s.startsWith('chn_')) return 'channel';
  if (s.startsWith('veh_')) return 'product';
  if (s.startsWith('pol_')) return 'policy';
  if (s.startsWith('con_') || s.startsWith('TMP-')) return 'contract';
  if (s.startsWith('stl_') || s.startsWith('ST_') || s.startsWith('IMP_')) return 'settlement';
  if (s.startsWith('cus_')) return 'customer';
  return 'unknown';
}

/** 사람의 소속 org 코드 — 영업자=채널, 공급사직원=회사(공급사). 신형 org_id 우선. */
export function orgIdOf(u: EntityRecord): string {
  if (u.org_id) return String(u.org_id);
  const role = String(u.role || '');
  if (role.startsWith('agent')) return String(u.agent_channel_code || '');
  if (role === 'provider') return String(u.company_code || '');
  return '';
}

/** 사람 조회 — uid 또는 user_code(동일값 권장). */
export async function getPerson(co: string, id: string): Promise<EntityRecord | null> {
  if (!id) return null;
  const users = await getStore().list('user', co);
  return users.find((u) => String(u.uid) === id || matchesEntityCode('user', u, id)) || null;
}

/** 조직 조회 — sup_/chn_ = partner 레코드. 없으면 코드 그대로 이름 fallback. */
export async function getOrg(co: string, id: string): Promise<OrgRef | null> {
  const k = kindOf(id);
  const partners = await getStore().list('partner', co);
  const p = partners.find((x) => (
    matchesEntityCode('partner', x, id)
    || String(x.company_code || '') === id
    || String(x.provider_company_code || '') === id
  ));
  if (!p && k !== 'supplier' && k !== 'channel') return null;
  const inferredType: OrgType = k === 'channel'
    || /영업|채널/.test(String(p?.partner_type || '')) ? 'channel' : 'supplier';
  const full = p ? String(p.name || id) : id;
  const alias = p ? companyAlias(full, p.alias || p.short_name || p.display_name) : id;
  return { id, type: inferredType, name: alias, contact: p?.contact ? String(p.contact) : undefined };
}

/** org 소속 직원 목록(활성 우선). */
export async function staffOf(co: string, orgId: string): Promise<EntityRecord[]> {
  if (!orgId) return [];
  const users = await getStore().list('user', co);
  return users.filter((u) => orgIdOf(u) === orgId && u.is_active !== '아니오');
}

/** 담당자(영업자) 표시정보 — 손님 상품링크 공유 헤더용(이름·연락·소속채널). */
export async function agentInfo(co: string, agentId: string): Promise<AgentInfo | null> {
  const u = await getPerson(co, agentId);
  if (!u) return null;
  const channel = await getOrg(co, orgIdOf(u));
  return { id: agentId, name: String(u.name || agentId), contact: u.contact ? String(u.contact) : undefined, channel };
}

/** 계약 당사자 해석 — 영업자(사람)+영업채널(org)+공급사(org)+고객. 스냅샷 fallback. */
export async function contractParties(co: string, c: EntityRecord): Promise<{
  agent: { id: string; name: string }; channel: OrgRef | null; supplier: OrgRef | null; customer: { id: string; name: string };
}> {
  const agentRec = await getPerson(co, String(c.agent_uid || c.agent_code || ''));
  const channel = await getOrg(co, String(c.agent_channel_code || (agentRec ? orgIdOf(agentRec) : '')));
  const supplier = await getOrg(co, String(c.provider_uid || c.provider_company_code || ''));
  return {
    agent: agentRec ? { id: String(agentRec.uid), name: String(agentRec.name || '') } : { id: String(c.agent_code || ''), name: String(c.agent_name || '') },
    channel, supplier,
    customer: { id: String(c.customer_uid || ''), name: String(c.customer_name || '') },
  };
}

/** 공급사코드 → 표시명(별칭). 명시 alias 우선, 없으면 상호에서 잡음어 제거. */
export function providerNameMap(partners: EntityRecord[]): Record<string, string> {
  const m: Record<string, string> = { ...PROVIDER_NAME_FALLBACKS };
  for (const pt of partners) {
    const full = partnerCompanyNameRaw(pt);
    if (!full && !pt.alias && !pt.short_name) continue;
    const nm = companyAlias(full, pt.alias || pt.short_name || pt.display_name);
    if (!nm) continue;
    for (const k of [...entityCodeAliases('partner', pt), pt.company_code, pt.provider_company_code]) {
      const id = String(k || '').trim();
      if (id) m[id] = nm;
    }
  }
  return m;
}

/**
 * 회사 표시 별칭 — UI·칩·엑셀 SSOT.
 * 명시 alias가 있으면 그걸 쓰고, 없으면 상호에서 주식회사·(주)·렌트카·렌터카 등을 뺀다.
 */
export function companyAlias(raw: unknown, explicit?: unknown): string {
  const ex = String(explicit ?? '').trim();
  if (ex) return ex;
  const full = String(raw ?? '').trim();
  if (!full) return '';
  let s = full;
  // 긴 토큰 먼저. 주식회사·법인격·렌트·모빌리티 접미.
  s = s.replace(/주식회사|\(주\)|㈜|㈐|유한회사|유한책임회사/g, '');
  s = s.replace(/렌터카|렌트카|모빌리티/g, '');
  s = s.replace(/[ \t\-_/·.,]+/g, ' ').trim();
  s = s.replace(/^[\s\-_/·]+|[\s\-_/·]+$/g, '');
  return s || full;
}

/**
 * ★**로마자와 한글이 갈리는 상호** — 규칙으로는 못 잇는다. 글자가 한 자도 안 겹친다.
 *   ⚠ 짐작으로 이으려 들면 엉뚱한 회사끼리 붙는다. 그래서 여기에 **적어 둔다.**
 */
const SPELL_PAIRS: [string, string][] = [['SA', '에스에이'], ['J&J', '제이앤제이'], ['KH', '케이에이치']];

/**
 * **같은 회사를 다르게 적은 이름들을 잇는 열쇠 꾸러미.**
 *
 * ★왜(2026-08-14) — 문패는 「SA렌터카」, 우리 시트 이름은 「에스에이 프리패스 재고」다.
 *   `companyAlias` 하나만 믿었더니 **있는 시트를 「없다」로 떨궜다**(SA·J&J).
 *   열쇠를 여러 개 만들어 두고 «하나만 겹쳐도 같은 회사»로 본다.
 * ⚠ 이걸 쓰는 도구가 셋이다(문패 대조·정제칸 채우기·정책 되채우기).
 *   따로 적으면 서로 다른 답을 내고, 그때부터 «어떤 도구는 찾고 어떤 도구는 못 찾는» 상태가 된다.
 */
export function supplierNameKeys(raw: unknown): Set<string> {
  const full = String(raw ?? '').trim();
  const bare = full.replace(/\(주\)|주식회사|㈜/g, '').trim();
  const short = bare.replace(/렌터카|렌트카|렌트|캐피탈|모터스/g, '').replace(/\s/g, '').trim();
  const out = new Set(
    [full, bare, short, companyAlias(full), companyAlias(bare), companyAlias(short)]
      .map((x) => String(x ?? '').trim()).filter(Boolean),
  );
  for (const k of [...out]) {
    for (const [lat, han] of SPELL_PAIRS) {
      if (k === lat) out.add(han);
      if (k === han) out.add(lat);
    }
  }
  return out;
}

/**
 * 계약서 등 정식 회사 선택 UI용 표시명.
 * 영업 별칭과 달리 렌터카·모빌리티 같은 상호 구성어는 유지하고 법인격 표기만 뺀다.
 */
export function companyNameWithoutLegalForm(raw: unknown): string {
  const full = String(raw ?? '').trim();
  if (!full) return '';
  const name = full
    .replace(/주식회사|\(\s*주\s*\)|㈜|㈐|유한회사|유한책임회사/g, '')
    .replace(/[ \t]+/g, ' ')
    .trim();
  return name || full;
}

const COMPANY_CODE = /^(?:RP|PT|SUP|CHN|ORG)[-_]?\d+$/i;

/** 파트너 레코드에서 내부 식별코드가 아닌 실제 상호 원문을 고른다. */
function partnerCompanyNameRaw(partner: EntityRecord | null | undefined): string {
  if (!partner) return '';
  const ids = new Set([
    partner._key,
    partner.partner_code,
    partner.company_code,
    partner.provider_company_code,
  ].map((value) => String(value ?? '').trim().toUpperCase()).filter(Boolean));
  for (const value of [
    partner.partner_name,
    partner.company_name,
    partner.corp_name,
    partner.business_name,
    partner.legal_name,
    partner.name,
    partner.display_name,
    partner.short_name,
    partner.alias,
  ]) {
    const candidate = String(value ?? '').trim();
    if (!candidate) continue;
    if (ids.has(candidate.toUpperCase()) || COMPANY_CODE.test(candidate)) continue;
    return candidate;
  }
  return '';
}

/** 계약·정책 회사 선택 UI에 표시할 실제 상호. 법인격만 빼고 업종명은 보존한다. */
export function partnerCompanyDisplayName(partner: EntityRecord | null | undefined): string {
  return companyNameWithoutLegalForm(partnerCompanyNameRaw(partner));
}

/** 매물에 provider_name(별칭) 부착 — 검색·칩·엑셀 표기 SSOT. 풀네임은 provider_name_full. */
export function withProviderNames(products: EntityRecord[], partners: EntityRecord[]): EntityRecord[] {
  const map = providerNameMap(partners);
  const fullByCode: Record<string, string> = {};
  for (const pt of partners) {
    const full = partnerCompanyNameRaw(pt);
    if (!full) continue;
    for (const k of [...entityCodeAliases('partner', pt), pt.company_code, pt.provider_company_code]) {
      const id = String(k || '').trim();
      if (id) fullByCode[id] = full;
    }
  }
  return products.map((p) => {
    const code = String(p.provider_company_code || p.partner_code || '').trim();
    const fromMap = code ? (map[code] || PROVIDER_NAME_FALLBACKS[code]) : '';
    const existing = String(p.provider_name || p.provider_company_name || '').trim();
    const full = (code && fullByCode[code]) || (existing && existing !== code ? existing : '') || '';
    const raw = fromMap || (existing && existing !== code ? existing : '') || code;
    const name = companyAlias(raw);
    const fullOut = full && full !== name ? full : '';
    if (String(p.provider_name || '') === name && String(p.provider_name_full || '') === fullOut) return p;
    return fullOut ? { ...p, provider_name: name, provider_name_full: fullOut } : { ...p, provider_name: name };
  });
}
