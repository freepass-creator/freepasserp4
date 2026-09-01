'use client';
import type { CSSProperties, ReactNode } from 'react';

/**
 * 전자계약 «손님 화면» 원자 — **착한거래 UI/UX SSOT 를 그대로 옮긴 것**.
 * 프리패스ERP · 착한거래 공용(사장님 2026-08-21 「기능은 우리가 앞서고 디자인은 착한거래가 앞선다」).
 *
 * 정본: chakhandeal `docs/UIUX-SSOT.md` (S01–S30) + `app/globals.css`
 *   S01 색은 변수만 · S02 라운드 8 단일 · S03 Pretendard
 *   S06 손님 단계 화면은 c-body — **카드 남발 금지**
 *   S07 손님 타이포는 slabel → stitle → sdesc 세 단
 *   S10 주 CTA 는 하단 푸터 · S24 주요 터치 높이 ≥ 40px
 *
 * ★두 저장소에서 같이 쓴다 → **어느 저장소의 토큰도 import 하지 않는다.**
 *   색은 `--sign-*` 변수로만 쓰고 없으면 대체값(착한거래 원값)으로 혼자 선다.
 *   옮길 때 이 파일만 복사하고, 감싸는 곳에 SIGN_THEME 만 얹으면 된다.
 *
 * ⚠ ERP 원자(WorkTable·WorkRow)를 쓰지 않는다. 그건 「B2B는 조밀하게」로 만든 것이라
 *   손님 화면에 쓰면 빽빽한 업무화면이 된다.
 */

/** 착한거래 원값. 손님 화면에서는 여기 값만 쓴다. */
/** S02 — 라운드는 8 하나. 진짜 원(50%)과 알약(999)만 예외. */

/*
 * ★색·크기 상수를 여기에 두지 않는다.
 *   전에는 `--sign-*` 지도와 대체 hex 를 이 파일에 들고 있었는데,
 *   ① 어느 것도 쓰이지 않았고(원자는 전부 클래스로 그린다)
 *   ② 생 hex 라 check-tokens 가 13곳을 잡았다.
 *   색은 `sign.css` 의 `.sign-root` 가 ERP 토큰 위에 한 번만 얹는다 — 그게 유일한 자리다.
 */


/* ── 아래 원자는 모두 sign.css 의 «클래스»만 쓴다 ──────────────────────
   인라인 스타일로 흉내 내면 착한거래와 값이 갈린다. 규격은 CSS 한 곳에만 둔다.
   (사장님 2026-08-21 「착한거래를 똑같이, 숨소리까지」) */

/** 눈썹 — .slabel */
export function SignEyebrow({ children }: { children: ReactNode }) {
  return <div className="slabel">{children}</div>;
}

/** 단계 제목 — .stitle. «명사»가 아니라 «지금 무엇을 해 달라»는 문장을 넣는다. */
export function SignTitle({ children }: { children: ReactNode }) {
  return <h1 className="stitle">{children}</h1>;
}

/** 단계 설명 — .sdesc */
export function SignDesc({ children }: { children: ReactNode }) {
  return <p className="sdesc">{children}</p>;
}

/**
 * 패널 — .panel. 제목은 .panel-title(12/800 회색 눈썹)이다.
 * 큰 제목을 얹으면 카드가 주인공이 되어 S06 「카드 남발 금지」의 뜻이 무너진다 —
 * 주인공은 언제나 그 단계의 .stitle 이다.
 */
export function SignPanel({ title, hint, children, style }: {
  title?: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
  style?: CSSProperties;
  /* ERP FormCard 가 넘기는 강조색. 착한거래 판은 «머리띠 하나»로 서므로 색을 따로 받지 않는다 —
     받아서 버린다(옮기는 중이라 호출부를 안 고친다). 새로 쓸 때는 넘기지 않는다. */
  accent?: string;
}) {
  return (
    <section className="panel" style={style}>
      {title != null && title !== '' ? <div className="panel-title">{title}</div> : null}
      {hint ? <div className="sdesc" style={{ marginBottom: 9 }}>{hint}</div> : null}
      {children}
    </section>
  );
}

/** 한 줄 — 라벨 왼쪽 · 값 오른쪽. 라벨 88px 고정(값이 주인공이다). */
export function SignRow({ label, children, valueStyle }: {
  label: ReactNode;
  children?: ReactNode;
  valueStyle?: CSSProperties;
}) {
  return (
    <div className="srow">
      <span className="srow-l">{label}</span>
      <span className="srow-v" style={valueStyle}>{children}</span>
    </div>
  );
}

/**
 * 입력칸 — .field. **라벨은 값 «위»에** 놓는다.
 *
 * ★왜 ERP 처럼 「라벨 왼쪽 · 값 오른쪽」으로 하지 않나: 폰 폭에서 라벨이 자리를 먹으면
 *   입력칸이 좁아지고, 「주민등록번호 [필수]」 처럼 라벨이 길면 줄바꿈으로 흐트러진다.
 *   착한거래는 전부 라벨 위·전폭이다(AuthFlow 의 .field). 글자 16px 은 iOS 가
 *   포커스 때 화면을 확대하지 않는 최소값이라, 규격이자 «확대 방지»다.
 */
export function SignField({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="field">
      <span className="flabel">{label}{hint ? <em className="opt">{hint}</em> : null}</span>
      {children}
    </label>
  );
}

/**
 * 고르는 줄 — .auth-opt. **누르는 것이 곧 다음이다.**
 * 고르고 나서 아래 [다음]을 또 누르게 하면 한 화면에 결정이 두 번 생긴다
 * (사장님 2026-08-21 「한 화면에서 처리하면서 다음으로」).
 */
export function SignOption({ icon, title, desc, recommended, onClick }: {
  icon?: ReactNode;
  title: ReactNode;
  desc?: ReactNode;
  recommended?: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" className={`auth-opt${recommended ? ' rec' : ''}`} onClick={onClick}>
      {icon ? <span className="ic">{icon}</span> : null}
      <span className="tx">{title}{desc ? <small>{desc}</small> : null}</span>
      <span className="arr">›</span>
    </button>
  );
}

/**
 * CI 체크 — 브랜드 마크와 체크칸이 «같은 체크»를 쓴다.
 * 좌표는 프리패스 CI 정본 `public/icon.svg` 와 같다. 고칠 일이 생기면 둘을 같이 고친다.
 * 크기·획은 감싸는 쪽이 비율로 잡으므로 여기서는 좌표만 든다.
 */
export function SignCheck() {
  return (
    <svg viewBox="0 0 512 512" fill="none" aria-hidden>
      <path d="M128 264 l80 80 L384 168" stroke="currentColor" strokeWidth={52} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * 동의 한 줄 — .sagree. **판의 맨 아래에 붙는다.**
 * 라벨 칸(「동의 항목」) 없이 줄 전체가 표적이다 — 폰에서 22px 네모만 노리게 하면 안 된다(S24).
 */
export function SignConsent({ label, required, checked, onChange, disabled }: {
  label: ReactNode;
  required?: boolean;
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className="sagree"
      role="checkbox"
      aria-checked={checked}
      disabled={disabled}
      onClick={onChange}
    >
      <span className="sbox"><SignCheck /></span>
      <span style={{ flex: 1, minWidth: 0 }}>{label}<span className="req">{required ? '필수' : '선택'}</span></span>
    </button>
  );
}

/**
 * 입력칸 — ERP `WorkInput` 과 «같은 인자»를 받는다(value/onChange 문자열).
 *
 * ★왜 인자를 맞추나: 손님 화면의 입력칸이 27곳이다. 하나씩 고치면 그 사이 한 화면에
 *   ERP 칸과 착한거래 칸이 섞여 선다. 인자를 맞춰 두면 import 한 줄로 규격이 갈린다.
 * ★글자 16px 은 iOS 가 포커스 때 화면을 확대하지 않는 최소값이다 — 규격이자 «확대 방지»다.
 *   (sign.css `.sign-root .field input`)
 */
export function SignInput({ value, onChange, placeholder, inputMode, type = 'text', ariaLabel, disabled, maxLength }: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  inputMode?: 'text' | 'tel' | 'numeric' | 'email' | 'decimal' | 'search' | 'url' | 'none';
  type?: string;
  ariaLabel?: string;
  disabled?: boolean;
  maxLength?: number;
  /** ERP 호출부가 넘기지만 여기서는 폭을 CSS 가 잡는다 — 받아서 버린다. */
  full?: boolean;
  size?: string;
}) {
  return (
    <input
      /* ★.inp 를 반드시 붙인다 — 규격은 `.field input` 과 `.inp` 에만 걸린다.
         .srow 안처럼 .field 밖에 서면 클래스가 없으면 «민얼굴 input» 이 나온다.
         (2026-08-29 실측: 입력칸 27곳이 전부 테두리·높이·16px 없이 떴다) */
      className="inp"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      inputMode={inputMode}
      type={type}
      aria-label={ariaLabel}
      disabled={disabled}
      maxLength={maxLength}
    />
  );
}

/**
 * 알림 상자 — «막혔다»(warn)와 «끝났다»(ok) 둘뿐이다.
 *
 * ★설명에는 쓰지 않는다. 설명은 SignFootnote(※)다.
 *   상자가 한 화면에 여럿 쌓이면 «전부 중요»가 되어 아무것도 안 읽힌다(실측: 파란 박스 12개).
 */
export function SignNote({ tone = 'warn', children }: { tone?: 'warn' | 'ok'; children: ReactNode }) {
  return <div className={`snote ${tone}`} role={tone === 'warn' ? 'alert' : undefined}>{children}</div>;
}

/** 각주 — .footnotes 한 줄. ※ 가 매달린다. */
export function SignFootnote({ children }: { children: ReactNode }) {
  return <ul className="footnotes"><li>{children}</li></ul>;
}

/**
 * 조문 아코디언 — 약관처럼 «많고 긴 글»을 폰에서 읽게 하는 원자.
 *
 * ★왜: 28개 조문을 카드로 죽 펼치면 한 화면에 한두 개만 보이고, 손님은 «무엇이 들어 있는지»를
 *   모른 채 손가락으로만 끝까지 밀어야 한다(사장님 2026-08-21 「모바일에서 약관 보는 게 비효율적」).
 *   접어 두면 제목 여덟아홉 개가 한 화면에 서서 목차 구실을 하고, 볼 것만 펴서 읽는다.
 *
 * `<details>` 를 쓴다 — 키보드·보조기기 동작이 공짜로 따라오고, 열림 상태가 DOM 에 남는다.
 * `onOpen` 은 «어느 조문을 펴 봤는가»를 기록하라고 있다. 「끝까지 스크롤」보다 나은 증거다.
 */
export function SignAccordion({ title, children, onOpen }: {
  title: ReactNode;
  children: ReactNode;
  onOpen?: () => void;
}) {
  return (
    <details
      className="sacc"
      onToggle={(event) => { if ((event.currentTarget as HTMLDetailsElement).open) onOpen?.(); }}
    >
      <summary><span className="caret" aria-hidden>▸</span><span style={{ flex: 1, minWidth: 0 }}>{title}</span></summary>
      <div className="sacc-body">{children}</div>
    </details>
  );
}

/** 읽기 진행률 — 「몇 개 중 몇 개를 폈나」. 진행 바와 같은 문법(얇은 막대). */
export function SignProgress({ done, total, label }: { done: number; total: number; label?: ReactNode }) {
  const ratio = total > 0 ? Math.min(1, done / total) : 0;
  return (
    <div className="sprog">
      <div className="sprog-head"><span>{label}</span><b>{done} / {total}</b></div>
      <div className="sprog-bar"><i style={{ width: `${ratio * 100}%` }} /></div>
    </div>
  );
}
