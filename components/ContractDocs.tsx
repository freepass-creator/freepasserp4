'use client';
import { useEffect, useRef, useState } from 'react';
import { getStore } from '@/lib/store';
import { getCompanyId } from '@/lib/tenant';
import { getRole, actor, ROLE_LABEL, type Role } from '@/lib/domain/deal';
import { isContractCancelled } from '@/lib/domain/contract';
import { C, R, FS, FW, Btn, ButtonLabel, Dropzone, SCRIM, ICON } from '@/components/ui';
import { useIsMobile } from '@/lib/use-mobile';
import { Paperclip, FileText, X, Download, Trash2 } from 'lucide-react';
import { toast } from '@/components/Toaster';
import { deleteManagedFile, uploadManagedFile, type DriveBackupStatus } from '@/lib/firebase/storage-files';
import { findRoomForContract } from '@/features/chat/room-display';

// 신규 파일은 Storage 원본 + Drive 백업으로 저장한다. 기존 data URL 레코드는 계속 읽는다.
type Att = {
  name: string;
  size: number;
  type: string;
  at: number;
  url?: string;
  storage_path?: string;
  drive_backup_status?: DriveBackupStatus;
  drive_file_id?: string;
  drive_web_view_link?: string;
  by_role?: string;
  by_name?: string;
  fromChat?: boolean;
};
const CAP = 4 * 1024 * 1024;

function fileNameFromUrl(url: string): string {
  try {
    const bare = decodeURIComponent(String(url).split('?')[0] || '');
    const o = bare.match(/\/o\/(.+)$/);
    const path = o ? decodeURIComponent(o[1]) : bare;
    const base = path.split('/').filter(Boolean).pop() || '';
    if (base && !/^https?:$/i.test(base)) return base;
  } catch { /* ignore */ }
  return '첨부파일';
}
function looksLikeUrl(s: string): boolean {
  return /^https?:\/\//i.test(s) || /firebasestorage\.googleapis/i.test(s);
}
function guessType(s: string): string {
  if (/\.(jpe?g|png|gif|webp|bmp)(\?|$)/i.test(s)) return 'image/jpeg';
  if (/\.pdf(\?|$)/i.test(s)) return 'application/pdf';
  return '';
}
/** v3·레거시 첨부 레코드 → 화면용(이름·용량·타입). URL이 name 자리에 들어온 경우 복구. */
function coerceAtt(raw: unknown): Att | null {
  if (raw == null) return null;
  if (typeof raw === 'string') {
    const url = raw.trim();
    if (!url) return null;
    return { name: fileNameFromUrl(url), size: 0, type: guessType(url), at: 0, url };
  }
  if (typeof raw !== 'object') return null;
  const d = raw as Record<string, unknown>;
  let url = String(d.url || d.downloadURL || d.href || d.src || '').trim();
  let name = String(d.name || d.file_name || d.filename || d.original_name || d.title || '').trim();
  // v3: name 자리에 Storage URL만 넣고 url 필드가 비어 있는 경우
  if (!url && looksLikeUrl(name)) url = name;
  if (!name || looksLikeUrl(name)) name = url ? fileNameFromUrl(url) : '첨부파일';
  const sizeN = Number(d.size ?? d.bytes ?? d.file_size ?? d.byteSize);
  const size = Number.isFinite(sizeN) && sizeN > 0 ? sizeN : 0;
  const type = String(d.type || d.contentType || d.mime || guessType(name) || guessType(url) || '');
  const atN = Number(d.at || d.created_at || d.uploaded_at || d.ts || d.time);
  const at = Number.isFinite(atN) && atN > 0 ? atN : 0;
  return {
    name, size, type, at, url: url || undefined,
    storage_path: d.storage_path != null ? String(d.storage_path) : undefined,
    drive_backup_status: d.drive_backup_status as DriveBackupStatus | undefined,
    drive_file_id: d.drive_file_id != null ? String(d.drive_file_id) : undefined,
    drive_web_view_link: d.drive_web_view_link != null ? String(d.drive_web_view_link) : undefined,
    by_role: d.by_role != null ? String(d.by_role) : undefined,
    by_name: d.by_name != null ? String(d.by_name) : undefined,
    fromChat: !!d.fromChat,
  };
}

export function ContractDocs({ contractCode, roomId, readOnly = false }: { contractCode: string; roomId?: string; readOnly?: boolean }) {
  const mobile = useIsMobile();
  const co = getCompanyId();
  const thumb = mobile ? 40 : 34;
  const [atts, setAtts] = useState<Att[]>([]);
  const [chatAtts, setChatAtts] = useState<Att[]>([]);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [preview, setPreview] = useState<Att | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const selectionEpoch = useRef(0);
  const operationRef = useRef(false);

  const getWritableContract = async (targetCode: string, epoch: number) => {
    const store = getStore();
    const latest = store.getFresh
      ? await store.getFresh('contract', co, targetCode)
      : await store.get('contract', co, targetCode);
    if (epoch !== selectionEpoch.current) throw new Error('선택이 변경되어 첨부 작업을 중단했습니다.');
    if (!latest) throw new Error('계약 정보를 찾을 수 없습니다.');
    if (isContractCancelled(latest)) throw new Error('취소된 계약에는 첨부를 변경할 수 없습니다.');
    return latest;
  };

  const load = async (epoch = selectionEpoch.current) => {
    const c = await getStore().get('contract', co, contractCode);
    if (!c) throw new Error('계약 정보를 찾을 수 없습니다.');
    const raw = Array.isArray(c?.attachments) ? (c!.attachments as unknown[]) : [];
    const nextAtts = raw.map(coerceAtt).filter((a): a is Att => !!a);
    // 채팅 첨부 자동 미러링 — 이 계약의 방(매물+영업자)에 올린 사진·파일을 첨부 서류에 자동 노출(중복 저장 없이).
    let rid = roomId;
    let nextChatAtts: Att[] = [];
    if (!rid && c) {
      const rms = await getStore().list('room', co);
      rid = findRoomForContract(rms, c)?._key as string | undefined;
    }
    if (rid) {
      const msgs = (await getStore().list('message', co)).filter((m) => m.room_id === rid && (m.image_url || m.file_url));
      nextChatAtts = msgs.map((m) => {
        const url = String(m.image_url || m.file_url || '');
        const fileName = String(m.file_name || '').trim();
        const name = m.image_url
          ? (fileName && !looksLikeUrl(fileName) ? fileName : '채팅 사진')
          : (fileName && !looksLikeUrl(fileName) ? fileName : (url ? fileNameFromUrl(url) : '채팅 파일'));
        return {
          name,
          size: 0,
          type: m.image_url ? 'image/jpeg' : (guessType(fileName || url) || ''),
          at: Number(m.created_at) || 0,
          url,
          by_role: ROLE_LABEL[m.sender_role as Role] || '',
          by_name: String(m.sender_name || ''),
          fromChat: true,
        } satisfies Att;
      });
    }
    if (epoch !== selectionEpoch.current) return;
    setAtts(nextAtts);
    setChatAtts(nextChatAtts);
    setLoadState('ready');
  };
  useEffect(() => {
    const epoch = ++selectionEpoch.current;
    setAtts([]);
    setChatAtts([]);
    setDrag(false);
    setBusy(false);
    operationRef.current = false;
    setLoadState('loading');
    setPreview(null);
    void load(epoch).catch((error) => {
      if (epoch !== selectionEpoch.current) return;
      setLoadState('error');
      toast(`첨부 서류 조회 실패: ${String((error as Error)?.message || error)}`, 'error');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contractCode]);

  const addFiles = async (files: FileList | null) => {
    if (readOnly || loadState !== 'ready' || !files || !files.length || operationRef.current) return;
    const epoch = selectionEpoch.current;
    const targetCode = contractCode;
    operationRef.current = true;
    setBusy(true);
    try {
      const me = actor(getRole());
      const role = ROLE_LABEL[getRole()];
      const added: Att[] = [];
      for (const f of Array.from(files)) {
        if (f.size > CAP) { toast(`${f.name} — 4MB 초과로 첨부 생략`, 'error'); continue; }
        try {
          const uploaded = await uploadManagedFile(f, {
            kind: 'contract',
            entityId: targetCode,
            backupToDrive: true,
          });
          added.push({
            name: uploaded.file_name,
            size: uploaded.file_size,
            type: uploaded.file_type,
            at: uploaded.uploaded_at,
            url: uploaded.url,
            storage_path: uploaded.storage_path,
            drive_backup_status: uploaded.drive_backup_status,
            drive_file_id: uploaded.drive_file_id,
            drive_web_view_link: uploaded.drive_web_view_link,
            by_role: role,
            by_name: me.name,
          });
        } catch (error) {
          toast(`${f.name} 업로드 실패: ${String((error as Error)?.message || error)}`, 'error');
        }
      }
      if (!added.length) return;
      try {
        const latest = await getWritableContract(targetCode, epoch);
        const latestAtts = Array.isArray(latest.attachments)
          ? (latest.attachments as unknown[]).map(coerceAtt).filter((a): a is Att => !!a)
          : [];
        const seen = new Set(latestAtts.map((file) => file.storage_path || file.url || `${file.name}:${file.at}`));
        const next = [...latestAtts, ...added.filter((file) => {
          const key = file.storage_path || file.url || `${file.name}:${file.at}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })];
        await getStore().update('contract', co, targetCode, { attachments: next });
        if (epoch === selectionEpoch.current) setAtts(next);
      } catch (error) {
        await Promise.all(added.map((file) =>
          deleteManagedFile(file.storage_path || file.url || '').catch(() => undefined)
        ));
        throw error;
      }
      const saved = added.filter((file) => file.drive_backup_status === 'saved').length;
      const disabled = added.some((file) => file.drive_backup_status === 'disabled');
      const failed = added.some((file) => file.drive_backup_status === 'failed');
      if (epoch === selectionEpoch.current) {
        if (failed) toast(`${added.length}건 첨부됨 · Drive 백업 일부 실패`, 'error');
        else if (disabled) toast(`${added.length}건 첨부됨 · Drive 백업 미설정`, 'ok');
        else toast(`${added.length}건 첨부됨${saved ? ` · Drive 백업 ${saved}건` : ''}`, 'ok');
      }
    } catch (e) {
      if (epoch === selectionEpoch.current) toast(`첨부 실패: ${String((e as Error)?.message || e)}`, 'error');
    } finally {
      if (epoch === selectionEpoch.current) {
        operationRef.current = false;
        setBusy(false);
        if (inputRef.current) inputRef.current.value = '';
      }
    }
  };
  const remove = async (target: Att) => {
    if (readOnly || loadState !== 'ready' || operationRef.current) return;
    const epoch = selectionEpoch.current;
    const targetCode = contractCode;
    operationRef.current = true;
    setBusy(true);
    try {
      const latest = await getWritableContract(targetCode, epoch);
      const latestAtts = Array.isArray(latest.attachments)
        ? (latest.attachments as unknown[]).map(coerceAtt).filter((a): a is Att => !!a)
        : [];
      const next = latestAtts.filter((a) => !(a.url === target.url && a.at === target.at));
      await getStore().update('contract', co, targetCode, { attachments: next });
      if (epoch === selectionEpoch.current) setAtts(next);
      try {
        await deleteManagedFile(target.storage_path || target.url || '');
      } catch (error) {
        if (epoch === selectionEpoch.current) toast(`목록에서는 삭제됐지만 Storage 원본 삭제 실패: ${String((error as Error)?.message || error)}`, 'error');
      }
    } catch (e) {
      if (epoch === selectionEpoch.current) toast(`첨부 삭제 실패: ${String((e as Error)?.message || e)}`, 'error');
    } finally {
      if (epoch === selectionEpoch.current) {
        operationRef.current = false;
        setBusy(false);
      }
    }
  };
  const sz = (n: number) => {
    if (!Number.isFinite(n) || n <= 0) return '';
    return n >= 1048576 ? `${(n / 1048576).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`;
  };
  const isImg = (a: Att) => /^image\//.test(a.type || '') || /\.(jpe?g|png|gif|webp|bmp)(\?|$)/i.test(a.name || a.url || '');
  const isPdf = (a: Att) => /pdf/i.test(a.type || '') || /\.pdf(\?|$)/i.test(a.name || a.url || '');
  const canPreview = (a: Att) => !!a.url && (isImg(a) || isPdf(a));
  // 수동 첨부 + 채팅 미러(중복 url 제외) 합쳐 시간순 노출.
  const manualKeys = new Set(atts.map((a) => a.url));
  const merged = [...atts, ...chatAtts.filter((c) => !manualKeys.has(c.url))].sort((a, b) => a.at - b.at);

  return (
    <div style={{ padding: '12px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: FS.sub, fontWeight: FW.title, color: C.ink }}>첨부 서류</span>
        <span style={{ fontSize: FS.cap, color: C.faint }}>{loadState === 'ready' ? merged.length : '—'}</span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: FS.cap, color: C.faint }}>{readOnly ? '취소 계약 · 읽기 전용' : 'Storage 원본 · Drive 백업(설정 시)'}</span>
      </div>

      {!readOnly && loadState === 'ready' ? (
        <Dropzone
          variant="file"
          active={drag}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); addFiles(e.dataTransfer.files); }}
          style={{ marginBottom: 8 }}
          title={busy ? '첨부 중…' : '파일 첨부'}
        >
          <Paperclip size={16} color={drag ? C.brand : C.faint} />
          <span style={{ fontSize: FS.cap, color: drag ? C.brand : C.mute, fontWeight: FW.strong }}>{busy ? '첨부 중…' : '파일을 여기로 끌어놓거나 클릭'}</span>
          <span style={{ fontSize: FS.micro, color: C.faint }}>이미지·PDF 등 · 4MB/파일</span>
          <input ref={inputRef} type="file" multiple disabled={busy} onChange={(e) => void addFiles(e.target.files)} style={{ display: 'none' }} onClick={(e) => e.stopPropagation()} />
        </Dropzone>
      ) : !readOnly ? (
        <div style={{ marginBottom: 8, padding: '12px 10px', textAlign: 'center', border: `1px solid ${C.line}`, borderRadius: R, color: loadState === 'error' ? C.danger : C.faint, fontSize: FS.cap }}>
          {loadState === 'error' ? '첨부 서류를 불러오지 못했습니다. 새로고침 후 다시 시도하세요.' : '첨부 서류 불러오는 중…'}
        </div>
      ) : null}

      {loadState !== 'ready' ? null : merged.length === 0 ? <div style={{ fontSize: FS.cap, color: C.faint, textAlign: 'center', padding: '6px 0' }}>첨부된 서류가 없습니다.</div> :
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {merged.map((a, i) => {
            const sizeLabel = sz(a.size);
            return (
              <div key={`${a.url || a.name}-${a.at}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 9px', border: `1px solid ${C.line}`, borderRadius: R, background: C.taupeBg }}>
                {isImg(a) && a.url
                  ? <img src={a.url} alt="" onClick={() => setPreview(a)} style={{ width: thumb, height: thumb, objectFit: 'cover', borderRadius: R, cursor: 'zoom-in', flex: '0 0 auto', background: C.placeholder }} />
                  : <span onClick={() => canPreview(a) && setPreview(a)} style={{ display: 'flex', flex: '0 0 auto', cursor: canPreview(a) ? 'pointer' : 'default' }}>{isPdf(a) ? <FileText size={16} color={C.danger} /> : <FileText size={14} color={C.mute} />}</span>}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span
                    onClick={() => canPreview(a) ? setPreview(a) : a.url && window.open(a.url, '_blank')}
                    title={a.name}
                    style={{ fontSize: FS.sub, fontWeight: FW.strong, color: C.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block', cursor: 'pointer' }}
                  >{a.name}</span>
                  <span style={{ fontSize: FS.micro, color: C.faint }}>
                    {[sizeLabel, a.fromChat ? '채팅' : '', [a.by_role, a.by_name].filter(Boolean).join(' ')].filter(Boolean).join(' · ')}
                    {(a.by_name || a.by_role) && !a.fromChat ? ' 첨부' : ''}
                    {!a.fromChat && a.drive_backup_status === 'saved' ? ' · Drive 백업됨' : ''}
                    {!a.fromChat && a.drive_backup_status === 'failed' ? ' · Drive 백업 실패' : ''}
                    {!a.fromChat && a.drive_backup_status === 'disabled' ? ' · Drive 미설정' : ''}
                  </span>
                </div>
                {a.fromChat
                  ? <span style={{ fontSize: FS.micro, fontWeight: FW.label, color: C.brand, background: C.selected, borderRadius: R, padding: '1px 5px', flex: '0 0 auto' }}>채팅</span>
                  : null}
                {a.url && <a href={a.url} download={a.name} aria-label="다운로드" style={{ color: C.faint, display: 'flex', flex: '0 0 auto' }}><Download size={13} /></a>}
                {!a.fromChat && !readOnly ? (
                  <Btn size="sm" variant="danger" title="삭제" disabled={busy} onClick={() => remove(a)}>
                    <ButtonLabel icon={<Trash2 size={ICON.md} aria-hidden />}>삭제</ButtonLabel>
                  </Btn>
                ) : null}
              </div>
            );
          })}
        </div>}

      {preview && preview.url && (
        <div onClick={() => setPreview(null)} style={{ position: 'fixed', inset: 0, zIndex: 90, background: SCRIM.black, display: 'flex', flexDirection: 'column', padding: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: C.inverse, padding: '4px 6px 8px' }}>
            <span style={{ fontSize: FS.sub, fontWeight: FW.title, flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{preview.name}</span>
            <a href={preview.url} download={preview.name} onClick={(e) => e.stopPropagation()} aria-label="다운로드" style={{ color: C.inverse, display: 'flex' }}><Download size={17} /></a>
            <Btn
              mobileIcon={<X size={18} />}
              title="미리보기 닫기"
              size="sm"
              variant="ghost"
              onClick={() => setPreview(null)}
              style={{ background: 'transparent', border: 'none', color: C.inverse, boxShadow: 'none', minWidth: 40 }}
            >닫기</Btn>
          </div>
          <div onClick={(e) => e.stopPropagation()} style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'auto' }}>
            {isPdf(preview)
              ? <iframe title={preview.name} src={preview.url} style={{ width: '100%', height: '100%', border: 'none', background: C.taupeBg, borderRadius: R }} />
              : <img src={preview.url} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: R }} />}
          </div>
        </div>
      )}
    </div>
  );
}
