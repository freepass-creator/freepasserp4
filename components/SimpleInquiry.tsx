'use client';
import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { type EntityRecord } from '@/lib/intake/entities';
import { getRole, actor, ensureRoom, type Role } from '@/lib/domain/deal';
import { sendText, listMessages, isMine, markRead } from '@/lib/domain/messaging';
import { C, R, FS, FW, Btn, Input } from '@/components/ui';
import { toast } from '@/components/Toaster';
import { ChatSenderLabel } from '@/components/ChatSenderLabel';
import { msgClock } from '@/lib/format';

/**
 * 간단 문의 — 상세 하단. 방 = CH_매물_{나}, channel='간단'.
 * 전송·목록 = messaging SSOT. UI는 간단 채널만 표시.
 */
export function SimpleInquiry({ p }: { p: EntityRecord }) {
  const router = useRouter();
  const role = getRole();
  const me = actor(role);
  const [msgs, setMsgs] = useState<EntityRecord[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const threadRef = useRef<HTMLDivElement | null>(null);

  const roomKey = `CH_${p.product_code}_${me.code}`;
  const load = async () => {
    const list = await listMessages(roomKey, '간단');
    setMsgs(list);
    // 상대 문의 확인 = 열람
    if (list.some((m) => !isMine(m, me, role))) await markRead(roomKey, role);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [p.product_code, me.code]);
  // 스레드 박스 안에서만 스크롤 — scrollIntoView는 .fp-main-pad까지 끌어내려 상세가 아래로 점프함
  useEffect(() => {
    const el = threadRef.current;
    if (!el || !msgs.length) return;
    el.scrollTop = el.scrollHeight;
  }, [msgs.length]);

  const send = async () => {
    const t = text.trim(); if (!t || busy) return;
    setBusy(true);
    const optimistic: EntityRecord = {
      _key: `${roomKey}_${Date.now()}_opt`, room_id: roomKey, text: t,
      sender_uid: me.uid, sender_code: me.code, sender_role: role, sender_name: me.name,
      channel: '간단', created_at: Date.now(),
    };
    setMsgs((prev) => [...prev, optimistic]);
    setText('');
    try {
      const rid = await ensureRoom(p, me);
      await sendText({ roomId: rid, text: t, channel: '간단', role });
      await load();
    } catch (e) {
      console.error('간단문의 전송 실패:', e);
      toast(`문의 전송 실패: ${(e as Error).message}`, 'error');
      setMsgs((prev) => prev.filter((m) => m._key !== optimistic._key));
      setText(t);
    } finally { setBusy(false); }
  };

  const openFull = async () => { const rid = await ensureRoom(p, me); router.push(`/chat?room=${encodeURIComponent(rid)}`); };

  const inputRow = (
    <div style={{
      display: 'flex', gap: 8, alignItems: 'center',
      background: '#fff', border: `1px solid ${C.line}`, borderRadius: R, padding: 6,
    }}>
      <Input full value={text} onChange={setText} onEnter={send} placeholder="여기에 바로 문의하세요"
        style={{ flex: 1, border: 'none', background: 'transparent' }} />
      <Btn size="sm" onClick={send} disabled={busy || !text.trim()}>문의</Btn>
    </div>
  );

  const thread = (
    <div
      ref={threadRef}
      style={{
      maxHeight: 300, overflowY: 'auto',
      display: 'flex', flexDirection: 'column', gap: 8,
      padding: msgs.length ? '2px 0 10px' : 0,
    }}>
      {msgs.map((m) => {
        const mine = isMine(m, me, role);
        const clock = msgClock(m.created_at);
        return (
          <div key={String(m._key)} style={{
            alignSelf: mine ? 'flex-end' : 'flex-start',
            maxWidth: '86%',
            display: 'flex', flexDirection: 'column', gap: 2,
            alignItems: mine ? 'flex-end' : 'flex-start',
          }}>
            {!mine && (
              <div style={{ padding: '0 2px' }}>
                <ChatSenderLabel role={String(m.sender_role)} name={String(m.sender_name)} code={String(m.sender_code || m.sender_uid || '')} />
              </div>
            )}
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, flexDirection: mine ? 'row-reverse' : 'row' }}>
              <div style={{
                padding: '7px 11px', borderRadius: mine ? `${R}px ${R}px 2px ${R}px` : `${R}px ${R}px ${R}px 2px`,
                fontSize: FS.sub, lineHeight: 1.45,
                background: mine ? C.brand : '#fff',
                color: mine ? '#fff' : C.ink,
                border: mine ? 'none' : `1px solid ${C.line2}`,
                whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                boxShadow: mine ? 'none' : `0 1px 0 ${C.line2}`,
              }}>{String(m.text)}</div>
              {clock ? (
                <span style={{ flex: '0 0 auto', fontSize: FS.micro, color: C.faint, fontVariantNumeric: 'tabular-nums', lineHeight: 1, paddingBottom: 1 }}>
                  {clock}
                </span>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );

  return (
    <section style={{ marginTop: 22 }}>
      <div style={{ borderRadius: R, background: C.selected, padding: '14px 14px 12px', border: `1px solid ${C.line}` }}>
        <div style={{ fontSize: FS.title, fontWeight: FW.title, color: C.ink, marginBottom: 2 }}>
          {msgs.length ? '이어가는 문의' : '궁금한 게 있으신가요?'}
        </div>
        <div style={{ fontSize: FS.cap, color: C.mute, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {msgs.length ? (
            <>
              <span>주고받은 {msgs.length}건 · 계약문의로 이어집니다</span>
              <Btn variant="ghost" size="sm" onClick={openFull}>전체 대화 보기 →</Btn>
            </>
          ) : '출고·조건 뭐든 여기에 바로 문의하세요. 계약문의로 이어집니다.'}
        </div>
        {msgs.length > 0 && (
          <div style={{ background: '#fff', borderRadius: R, border: `1px solid ${C.line2}`, padding: '8px 10px', marginBottom: 8 }}>
            {thread}
          </div>
        )}
        {inputRow}
      </div>
    </section>
  );
}
