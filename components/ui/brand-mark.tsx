'use client';

/**
 * 프리패스 CI 마크 — 좌표는 정본 `public/icon.svg` 와 «같다».
 *   라운드 96/512 = 18.75% · 체크 획 52/512 = 10.16%.
 *   비율(%)로 적어 두면 20px 이든 34px 이든 CI 와 같은 모양으로 선다.
 *
 * ★색은 «반전»한다 — 흰 네모 + 남색 체크(사장님 2026-08-28 「하얀 네모에 체크는 남색이라야 임팩트」).
 *   CI 원본은 네이비 네모 + 흰 체크로 대비 13.9:1 이다. 네이비 띠 위에 그대로 쓰면 네모가 안 보이므로
 *   밝기 관계를 뒤집는데, 「흰 네모 + 남색 체크」가 14.1:1 로 CI 와 같은 세기다.
 *   스카이 네모 + 흰 체크는 1.8:1 밖에 안 나와 체크가 뭉갠다 — 그래서 안 쓴다.
 *
 * ⚠ 좌표를 고칠 일이 생기면 `public/icon.svg` · `components/sign/sign.css`(.brand-mark) 와 «같이» 고친다.
 *   전자계약 머리와 이 마크는 «같은 마크»여야 한다 — 손님이 받은 계약서와 우리 앱이 같은 얼굴이다.
 */
export function BrandMark({ size = 20, ink = 'var(--brand)', paper = 'var(--fp-bar-paper)' }: {
  size?: number;
  /** 체크 색 — 네이비 띠 위에서는 그 띠 색(`var(--fp-bar-navy)`)을 넘긴다. */
  ink?: string;
  /** 네모 색 — 기본 `--fp-bar-paper`(흰색, 다크에서도 흰색 — 띠가 양쪽 다 남색이다). */
  paper?: string;
}) {
  return (
    <span
      aria-hidden
      style={{
        width: size, height: size, borderRadius: '18.75%',
        background: paper, color: ink,
        display: 'grid', placeItems: 'center', flex: '0 0 auto',
      }}
    >
      <svg viewBox="0 0 512 512" fill="none" style={{ width: '100%', height: '100%', display: 'block' }}>
        <path d="M128 264 l80 80 L384 168" stroke="currentColor" strokeWidth={52} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}
