'use client';
import { useEffect, useRef, useState } from 'react';
import { getStore } from '@/lib/store';
import { getCompanyId } from '@/lib/tenant';
import { type EntityRecord } from '@/lib/intake/entities';
import { getRole, actor, ROLE_LABEL, type Role } from '@/lib/domain/deal';
import { C, R, IconBtn, Btn } from '@/components/ui';
import { Paperclip, FileText, X, Download } from 'lucide-react';
import { toast } from '@/components/Toaster';

// 첨부 서류 = 계약별 파일. 파일 내용(data URL)까지 계약 레코드에 저장 → 그 계약을 보는 영업·공급·관리자가 함께 열람.
// 드래그앤드랍 + 클릭 열람 + 첨부자(역할) 기록. ⚠ 로컬/RTDB엔 data URL 저장(대용량은 Firebase Storage 후속).
type Att = { name: string; size: number; type: string; at: number; url?: string; by_role?: string; by_name?: string; fromChat?: boolean };
const CAP = 4 * 1024 * 1024; // 4MB/파일 (localStorage 한도 보호)
const toDataUrl = (f: File) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(f); });

export function ContractDocs({ contractCode, roomId }: { contractCode: string; roomId?: string }) {
  const co = getCompanyId();
  const [atts, setAtts] = useState<Att[]>([]);
  const [chatAtts, setChatAtts] = useState<Att[]>([]);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Att | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const load = async () => {
    const c = await getStore().get('contract', co, contractCode);
    setAtts(Array.isArray(c?.attachments) ? (c!.attachments as Att[]) : []);
    // 채팅 첨부 자동 미러링 — 이 계약의 방(매물+영업자)에 올린 사진·파일을 첨부 서류에 자동 노출(중복 저장 없이).
    let rid = roomId;
    if (!rid && c) {
      const rms = await getStore().list('room', co);
      rid = rms.find((r) => String(r.product_code) === String(c.product_code) && String(r.agent_code) === String(c.agent_code))?._key as string | undefined;
    }
    if (rid) {
      const msgs = (await getStore().list('message', co)).filter((m) => m.room_id === rid && (m.image_url || m.file_url));
      setChatAtts(msgs.map((m) => ({
        name: m.image_url ? '채팅 사진' : String(m.file_name || '채팅 파일'),
        size: 0,
        type: m.image_url ? 'image/*' : (/\.pdf$/i.test(String(m.file_name || '')) ? 'application/pdf' : ''),
        at: Number(m.created_at) || 0,
        url: String(m.image_url || m.file_url),
        by_role: ROLE_LABEL[m.sender_role as Role] || '',
        by_name: String(m.sender_name || ''),
        fromChat: true,
      })));
    } else setChatAtts([]);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [contractCode, roomId]);

  const addFiles = async (files: FileList | null) => {
    if (!files || !files.length || busy) return;
    setBusy(true);
    try {
      const now = Date.now();
      const me = actor(getRole());
      const role = ROLE_LABEL[getRole()];
      const added: Att[] = [];
      for (const f of Array.from(files)) {
        if (f.size > CAP) { toast(`${f.name} — 4MB 초과로 첨부 생략`, 'error'); continue; }
        const url = await toDataUrl(f);
        added.push({ name: f.name, size: f.size, type: f.type, at: now, url, by_role: role, by_name: me.name });
      }
      if (!added.length) return;
      const next = [...atts, ...added];
      await getStore().update('contract', co, contractCode, { attachments: next });
      setAtts(next);
    } finally { setBusy(false); if (inputRef.current) inputRef.current.value = ''; }
  };
  const remove = async (target: Att) => { const next = atts.filter((a) => !(a.url === target.url && a.at === target.at)); await getStore().update('contract', co, contractCode, { attachments: next }); setAtts(next); };
  const sz = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`);
  const isImg = (a: Att) => /^image\//.test(a.type || '');
  const isPdf = (a: Att) => /pdf/i.test(a.type || '') || /\.pdf$/i.test(a.name);
  const canPreview = (a: Att) => !!a.url && (isImg(a) || isPdf(a));
  // 수동 첨부 + 채팅 미러(중복 url 제외) 합쳐 시간순 노출.
  const manualKeys = new Set(atts.map((a) => a.url));
  const merged = [...atts, ...chatAtts.filter((c) => !manualKeys.has(c.url))].sort((a, b) => a.at - b.at);

  return (
    <div style={{ padding: '12px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 800, color: C.ink }}>첨부 서류</span>
        <span style={{ fontSize: 11, color: C.faint }}>{merged.length}</span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 10.5, color: C.faint }}>영업·공급·관리자 공유</span>
      </div>

      {/* 드래그앤드랍 존 */}
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); addFiles(e.dataTransfer.files); }}
        style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, padding: '16px 12px', border: `1.5px dashed ${drag ? C.brand : C.line}`, borderRadius: R, background: drag ? C.selected : '#fafbfc', cursor: 'pointer', marginBottom: 8, transition: 'background .12s, border-color .12s' }}>
        <Paperclip size={16} color={drag ? C.brand : C.faint} />
        <span style={{ fontSize: 11.5, color: drag ? C.brand : C.mute, fontWeight: 600 }}>{busy ? '첨부 중…' : '파일을 여기로 끌어놓거나 클릭'}</span>
        <span style={{ fontSize: 10, color: C.faint }}>이미지·PDF 등 · 4MB/파일</span>
        <input ref={inputRef} type="file" multiple onChange={(e) => addFiles(e.target.files)} style={{ display: 'none' }} />
      </div>

      {merged.length === 0 ? <div style={{ fontSize: 11.5, color: C.faint, textAlign: 'center', padding: '6px 0' }}>첨부된 서류가 없습니다.</div> :
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {merged.map((a, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 9px', border: `1px solid ${C.line}`, borderRadius: R, background: C.taupeBg }}>
              {isImg(a) && a.url
                ? <img src={a.url} alt="" onClick={() => setPreview(a)} style={{ width: 34, height: 34, objectFit: 'cover', borderRadius: R, cursor: 'zoom-in', flex: '0 0 auto', background: C.placeholder }} />
                : <span onClick={() => canPreview(a) && setPreview(a)} style={{ display: 'flex', flex: '0 0 auto', cursor: canPreview(a) ? 'pointer' : 'default' }}>{isPdf(a) ? <FileText size={16} color="#c0392b" /> : <FileText size={14} color={C.mute} />}</span>}
              <div style={{ flex: 1, minWidth: 0 }}>
                <span onClick={() => canPreview(a) ? setPreview(a) : a.url && window.open(a.url, '_blank')} style={{ fontSize: 12, color: C.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block', cursor: 'pointer' }}>{a.name}</span>
                {(a.by_name || a.by_role || a.fromChat) && <span style={{ fontSize: 10, color: C.faint }}>{a.fromChat ? '채팅 · ' : ''}{[a.by_role, a.by_name].filter(Boolean).join(' ')} 첨부</span>}
              </div>
              {a.fromChat
                ? <span style={{ fontSize: 9.5, fontWeight: 700, color: C.brand, background: C.selected, borderRadius: R, padding: '1px 5px', flex: '0 0 auto' }}>채팅</span>
                : <span style={{ fontSize: 10.5, color: C.faint, fontVariantNumeric: 'tabular-nums', flex: '0 0 auto' }}>{sz(a.size)}</span>}
              {a.url && <a href={a.url} download={a.name} aria-label="다운로드" style={{ color: C.faint, display: 'flex', flex: '0 0 auto' }}><Download size={13} /></a>}
              {!a.fromChat && <IconBtn title="삭제" onClick={() => remove(a)}><X size={13} /></IconBtn>}
            </div>
          ))}
        </div>}

      {preview && preview.url && (
        <div onClick={() => setPreview(null)} style={{ position: 'fixed', inset: 0, zIndex: 90, background: 'rgba(0,0,0,0.9)', display: 'flex', flexDirection: 'column', padding: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#fff', padding: '4px 6px 8px' }}>
            <span style={{ fontSize: 12.5, fontWeight: 700, flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{preview.name}</span>
            <a href={preview.url} download={preview.name} onClick={(e) => e.stopPropagation()} aria-label="다운로드" style={{ color: '#fff', display: 'flex' }}><Download size={17} /></a>
            <Btn
              size="sm"
              variant="ghost"
              onClick={() => setPreview(null)}
              style={{ background: 'transparent', border: 'none', color: '#fff', boxShadow: 'none', minWidth: 40 }}
            >닫기</Btn>
          </div>
          <div onClick={(e) => e.stopPropagation()} style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'auto' }}>
            {isPdf(preview)
              ? <iframe title={preview.name} src={preview.url} style={{ width: '100%', height: '100%', border: 'none', background: '#fff', borderRadius: R }} />
              : <img src={preview.url} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: R }} />}
          </div>
        </div>
      )}
    </div>
  );
}
