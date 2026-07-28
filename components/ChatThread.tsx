'use client';
import { useCallback, useEffect, useState, useRef, type DragEvent } from 'react';
import { getStore } from '@/lib/store';
import { getCompanyId } from '@/lib/tenant';
import { seedIfEmpty } from '@/lib/seed';
import { type EntityRecord } from '@/lib/intake/entities';
import { getRole, actor, type Role } from '@/lib/domain/deal';
import { sendText, sendFile as sendFileMsg, markRead, listMessages, isMine } from '@/lib/domain/messaging';
import { Btn, C, R, FW, FS, Loading, CenterNote, Input, IconBtn, ctrlH, NavBack, Dropzone, SCRIM } from '@/components/ui';
import { toast } from '@/components/Toaster';
import { ChatSenderLabel } from '@/components/ChatSenderLabel';
import { useIsMobile } from '@/lib/use-mobile';
import { msgClock } from '@/lib/format';
import { ListChecks, LoaderCircle, Paperclip, Send } from 'lucide-react';

/** 📎 accept와 동일 — image/* · application/pdf */
function isAcceptedChatFile(file: File): boolean {
  return file.type.startsWith('image/') || file.type === 'application/pdf';
}

// 대화창 = 공통 원자(방 하나의 스레드+입력). 전송·안읽음 = messaging SSOT.
export function ChatThread({ roomId, onBack, onVehicle, onContract }: { roomId: string; onBack?: () => void; onVehicle?: (productCode: string) => void; onContract?: (productCode: string) => void }) {
  const mobile = useIsMobile();
  const co = getCompanyId();
  const [room, setRoom] = useState<EntityRecord | null | undefined>(undefined);
  const [msgs, setMsgs] = useState<EntityRecord[] | undefined>(undefined);
  const [role, setRoleS] = useState<Role>('agent');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [full, setFull] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const threadRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const dragDepth = useRef(0);

  const load = useCallback(async (mark = true) => {
    const rm = await getStore().get('room', co, roomId);
    setRoom(rm);
    if (mark) await markRead(roomId, getRole());
    setMsgs(await listMessages(roomId));
  }, [co, roomId]);
  useEffect(() => {
    let alive = true;
    setMsgs(undefined);
    (async () => {
      await seedIfEmpty(co);
      if (!alive) return;
      setRoleS(getRole());
      await load();
    })().catch((e) => {
      console.error('메시지 조회 실패:', e);
      if (alive) setMsgs([]);
    });
    return () => { alive = false; };
  }, [co, load]);
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'hidden') return;
      load(false).catch((e) => console.warn('메시지 새로고침 실패:', e));
    };
    const id = window.setInterval(refresh, 5000);
    window.addEventListener('focus', refresh);
    window.addEventListener('fp:unread', refresh);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('fp:unread', refresh);
    };
  }, [load]);
  useEffect(() => { const on = (e: Event) => setRoleS((e as CustomEvent).detail as Role); window.addEventListener('fp:role', on); return () => window.removeEventListener('fp:role', on); }, []);
  // 스레드 박스 안에서만 스크롤 — rAF 후 적용(이미지 로드 점프 완화). scrollIntoView는 .fp-main-pad까지 끌어올림.
  useEffect(() => {
    const el = threadRef.current;
    if (!el) return;
    const id = requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
    return () => cancelAnimationFrame(id);
  }, [msgs?.length, roomId]);

  const send = async () => {
    const t = text.trim(); if (!t || busy) return;
    const meNow = actor(role);
    const tempKey = `_tmp_${Date.now()}`;
    const optimistic: EntityRecord = {
      _key: tempKey,
      room_id: roomId,
      text: t,
      sender_uid: meNow.uid,
      sender_role: role,
      sender_name: meNow.name,
      sender_code: meNow.code,
      created_at: Date.now(),
      channel: '정식',
    };
    setText('');
    setMsgs((prev) => [...(prev || []), optimistic]);
    setBusy(true);
    try {
      const rec = await sendText({ roomId, text: t, channel: '정식', role });
      setMsgs((prev) => (prev || []).map((m) => (String(m._key) === tempKey ? rec : m)));
      const rm = await getStore().get('room', co, roomId);
      if (rm) setRoom(rm);
    } catch (e) {
      console.error('메시지 전송 실패:', e);
      setMsgs((prev) => (prev || []).filter((m) => String(m._key) !== tempKey));
      setText(t);
      toast(`전송 실패: ${(e as Error).message}`, 'error');
    } finally { setBusy(false); }
  };

  const onPickFile = async (files: FileList | null) => {
    if (!files || !files.length || busy) return;
    setBusy(true);
    try {
      const rec = await sendFileMsg({ roomId, file: files[0], channel: '정식', role });
      setMsgs((prev) => [...(prev || []), rec]);
      const rm = await getStore().get('room', co, roomId);
      if (rm) setRoom(rm);
    } catch (e) {
      console.error('첨부 전송 실패:', e);
      toast(`첨부 전송 실패: ${(e as Error).message}`, 'error');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  // 데스크톱 DnD — 모바일은 리스너·오버레이 없음. 업로드는 onPickFile 재사용만.
  const onDragEnter = (e: DragEvent) => {
    if (mobile) return;
    e.preventDefault();
    e.stopPropagation();
    dragDepth.current += 1;
    setDragActive(true);
  };
  const onDragOver = (e: DragEvent) => {
    if (mobile) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  };
  const onDragLeave = (e: DragEvent) => {
    if (mobile) return;
    e.preventDefault();
    e.stopPropagation();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragActive(false);
  };
  const onDrop = (e: DragEvent) => {
    if (mobile) return;
    e.preventDefault();
    e.stopPropagation();
    dragDepth.current = 0;
    setDragActive(false);
    const files = e.dataTransfer?.files ?? null;
    if (!files?.length) return;
    const file = files[0];
    if (!isAcceptedChatFile(file)) {
      toast('이미지 또는 PDF만 첨부할 수 있습니다', 'error');
      return;
    }
    void onPickFile(files);
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
  // WorkPage 선택(swap) = TopBar·BottomNav가 크롬 담당 → 스레드 헤더·컴포저 safe-area 생략(이중 여백·차명 중복 방지).
  const embedded = !onBack && !onVehicle && !onContract;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, background: C.taupeBg }}>
      {!embedded ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: ctrlH(mobile), flex: `0 0 ${ctrlH(mobile)}px`, padding: '0 14px', borderBottom: `1px solid ${C.line}`, background: C.taupeBg, boxSizing: 'border-box' }}>
          {onBack && <NavBack kind="list" onClick={onBack} />}
          <span style={{ fontSize: FS.title, fontWeight: FW.title, minWidth: 0, flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{String(room.vehicle_name || room.car_number || room.vehicle_number || '대화')}</span>
          {onVehicle && <Btn title="차량 보기" variant="ghost" size="sm" onClick={() => onVehicle(String(room.product_code))}>차량</Btn>}
          {onContract && <Btn mobileIcon={<ListChecks size={18} />} title="계약 진행" size="sm" onClick={() => onContract(String(room.product_code))}>계약진행</Btn>}
        </div>
      ) : null}

      <div
        ref={threadRef}
        onDragEnter={mobile ? undefined : onDragEnter}
        onDragOver={mobile ? undefined : onDragOver}
        onDragLeave={mobile ? undefined : onDragLeave}
        onDrop={mobile ? undefined : onDrop}
        style={{ flex: 1, overflowY: 'auto', minHeight: 0, padding: 14, display: 'flex', flexDirection: 'column', gap: 8, position: 'relative' }}
      >
        {!mobile && dragActive ? (
          <Dropzone
            variant="file"
            active
            style={{
              position: 'absolute', inset: 0, zIndex: 5,
              background: SCRIM.light,
              pointerEvents: 'none',
              color: C.ink, fontSize: FS.title, fontWeight: FW.title,
            }}
          >
            여기에 놓아 첨부
          </Dropzone>
        ) : null}
        {msgs === undefined && <Loading label="메시지를 불러오는 중…" minHeight={80} />}
        {msgs?.length === 0 && <div style={{ textAlign: 'center', color: C.faint, fontSize: FS.sub, marginTop: 20 }}>첫 메시지를 남겨보세요.</div>}
        {msgs?.map((m) => {
          const mine = isMine(m, me, role);
          const isAdmin = m.sender_role === 'admin';
          const simple = m.channel === '간단';
          const clock = msgClock(m.created_at);
          const bubble = m.image_url ? (
            <img
              src={String(m.image_url)}
              alt=""
              width={200}
              height={220}
              loading="lazy"
              decoding="async"
              onClick={() => setFull(String(m.image_url))}
              style={{ maxWidth: 200, maxHeight: 220, width: 'auto', height: 'auto', aspectRatio: '10 / 11', objectFit: 'cover', borderRadius: R, cursor: 'zoom-in', display: 'block', border: `1px solid ${C.line}` }}
            />
          ) : m.file_url ? (
            <a href={String(m.file_url)} download={String(m.file_name || 'file')} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, maxWidth: 220, padding: '8px 11px', borderRadius: R, fontSize: FS.sub, background: mine ? C.brand : C.taupeBg, color: mine ? C.taupeBg : C.ink, border: mine ? 'none' : `1px solid ${C.line}`, textDecoration: 'none' }}><Paperclip size={14} aria-hidden /><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{String(m.file_name || '파일')}</span></a>
          ) : (
            <div style={{ padding: '8px 11px', borderRadius: R, fontSize: FS.body, lineHeight: 1.45, background: mine ? C.brand : isAdmin ? C.warnBg : C.taupeBg, color: mine ? C.taupeBg : C.ink, border: mine ? 'none' : `1px solid ${C.line}`, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{String(m.text)}</div>
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
      </div>

      {/* embedded(WorkPage) = BottomNav가 safe-area · 그 외 = --fp-dock-safe(탭바 숨김 시) */}
      <div style={{
        display: 'flex', gap: 6, alignItems: 'center', flex: '0 0 auto',
        padding: embedded
          ? '6px 10px'
          : '6px 10px calc(6px + var(--fp-dock-safe, env(safe-area-inset-bottom, 0px)))',
        borderTop: `1px solid ${C.line}`,
      }}>
        <input ref={fileRef} type="file" accept="image/*,application/pdf" onChange={(e) => onPickFile(e.target.files)} style={{ display: 'none' }} />
        <IconBtn onClick={() => fileRef.current?.click()} title="사진·파일 첨부" disabled={busy}><Paperclip size={18} /></IconBtn>
        {/* embedded 모바일 autoFocus 금지 — 키보드가 뷰를 밀면 메시지 영역이 사라짐. 탭해서 입력. */}
        <Input value={text} onChange={setText} onEnter={send} placeholder="메시지 입력" full style={{ flex: 1 }} autoFocus={mobile && !embedded} disabled={busy} />
        {mobile ? (
          <IconBtn onClick={send} title={busy ? '전송 중' : '보내기'} disabled={busy || !text.trim()}>
            {busy ? <LoaderCircle size={18} /> : <Send size={18} />}
          </IconBtn>
        ) : (
          <Btn onClick={send} disabled={busy || !text.trim()}>{busy ? '전송 중…' : '보내기'}</Btn>
        )}
      </div>

      {full && <div onClick={() => setFull(null)} style={{ position: 'fixed', inset: 0, zIndex: 90, background: SCRIM.black, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}><img src={full} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: R }} /></div>}
    </div>
  );
}
