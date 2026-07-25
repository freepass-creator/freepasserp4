import type { EntityRecord } from '@/lib/intake/entities';

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
      const code = record.product_code || childKey;
      const policy = record._policy || (record.policy_code && joinMap ? (joinMap[record.policy_code as string] as unknown) : undefined);
      return { ...base, _key: String(code), product_code: code, product_uid: record.product_uid || childKey, _policy: policy,
        photos: record.photos || record.image_urls || record.images || record.doc_images,
        photo: record.photo || record.image_url || (Array.isArray(record.photos) ? record.photos[0] : undefined) } as EntityRecord;
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
