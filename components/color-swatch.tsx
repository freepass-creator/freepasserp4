'use client';

import type { CSSProperties } from 'react';
import { C, FS, R } from '@/components/ui';

/**
 * 차 색 이름 → 실제 색 점(사장님 2026-08-20 「색상은 텍스트로만 보여주는 게 아니고 컬러 뱃지같은 거 활용해 줘야지」).
 *
 * 공급사가 적는 색 이름은 규격이 없다 — 「화이트」·「쉬머링 실버」·「어비스 블랙 펄」·「클라우드 필」처럼
 * 브랜드 이름이 섞여 온다. 그래서 **낱말이 들어 있는지**로 찾는다(정확히 같은지가 아니라).
 * 못 찾으면 점을 안 그린다 — 모르는 색을 회색 점으로 그리면 «회색 차»로 읽힌다.
 *
 * ⚠ 여기 색은 «그 차의 실제 도색»이 아니라 «그 이름이 가리키는 계열»이다. 상담에서 색을 고를 때
 *   글자보다 점이 빠르라고 두는 것이고, 정확한 색은 사진이 말한다.
 */
const COLOR_HEX: [RegExp, string][] = [
  [/화이트|백색|흰/, '#f4f5f7'],
  [/블랙|검정|흑/, '#1a1a1c'],
  [/실버|은색/, '#c3c7cc'],
  [/그레이|그레이시|회색|그래파이트|건메탈/, '#7b8087'],
  [/베이지|아이보리|크림|샴페인/, '#e3d9c4'],
  [/브라운|갈색|모카|코냑|탄|카멜/, '#6b4a34'],
  [/네이비|남색/, '#22304f'],
  [/블루|파랑|청색|스카이/, '#2f6fb5'],
  [/그린|녹색|초록|카키/, '#3f6b4a'],
  [/레드|빨강|적색|버건디|와인/, '#a52a2a'],
  [/오렌지|주황/, '#d97427'],
  [/옐로|노랑|황색/, '#e0b53a'],
  [/퍼플|보라|바이올렛/, '#6b4a91'],
  [/골드|금색/, '#b79a5b'],
  [/펄|진주/, '#eceaea'],
];

/** 색 이름 한 덩어리 → 색. 못 찾으면 빈 문자열. */
export function colorHexOf(name: string): string {
  const text = String(name || '').trim();
  if (!text) return '';
  return COLOR_HEX.find(([re]) => re.test(text))?.[1] || '';
}

/** 색 점 하나 — 흰색 계열이 배경에 묻지 않게 테두리를 항상 두른다. */
export function ColorDot({ name, size = 11 }: { name: string; size?: number }) {
  const hex = colorHexOf(name);
  if (!hex) return null;
  const style: CSSProperties = {
    display: 'inline-block', width: size, height: size, borderRadius: R,
    background: hex, border: `1px solid ${C.line}`,
    flex: '0 0 auto', verticalAlign: 'text-bottom', marginRight: 5,
  };
  return <span aria-hidden style={style} />;
}

/**
 * 「외장색 화이트 · 내장색 블랙」 한 줄을 점 + 글자로 그린다.
 * 값 문자열의 «모양»(라벨 + 색이름, 가운뎃점 구분)은 product.ts 가 만든 그대로를 따른다 —
 * 여기서 다시 조립하면 두 곳이 갈라져 언젠가 서로 다른 글자를 낸다.
 */
export function ColorValue({ value }: { value: string }) {
  const parts = String(value || '').split('·').map((x) => x.trim()).filter(Boolean);
  if (!parts.length) return null;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', flexWrap: 'wrap', gap: 4 }}>
      {parts.map((part, i) => {
        // 「외장색 화이트」 → 라벨(외장색)과 색이름(화이트)을 갈라 점은 색이름으로 찾는다.
        const m = /^(외장색|내장색)\s*(.*)$/.exec(part);
        const label = m?.[1] || '';
        const name = (m?.[2] ?? part).trim();
        return (
          <span key={i} style={{ display: 'inline-flex', alignItems: 'center' }}>
            {i > 0 && <span style={{ color: C.faint, margin: '0 6px 0 2px' }}>·</span>}
            {label ? <span style={{ color: C.mute, fontSize: FS.cap, marginRight: 5 }}>{label}</span> : null}
            <ColorDot name={name} />
            {/* 미입력은 점도 글자도 죽인다 — 색이 없는 게 아니라 «안 적힌 것»이다. */}
            <span style={name === '미입력' ? { color: C.faint } : undefined}>{name || '미입력'}</span>
          </span>
        );
      })}
    </span>
  );
}
