/**
 * 메시징 도메인 SSOT — 전송·안읽음·열람. UI(ChatThread·SimpleInquiry)는 이 API만 호출.
 * 채널: '간단'(상세 간단문의) | '정식'(계약문의). 같은 방(CH_매물_문의자)에 공존.
 *
 * 안읽음 = 상대가 보냈는데 내가 아직 열람(확인) 안 한 것(역할 무관 · 내 필드만).
 *   · 카운터 unread_for_{role} + last_read_at_{role}
 *   · v3 레거시(카운터 없음) = 마지막 말이 상대이고 내가 안 열람 → 최소 1
 */
import { getStore, type StoreAdapter } from '@/lib/store';
import { getCompanyId } from '@/lib/tenant';
import { type EntityRecord } from '@/lib/intake/entities';
import { actor, getRole, type Role } from '@/lib/domain/deal';
import { deleteManagedFile, uploadManagedFile } from '@/lib/firebase/storage-files';

export type MsgChannel = '간단' | '정식';

function unreadField(role: Role): 'unread_for_agent' | 'unread_for_provider' | 'unread_for_admin' {
  if (role === 'provider') return 'unread_for_provider';
  if (role === 'admin') return 'unread_for_admin';
  return 'unread_for_agent';
}

function lastReadField(role: Role): 'last_read_at_agent' | 'last_read_at_provider' | 'last_read_at_admin' {
  if (role === 'provider') return 'last_read_at_provider';
  if (role === 'admin') return 'last_read_at_admin';
  return 'last_read_at_agent';
}

function sideOf(role: Role | string): 'agent' | 'provider' | 'admin' {
  if (role === 'provider') return 'provider';
  if (role === 'admin') return 'admin';
  return 'agent';
}

function notifyUnread() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('fp:unread'));
  }
}

/**
 * 상대방 안읽음만 +1.
 *   보낸 사람 제외 전 역할(+관리자). 내가 보낸 건 내 안읽음에 안 잡힘.
 *
 * ★안읽음은 **사람이 아니라 편(側) 단위**다 — 공급사·관리자는 여러 명이 한 편이다.
 *   직원 누구라도 답을 달면 그 편에는 더 이상 «안 읽은 말»이 없다. 그래서 보내는 순간
 *   보낸 편의 카운터를 0으로 내리고 열람시각도 지금으로 올린다.
 *   (방을 열면 markRead 가 같은 일을 하지만, 그 쓰기가 실패했거나 목록에서 바로 답하는 경로가
 *    생기면 카운터가 남는다. «썼다 = 읽었다»를 보내는 쪽에서 한 번 더 못 박는다.)
 */
function bumpUnreadPatch(rm: EntityRecord | null, senderRole: Role, preview: string, at: number): EntityRecord {
  const side = sideOf(senderRole);
  const patch: EntityRecord = {
    last_message: preview,
    last_message_at: at,
    last_sender_role: senderRole,
    [unreadField(side)]: 0,
    [lastReadField(side)]: at,
  };
  if (side !== 'agent') patch.unread_for_agent = (Number(rm?.unread_for_agent) || 0) + 1;
  if (side !== 'provider') patch.unread_for_provider = (Number(rm?.unread_for_provider) || 0) + 1;
  if (side !== 'admin') patch.unread_for_admin = (Number(rm?.unread_for_admin) || 0) + 1;
  return patch;
}

function msgKey(roomId: string, now: number): string {
  return `${roomId}_${now}_${Math.random().toString(36).slice(2, 6)}`;
}

export type SendTextOpts = {
  roomId: string;
  text: string;
  channel?: MsgChannel;
  /** 미지정 = getRole() 기준 actor */
  role?: Role;
};

/** 텍스트 메시지 저장 + 방 last/unread 갱신. 저장 0건이면 throw. */
export async function sendText(opts: SendTextOpts): Promise<EntityRecord> {
  const co = getCompanyId();
  const store = getStore();
  const role = opts.role ?? getRole();
  const me = actor(role);
  const channel: MsgChannel = opts.channel ?? '정식';
  const text = opts.text.trim();
  if (!text) throw new Error('빈 메시지');
  const now = Date.now();
  const rec: EntityRecord = {
    _key: msgKey(opts.roomId, now),
    room_id: opts.roomId,
    text,
    sender_uid: me.uid,
    sender_code: me.code,
    sender_role: role,
    sender_name: me.name,
    channel,
    created_at: now,
  };
  const r = await store.save('message', co, [rec]);
  if (!r.saved) throw new Error(`저장 0건 (중복 ${r.duplicates} · ${r.backend})`);
  // 메시지 저장 후 방 갱신 실패해도 메시지는 남음 — throw 하면 UI가 재전송해 중복됨.
  try {
    const rm = await store.get('room', co, opts.roomId);
    await store.update('room', co, opts.roomId, bumpUnreadPatch(rm, role, text, now));
    notifyUnread();
  } catch (e) {
    console.warn('[messaging] room bump failed after text save (message kept):', e);
  }
  return rec;
}

export type SendFileOpts = {
  roomId: string;
  file: File;
  channel?: MsgChannel;
  role?: Role;
  maxBytes?: number;
  /** 한 번에 여러 장 올릴 때 같은 값을 줘 묶음으로 표시(카톡식 앨범 말풍선). 낱장은 미지정. */
  batchId?: string;
};

/** 파일/이미지 첨부(Firebase Storage). 3MB 기본 한도. */
export async function sendFile(opts: SendFileOpts): Promise<EntityRecord> {
  const max = opts.maxBytes ?? 3 * 1024 * 1024;
  if (opts.file.size > max) throw new Error(`${Math.round(max / (1024 * 1024))}MB 초과 파일은 첨부할 수 없습니다`);
  const co = getCompanyId();
  const store = getStore();
  const role = opts.role ?? getRole();
  const me = actor(role);
  const channel: MsgChannel = opts.channel ?? '정식';
  const uploaded = await uploadManagedFile(opts.file, {
    kind: 'chat',
    entityId: opts.roomId,
    backupToDrive: false,
  });
  const url = uploaded.url;
  const isImg = /^image\//.test(opts.file.type);
  const now = Date.now();
  const rec: EntityRecord = {
    _key: msgKey(opts.roomId, now),
    room_id: opts.roomId,
    sender_uid: me.uid,
    sender_code: me.code,
    sender_role: role,
    sender_name: me.name,
    channel,
    created_at: now,
    storage_path: uploaded.storage_path,
    file_size: uploaded.file_size,
    file_type: uploaded.file_type,
  };
  if (isImg) rec.image_url = url;
  else { rec.file_url = url; rec.file_name = opts.file.name; }
  if (opts.batchId) rec.batch_id = opts.batchId; // 같은 batch = 한 번에 올린 묶음
  let r;
  try {
    r = await store.save('message', co, [rec]);
    if (!r.saved) throw new Error(`저장 0건 (중복 ${r.duplicates} · ${r.backend})`);
  } catch (error) {
    await deleteManagedFile(uploaded.storage_path).catch(() => undefined);
    throw error;
  }
  const preview = isImg ? '[사진]' : '[파일]';
  try {
    const rm = await store.get('room', co, opts.roomId);
    await store.update('room', co, opts.roomId, bumpUnreadPatch(rm, role, preview, now));
    notifyUnread();
  } catch (e) {
    console.warn('[messaging] room bump failed after file save (message kept):', e);
  }
  return rec;
}

/** 방 열람 — 내 역할 안읽음 0 + 열람시각. shouldCommit은 빠른 방 전환·언마운트 시 쓰기를 막는 UI 세대 가드. */
export async function markRead(roomId: string, role?: Role, shouldCommit: () => boolean = () => true): Promise<void> {
  const co = getCompanyId();
  const store = getStore();
  const r = role ?? getRole();
  const field = unreadField(r);
  const lr = lastReadField(r);
  const rm = await store.get('room', co, roomId);
  if (!rm || !shouldCommit()) return;
  const now = Date.now();
  const lastAt = Number(rm.last_message_at) || now;
  const patch: EntityRecord = { [field]: 0, [lr]: Math.max(now, lastAt) };
  const cur = Number(rm[field]) || 0;
  const prevRead = Number(rm[lr]) || 0;
  if (cur > 0 || prevRead < lastAt) {
    if (!shouldCommit()) return;
    await store.update('room', co, roomId, patch);
    notifyUnread();
  }
}

/** 방 메시지 목록(시간순). channel 지정 시 필터.
 *  getMessages = roomId 1개만 스코프 조회(전 방 list 회피). */
export async function getMessages(roomId: string): Promise<EntityRecord[]> {
  const co = getCompanyId();
  const store = getStore();
  if (typeof store.listMessagesForRoom === 'function') {
    return store.listMessagesForRoom(co, roomId);
  }
  return (await store.list('message', co)).filter((m) => String(m.room_id) === roomId);
}

export async function listMessages(roomId: string, channel?: MsgChannel): Promise<EntityRecord[]> {
  const all = await getMessages(roomId);
  return all
    .filter((m) => !channel || m.channel === channel)
    .sort((a, b) => Number(a.created_at) - Number(b.created_at));
}

/**
 * 목록·뱃지용 내 안읽음 수.
 *   1) 카운터(상대 발신 bump) 우선
 *   2) 없으면: 마지막 말이 상대이고 내가 아직 열람 안 함 → 1
 *      ※ 최근 14일만(옛 방 전부가 미확인으로 부푸는 것 방지 — 관리자·레거시)
 * 역할(영업·공급·관리) 무관 — 지금 내 역할 필드만 본다.
 */
export function unreadFor(rm: EntityRecord, role: Role): number {
  const counted = Number(rm[unreadField(role)]) || 0;
  if (counted > 0) return counted;

  const lastRole = String(rm.last_sender_role || '');
  if (!lastRole) return 0;
  if (sideOf(lastRole) === sideOf(role)) return 0;

  const lastAt = Number(rm.last_message_at) || 0;
  if (!lastAt) return 0;
  // 콜드 방 soft-폴백 = 햄버거·탭 99 폭주 방지
  if (Date.now() - lastAt > 14 * 24 * 60 * 60 * 1000) return 0;
  const readAt = Number(rm[lastReadField(role)]) || 0;
  if (readAt >= lastAt) return 0;
  return 1;
}

/** 내가 아직 안 연 방 개수(메시지 합이 아님). */
export function unreadRoomCount(rooms: EntityRecord[], role: Role): number {
  return rooms.filter((rm) => unreadFor(rm, role) > 0).length;
}

/**
 * 메시지 기준으로 안읽음 수를 방에 채움(목록·뱃지용).
 *   · last_read 있음 = 그 이후 상대 메시지 수
 *   · 없음 = 저장된 카운터만(soft 폴백 금지 — 뱃지 99 폭주 방지)
 * soft(최근 상대말·미열람→1) = unreadFor 가 목록 점용으로만 처리.
 */
type MessageListReader = Pick<StoreAdapter, 'list' | 'listMessagesForRoom'>;

export async function roomsWithUnread(
  rooms: EntityRecord[],
  role: Role,
  reader: MessageListReader = getStore(),
): Promise<EntityRecord[]> {
  if (!rooms.length) return rooms;
  const co = getCompanyId();
  const field = unreadField(role);
  const lr = lastReadField(role);
  const scanRooms = rooms.filter((rm) => {
    const readAt = Number(rm[lr]) || 0;
    const lastAt = Number(rm.last_message_at) || 0;
    // 마지막 메시지보다 이미 늦게 읽은 방은 요약값만으로 0을 확정할 수 있다.
    // last_message_at 없는 legacy 방은 저장 카운터를 보존해 대량 조회와 오판을 함께 피한다.
    // 저장 카운터 또는 최근 상대 발신 요약이 미확인을 가리키는 방만 정확 개수를 보정한다.
    // 요약상 0인 오래된 방까지 전부 조회하면 방마다 v3+v4 요청이 발생해 목록 로딩을 막는다.
    return readAt > 0 && lastAt > readAt && unreadFor(rm, role) > 0;
  });
  // 실제 미확인 가능 방이 없으면 메시지 조회 자체를 스킵.
  if (!scanRooms.length) {
    return rooms.map((rm) => {
      const readAt = Number(rm[lr]) || 0;
      const lastAt = Number(rm.last_message_at) || 0;
      return { ...rm, [field]: readAt > 0 && lastAt > 0 && readAt >= lastAt ? 0 : Number(rm[field]) || 0 };
    });
  }
  const me = actor(role);
  const byRoom = new Map<string, EntityRecord[] | null>();

  if (typeof reader.listMessagesForRoom === 'function') {
    await Promise.all(scanRooms.map(async (room) => {
      const roomId = String(room._key || '');
      if (!roomId) return;
      try {
        byRoom.set(roomId, await reader.listMessagesForRoom!(co, roomId));
      } catch {
        // A failed room must retain its stored counter; do not treat failed lookup as zero messages.
        byRoom.set(roomId, null);
      }
    }));
  } else {
    // Legacy/fallback adapters without a scoped API keep the previous one-shot full read.
    let messages: EntityRecord[];
    try { messages = await reader.list('message', co); }
    catch { return rooms.map((rm) => ({ ...rm, [field]: Number(rm[field]) || 0 })); }
    const roomIds = new Set(scanRooms.map((room) => String(room._key)));
    for (const roomId of roomIds) if (roomId) byRoom.set(roomId, []);
    for (const message of messages) {
      const roomId = String(message.room_id || '');
      if (!roomId || !roomIds.has(roomId)) continue;
      const list = byRoom.get(roomId);
      if (list) list.push(message);
      else byRoom.set(roomId, [message]);
    }
  }

  return rooms.map((rm) => {
    const readAt = Number(rm[lr]) || 0;
    if (!readAt) {
      return { ...rm, [field]: Number(rm[field]) || 0 };
    }
    const lastAt = Number(rm.last_message_at) || 0;
    if (lastAt > 0 && readAt >= lastAt) return { ...rm, [field]: 0 };
    const list = byRoom.get(String(rm._key));
    if (list == null) return { ...rm, [field]: Number(rm[field]) || 0 };
    const n = list.filter((m) => !isMine(m, me, role) && Number(m.created_at || 0) > readAt).length;
    return { ...rm, [field]: n };
  });
}

/** 내 말 여부 — uid 우선, 없으면 role 폴백. */
export function isMine(m: EntityRecord, me: { uid: string }, role: Role): boolean {
  return m.sender_uid ? m.sender_uid === me.uid : m.sender_role === role;
}
