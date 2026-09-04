'use client';
import { useEffect, useMemo, useState } from 'react';
import { Check, Copy, ExternalLink, Share2 } from 'lucide-react';
import { Btn, C, CenterNote, FS, FW, ICON, Message, Page, R, SectionLabel } from '@/components/ui';
import { getSession } from '@/lib/auth-session';
import { WHITELABELS, hasBrand, type Whitelabel } from '@/lib/whitelabel';
import { useIsMobile } from '@/lib/use-mobile';
import { haptic } from '@/lib/haptics';

/**
 * **내 손님 링크** — 영업자가 손님에게 보낼 주소를 여기서 받는다.
 *
 * 왜 필요한가(2026-09-05). 손님 화면은 `?a={내 코드}` 가 붙어야 담당자가 나에게 귀속된다.
 * 그런데 그 주소를 «손으로» 조립하고 있었다 — 코드를 외우거나 어디선가 복사해 와야 했고,
 * 한 글자만 틀려도 손님이 열었을 때 **담당자가 대표번호로 떨어진다**(그 손님은 남의 손님이 된다).
 * 링크를 만드는 일은 사람이 아니라 화면이 해야 한다.
 *
 * ★채널마다 주소가 다르다. 유니오토플랜 손님에게는 유니오토 주소를, 프리패스 손님에게는
 *   노브랜드 주소를 줘야 한다 — 그래서 목록이 `lib/whitelabel` 표를 그대로 따른다.
 *   채널이 늘면 이 화면은 안 고친다(그 표에 줄이 하나 늘 뿐이다).
 * ★★**도메인이 붙기 전에는 미리보기 주소**(`?wl=`)를 준다. 도메인이 붙으면 그 도메인 주소로
 *   저절로 바뀐다 — 여기서 판단하지 않고 `wl.hosts` 가 있으면 그걸 쓴다.
 *   ⚠ 미리보기 주소를 손님에게 보내면 주소창에 우리 도메인이 그대로 보인다. 그래서 그 줄에는
 *     「아직 손님에게 보내지 마세요」를 붙인다 — 안 붙이면 반드시 그대로 나간다.
 */
export default function SharePage() {
  const mobile = useIsMobile();
  const [code, setCode] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [origin, setOrigin] = useState('');

  useEffect(() => {
    const s = getSession();
    // 귀속키는 `user_code` 다 — `/q?a=` 를 푸는 `matchAgentByShareCode` 가 이것부터 본다.
    setCode(s ? String(s.user_code || '') : '');
    setName(s ? String(s.name || '') : '');
    setOrigin(window.location.origin);
  }, []);

  const rows = useMemo(() => {
    if (!code) return [];
    return WHITELABELS.filter(hasBrand).map((wl) => linkOf(wl, code, origin));
  }, [code, origin]);

  if (code === null) return <Page title="내 손님 링크"><CenterNote>불러오는 중…</CenterNote></Page>;
  if (!code) {
    return (
      <Page title="내 손님 링크">
        <Message variant="warning">
          로그인한 계정에 담당자 코드가 없어 링크를 만들 수 없습니다. 관리자에게 문의해 주세요.
        </Message>
      </Page>
    );
  }

  return (
    <Page title="내 손님 링크">
      <Message variant="info">
        아래 주소로 손님이 들어오면 <b>담당자가 {name || '나'}로 잡힙니다.</b>
        {' '}손님이 그 주소에서 차를 골라 상세로 들어가도 담당은 그대로 이어집니다.
      </Message>

      <SectionLabel>채널별 손님 주소</SectionLabel>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {rows.map((row) => <LinkCard key={row.key} row={row} mobile={mobile} />)}
        {/* 노브랜드(프리패스) 주소 — 채널이 없는 손님에게 쓴다. */}
        <LinkCard row={linkOf(null, code, origin)} mobile={mobile} />
      </div>

      <div style={{ marginTop: 22 }}>
        <SectionLabel>내 담당자 코드</SectionLabel>
        <div style={{
          padding: '12px 14px', borderRadius: R, border: `1px solid ${C.line}`,
          fontFamily: 'var(--font-mono)', fontSize: FS.body, color: C.ink,
        }}>{code}</div>
        <p style={{ margin: '8px 0 0', fontSize: FS.cap, color: C.faint, lineHeight: 1.7 }}>
          주소 끝의 <code>a={code}</code> 가 이 코드입니다. 한 글자라도 다르면 손님이 열었을 때
          담당자가 대표번호로 떨어지니, 주소는 손으로 고치지 말고 여기서 복사해 쓰세요.
        </p>
      </div>
    </Page>
  );
}

type Row = { key: string; label: string; url: string; preview: boolean };

/**
 * 채널 하나의 손님 주소.
 * ★도메인이 등록돼 있으면(`wl.hosts[0]`) **그 도메인**으로 만든다 — 손님 주소창에 우리가 안 보인다.
 *   아직 없으면 지금 접속한 주소 + `?wl=` 미리보기다. 그 차이를 `preview` 로 표시해 화면이 경고한다.
 */
function linkOf(wl: Whitelabel | null, code: string, origin: string): Row {
  const q = `?a=${encodeURIComponent(code)}`;
  if (!wl) return { key: 'freepass', label: '프리패스 (채널 없음)', url: `${origin}/shop${q}`, preview: false };
  // ⚠ `hosts` 가 있다고 열리는 게 아니다 — 도메인을 «사서 붙인 뒤»에만 그 주소를 준다(`domainReady`).
  //   안 그러면 영업자가 죽은 링크를 손님에게 보내고, 그 손님은 그걸로 끝이다.
  const host = wl.domainReady ? wl.hosts[0] : '';
  if (host) return { key: wl.key, label: wl.name, url: `https://${host}/shop${q}`, preview: false };
  return { key: wl.key, label: wl.name, url: `${origin}/shop${q}&wl=${encodeURIComponent(wl.key)}`, preview: true };
}

function LinkCard({ row, mobile }: { row: Row; mobile: boolean }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    haptic.tap();
    try {
      await navigator.clipboard.writeText(row.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* 복사를 막아 둔 브라우저 — 주소가 화면에 그대로 있으니 손으로 긁으면 된다 */ }
  };
  /** 기기가 아는 방법(카톡·문자)이 있으면 그걸 쓴다 — 복사해서 붙여넣기보다 손이 덜 간다. */
  const send = async () => {
    haptic.tap();
    try {
      if (navigator.share) { await navigator.share({ title: row.label, url: row.url }); return; }
      await copy();
    } catch { /* 취소도 여기로 온다 — 아무 말도 하지 않는다 */ }
  };

  return (
    <div style={{ padding: 14, borderRadius: R, border: `1px solid ${C.line}`, background: C.bg }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: FS.title, fontWeight: FW.title, color: C.ink }}>{row.label}</span>
        {row.preview ? (
          <span style={{ fontSize: FS.cap, color: C.warn, fontWeight: FW.strong }}>
            미리보기 · 아직 손님에게 보내지 마세요
          </span>
        ) : null}
      </div>
      <div style={{
        padding: '9px 11px', borderRadius: R, background: C.zebra,
        fontFamily: 'var(--font-mono)', fontSize: FS.sub, color: C.sub,
        overflowX: 'auto', whiteSpace: 'nowrap', marginBottom: 10,
      }}>{row.url}</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Btn onClick={() => void send()} title="카톡·문자로 바로 보냅니다">
          <Share2 size={ICON.md} aria-hidden />공유
        </Btn>
        <Btn variant="ghost" onClick={() => void copy()} title="주소를 복사합니다">
          {copied ? <Check size={ICON.md} aria-hidden /> : <Copy size={ICON.md} aria-hidden />}
          {copied ? '복사했습니다' : '주소 복사'}
        </Btn>
        <Btn variant="ghost" href={row.url} title="손님에게 보이는 화면을 그대로 엽니다">
          <ExternalLink size={ICON.md} aria-hidden />{mobile ? '열기' : '손님 화면 보기'}
        </Btn>
      </div>
    </div>
  );
}
