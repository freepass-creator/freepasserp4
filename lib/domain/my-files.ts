/**
 * 내가 올린 파일 모음 — 설정 «내 문서»(읽기 전용).
 *
 * 왜 RTDB 를 훑는가:
 *   Storage Rules 가 목록 열람을 막아 둔다(storage.rules:60 — 업로더가 파일 «하나»를 읽을 수만 있다).
 *   그래서 버킷을 나열할 수 없고, 업로드 때 남은 RTDB 메타데이터에서 모아야 한다.
 *
 * 누가 올렸는지 판정:
 *   저장 경로가 erp/{회사}/{종류}/{대상}/{업로더uid}/{파일} 이라 storage_path 에서 uid 를 꺼낸다.
 *   계약 서류 레코드에는 업로더 필드가 없어서(ContractDocs 의 doc 모양) 이 방법이 유일하게 셋을 다 덮는다.
 *   경로가 없는 레거시(메시지)만 sender_uid 로 보완한다.
 *
 * ⚠ 읽기 전용이다. 여기서 삭제를 열지 말 것 —
 *   계약에 붙은 서류를 설정에서 지우면 그 계약의 서류함이 깨진다.
 */
import { getStore } from '@/lib/store';
import { getCompanyId } from '@/lib/tenant';
import type { EntityRecord } from '@/lib/intake/entities';

export type MyFileKind = 'chat' | 'contract' | 'product';

export type MyFile = {
  id: string;
  kind: MyFileKind;
  name: string;
  size: number;
  type: string;
  at: number;
  url: string;
  /** 어디에 올렸는지 — 방·계약·매물 코드 */
  ownerLabel: string;
};

export const MY_FILE_KIND_LABEL: Record<MyFileKind, string> = {
  chat: '상담',
  contract: '계약',
  product: '매물',
};

/** erp/{회사}/{종류}/{대상}/{업로더uid}/{파일} → 업로더 uid. 형식이 다르면 빈 문자열. */
export function uploaderFromPath(storagePath: unknown): string {
  const parts = String(storagePath ?? '').split('/');
  // [erp, companyId, kind, entityId, uid, fileName]
  return parts.length >= 6 && parts[0] === 'erp' ? String(parts[4] || '') : '';
}

function kindFromPath(storagePath: unknown): MyFileKind | null {
  const k = String(storagePath ?? '').split('/')[2];
  return k === 'chat' || k === 'contract' || k === 'product' ? k : null;
}

const text = (v: unknown) => String(v ?? '').trim();
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0; };
const looksLikeUrl = (s: string) => /^https?:\/\//i.test(s);

function nameFromUrl(url: string): string {
  try {
    const last = new URL(url).pathname.split('/').pop() || '';
    return decodeURIComponent(last).replace(/^\d+_[0-9a-f]{6,}_/i, '') || '첨부파일';
  } catch { return '첨부파일'; }
}

/** 메시지 1건 → 내 파일 (첨부가 없으면 null) */
function fromMessage(m: EntityRecord, uid: string): MyFile | null {
  const url = text(m.image_url) || text(m.file_url);
  if (!url) return null;
  const owner = uploaderFromPath(m.storage_path) || text(m.sender_uid);
  if (owner !== uid) return null;
  const raw = text(m.file_name);
  const name = raw && !looksLikeUrl(raw) ? raw : (m.image_url ? '상담 사진' : nameFromUrl(url));
  return {
    id: `msg:${text(m._key)}`,
    kind: 'chat',
    name,
    size: num(m.file_size),
    type: text(m.file_type) || (m.image_url ? 'image/*' : ''),
    at: num(m.created_at),
    url,
    ownerLabel: text(m.room_id),
  };
}

/** 레코드에 배열로 붙은 서류(계약·매물) → 내 파일 */
function fromDocList(rec: EntityRecord, field: string, kind: MyFileKind, uid: string, label: string): MyFile[] {
  const raw = (rec as Record<string, unknown>)[field];
  const list = Array.isArray(raw) ? raw : [];
  const out: MyFile[] = [];
  list.forEach((d, i) => {
    if (!d || typeof d !== 'object') return;
    const doc = d as Record<string, unknown>;
    if (uploaderFromPath(doc.storage_path) !== uid) return;   // 업로더 판정은 경로가 유일한 근거
    const url = text(doc.url) || text(doc.downloadURL);
    if (!url) return;
    const raw2 = text(doc.name) || text(doc.file_name);
    out.push({
      id: `${kind}:${text(rec._key)}:${i}`,
      kind: kindFromPath(doc.storage_path) || kind,
      name: raw2 && !looksLikeUrl(raw2) ? raw2 : nameFromUrl(url),
      size: num(doc.size) || num(doc.file_size),
      type: text(doc.type) || text(doc.file_type),
      at: num(doc.at) || num(doc.uploaded_at),
      url,
      ownerLabel: label,
    });
  });
  return out;
}

/**
 * 내가 올린 파일 전부. 권한 스코프가 적용된 store 만 쓰므로
 * 애초에 볼 수 없는 방·계약의 파일은 목록에 들어오지 않는다.
 */
export async function listMyFiles(uid: string): Promise<MyFile[]> {
  const me = String(uid || '').trim();
  if (!me) return [];
  const co = getCompanyId();
  const store = getStore();

  const [messages, contracts] = await Promise.all([
    store.list('message', co).catch(() => [] as EntityRecord[]),
    store.list('contract', co).catch(() => [] as EntityRecord[]),
  ]);

  const out: MyFile[] = [];
  for (const m of messages) {
    const f = fromMessage(m, me);
    if (f) out.push(f);
  }
  for (const c of contracts) {
    const label = text(c.contract_code) || text(c._key);
    out.push(...fromDocList(c, 'docs', 'contract', me, label));
  }
  return out.sort((a, b) => b.at - a.at);
}
