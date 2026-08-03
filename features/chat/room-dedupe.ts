import type { EntityRecord } from '@/lib/intake/entities';

export type EmptyRoomDedupeEvidence = {
  /** Missing/`unknown` entries are fail-closed and keep the whole duplicate family. */
  messageState: ReadonlyMap<string, RoomMessageState>;
  /** Includes explicit links and legacy product/vehicle/agent fallback contract matches. */
  contractOf: (room: EntityRecord) => EntityRecord | null | undefined;
};

export type RoomMessageState = 'empty' | 'present' | 'unknown';

export type DuplicateRoomMessageReaders = {
  /** Preferred RTDB path: query only one candidate room. */
  listForRoom?: (roomId: string) => Promise<readonly EntityRecord[]>;
  /** Used once only by adapters that do not implement the scoped API. */
  listAll: () => Promise<readonly EntityRecord[]>;
};

function text(value: unknown): string {
  return String(value ?? '').trim();
}

function hasSignal(value: unknown): boolean {
  if (value == null || value === false) return false;
  if (typeof value === 'number') return !Number.isFinite(value) || value !== 0;
  if (typeof value === 'string') {
    const valueText = value.trim();
    if (!valueText) return false;
    const numeric = Number(valueText);
    return !Number.isFinite(numeric) || numeric !== 0;
  }
  return true;
}

/**
 * A duplicate family must prove the exact listing and all parties. Missing ownership fields are
 * deliberately not inferred: under-deduplication is safer than hiding another business thread.
 */
function strongRoomIdentity(room: EntityRecord): string | null {
  const product = [
    text(room.product_code),
    text(room.product_uid),
    text(room.product_id),
  ];
  const agent = [text(room.agent_uid), text(room.agent_code)];
  const provider = text(room.provider_company_code);
  const channel = text(room.agent_channel_code);
  if (!product.some(Boolean) || !agent.some(Boolean) || !provider || !channel) return null;
  return JSON.stringify([product, agent, provider, channel]);
}

function hasRoomMetadataActivity(
  room: EntityRecord,
  contractOf: EmptyRoomDedupeEvidence['contractOf'],
): boolean {
  const key = text(room._key);
  if (!key) return true;
  if (contractOf(room)) return true;
  if (room._deleted || room.deletedAt || room.is_admin_chat) return true;

  for (const field of [
    'linked_contract', 'contract_code', 'contract_id',
    'last_message', 'last_message_at', 'last_message_id',
    'last_sender_role', 'last_sender_uid', 'last_sender_code', 'last_sender_name',
  ]) {
    if (hasSignal(room[field])) return true;
  }

  // Covers the three current counters and unknown legacy variants without assuming their names.
  return Object.entries(room).some(([field, value]) => (
    field.toLowerCase().startsWith('unread') && hasSignal(value)
  ));
}

/** Strong-identity families that are metadata-empty and therefore need scoped message proof. */
export function duplicateEmptyRoomFamilies(
  rooms: readonly EntityRecord[],
  context: Pick<EmptyRoomDedupeEvidence, 'contractOf'>,
): EntityRecord[][] {
  const grouped = new Map<string, EntityRecord[]>();
  for (const room of rooms) {
    const identity = strongRoomIdentity(room);
    if (!identity) continue;
    const family = grouped.get(identity);
    if (family) family.push(room);
    else grouped.set(identity, [room]);
  }
  return [...grouped.values()].filter((family) => (
    family.length > 1
    && family.every((room) => !hasRoomMetadataActivity(room, context.contractOf))
  ));
}

/**
 * Verify messages only for candidate room ids. A scoped failure marks that room unknown; collapse
 * then preserves its entire family. Adapters without a scoped reader use exactly one full read.
 */
export async function verifyDuplicateRoomMessages(
  families: readonly (readonly EntityRecord[])[],
  readers: DuplicateRoomMessageReaders,
): Promise<Map<string, RoomMessageState>> {
  const roomIds = [...new Set(
    families.flatMap((family) => family.map((room) => text(room._key))).filter(Boolean),
  )];
  const state = new Map<string, RoomMessageState>();
  if (!roomIds.length) return state;
  const hasActiveMessage = (messages: readonly EntityRecord[]) => (
    messages.some((message) => !message._deleted && !message.deletedAt)
  );

  if (readers.listForRoom) {
    await Promise.all(roomIds.map(async (roomId) => {
      try {
        const messages = await readers.listForRoom!(roomId);
        state.set(roomId, hasActiveMessage(messages) ? 'present' : 'empty');
      } catch {
        state.set(roomId, 'unknown');
      }
    }));
    return state;
  }

  try {
    const all = await readers.listAll();
    const withMessages = new Set(
      all
        .filter((message) => !message._deleted && !message.deletedAt)
        .map((message) => text(message.room_id))
        .filter(Boolean),
    );
    for (const roomId of roomIds) state.set(roomId, withMessages.has(roomId) ? 'present' : 'empty');
  } catch {
    for (const roomId of roomIds) state.set(roomId, 'unknown');
  }
  return state;
}

function preferredRoom(family: readonly EntityRecord[]): EntityRecord {
  return family.slice().sort((a, b) => {
    const aKey = text(a._key);
    const bKey = text(b._key);
    const aCanonical = aKey === `CH_${text(a.product_code)}_${text(a.agent_code)}`;
    const bCanonical = bKey === `CH_${text(b.product_code)}_${text(b.agent_code)}`;
    if (aCanonical !== bCanonical) return aCanonical ? -1 : 1;
    return aKey.localeCompare(bKey);
  })[0];
}

/**
 * Collapse only proven-empty duplicate room shells for list presentation.
 *
 * This never mutates or deletes records. If one family member has a message, contract, unread
 * counter, last-message metadata, different party/listing identity, or incomplete evidence, the
 * entire family remains visible so no conversation or business history becomes unreachable.
 */
export function collapseDuplicateEmptyRooms(
  rooms: readonly EntityRecord[],
  evidence: EmptyRoomDedupeEvidence,
): EntityRecord[] {
  const families = duplicateEmptyRoomFamilies(rooms, evidence);
  const hidden = new Set<EntityRecord>();
  for (const family of families) {
    const fullyVerifiedEmpty = family.every((room) => (
      evidence.messageState.get(text(room._key)) === 'empty'
    ));
    if (!fullyVerifiedEmpty) continue;
    const keep = preferredRoom(family);
    for (const room of family) {
      if (room !== keep) hidden.add(room);
    }
  }

  return rooms.filter((room) => !hidden.has(room));
}
