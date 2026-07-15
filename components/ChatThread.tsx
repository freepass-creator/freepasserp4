'use client';
import { useEffect, useState, useRef } from 'react';
import { getStore } from '@/lib/store';
import { getCompanyId } from '@/lib/tenant';
import { seedIfEmpty } from '@/lib/seed';
import { type EntityRecord } from '@/lib/intake/entities';
import { getRole, actor, ROLE_LABEL, type Role } from '@/lib/domain/deal';
import { Btn, C } from '@/components/ui';

// 대화창 = 공통 원자(방 하나의 스레드+입력). 역할=로그인 세션 고정(getRole) — 대화 안 역할 전환 UI 없음.
// 상단바 계정(역할) 변경 시 fp:role 이벤트로 갱신. 헤드 높이 44(패널 규격 통일).
export function ChatThread({ roomId, onBack, onVehicle, onContract }: { roomId: string; onBack?: () => void; onVehicle?: (productCode: string) => void; onContract?: (productCode: string) => void }) {
  const co = getCompanyId();
  const [room, setRoom] = useState<EntityRecord | null | undefined>(undefined);
  const [msgs, setMsgs] = useState<EntityRecord[]>([]);
  const [role, setRoleS] = useState<Role>('agent');
  const [text, setText] = useState('');
  const endRef = useRef<HTMLDivElement | null>(null);

  const load = async () => {
    const rm = await getStore().get('room', co, roomId);
    setRoom(rm);
    // 열람 = 내 역할 안읽음 리셋
    const r = getRole();
    const field = r === 'agent' ? 'unread_for_agent' : r === 'provider' ? 'unread_for_provider' : '';
    if (field && rm && Number(rm[field]) > 0) await getStore().update('room', co, roomId, { [field]: 0 });
    const all = await getStore().list('message', co);
    setMsgs(all.filter((m) => m.room_id === roomId).sort((a, b) => Number(a.created_at) - Number(b.created_at)));
  };
  useEffect(() => { (async () => { await seedIfEmpty(co); setRoleS(getRole()); await load(); })(); /* eslint-disable-next-line */ }, [roomId]);
  useEffect(() => { const on = (e: Event) => setRoleS((e as CustomEvent).detail as Role); window.addEventListener('fp:role', on); return () => window.removeEventListener('fp:role', on); }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs.length, roomId]);

  const send = async () => {
    const t = text.trim(); if (!t) return;
    const me = actor(role); const now = Date.now();
    await getStore().save('message', co, [{ _key: `${roomId}_${now}_${Math.random().toString(36).slice(2, 6)}`, room_id: roomId, text: t, sender_uid: me.uid, sender_role: role, sender_name: me.name, created_at: now }]);
    const rm = await getStore().get('room', co, roomId);
    const patch: EntityRecord = { last_message: t, last_message_at: now }; // 상대 안읽음 증가(회신대기)
    if (role !== 'agent') patch.unread_for_agent = (Number(rm?.unread_for_agent) || 0) + 1;
    if (role !== 'provider') patch.unread_for_provider = (Number(rm?.unread_for_provider) || 0) + 1;
    await getStore().update('room', co, roomId, patch);
    setText(''); await load();
  };

  if (room === undefined) return <div style={{ padding: 30, color: C.faint, height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>불러오는 중…</div>;
  if (!room) return <div style={{ padding: 20 }}>{onBack && <Btn variant="ghost" size="sm" onClick={onBack}>← 목록</Btn>}<div style={{ marginTop: 14, color: C.faint }}>대화방을 찾을 수 없습니다.</div></div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, background: '#fff' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 44, flex: '0 0 44px', padding: '0 14px', borderBottom: `1px solid ${C.line}`, background: '#fff', boxSizing: 'border-box' }}>
        {onBack && <Btn variant="ghost" size="sm" onClick={onBack}>← 목록</Btn>}
        <span style={{ fontSize: 13.5, fontWeight: 800, minWidth: 0, flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{String(room.vehicle_name || '')}</span>
        {onVehicle && <Btn variant="ghost" size="sm" onClick={() => onVehicle(String(room.product_code))}>차량</Btn>}
        {onContract && <Btn size="sm" onClick={() => onContract(String(room.product_code))}>계약</Btn>}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {msgs.length === 0 && <div style={{ textAlign: 'center', color: C.faint, fontSize: 12.5, marginTop: 20 }}>첫 메시지를 남겨보세요.</div>}
        {msgs.map((m) => {
          const mine = m.sender_role === role; const isAdmin = m.sender_role === 'admin';
          return (
            <div key={String(m._key)} style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '78%' }}>
              {!mine && <div style={{ fontSize: 10.5, color: C.faint, margin: '0 0 2px 3px' }}>{String(m.sender_name)} · {ROLE_LABEL[m.sender_role as Role] || ''}</div>}
              <div style={{ padding: '8px 11px', borderRadius: 8, fontSize: 13, lineHeight: 1.45, background: mine ? C.brand : isAdmin ? '#fff7ed' : '#fff', color: mine ? '#fff' : C.ink, border: mine ? 'none' : `1px solid ${C.line}`, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{String(m.text)}</div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      <div style={{ display: 'flex', gap: 8, padding: '10px 12px calc(10px + env(safe-area-inset-bottom))', borderTop: `1px solid ${C.line}`, flex: '0 0 auto' }}>
        <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} placeholder="메시지 입력" style={{ flex: 1, height: 38, padding: '0 12px', border: `1px solid ${C.line}`, borderRadius: 6, fontSize: 14 }} />
        <Btn onClick={send}>보내기</Btn>
      </div>
    </div>
  );
}
