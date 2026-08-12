'use client';
import type { EntityRecord } from '@/lib/intake/entities';
import type { Role } from '@/lib/domain/deal';
import { replyAttentionFor, unreadFor } from '@/lib/domain/messaging';
import { Btn, CenterNote } from '@/components/ui';
import { ChatRoomRow } from '@/components/list-rows';
export function ChatRoomList({ rooms, role, selected, query, filterActive, displayName, plate, contract, counter, onSelect, onReset }: {
  rooms: EntityRecord[];
  role: Role;
  selected: string | null;
  query: string;
  filterActive: boolean;
  /** ①줄 = 차량명 */
  displayName: (room: EntityRecord) => string;
  /** ②줄 = 차량번호 */
  plate: (room: EntityRecord) => string;
  contract: (room: EntityRecord) => EntityRecord | undefined;
  counter: (room: EntityRecord) => string;
  onSelect: (room: EntityRecord) => void;
  onReset: () => void;
}) {
  if (!rooms.length) return <CenterNote><div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
    <span>{query || filterActive ? '검색 결과 없음' : role === 'provider' ? '들어온 문의가 없습니다.' : role === 'admin' ? '처리할 문의가 없습니다.' : '채팅 중인 문의가 없습니다.'}</span>
    {(query || filterActive) && <Btn title="조건 해제" size="sm" variant="ghost" onClick={onReset}>조건 해제</Btn>}
  </div></CenterNote>;
  return <div>{rooms.map((room) => <ChatRoomRow
    key={String(room._key)}
    room={room}
    displayName={displayName(room)}
    plate={plate(room)}
    stageContract={contract(room)}
    counter={counter(room)}
    unread={unreadFor(room, role)}
    unreplied={replyAttentionFor(room, role) === 'unreplied'}
    selected={String(room._key) === selected}
    onClick={onSelect}
  />)}</div>;
}
