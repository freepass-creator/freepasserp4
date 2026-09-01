'use client';

import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import { ChatThread } from '@/components/ChatThread';
import {
  Btn, ButtonLabel, CenterNote, CountPill, C, Dropzone, FS, FW, ICON, IconBtn, ListRow, Message, PaneBody, PaneHead, VSplit, ctrlPadX,
} from '@/components/ui';
import { useIsMobile } from '@/lib/use-mobile';
import { getRole, type ConsultApp } from '@/lib/domain/deal';
import { listMessages, sendFile, isAcceptedChatFile, CHAT_FILE_ACCEPT } from '@/lib/domain/messaging';
import { fileSizeText } from '@/lib/format';
import { toast } from '@/components/Toaster';
import { ChevronDown, ChevronUp, Download, Paperclip } from 'lucide-react';

// 견적기 좌측 차량 레일(400px)과 좌우 균형을 맞춘 폭. 채팅 말풍선·첨부행이 320 에선 답답했다.
const PANEL_W = 420;
const ATTACH_MAX = 0.45;
const ATTACH_INITIAL = 0.35;

type ChatAtt = {
  id: string;
  name: string;
  size: number;
  type: string;
  url: string;
};

/** ChatThread 와 동일 — image/* · application/pdf */

/** ContractDocs sz() 와 동일. */

function attFromMessage(m: { _key?: unknown; image_url?: unknown; file_url?: unknown; file_name?: unknown; file_size?: unknown; file_type?: unknown }): ChatAtt | null {
  const url = String(m.image_url || m.file_url || '').trim();
  if (!url) return null;
  const fileName = String(m.file_name || '').trim();
  const name = m.image_url
    ? (fileName || '채팅 사진')
    : (fileName || '채팅 파일');
  return {
    id: String(m._key || url),
    name,
    size: Number(m.file_size) || 0,
    type: String(m.file_type || (m.image_url ? 'image/jpeg' : '')),
    url,
  };
}

/**
 * 견적기(손오공·웰릭스) 옆 상담 패널.
 * 첨부 = ChatThread 와 같은 sendFile 경로(새 업로드 로직 금지). 목록 = 방 메시지 첨부 미러.
 */
export function ConsultPanel({
  app,
  roomId = null,
  fill = false,
  note = null,
  onBack,
}: {
  app: ConsultApp;
  roomId?: string | null;
  /** 하단시트 등 — 고정폭 대신 부모 폭을 채움. */
  fill?: boolean;
  /** 상담을 열 수 없는 사유 — 빈 화면을 남기지 않는다. */
  note?: { text: string; variant: 'info' | 'warning' } | null;
  /** 주면 ChatThread 헤더(이전 버튼)가 살아난다. 안 주면 embedded 로 판정돼 헤더가 생략된다. */
  onBack?: () => void;
}) {
  const mobile = useIsMobile();
  const [files, setFiles] = useState<ChatAtt[]>([]);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [attachCollapsed, setAttachCollapsed] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const reloadAtts = useCallback(async () => {
    if (!roomId) {
      setFiles([]);
      return;
    }
    try {
      const msgs = await listMessages(roomId);
      setFiles(
        msgs
          .map((m) => attFromMessage(m))
          .filter((a): a is ChatAtt => !!a)
          .reverse(),
      );
    } catch (e) {
      console.warn('상담 첨부 목록 실패:', e);
    }
  }, [roomId]);

  useEffect(() => {
    void reloadAtts();
  }, [reloadAtts]);

  useEffect(() => {
    if (!roomId) return;
    const on = () => { void reloadAtts(); };
    window.addEventListener('fp:unread', on);
    const id = window.setInterval(on, 5000);
    return () => {
      window.removeEventListener('fp:unread', on);
      window.clearInterval(id);
    };
  }, [roomId, reloadAtts]);

  const uploadFiles = async (list: FileList | File[] | null) => {
    if (!roomId) {
      toast('상담 방이 아직 없습니다', 'info');
      return;
    }
    if (!list?.length || busy) return;
    const accepted = Array.from(list).filter((f) => f && isAcceptedChatFile(f));
    if (!accepted.length) {
      toast('이미지 또는 PDF만 첨부할 수 있습니다', 'error');
      return;
    }
    setBusy(true);
    const batchId = accepted.length > 1 ? `B${Date.now()}` : undefined;
    let sent = 0;
    try {
      const role = getRole();
      for (const file of accepted) {
        // ChatThread onPickFile 과 동일 경로 — messaging.sendFile.
        await sendFile({ roomId, file, channel: '정식', role, batchId });
        sent += 1;
      }
      await reloadAtts();
    } catch (e) {
      console.error('상담 첨부 전송 실패:', e);
      const done = sent ? ` (${sent}/${accepted.length}장 전송됨)` : '';
      toast(`첨부 전송 실패${done}: ${(e as Error).message}`, 'error');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const attachHead = (
    <PaneHead
      title={(
        <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6, minWidth: 0 }}>
          문의 및 첨부서류
          {files.length > 0 ? <CountPill n={files.length} /> : null}
          {/* 무엇이 어디로 가는지 — 올린 뒤 "보냈나?" 하고 되묻지 않게 헤더에서 바로 알린다 */}
          <span style={{
            fontSize: FS.micro, fontWeight: FW.label, color: C.mute,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0,
          }}>
            상담 이력에 함께 보관 · 이미지·PDF 3MB
          </span>
        </span>
      )}
      right={(
        <IconBtn
          title={attachCollapsed ? '첨부 펼치기' : '첨부 접기'}
          onClick={() => setAttachCollapsed((v) => !v)}
        >
          {attachCollapsed ? <ChevronDown size={ICON.sm} aria-hidden /> : <ChevronUp size={ICON.sm} aria-hidden />}
        </IconBtn>
      )}
    />
  );

  const attachBody = (
    <PaneBody>
      <div style={{ padding: `8px ${ctrlPadX(mobile)}px`, display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0, flex: 1, boxSizing: 'border-box' }}>
        <Dropzone
          variant="file"
          active={drag}
          title={busy ? '첨부 중…' : '파일 첨부'}
          onClick={() => { if (!busy) fileRef.current?.click(); }}
          onDragOver={(e: DragEvent) => { e.preventDefault(); if (!busy) setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e: DragEvent) => {
            e.preventDefault();
            setDrag(false);
            void uploadFiles(e.dataTransfer.files);
          }}
          style={{ flex: '0 0 auto' }}
        >
          <Paperclip size={ICON.md} color={drag ? C.brand : C.faint} aria-hidden />
          <span style={{ fontSize: FS.cap, color: drag ? C.brand : C.mute, fontWeight: FW.strong }}>
            {busy ? '첨부 중…' : '파일을 여기로 끌어놓거나 클릭'}
          </span>
          <span style={{ fontSize: FS.micro, color: C.faint }}>이미지·PDF 등 · 채팅 첨부와 동일</span>
          <input
            ref={fileRef}
            type="file"
            multiple
            accept={CHAT_FILE_ACCEPT}
            style={{ display: 'none' }}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => {
              void uploadFiles(e.target.files);
            }}
          />
        </Dropzone>
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
          {files.length === 0 ? (
            <CenterNote minHeight={48}>첨부된 서류가 없습니다.</CenterNote>
          ) : (
            files.map((f) => {
              const sizeLabel = fileSizeText(f.size);
              const isPdf = /pdf/i.test(f.type) || /\.pdf$/i.test(f.name);
              return (
                <ListRow
                  key={f.id}
                  badge={isPdf ? 'PDF' : undefined}
                  badgeTone="red"
                  main={f.name}
                  sub={sizeLabel || undefined}
                  right={(
                    <Btn
                      size="sm"
                      variant="ghost"
                      title="열기"
                      onClick={() => window.open(f.url, '_blank', 'noopener,noreferrer')}
                    >
                      <ButtonLabel icon={<Download size={ICON.md} aria-hidden />}>열기</ButtonLabel>
                    </Btn>
                  )}
                />
              );
            })
          )}
        </div>
      </div>
    </PaneBody>
  );

  const chatPane = (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {note ? (
        <div style={{ padding: `8px ${ctrlPadX(mobile)}px 0` }}>
          <Message variant={note.variant}>{note.text}</Message>
        </div>
      ) : null}
      <ChatThread roomId={roomId} onBack={onBack} />
    </div>
  );

  const body = attachCollapsed ? (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      {attachHead}
      {chatPane}
    </div>
  ) : (
    <VSplit
      top={(
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          {attachHead}
          {attachBody}
        </div>
      )}
      bottom={chatPane}
      initial={ATTACH_INITIAL}
      max={ATTACH_MAX}
      min={0.18}
      storageKey={`fp4_consult_split_${app}`}
    />
  );

  return (
    <aside
      data-consult-app={app}
      style={{
        flex: fill ? '1 1 0' : `0 0 ${PANEL_W}px`,
        width: fill ? '100%' : PANEL_W,
        minWidth: fill ? 0 : PANEL_W,
        maxWidth: fill ? undefined : PANEL_W,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        borderLeft: fill ? undefined : `1px solid ${C.line}`,
        background: C.taupeBg,
        boxSizing: 'border-box',
      }}
    >
      {body}
    </aside>
  );
}
