'use client';
import { useEffect, useState, useRef } from 'react';
import { getStore } from '@/lib/store';
import { getCompanyId } from '@/lib/tenant';
import { seedIfEmpty } from '@/lib/seed';
import { type EntityRecord } from '@/lib/intake/entities';
import { getRole, actor, type Role } from '@/lib/domain/deal';
import { sendText, sendFile as sendFileMsg, markRead, listMessages, isMine } from '@/lib/domain/messaging';
import { Btn, C, R, FW, FS, Loading, CenterNote, Input, IconBtn, ctrlH, NavBack } from '@/components/ui';
import { toast } from '@/components/Toaster';
import { ChatSenderLabel } from '@/components/ChatSenderLabel';
import { useIsMobile } from '@/lib/use-mobile';
import { msgClock } from '@/lib/format';

// 대화창 = 공통 원자(방 하나의 스레드+입력). 전송·안읽음 = messaging SSOT.
export function ChatThread({ roomId, onBack, onVehicle, onContract }: { roomId: string; onBack?: () => void; onVehicle?: (productCode: string) => void; onContract?: (productCode: string) => void }) {
  const mobile = useIsMobile();
  const co = getCompanyId();
  const [room, setRoom] = useState<EntityRecord | null | undefined>(undefined);
  const [msgs, setMsgs] = useState<EntityRecord[]>([]);
  const [role, setRoleS] = useState<Role>('agent');
  const [text, setText] = useState('');
  const [full, setFull] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const load = async () => {
    const rm = await getStore().get('room', co, roomId);
    setRoom(rm);
    await markRead(roomId, getRole());
    setMsgs(await listMessages(roomId));
  };
  useEffect(() => { (async () => { await seedIfEmpty(co); setRoleS(getRole()); await load(); })(); /* eslint-disable-next-line */ }, [roomId]);
  useEffect(() => { const on = (e: Event) => setRoleS((e as CustomEvent).detail as Role); window.addEventListener('fp:role', on); return () => window.removeEventListener('fp:role', on); }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs.length, roomId]);

  const send = async () => {
    const t = text.trim(); if (!t) return;
    setText('');
    try {
      await sendText({ roomId, text: t, channel: '정식', role });
      await load();
    } catch (e) {
      console.error('메시지 전송 실패:', e);
      toast(`전송 실패: ${(e as Error).message}`, 'error');
      setText(t);
    }
  };

  const onPickFile = async (files: FileList | null) => {
    if (!files || !files.length) return;
    try {
      await sendFileMsg({ roomId, file: files[0], channel: '정식', role });
      await load();
    } catch (e) {
      console.error('첨부 전송 실패:', e);
      toast(`첨부 전송 실패: ${(e as Error).message}`, 'error');
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  if (room === undefined) return <Loading label="불러오는 중…" minHeight="100%" />;
  if (!room) {
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        {onBack && <div style={{ padding: 12 }}><NavBack kind="list" onClick={onBack} /></div>}
        <CenterNote minHeight="100%">대화방을 찾을 수 없습니다.</CenterNote>
      </div>
    );
  }

  const me = actor(role);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, background: '#fff' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: ctrlH(mobile), flex: `0 0 ${ctrlH(mobile)}px`, padding: '0 14px', borderBottom: `1px solid ${C.line}`, background: '#fff', boxSizing: 'border-box' }}>
        {onBack && <NavBack kind="list" onClick={onBack} />}
        <span style={{ fontSize: FS.title, fontWeight: FW.title, minWidth: 0, flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{String(room.vehicle_name || '')}</span>
        {onVehicle && <Btn variant="ghost" size="sm" onClick={() => onVehicle(String(room.product_code))}>차량</Btn>}
        {onContract && <Btn size="sm" onClick={() => onContract(String(room.product_code))}>계약진행</Btn>}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {msgs.length === 0 && <div style={{ textAlign: 'center', color: C.faint, fontSize: FS.sub, marginTop: 20 }}>첫 메시지를 남겨보세요.</div>}
        {msgs.map((m) => {
          const mine = isMine(m, me, role);
          const isAdmin = m.sender_role === 'admin';
          const simple = m.channel === '간단';
          const clock = msgClock(m.created_at);
          const bubble = m.image_url ? (
            <img src={String(m.image_url)} alt="" onClick={() => setFull(String(m.image_url))} style={{ maxWidth: 200, maxHeight: 220, borderRadius: R, cursor: 'zoom-in', display: 'block', border: `1px solid ${C.line}` }} />
          ) : m.file_url ? (
            <a href={String(m.file_url)} download={String(m.file_name || 'file')} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, maxWidth: 220, padding: '8px 11px', borderRadius: R, fontSize: FS.sub, background: mine ? C.brand : '#fff', color: mine ? '#fff' : C.ink, border: mine ? 'none' : `1px solid ${C.line}`, textDecoration: 'none' }}><span>📎</span><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{String(m.file_name || '파일')}</span></a>
          ) : (
            <div style={{ padding: '8px 11px', borderRadius: R, fontSize: 13, lineHeight: 1.45, background: mine ? C.brand : isAdmin ? C.warnBg : '#fff', color: mine ? '#fff' : C.ink, border: mine ? 'none' : `1px solid ${C.line}`, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{String(m.text)}</div>
          );
          return (
            <div key={String(m._key)} style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '78%' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, margin: '0 0 2px 3px', justifyContent: mine ? 'flex-end' : 'flex-start' }}>
                {!mine && <ChatSenderLabel role={String(m.sender_role)} name={String(m.sender_name)} code={String(m.sender_code || m.sender_uid || '')} />}
                {simple && <span style={{ fontSize: FS.micro, fontWeight: FW.label, color: C.brand, background: C.selected, padding: '1px 5px', borderRadius: R }}>간단</span>}
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, flexDirection: mine ? 'row-reverse' : 'row' }}>
                {bubble}
                {clock ? (
                  <span style={{ flex: '0 0 auto', fontSize: FS.micro, color: C.faint, fontVariantNumeric: 'tabular-nums', lineHeight: 1, paddingBottom: 2 }}>
                    {clock}
                  </span>
                ) : null}
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      {/* 일반 메신저처럼 1줄 컴포저 — 탭바 켤 때 --fp-dock-safe=0 (이중 safe-area 빈칸 방지) */}
      <div style={{ display: 'flex', gap: 6, padding: '6px 10px calc(6px + var(--fp-dock-safe, env(safe-area-inset-bottom, 0px)))', borderTop: `1px solid ${C.line}`, flex: '0 0 auto', alignItems: 'center' }}>
        <input ref={fileRef} type="file" accept="image/*,application/pdf" onChange={(e) => onPickFile(e.target.files)} style={{ display: 'none' }} />
        <IconBtn onClick={() => fileRef.current?.click()} title="사진·파일 첨부">📎</IconBtn>
        <Input value={text} onChange={setText} onEnter={send} placeholder="메시지 입력" full style={{ flex: 1 }} />
        <Btn onClick={send}>보내기</Btn>
      </div>

      {full && <div onClick={() => setFull(null)} style={{ position: 'fixed', inset: 0, zIndex: 90, background: 'rgba(0,0,0,0.92)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}><img src={full} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: R }} /></div>}
    </div>
  );
}
