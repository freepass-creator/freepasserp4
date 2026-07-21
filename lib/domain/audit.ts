/**
 * 감사로그 SSOT — 전 엔티티 write 관장(매물·대여료·계약·정산·채팅·회원…).
 * store 어댑터가 buildAuditEntry로 기록. audit_log 자신만 제외.
 */
import { type EntityRecord } from '@/lib/intake/entities';
import {
  SNAP_TRACK_KEYS,
  SNAP_TRACK_LABEL,
  vehicleIdentityLine,
  type SnapTrackKey,
} from '@/lib/domain/vehicle-master-match';

export type AuditChange = { key: string; label: string; from: string; to: string };

/** 감사 화면 카테고리 — 필터용. */
export type AuditDomain = 'product' | 'price' | 'contract' | 'settlement' | 'chat' | 'policy' | 'member' | 'other' | 'snap';

export const AUDIT_DOMAIN_OPTS: { key: string; label: string }[] = [
  { key: '', label: '전체' },
  { key: 'product', label: '매물' },
  { key: 'price', label: '대여료' },
  { key: 'contract', label: '계약' },
  { key: 'settlement', label: '정산' },
  { key: 'chat', label: '채팅' },
  { key: 'policy', label: '정책' },
  { key: 'member', label: '회원·파트너' },
  { key: 'snap', label: '차종변환' },
];

const FIELD_LABEL: Record<string, string> = {
  ...Object.fromEntries(SNAP_TRACK_KEYS.map((k) => [k, SNAP_TRACK_LABEL[k as SnapTrackKey]])),
  catalog_id: '카탈로그',
  car_number: '차량번호',
  vehicle_status: '출고상태',
  product_type: '매물구분',
  mileage: '주행',
  price: '대여료',
  deposit_free: '무보증',
  policy_code: '정책',
  options: '옵션',
  event_tags: '행사',
  photos: '사진',
  partner_memo: '메모',
  _snap_confidence: '매칭신뢰',
  _needs_master_review: '검수필요',
  _snapped: '변환됨',
  // 계약
  contract_status: '계약상태',
  contract_code: '계약코드',
  customer_name: '계약자',
  rent_month_snapshot: '대여기간',
  rent_amount_snapshot: '월대여료',
  deposit_amount_snapshot: '보증금',
  car_number_snapshot: '차량번호',
  sub_model_snapshot: '차종',
  sign_status: '서명',
  step_check: '진행체크',
  // 정산
  settlement_status: '정산상태',
  fee_amount: '수수료',
  payout_amount: '지급액',
  clawback_amount: '환수액',
  // 채팅
  text: '메시지',
  room_id: '방',
  sender_name: '발신',
  sender_role: '역할',
  channel: '채널',
  image_url: '이미지',
  file_name: '파일',
  last_message: '마지막말',
  // 정책·회원
  policy_name: '정책명',
  fee_rate: '수수료율',
  payout_rate: '지급율',
  credit_grade: '심사',
  name: '이름',
  partner_type: '유형',
  sheet_url: '시트URL',
};

const ROOM_NOISE = new Set([
  'unread_for_agent', 'unread_for_provider', 'unread_for_admin',
  'last_read_at_agent', 'last_read_at_provider', 'last_read_at_admin',
  'last_message', 'last_message_at', 'last_sender_role', 'last_sender_code', 'last_sender_name',
  'updatedAt',
]);

const META_SKIP = new Set([
  'companyId', 'createdAt', 'createdBy', 'updatedAt', 'deletedAt', 'deletedReason',
  '_raw_vehicle', '_snap_history', '_key',
]);

function fmtVal(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'object') {
    try { return JSON.stringify(v).slice(0, 160); } catch { return '[obj]'; }
  }
  return String(v).trim();
}

function fmtWon(n: unknown): string {
  const x = Number(n);
  if (!Number.isFinite(x)) return String(n ?? '');
  return x.toLocaleString('ko-KR') + '원';
}

/** 대여료 price 맵 diff — "36개월 45만→48만" 형태. */
export function priceChanges(before: unknown, after: unknown): AuditChange[] {
  const b = (before && typeof before === 'object') ? before as Record<string, { rent?: number; deposit?: number }> : {};
  const a = (after && typeof after === 'object') ? after as Record<string, { rent?: number; deposit?: number }> : {};
  const keys = new Set([...Object.keys(b), ...Object.keys(a)]);
  const out: AuditChange[] = [];
  for (const k of [...keys].sort((x, y) => Number(x) - Number(y) || x.localeCompare(y))) {
    const br = b[k]?.rent, ar = a[k]?.rent;
    const bd = b[k]?.deposit, ad = a[k]?.deposit;
    if (br !== ar) {
      out.push({
        key: `price.${k}.rent`,
        label: `${k}개월 대여료`,
        from: br != null ? fmtWon(br) : '—',
        to: ar != null ? fmtWon(ar) : '—',
      });
    }
    if (bd !== ad) {
      out.push({
        key: `price.${k}.deposit`,
        label: `${k}개월 보증금`,
        from: bd != null ? fmtWon(bd) : '—',
        to: ad != null ? fmtWon(ad) : '—',
      });
    }
  }
  return out;
}

function labelOf(k: string): string {
  return FIELD_LABEL[k] || k;
}

/** before→after 필드 diff. */
export function fieldChanges(before: EntityRecord | null, after: EntityRecord | null, limit = 40): AuditChange[] {
  if (!after) return [];
  const keys = new Set<string>();
  if (before) for (const k of Object.keys(before)) keys.add(k);
  for (const k of Object.keys(after)) keys.add(k);

  const out: AuditChange[] = [];
  // 대여료는 전용 분해
  if (keys.has('price') && !same(before?.price, after.price)) {
    out.push(...priceChanges(before?.price, after.price));
    keys.delete('price');
  }

  for (const k of keys) {
    if (META_SKIP.has(k)) continue;
    if (k.startsWith('_') && !k.startsWith('_snap') && k !== '_needs_master_review' && k !== '_snapped') continue;
    const from = before ? fmtVal(before[k]) : '';
    const to = fmtVal(after[k]);
    if (from === to) continue;
    // 긴 본문은 잘라 표시
    const clip = (s: string) => (s.length > 120 ? s.slice(0, 117) + '…' : s);
    out.push({ key: k, label: labelOf(k), from: clip(from) || '—', to: clip(to) || '—' });
    if (out.length >= limit) break;
  }
  return out;
}

function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; }
}

/**
 * 방 unread/last_message만 바뀐 갱신 = 채팅 전송의 부산물 → 메시지 로그로 충분, 스킵.
 */
export function shouldSkipAudit(
  entityKey: string,
  action: string,
  before: EntityRecord | null,
  after: EntityRecord | null,
): boolean {
  if (entityKey === 'audit_log') return true;
  if (entityKey === 'room' && action === 'update' && before && after) {
    const ch = fieldChanges(before, after, 50);
    if (!ch.length) return true;
    if (ch.every((c) => ROOM_NOISE.has(c.key) || c.key.startsWith('unread_'))) return true;
  }
  return false;
}

export function auditDomainOf(log: EntityRecord): AuditDomain {
  if (log.action === 'master_snap') return 'snap';
  const ent = String(log.entity || '');
  if (ent === 'message' || log.action === 'chat') return 'chat';
  if (ent === 'contract') return 'contract';
  if (ent === 'settlement' || ent === 'admin_settlement') return 'settlement';
  if (ent === 'policy') return 'policy';
  if (ent === 'partner' || ent === 'user' || ent === 'customer') return 'member';
  if (ent === 'product') {
    const ch = parseAuditChanges(log);
    if (ch.some((c) => c.key === 'price' || c.key.startsWith('price.'))) return 'price';
    if (String(log.summary || '').includes('→') && ch.some((c) => ['maker', 'model', 'sub_model'].includes(c.key))) return 'snap';
    return 'product';
  }
  if (ent === 'room') return 'chat';
  return 'other';
}

export function auditSummary(entity: string, action: string, before: EntityRecord | null, after: EntityRecord | null, extra?: string): string {
  if (extra) return extra;
  const a = after || before || {};
  if (entity === 'message') {
    const who = String(a.sender_name || a.sender_role || '?');
    const text = String(a.text || a.file_name || (a.image_url ? '(이미지)' : '') || '').slice(0, 80);
    const room = String(a.room_id || '');
    const ch = a.channel ? `[${a.channel}] ` : '';
    return `${ch}${who}: ${text}${room ? ` · ${room}` : ''}`.slice(0, 200);
  }
  if (entity === 'product' && after) {
    const id = String(after.car_number || after.product_code || '');
    const line = vehicleIdentityLine(after);
    if (before && !same(before.price, after.price)) {
      const pc = priceChanges(before.price, after.price);
      const tip = pc.slice(0, 2).map((c) => `${c.label} ${c.from}→${c.to}`).join(', ');
      return `대여료 · ${id} · ${tip || line}`.slice(0, 200);
    }
    if (before && (String(before.maker) !== String(after.maker) || String(before.model) !== String(after.model) || String(before.sub_model) !== String(after.sub_model))) {
      return `차종 · ${id} · ${vehicleIdentityLine(before)} → ${line}`.slice(0, 200);
    }
    if (before && String(before.vehicle_status) !== String(after.vehicle_status)) {
      return `상태 · ${id} · ${before.vehicle_status || '—'} → ${after.vehicle_status || '—'}`.slice(0, 200);
    }
    return `${action} · ${id} · ${line}`.slice(0, 200);
  }
  if (entity === 'contract' && after) {
    return `${after.contract_status || action} · ${after.customer_name || ''} · ${after.car_number_snapshot || after.contract_code || ''}`.slice(0, 200);
  }
  if (entity === 'settlement' && after) {
    return `${after.settlement_status || action} · ${after.contract_code || after._key || ''}`.slice(0, 200);
  }
  if (entity === 'policy' && after) {
    return `${after.policy_name || after.policy_code || action}`.slice(0, 200);
  }
  if (entity === 'partner' && after) {
    return `${after.name || after.partner_name || after.partner_code || action}`.slice(0, 200);
  }
  if (entity === 'room' && after) {
    return `방 · ${after.car_number || after.product_code || after._key || ''}`.slice(0, 200);
  }
  return `${action} · ${entity}`;
}

/** store 어댑터 공용 감사 레코드. null = 스킵. */
export function buildAuditEntry(
  entityKey: string,
  companyId: string,
  key: string,
  action: string,
  before: EntityRecord | null,
  after: EntityRecord | null,
  actor: { uid: string; role: string; name: string },
  opts?: { summary?: string },
): EntityRecord | null {
  if (shouldSkipAudit(entityKey, action, before, after)) return null;

  let act = action;
  if (entityKey === 'message' && action === 'create') act = 'chat';

  const changes = fieldChanges(before, after);
  const summary = auditSummary(entityKey, act, before, after, opts?.summary);

  // 메시지 create — 본문 중심으로 짧게
  if (entityKey === 'message' && after) {
    return {
      _key: `AL-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      entity: entityKey,
      target_key: key,
      action: act,
      companyId,
      at: Date.now(),
      actor_uid: actor.uid,
      actor_role: actor.role,
      actor_name: actor.name,
      summary,
      room_id: after.room_id,
      changes: changes.length ? changes : [{
        key: 'text', label: '메시지', from: '—',
        to: String(after.text || after.file_name || '(첨부)').slice(0, 160),
      }],
      before: '',
      after: JSON.stringify({
        room_id: after.room_id,
        text: after.text,
        sender_name: after.sender_name,
        channel: after.channel,
      }).slice(0, 800),
    };
  }

  return {
    _key: `AL-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    entity: entityKey,
    target_key: key,
    action: act,
    companyId,
    at: Date.now(),
    actor_uid: actor.uid,
    actor_role: actor.role,
    actor_name: actor.name,
    summary,
    changes,
    before: before ? JSON.stringify(before).slice(0, 1200) : '',
    after: after ? JSON.stringify(after).slice(0, 1200) : '',
  };
}

/** 일괄 차종변환 요약 로그. */
export function buildMasterSnapBulkEntry(
  companyId: string,
  patches: { key: string; patch: EntityRecord }[],
  actor: { uid: string; role: string; name: string },
): EntityRecord {
  const samples = patches.slice(0, 30).map(({ key, patch }) => {
    const raw = patch._raw_vehicle && typeof patch._raw_vehicle === 'object' ? patch._raw_vehicle as EntityRecord : null;
    const from = raw ? vehicleIdentityLine(raw) : '—';
    const to = vehicleIdentityLine(patch);
    return `${key}: ${from} → ${to}`;
  });
  return {
    _key: `AL-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    entity: 'product',
    target_key: `bulk:${patches.length}`,
    action: 'master_snap',
    companyId,
    at: Date.now(),
    actor_uid: actor.uid,
    actor_role: actor.role,
    actor_name: actor.name,
    summary: `차종마스터 변환 ${patches.length}건`,
    samples,
    changes: [] as AuditChange[],
    before: '',
    after: JSON.stringify({ count: patches.length, samples: samples.slice(0, 8) }).slice(0, 800),
  };
}

/** 저장된 로그에서 변경목록 복원. */
export function parseAuditChanges(log: EntityRecord): AuditChange[] {
  if (Array.isArray(log.changes) && log.changes.length) {
    return (log.changes as AuditChange[]).filter((c) => c && c.key);
  }
  try {
    const b = log.before ? JSON.parse(String(log.before)) as EntityRecord : null;
    const a = log.after ? JSON.parse(String(log.after)) as EntityRecord : null;
    return fieldChanges(b, a);
  } catch { return []; }
}
