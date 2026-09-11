'use client';
import { useMemo, useState } from 'react';
import { C } from '@/components/ui';
import { useIsMobile } from '@/lib/use-mobile';
import { SHOP, ShopDockAction, ShopPill, ShopTextBtn } from '@/components/shop/shop-ui';
import { AXIS_LABEL, SHOP_AXES, soloLabel, type ShopAxis, type ShopFacets, type ShopQuickChip } from '@/lib/shop/query';

/** 한 번에 보이는 수 · 더 여는 수 — 조건칸의 「다섯씩」과 같은 값이다. */
const STEP = 5;

/**
 * **빠른조건을 «고르는» 칸 — 조건칸 맨 아래 접이식 구역 안에 선다. 누구나 연다.**
 *
 * ★★★사장님 2026-09-11 「화이트라벨에서 퀵필터 조정하는 거 **설정페이지 맨 하단 섹션 하나** 주고
 *   거기서 **펼쳐서 넣게** 해주자」.
 *   ⚠ 전에는 칩 줄 맨 앞 «설정 눈금» 단추 → 가운데 창(웹)·바닥 시트(폰)였다(2026-09-10).
 *     손님이 조건을 읽는 첫 자리에 «고치는 문»이 서 있었고, 창이 한 겹 더 떴다.
 *   ⇒ 문을 **조건칸(웹 왼쪽 기둥 · 폰 상세 조건 시트)의 맨 아래 구역**으로 옮겼다.
 *     축과 «같은 모양»으로 접혀 있다가 펼치면 이 칸이 나온다 — 새 창이 없다.
 *   ★웹·폰이 **이 한 벌**을 같이 쓴다(집 규칙 ③). 부르는 쪽은 자리만 준다.
 *
 * ★★★사장님 2026-09-10 「그냥 **누구나 할 수 있게 오픈**할 거야」 · 「**손님도 할 수 있게 다~**」.
 *   ⇒ 로그인도 역할도 안 본다. 그래서 여기 「권한이 없습니다」가 없다.
 * ⚠⚠ **고친 것은 «그 채널에 들어오는 다음 사람»에게도 보인다** — 그래서 칸이 먼저 그렇다고 말한다.
 *
 * ★★「**있는 필터를 잠시 옮겨놓은 느낌**」 · 「**있는 필터만** 갖다 놓겠음」 —
 *   고르는 목록은 조건칸과 **같은 집계**(`facets`)에서 만든다. 손으로 적는 칸이 없다.
 *   ★짜임도 그 말 그대로다 — **위 = 지금 줄에 올라와 있는 것 · 아래 = 옮겨올 수 있는 것.**
 *     누르면 위아래로 오간다(한 조건이 한 칸에 두 번 서지 않는다). 올린 것은 줄 «끝»에 붙는다.
 *
 * ★저장은 **단추로** 한다 — 누를 때마다 바로 적으면 헛누름 한 번이 «모든 손님의 첫 줄»을 바꾼다.
 *   바뀐 것이 있을 때만 「저장 · 되돌리기」가 선다(바뀐 게 없는데 저장 단추가 서 있으면 소음이다).
 * ⚠ 부르는 쪽이 `key` 로 저장된 줄을 넘긴다 — 저장이 끝나면 초안이 새 줄로 다시 선다.
 */
export function ShopQuickEditor({ facets, value, onSave, saving }: {
  facets: ShopFacets;
  value: ShopQuickChip[];
  onSave: (next: ShopQuickChip[]) => void;
  saving?: boolean;
}) {
  const [picked, setPicked] = useState<ShopQuickChip[]>(value);
  const mobile = useIsMobile();

  const id = (c: { axis: ShopAxis; key: string }) => `${c.axis}:${c.key}`;
  const on = useMemo(() => new Set(picked.map(id)), [picked]);
  const dirty = picked.map(id).join('|') !== value.map(id).join('|');

  /**
   * 그 값이 **재고에 몇 대인가** — `count`(지금 조건에서)가 아니라 `base`(조건을 다 풀면)다.
   * 여기는 «가게의 첫 줄»을 짜는 자리라 지금 손님이 무엇을 걸어 뒀는지와 무관해야 한다.
   */
  const baseOf = (axis: ShopAxis, key: string) =>
    facets[axis].find((o) => o.key === key)?.base ?? 0;
  /**
   * 위 「지금 줄」의 이름 = **칩 줄에 실제로 서는 이름**(`soloLabel` — 「보증 없음」·「월 50만 이하」).
   * ⚠ 집계 이름(`label`)은 축 제목 밑에 설 때의 말이라 홀로 서면 「없음」·「50만 이하」가 된다(실측).
   */
  const labelOf = (c: ShopQuickChip) =>
    c.label || soloLabel(c.key) || facets[c.axis].find((o) => o.key === c.key)?.label || c.key;
  /**
   * 축마다 **다섯씩** 보이고 「더보기」로 다섯씩 더 연다 — 조건칸(`ShopFilters`)과 같은 박자다.
   * ⚠ 다 펴 두면 이 구역 하나가 2,100px 이었다(실측 · 모델·연식이 스무 줄씩) — 기둥이 통째로 길어진다.
   */
  const [more, setMore] = useState<Partial<Record<ShopAxis, number>>>({});

  const add = (axis: ShopAxis, key: string) => {
    if (on.has(`${axis}:${key}`)) return;
    setPicked((p) => [...p, { axis, key }]);
  };
  const drop = (c: ShopQuickChip) => setPicked((p) => p.filter((x) => id(x) !== id(c)));

  /* 건수는 칩 글자와 같은 색으로 한 단 옅게 — 켜진(남색) 칩 위에서도 읽혀야 한다. */
  const num = (n: number) => (
    <span style={{ marginLeft: SHOP.sp.tight, opacity: 0.6, fontVariantNumeric: 'tabular-nums' }}>{n}</span>
  );

  return (
    <div>
      {/*
        ★**«같이 보는 줄»이라고 먼저 말한다.** 누구나 고칠 수 있게 열어 둔 자리라,
          고치는 사람이 「내 화면만 바뀐다」고 오해하면 남의 가게 첫 줄을 무심코 바꾼다.
      */}
      <div style={{ fontSize: SHOP.fs.cap, color: C.mute, lineHeight: 1.7, marginBottom: SHOP.sp.cozy }}>
        목록 위 칩 줄에 세울 조건입니다. 고친 줄은 <strong style={{ color: C.ink }}>이 가게를 보는 모든 분</strong>에게 같이 보입니다.
      </div>

      {/* ── 위: 지금 줄에 올라와 있는 것(누르면 뺀다) ── */}
      <div style={{ fontSize: SHOP.fs.cap, color: C.faint, marginBottom: SHOP.sp.snug }}>
        지금 줄 · {picked.length}개 <span style={{ color: C.line }}>—</span> 누르면 뺍니다
      </div>
      {picked.length ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: SHOP.sp.snug }}>
          {picked.map((c) => {
            const n = baseOf(c.axis, c.key);
            return (
              /*
               * 건수 0 은 «지금 재고에 없는» 조건이다 — 저장해 둔 뒤 재고가 빠지면 이렇게 된다.
               * 손님 화면에는 안 뜨므로 여기서 「없음」이라고 말해 준다(빼기 쉬우라고 위에 남긴다).
               */
              <ShopPill key={id(c)} on onClick={() => drop(c)} title={`${AXIS_LABEL[c.axis]} · 누르면 뺍니다`}>
                {labelOf(c)}{n ? num(n) : <span style={{ marginLeft: SHOP.sp.tight, opacity: 0.6 }}>없음</span>}
              </ShopPill>
            );
          })}
        </div>
      ) : (
        <div style={{ fontSize: SHOP.fs.sub, color: C.faint, lineHeight: 1.7 }}>
          올린 조건이 없습니다 — 이대로 저장하면 칩 줄이 사라집니다.
        </div>
      )}

      {/* ── 아래: 옮겨올 수 있는 것 = 지금 재고에 있는 값 전부(누르면 줄 끝에 붙는다) ── */}
      <div style={{
        marginTop: SHOP.sp.edge, paddingTop: SHOP.sp.cozy, borderTop: `1px solid ${C.line2}`,
        fontSize: SHOP.fs.cap, color: C.faint,
      }}>
        누르면 줄 끝에 붙습니다 — 지금 재고에 있는 조건만 나옵니다
      </div>
      {SHOP_AXES.map((axis) => {
        const opts = facets[axis].filter((o) => o.base > 0 && !on.has(`${axis}:${o.key}`));
        if (!opts.length) return null;   // 값이 없는 축은 아예 안 그린다(빈 제목을 세우지 않는다)
        return (
          <div key={axis} style={{ marginTop: SHOP.sp.cozy }}>
            <div style={{ fontSize: SHOP.fs.cap, color: C.mute, marginBottom: SHOP.sp.tight }}>
              {AXIS_LABEL[axis]}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: SHOP.sp.snug }}>
              {opts.slice(0, STEP + (more[axis] ?? 0)).map((o) => (
                <ShopPill key={o.key} on={false} onClick={() => add(axis, o.key)}>
                  {o.label}{num(o.base)}
                </ShopPill>
              ))}
            </div>
            {opts.length > STEP + (more[axis] ?? 0) ? (
              <div style={{ marginTop: SHOP.sp.snug }}>
                <ShopTextBtn tone="faint" onClick={() => setMore((m) => ({ ...m, [axis]: (m[axis] ?? 0) + STEP }))}>
                  {`더보기 ${Math.min(STEP, opts.length - STEP - (more[axis] ?? 0))}`}
                </ShopTextBtn>
              </div>
            ) : null}
          </div>
        );
      })}

      {/*
        ★바뀐 것이 있을 때만 선다 — 「저장」은 주요(남색 면) · 「되돌리기」는 글자 단추.
        ★구역 «끝»에 둔다 — 고르고 내려온 손이 거기 있다.
      */}
      {dirty ? (
        <div style={{
          position: 'sticky', bottom: 0, background: C.bg,
          display: 'flex', alignItems: 'center', gap: SHOP.sp.cozy,
          marginTop: SHOP.sp.edge, paddingBlock: SHOP.sp.snug, borderTop: `1px solid ${C.line2}`,
          /*
           * ⚠ 구르는 칸에 아래 여백이 있으면 sticky 는 **그 여백 위**에 선다 — 그 틈으로 밑의 칩이
           *   비쳐 보였다(2026-09-11 실측 · 폰 시트 오른쪽 칸 24). 같은 바탕색 그림자로 그 틈을 덮는다.
           */
          boxShadow: `0 ${SHOP.sp.part}px 0 ${C.bg}`,
        }}>
          <ShopTextBtn onClick={() => setPicked(value)}>되돌리기</ShopTextBtn>
          {/* 높이 = 라벨 없는 단추 사다리(웹 36 · 폰 40) — 기둥 안 한 줄이라 독 높이(44/48)는 무겁다. */}
          <div style={{ flex: 1, height: mobile ? SHOP.icon.mobile : SHOP.icon.web }}>
            <ShopDockAction onClick={() => { if (!saving) onSave(picked); }}>
              {saving ? '저장하는 중' : '이 줄로 저장'}
            </ShopDockAction>
          </div>
        </div>
      ) : null}
    </div>
  );
}
