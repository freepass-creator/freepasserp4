import Link from 'next/link';
import { C, FS, FW, R } from '@/components/ui/tokens';

/** 없는 경로 — 기본 Next 404 대신 브랜드 톤 안내 + 홈 이동. */
export default function NotFound() {
  return (
    <div style={{
      minHeight: '60vh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: 14, padding: 24, textAlign: 'center',
    }}>
      <div style={{ fontSize: 40, fontWeight: FW.head, color: C.faint, fontFamily: 'monospace' }}>404</div>
      <div style={{ fontSize: FS.title, fontWeight: FW.title, color: C.ink }}>페이지를 찾을 수 없습니다</div>
      <div style={{ fontSize: FS.sub, color: C.mute, maxWidth: 340, lineHeight: 1.6 }}>
        주소가 바뀌었거나 삭제된 페이지일 수 있습니다.
      </div>
      <Link
        href="/"
        style={{
          marginTop: 6, padding: '10px 18px', borderRadius: R, border: 'none',
          background: C.brand, color: '#fff', fontSize: FS.body, fontWeight: FW.strong, textDecoration: 'none',
        }}
      >홈으로</Link>
    </div>
  );
}
