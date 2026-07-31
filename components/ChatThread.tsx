'use client';
import { useCallback, useEffect, useState, useRef, type DragEvent } from 'react';
import { getStore } from '@/lib/store';
import { getCompanyId } from '@/lib/tenant';
import { seedIfEmpty } from '@/lib/seed';
import { type EntityRecord } from '@/lib/intake/entities';
import { getRole, actor, type Role } from '@/lib/domain/deal';
import { sendText, sendFile as sendFileMsg, markRead, listMessages, isMine } from '@/lib/domain/messaging';
import { Btn, IconBtn, C, R, FW, FS, ICON, Loading, CenterNote, Input, ctrlH, ctrlInputFs, NavBack, Dropzone, SCRIM } from '@/components/ui';
import { toast } from '@/components/Toaster';
import { ChatSenderLabel } from '@/components/ChatSenderLabel';
import { useIsMobile } from '@/lib/use-mobile';
import { msgClock } from '@/lib/format';
import { ChevronLeft, ChevronRight, Download, LoaderCircle, Paperclip, Send, X } from 'lucide-react';

/** 📎 accept와 동일 — image/* · application/pdf */
function isAcceptedChatFile(file: File): boolean {
  return file.type.startsWith('image/') || file.type === 'application/pdf';
}

// 대화창 = 공통 원자(방 하나의 스레드+입력). 전송·안읽음 = messaging SSOT.
export function ChatThread({
  roomId, onBack, onVehicle, onContract, title, chatCode, onComposeFocus,
}: {
  roomId: string;
  onBack?: () => void;
  onVehicle?: (productCode: string) => void;
  onContract?: (productCode: string) => void;
  /** 입력창 포커스 알림 — 껍데기(WorkPage)가 하단독을 숨겼다 되돌리는 용도. */
  onComposeFocus?: (focused: boolean) => void;
  /** 목록·contextTitle과 동일 「차량번호 차량명」. 없으면 방 필드 폴백. */
  title?: string;
  /** erp3 대화코드(CH-차번-영업자). 스레드 단독 헤더에만 노출(WorkPage contextTitle이 담당할 때는 생략 가능). */
  chatCode?: string;
}) {
  const mobile = useIsMobile();
  const co = getCompanyId();
  const [room, setRoom] = useState<EntityRecord | null | undefined>(undefined);
  const [msgs, setMsgs] = useState<EntityRecord[] | undefined>(undefined);
  const [role, setRoleS] = useState<Role>('agent');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  // 첨부 뷰어 = 방 안 사진 전체를 하나의 갤러리로(통상 채팅과 동일). 인덱스로 좌우 이동.
  const [full, setFull] = useState<number | null>(null);
  const [viewSwipeX, setViewSwipeX] = useState<number | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const threadRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
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
  // 첨부 뷰어 — 데스크톱 키보드(Esc=닫기 · ←→=이동). 모바일은 버튼·스와이프.
  const galleryLen = (msgs || []).filter((m) => m.image_url).length;
  useEffect(() => {
    if (full == null) return;
    const step = (d: number) => setFull((i) => (i == null || !galleryLen ? i : (i + d + galleryLen) % galleryLen));
    const on = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFull(null);
      else if (e.key === 'ArrowLeft') step(-1);
      else if (e.key === 'ArrowRight') step(1);
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [full, galleryLen]);
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
    // 한 번에 여러 장 = 같은 batchId → 한 말풍선(앨범)으로 표시. 낱장은 batchId 없음 → 각각 표시.
    const list = Array.from(files);
    const batchId = list.length > 1 ? `B${Date.now()}` : undefined;
    let sent = 0;
    try {
      for (const file of list) {
        const rec = await sendFileMsg({ roomId, file, channel: '정식', role, batchId });
        setMsgs((prev) => [...(prev || []), rec]);
        sent += 1;
      }
      const rm = await getStore().get('room', co, roomId);
      if (rm) setRoom(rm);
    } catch (e) {
      console.error('첨부 전송 실패:', e);
      // 여러 장 중 일부만 올라간 경우를 숨기지 않는다 — 어디까지 갔는지 알려야 재시도 판단이 된다.
      const done = sent ? ` (${sent}/${list.length}장 전송됨)` : '';
      toast(`첨부 전송 실패${done}: ${(e as Error).message}`, 'error');
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
  // 방 안 사진 전체 = 뷰어 갤러리(올린 순서). 사진 하나를 열어도 좌우로 나머지를 다 볼 수 있어야 한다.
  const gallery = (msgs || [])
    .filter((m) => m.image_url)
    .map((m) => ({ url: String(m.image_url), name: String(m.file_name || '') }));
  const stepView = (d: number) => setFull((i) => (i == null || !gallery.length ? i : (i + d + gallery.length) % gallery.length));
  const openView = (url: unknown) => setFull(gallery.findIndex((g) => g.url === String(url)));
  // 같은 batch_id로 연속 도착한 사진 = 한 번에 올린 묶음 → 말풍선 하나(앨범). 낱장은 그대로 각각.
  const rows: { lead: EntityRecord; items: EntityRecord[] }[] = [];
  for (const m of msgs || []) {
    const b = String(m.batch_id || '');
    const last = rows[rows.length - 1];
    if (b && last && String(last.lead.batch_id || '') === b) { last.items.push(m); continue; }
    rows.push({ lead: m, items: [m] });
  }
  // WorkPage 선택(swap) = TopBar·BottomNav가 크롬 담당 → 스레드 헤더·컴포저 safe-area 생략(이중 여백·차명 중복 방지).
  const embedded = !onBack && !onVehicle && !onContract;
  const headTitle = (title || '').trim()
    || String(room?.vehicle_name || room?.car_number || room?.vehicle_number || '대화');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, background: C.taupeBg }}>
      {!embedded ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: ctrlH(mobile), flex: `0 0 ${ctrlH(mobile)}px`, padding: '0 14px', borderBottom: `1px solid ${C.line}`, background: C.taupeBg, boxSizing: 'border-box' }}>
          {onBack && <NavBack kind="list" onClick={onBack} />}
          <span style={{ fontSize: FS.title, fontWeight: FW.title, minWidth: 0, flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {headTitle}
            {chatCode ? (
              <span style={{ marginLeft: 8, color: C.faint, fontWeight: FW.label, fontSize: FS.sub }}>{chatCode}</span>
            ) : null}
          </span>
          {onVehicle && <Btn title="차량 보기" variant="ghost" size="sm" onClick={() => onVehicle(String(room.product_code))}>차량</Btn>}
          {onContract && <Btn title="계약 진행" size="sm" onClick={() => onContract(String(room.product_code))}>계약진행</Btn>}
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
        {rows.map((row) => {
          const m = row.lead;
          const mine = isMine(m, me, role);
          const isAdmin = m.sender_role === 'admin';
          const simple = m.channel === '간단';
          const clock = msgClock(m.created_at);
          // 앨범(한 번에 올린 사진 묶음) — 최대 6칸 노출, 나머지는 마지막 칸에 +N.
          const album = row.items.length > 1 && row.items.every((x) => x.image_url);
          const cells = album ? row.items.slice(0, 6) : [];
          const restN = album ? row.items.length - cells.length : 0;
          const cols = cells.length >= 3 ? 3 : 2;
          const bubble = album ? (
            <div style={{
              display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 2,
              width: Math.min(240, cols * 80), borderRadius: R, overflow: 'hidden',
              border: `1px solid ${C.line}`,
            }}>
              {cells.map((it, i) => (
                <button
                  key={String(it._key)}
                  type="button"
                  className="fp-press"
                  onClick={() => openView(it.image_url)}
                  title={`사진 ${i + 1}`}
                  style={{ position: 'relative', padding: 0, border: 'none', background: C.head, aspectRatio: '1 / 1', cursor: 'zoom-in', display: 'block' }}
                >
                  <img src={String(it.image_url)} alt="" loading="lazy" decoding="async" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                  {i === cells.length - 1 && restN > 0 && (
                    <span style={{
                      position: 'absolute', inset: 0, background: SCRIM.heavy, color: C.inverse,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: FS.title, fontWeight: FW.head,
                    }}>+{restN}</span>
                  )}
                </button>
              ))}
            </div>
          ) : m.image_url ? (
            <img
              src={String(m.image_url)}
              alt=""
              width={200}
              height={220}
              loading="lazy"
              decoding="async"
              onClick={() => openView(m.image_url)}
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
        <input ref={fileRef} type="file" accept="image/*,application/pdf" multiple onChange={(e) => onPickFile(e.target.files)} style={{ display: 'none' }} />
        {/* 모바일 = 아이콘 전용(첨부·보내기). 라벨을 달면 입력창 폭이 죽는다 —
            "아이콘 only 화이트리스트"의 채팅 입력행 예외(입력 폭 우선). 웹은 라벨 유지. */}
        {mobile ? (
          // pointerdown preventDefault = 입력창 포커스 유지. 안 막으면 blur→하단독이 다시 나타나며
          // 버튼이 위로 밀려 탭이 빗나간다(전송·첨부 둘 다 동일).
          <IconBtn onPointerDown={(e) => e.preventDefault()} onClick={() => fileRef.current?.click()} title="사진·파일 첨부" disabled={busy}>
            <Paperclip size={ICON.lg} aria-hidden />
          </IconBtn>
        ) : (
          <Btn size="sm" variant="ghost" onClick={() => fileRef.current?.click()} title="사진·파일 첨부" disabled={busy}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <Paperclip size={16} aria-hidden />
              첨부
            </span>
          </Btn>
        )}
        {/* embedded 모바일 autoFocus 금지 — 키보드가 뷰를 밀면 메시지 영역이 사라짐. 탭해서 입력.
            textarea 인 이유: <input> 이면 크롬이 이 칸을 비밀번호·카드·주소 후보로 보고 키보드 위에
            열쇠·카드·위치 칩을 띄운다. autocomplete='off' 로는 안 막힌다 — textarea 에는 그 자동완성이 없다.
            줄바꿈(Shift+Enter)도 덤으로 되고, 내용에 따라 4줄까지 늘어난다. */}
        <textarea
          ref={composerRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); }
          }}
          placeholder="메시지 입력"
          rows={1}
          disabled={busy}
          autoFocus={mobile && !embedded}
          enterKeyHint="send"
          autoComplete="off" autoCorrect="off" autoCapitalize="sentences" spellCheck={false}
          name="fp-chat-text" data-lpignore="true" data-1p-ignore="" data-form-type="other"
          onFocus={() => onComposeFocus?.(true)}
          onBlur={() => onComposeFocus?.(false)}
          style={{
            flex: 1, minWidth: 0, resize: 'none', overflowY: 'auto',
            minHeight: ctrlH(mobile), maxHeight: ctrlH(mobile) * 3,
            boxSizing: 'border-box',
            // 한 줄일 때 세로 가운데로 보이게 — textarea 는 input 과 달리 위쪽 정렬이다.
            padding: `${Math.max(0, (ctrlH(mobile) - Math.round(ctrlInputFs(mobile) * 1.4)) / 2)}px 12px`,
            border: `1px solid ${C.line}`, borderRadius: R,
            fontSize: ctrlInputFs(mobile), fontFamily: 'inherit', lineHeight: 1.4,
            background: busy ? C.head : C.taupeBg, color: C.ink,
          }}
        />
        {mobile ? (
          <IconBtn onPointerDown={(e) => e.preventDefault()} onClick={send} disabled={busy || !text.trim()} title={busy ? '전송 중' : '보내기'} active={!busy && !!text.trim()}>
            {busy ? <LoaderCircle size={ICON.lg} aria-hidden /> : <Send size={ICON.lg} aria-hidden />}
          </IconBtn>
        ) : (
          <Btn size="sm" onClick={send} disabled={busy || !text.trim()} title={busy ? '전송 중' : '보내기'}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              {busy ? <LoaderCircle size={16} aria-hidden /> : <Send size={16} aria-hidden />}
              {busy ? '전송 중…' : '보내기'}
            </span>
          </Btn>
        )}
      </div>

      {/* 첨부 뷰어 — 통상 채팅 규격: 좌우 넘김(버튼·스와이프) · 카운터 · 다운로드 · 닫기(→채팅으로 복귀) */}
      {full != null && gallery[full] && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="첨부 사진"
          onPointerDown={(e) => {
            if ((e.target as HTMLElement).closest('button, a')) return;
            setViewSwipeX(e.clientX);
          }}
          onPointerUp={(e) => {
            const sx = viewSwipeX; setViewSwipeX(null);
            if ((e.target as HTMLElement).closest('button, a')) return; // 버튼 탭은 제스처가 아님
            if (sx != null && Math.abs(e.clientX - sx) > 40) { stepView(e.clientX < sx ? 1 : -1); return; }
            setFull(null); // 빈 곳 탭 = 닫기(채팅으로)
          }}
          style={{
            position: 'fixed', inset: 0, zIndex: 90, background: SCRIM.black,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '56px 12px', touchAction: 'pan-y', userSelect: 'none',
          }}
        >
          <img
            src={gallery[full].url}
            alt=""
            draggable={false}
            style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: R, pointerEvents: 'none' }}
          />

          {/* 상단 바 — 카운터 · 다운로드 · 닫기 */}
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0,
            display: 'flex', alignItems: 'center', gap: 8,
            padding: `calc(env(safe-area-inset-top, 0px) + 8px) 12px 8px`,
          }}>
            <span style={{ flex: 1, color: C.inverse, fontSize: FS.sub, fontVariantNumeric: 'tabular-nums' }}>
              {full + 1} / {gallery.length}
            </span>
            <a
              href={gallery[full].url}
              download={gallery[full].name || 'photo'}
              title="다운로드"
              aria-label="다운로드"
              onClick={(e) => e.stopPropagation()}
              style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                width: ctrlH(mobile), height: ctrlH(mobile), borderRadius: R,
                background: SCRIM.heavy, color: C.inverse, textDecoration: 'none',
              }}
            >
              <Download size={ICON.lg} aria-hidden />
            </a>
            <IconBtn
              title="닫기"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => setFull(null)}
              style={{ border: 'none', background: SCRIM.heavy, color: C.inverse }}
            >
              <X size={ICON.lg} aria-hidden />
            </IconBtn>
          </div>

          {/* 좌우 넘김 — 2장 이상일 때만 */}
          {gallery.length > 1 && (
            <>
              <IconBtn
                title="이전 사진"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => stepView(-1)}
                style={{
                  position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)',
                  border: 'none', background: SCRIM.heavy, color: C.inverse, borderRadius: '50%',
                }}
              ><ChevronLeft size={ICON.xl} strokeWidth={2.5} /></IconBtn>
              <IconBtn
                title="다음 사진"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => stepView(1)}
                style={{
                  position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
                  border: 'none', background: SCRIM.heavy, color: C.inverse, borderRadius: '50%',
                }}
              ><ChevronRight size={ICON.xl} strokeWidth={2.5} /></IconBtn>
            </>
          )}
        </div>
      )}
    </div>
  );
}
