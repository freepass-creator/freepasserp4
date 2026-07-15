'use client';
import { C } from '@/components/ui';

// 차량 사진 업로드 — 로컬은 data URL로 저장(product.photos[]). 상세/카드에서 그대로 표시·라이트박스.
export function PhotoUpload({ photos, onChange }: { photos: unknown; onChange: (p: string[]) => void }) {
  const list: string[] = Array.isArray(photos) ? (photos as unknown[]).map(String) : [];
  const add = (files: FileList | null) => {
    if (!files || !files.length) return;
    const readers = Array.from(files).map((f) => new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsDataURL(f); }));
    Promise.all(readers).then((urls) => onChange([...list, ...urls]));
  };
  return (
    <div style={{ border: `1px solid ${C.line}`, borderRadius: 4, background: '#fff', padding: '10px 12px' }}>
      <div style={{ fontSize: 12, fontWeight: 800, color: C.ink, marginBottom: 7 }}>차량 사진 <span style={{ color: C.faint, fontWeight: 600 }}>{list.length}</span></div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {list.map((u, i) => (
          <div key={i} style={{ position: 'relative', width: 76, height: 57, borderRadius: 4, overflow: 'hidden', border: `1px solid ${C.line}` }}>
            <img src={u} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            <button onClick={() => onChange(list.filter((_, j) => j !== i))} aria-label="삭제" style={{ position: 'absolute', top: 2, right: 2, width: 18, height: 18, borderRadius: 9, border: 'none', background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: 12, lineHeight: 1, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
          </div>
        ))}
        <label style={{ width: 76, height: 57, borderRadius: 4, border: `1px dashed ${C.line}`, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: C.mute, fontSize: 22, background: '#fafbfd' }}>
          +
          <input type="file" accept="image/*" multiple onChange={(e) => add(e.target.files)} style={{ display: 'none' }} />
        </label>
      </div>
    </div>
  );
}
