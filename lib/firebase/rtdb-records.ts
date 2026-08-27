import type { EntityRecord } from '@/lib/intake/entities';
import { applyPolicyDefaults } from '@/lib/domain/policy-defaults';

export type RtdbRecord = Record<string, unknown>;

function fileNameFromUrl(url: string): string {
  try {
    const bare = decodeURIComponent(String(url).split('?')[0] || '');
    const objectMatch = bare.match(/\/o\/(.+)$/);
    const path = objectMatch ? decodeURIComponent(objectMatch[1]) : bare;
    const base = path.split('/').filter(Boolean).pop() || '';
    if (base && !/^https?:$/i.test(base)) return base;
  } catch { /* ignore malformed encoding */ }
  return '첨부파일';
}

const looksLikeUrl = (value: string) => /^https?:\/\//i.test(value) || /firebasestorage\.googleapis/i.test(value);
const guessAttachmentType = (value: string) => {
  if (/\.(jpe?g|png|gif|webp|bmp)(\?|$)/i.test(value)) return 'image/jpeg';
  if (/\.pdf(\?|$)/i.test(value)) return 'application/pdf';
  return '';
};

export function normalizeAttachment(raw: unknown): RtdbRecord | null {
  if (raw == null) return null;
  if (typeof raw === 'string') {
    const url = raw.trim();
    return url ? { url, name: fileNameFromUrl(url), size: 0, type: guessAttachmentType(url), at: 0 } : null;
  }
  if (typeof raw !== 'object') return null;
  const data = raw as RtdbRecord;
  if (data._deleted) return null;
  let url = String(data.url || data.downloadURL || data.href || data.src || '').trim();
  let name = String(data.name || data.file_name || data.filename || data.original_name || data.title || '').trim();
  if (!url && looksLikeUrl(name)) url = name;
  if (!name || looksLikeUrl(name)) name = url ? fileNameFromUrl(url) : '첨부파일';
  const sizeValue = Number(data.size ?? data.bytes ?? data.file_size ?? data.byteSize);
  const atValue = Number(data.at || data.created_at || data.uploaded_at || data.ts || data.time);
  return {
    ...data,
    url,
    name,
    size: Number.isFinite(sizeValue) && sizeValue > 0 ? sizeValue : 0,
    type: String(data.type || data.contentType || data.mime || guessAttachmentType(name) || guessAttachmentType(url) || ''),
    at: Number.isFinite(atValue) && atValue > 0 ? atValue : 0,
  };
}

export function attachmentsOf(record: RtdbRecord): RtdbRecord[] {
  const output: RtdbRecord[] = [];
  const append = (raw: unknown) => {
    const attachment = normalizeAttachment(raw);
    if (attachment) output.push(attachment);
  };
  if (Array.isArray(record.attachments)) {
    record.attachments.forEach(append);
    return output;
  }
  if (Array.isArray(record.doc_attachments)) record.doc_attachments.forEach(append);
  if (record.customer_docs && typeof record.customer_docs === 'object') {
    Object.values(record.customer_docs).forEach(append);
  }
  return output;
}

export function toV4Record(entity: string, childKey: string, record: RtdbRecord, companyId: string, joinMap?: RtdbRecord): EntityRecord {
  const base: RtdbRecord = { ...record, companyId };
  switch (entity) {
    case 'product': {
      const code = String(record.product_code || childKey);
      const linkedPolicy = record._policy || (record.policy_code && joinMap ? (joinMap[record.policy_code as string] as unknown) : undefined);
      /**
       * ★**정책이 안 붙었으면 채우지 않는다**(사장님 2026-08-07 「없으면 없다 · 미입력이면
       *   미입력이다 · 차라리 대여료만 맞게 보여주는 게 낫지」).
       *
       * 전에는 미연결 상품도 `applyPolicyDefaults({})` 로 프리패스 표준을 통째로 얹었다.
       * 그런데 절연 뒤 매물이 든 옛 `policy_code`(pol_xxx)가 새 정책 키(FP-RP0xx-RENT)와
       * 안 맞아 **816대 전부 미연결**이었고, 그래서 화면이 816대에 똑같은 조건을 보였다 —
       * 그 공급사가 주지도 않은 조건을. 영업자가 그걸 손님에게 그대로 말하면 없는 약속을 한다.
       * **빈칸보다 나쁘다**: 빈칸은 물어보게 만들지만 지어낸 값은 안 물어보게 만든다.
       *
       * 연결된 정책에는 그대로 기본값을 얹는다 — 공급사 정책에 «표준을 따른다»는 뜻이 있고,
       * 빈칸을 일부러 비운 정책은 `policy_default_pack` 이 지켜 준다(applyPolicyDefaults 참고).
       */
      const policy = linkedPolicy && typeof linkedPolicy === 'object'
        ? applyPolicyDefaults(linkedPolicy as RtdbRecord).next
        : {};
      // product_uid = erp3 원본 키(EXT_/PD*/pushId). v4 오버레이는 childKey===product_code 이라
      //  여기서 childKey를 uid로 채우면 라이브 EXT uid를 덮어 문의방 조인이 끊긴다.
      const uidExplicit = record.product_uid != null && String(record.product_uid).trim() !== ''
        ? String(record.product_uid)
        : '';
      const uidFromKey = String(childKey) !== code ? String(childKey) : '';
      const product_uid = uidExplicit || uidFromKey;
      const row: RtdbRecord = {
        ...base,
        _key: code,
        product_code: code,
        _policy: policy,
        photos: record.photos || record.image_urls || record.images || record.doc_images,
        photo: record.photo || record.image_url || (Array.isArray(record.photos) ? record.photos[0] : undefined),
      };
      // 쓸모없는 product_uid(=product_code 메아리)는 제거 — 오버레이 병합 시 라이브 EXT/PD uid를 덮지 않게.
      if (product_uid && product_uid !== code) row.product_uid = product_uid;
      else delete row.product_uid;
      if (uidFromKey) row._rtdb_key = uidFromKey;
      return row as EntityRecord;
    }
    case 'policy': { const code = record.policy_code || childKey; return { ...base, _key: String(code), policy_code: code } as EntityRecord; }
    case 'partner': { const code = record.partner_code || childKey; return { ...base, _key: String(code), partner_code: code, name: record.name || record.partner_name || record.company_name || code } as EntityRecord; }
    case 'user': { const code = record.uid || childKey; return { ...base, _key: String(code), uid: code, user_code: record.user_code || code, agent_channel_code: record.agent_channel_code || record.company_code || '', name: record.name || record.email || '' } as EntityRecord; }
    case 'contract': { const code = record.contract_code || childKey; return { ...base, _key: String(code), contract_code: code, attachments: attachmentsOf(record) } as EntityRecord; }
    case 'room': return { ...base, _key: childKey, room_code: record.room_code || childKey, car_number: record.car_number || record.vehicle_number || '', vehicle_name: record.vehicle_name || [record.maker, record.model, record.sub_model, record.trim_name].filter(Boolean).join(' ') } as EntityRecord;
    case 'settlement': {
      const code = record.settlement_code || childKey;
      const contract = joinMap?.[String(record.contract_code)] as RtdbRecord | undefined;
      return { ...base, _key: String(code), settlement_code: code, contract_date: record.contract_date || contract?.contract_date || '' } as EntityRecord;
    }
    default: return { ...base, _key: String(record._key || childKey) } as EntityRecord;
  }
}

/**
 * RTDB v3 원본과 v4 overlay를 저장 child key가 아니라 앱의 논리키로 병합한다.
 * 특히 상품은 v3 `EXT_*` child가 `product_code=RP006_차번`일 수 있으므로 child key로
 * 합치면 같은 상품을 활성 중복으로 오판한다. 실제 RtdbStore.merged()와 같은 순서다.
 */
export function mergeV3V4Records(
  entity: string,
  v3: unknown,
  v4: unknown,
  companyId = 'freepass',
  joinMap?: RtdbRecord,
): EntityRecord[] {
  const normalized = (raw: unknown): EntityRecord[] => Object.entries(
    (raw || {}) as Record<string, RtdbRecord>,
  ).flatMap(([childKey, record]) => (
    record && typeof record === 'object' && !Array.isArray(record)
      ? [toV4Record(entity, childKey, record, companyId, joinMap)]
      : []
  ));
  const merged = new Map<string, EntityRecord>();
  for (const row of normalized(v3)) merged.set(String(row._key), row);
  for (const row of normalized(v4)) {
    const key = String(row._key);
    const current: EntityRecord = { ...(merged.get(key) || {}) };
    for (const [field, value] of Object.entries(row)) if (value !== undefined) current[field] = value;
    merged.set(key, current);
  }
  return [...merged.values()];
}
