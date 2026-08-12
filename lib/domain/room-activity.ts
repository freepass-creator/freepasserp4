import type { EntityRecord } from '@/lib/intake/entities';

function hasSignal(value: unknown): boolean {
  if (value == null || value === false) return false;
  if (typeof value === 'number') return !Number.isFinite(value) || value !== 0;
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text) return false;
    const numeric = Number(text);
    return !Number.isFinite(numeric) || numeric !== 0;
  }
  return true;
}

/**
 * 목록·상품 마킹에 노출할 실제 문의 활동.
 *
 * 방 레코드는 메시지를 보내기 전에 먼저 만들어질 수 있다. 그런 빈 셸까지 문의로 세면
 * 상세를 열기만 한 차량이 「문의중」이 되고 계약문의 숫자도 부풀기 때문에, 계약 연결·
 * 메시지 메타·안읽음 중 하나가 있는 방만 활동으로 본다. 실제 메시지 전송은 messaging
 * 도메인이 last_message 계열을 함께 갱신한다.
 */
export function hasRoomStoredActivity(room: EntityRecord): boolean {
  for (const field of [
    'linked_contract', 'contract_code', 'contract_id',
    'last_message', 'last_message_at', 'last_message_id',
    'last_sender_role', 'last_sender_uid', 'last_sender_code', 'last_sender_name',
  ]) {
    if (hasSignal(room[field])) return true;
  }

  return Object.entries(room).some(([field, value]) => (
    field.toLowerCase().startsWith('unread') && hasSignal(value)
  ));
}
