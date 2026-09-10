'use client';
import { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { C, SCRIM } from '@/components/ui';
import { useIsMobile } from '@/lib/use-mobile';
import { SHOP, ShopDock, ShopDockAction, ShopIconBtn, ShopPill, ShopTextBtn } from '@/components/shop/shop-ui';
import { AXIS_LABEL, SHOP_AXES, type ShopAxis, type ShopFacets, type ShopQuickChip } from '@/lib/shop/query';

/**
 * **빠른조건을 «고르는» 화면 — 누구나 연다.**
 *
 * ★★★사장님 2026-09-10 「그냥 **누구나 할 수 있게 오픈**할 거야. 어차피 **우리 거 팔아주는
 *   입장**이니까 **누구라도 할 수 있게**」 · 「**손님도 할 수 있게 다~ 모든 사람이**」.
 *   ⇒ 로그인도 역할도 안 본다. 그래서 이 창에 「권한이 없습니다」가 없다.
 *
 * ⚠⚠ **고친 것은 «그 채널에 들어오는 다음 사람»에게도 보인다.** 내 화면만 바뀌는 것이 아니라
 *   가게의 첫 줄이 바뀐다 — 그래서 창이 「지금 줄에 있는 조건」이라고 말한다(「내 조건」이 아니다).
 *
 * ★★사장님 2026-09-10 「**있는 필터를 잠시 옮겨놓은 느낌**이어야 하잖아」 ·
 *   「그래서 퀵필터를 **수정할 수 있게** 해주면 좋겠어」 · 「**있는 필터만** 갖다 놓겠음」.
 *
 * ★★★**여기 뜨는 값은 전부 «지금 재고에 있는» 값이다.** 고르는 목록을 조건칸과 같은 집계
 *   (`facets`)에서 만든다 — 그 집계는 **건수 0 인 값을 이미 뺀다**(`runShopQuery`).
 *   그래서 «없는 조건을 갖다 놓는» 일이 구조적으로 안 생긴다. 손으로 적는 칸이 없는 이유다.
 *   ⚠ 목록을 여기서 새로 세지 않는다 — 세는 곳이 둘이 되면 조건칸과 퀵칩이 다른 말을 한다.
 *
 * ★**「잠시 옮겨놓는」이 그대로 짜임이다.** 위=지금 줄에 올라와 있는 것, 아래=옮겨올 수 있는 것.
 *   누르면 위아래로 오간다. 새 개념을 만들지 않았다 — 조건칸에 있는 것을 그대로 집어 올린다.
 *
 * ★건수를 칩에 같이 적는다 — 「이걸 올리면 손님이 몇 대를 보나」를 고르는 순간에 안다.
 *   0대짜리를 못 고르는 것과, 3대짜리인 줄 모르고 고르는 것은 다른 문제다.
 */
export function ShopQuickEditor({ facets, value, onSave, onClose, saving }: {
  facets: ShopFacets;
  value: ShopQuickChip[];
  onSave: (next: ShopQuickChip[]) => void;
  onClose: () => void;
  saving?: boolean;
}) {
  const [picked, setPicked] = useState<ShopQuickChip[]>(value);
  const mobile = useIsMobile();

  const id = (c: { axis: ShopAxis; key: string }) => `${c.axis}:${c.key}`;
  const on = useMemo(() => new Set(picked.map(id)), [picked]);

  /**
    * 그 값이 **재고에 몇 대인가** — 집계에서 그대로 읽는다(여기서 세지 않는다).
    * ★`count`(지금 조건에서 몇 대)가 아니라 `base`(조건을 다 풀면 몇 대)다 —
    *   여기는 «가게의 첫 줄»을 짜는 자리라, 지금 손님이 무엇을 걸어 뒀는지와 무관해야 한다.
    *   조건을 걸어 둔 채 창을 열었다고 「지금 없음」이 되면 **고를 수 있는 것이 조건마다 달라진다.**
    */
  const countOf = (axis: ShopAxis, key: string) =>
    facets[axis].find((o) => o.key === key)?.base ?? 0;
  /** 화면에 뜰 이름 — 집계가 이미 손님 말로 만들어 둔 이름(`label`)을 쓴다. */
  const labelOf = (axis: ShopAxis, key: string) =>
    facets[axis].find((o) => o.key === key)?.label || key;

  const add = (axis: ShopAxis, key: string) => {
    if (on.has(`${axis}:${key}`)) return;
    setPicked((p) => [...p, { axis, key }]);
  };
  const drop = (c: ShopQuickChip) => setPicked((p) => p.filter((x) => id(x) !== id(c)));
  const move = (i: number, d: -1 | 1) => setPicked((p) => {
    const j = i + d;
    if (j < 0 || j >= p.length) return p;
    const next = [...p];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });

  return (
    <div role="dialog" aria-label="빠른조건 고치기"
      style={{
        /* 딤은 토큰이다 — 생 rgba 를 쓰면 다크에서 같이 안 뒤집힌다(check:tokens 가 잡는다). */
        position: 'fixed', inset: 0, zIndex: 40, background: SCRIM.heavy,
        display: 'flex', flexDirection: 'column',
        /*
         * ★**폰은 밑에서 올라오는 시트, 웹은 가운데 판**(집 규칙 ③ — 같은 창을 양쪽에 «한 번에»
         *   맞춘다). 웹에서 폭을 안 잡으면 조건 이름은 왼쪽 끝, ↑↓·빼기는 오른쪽 끝에 서서
         *   한 줄을 눈으로 가로질러야 한다 — 고르는 화면이 «읽는 화면»이 된다.
         */
        justifyContent: mobile ? 'flex-end' : 'center',
        alignItems: mobile ? 'stretch' : 'center',
      }}
      onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        style={{
          background: C.bg,
          ...(mobile
            ? { borderTopLeftRadius: SHOP.sheetR, borderTopRightRadius: SHOP.sheetR, height: '82vh' }
            : { borderRadius: SHOP.sheetR, width: 'min(720px, 92vw)', height: 'min(82vh, 760px)' }),
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}>
        {/* 머리 — 조건 시트와 같은 짜임(제목 왼쪽 · 닫기 오른쪽). 화면마다 다른 머리를 만들지 않는다. */}
        <div style={{
          flex: '0 0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: `${SHOP.sp.cozy}px ${SHOP.sp.edge}px`, borderBottom: `1px solid ${C.line2}`,
        }}>
          <span style={{ fontSize: SHOP.fs.h2, fontWeight: 700, color: C.ink }}>빠른조건 고치기</span>
          <ShopIconBtn onClick={onClose} label="닫기"><X size={18} aria-hidden /></ShopIconBtn>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: SHOP.sp.edge }}>
          {/*
            ★**«같이 보는 줄»이라고 먼저 말한다.** 누구나 고칠 수 있게 열어 둔 자리라(머리말),
              고치는 사람이 「내 화면만 바뀐다」고 오해하면 남의 가게 첫 줄을 무심코 바꾼다.
              막는 대신 **말해 준다** — 문을 연 채로 할 수 있는 일은 이것이다.
          */}
          <div style={{ fontSize: SHOP.fs.cap, color: C.mute, marginBottom: SHOP.sp.cozy, lineHeight: 1.7 }}>
            이 줄은 <strong style={{ color: C.ink }}>이 가게를 보는 모든 분</strong>에게 같이 보입니다.
          </div>

          {/* ── 위: 지금 줄에 올라와 있는 것 ── */}
          <div style={{ fontSize: SHOP.fs.cap, color: C.faint, marginBottom: SHOP.sp.snug }}>
            지금 줄에 있는 조건 · {picked.length}개
          </div>
          {picked.length ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: SHOP.sp.snug }}>
              {picked.map((c, i) => (
                <div key={id(c)} style={{
                  display: 'flex', alignItems: 'center', gap: SHOP.sp.snug,
                  padding: `${SHOP.sp.snug}px ${SHOP.sp.cozy}px`,
                  border: `1px solid ${C.line2}`, borderRadius: SHOP.r.ctrl, background: C.zebra,
                }}>
                  <span style={{ fontSize: SHOP.fs.cap, color: C.faint, flex: '0 0 auto' }}>
                    {AXIS_LABEL[c.axis]}
                  </span>
                  <span style={{ flex: 1, minWidth: 0, fontSize: SHOP.fs.body, fontWeight: 700, color: C.ink }}>
                    {c.label || labelOf(c.axis, c.key)}
                  </span>
                  {/*
                    건수 0 은 «지금 재고에 없는» 조건이다 — 이미 저장돼 있던 것이 재고가 빠지면서
                    이렇게 된다. 손님 화면에는 안 뜨므로, 여기서 그렇다고 말해 준다.
                  */}
                  <span style={{
                    flex: '0 0 auto', fontSize: SHOP.fs.cap,
                    color: countOf(c.axis, c.key) ? C.faint : C.danger,
                    fontVariantNumeric: 'tabular-nums',
                  }}>
                    {countOf(c.axis, c.key) ? `${countOf(c.axis, c.key)}대` : '지금 없음'}
                  </span>
                  <ShopTextBtn tone="faint" onClick={() => move(i, -1)}>↑</ShopTextBtn>
                  <ShopTextBtn tone="faint" onClick={() => move(i, 1)}>↓</ShopTextBtn>
                  <ShopTextBtn tone="faint" onClick={() => drop(c)}>빼기</ShopTextBtn>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: SHOP.fs.sub, color: C.faint, lineHeight: 1.8 }}>
              올려 둔 조건이 없습니다. 아래에서 골라 올리세요 — 손님 화면의 칩 줄이 사라집니다.
            </div>
          )}

          {/* ── 아래: 옮겨올 수 있는 것 = 지금 재고에 있는 값 전부 ── */}
          <div style={{
            marginTop: SHOP.sp.part, paddingTop: SHOP.sp.cozy, borderTop: `1px solid ${C.line2}`,
            fontSize: SHOP.fs.cap, color: C.faint,
          }}>
            여기서 올립니다 — <strong style={{ color: C.mute }}>지금 재고에 있는 조건만</strong> 나옵니다
          </div>
          {SHOP_AXES.map((axis) => {
            const opts = facets[axis].filter((o) => o.base > 0 && !on.has(`${axis}:${o.key}`));
            if (!opts.length) return null;   // 값이 없는 축은 아예 안 그린다(빈 제목을 세우지 않는다)
            return (
              <div key={axis} style={{ marginTop: SHOP.sp.cozy }}>
                <div style={{ fontSize: SHOP.fs.cap, color: C.faint, marginBottom: SHOP.sp.tight }}>
                  {AXIS_LABEL[axis]}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: SHOP.sp.snug }}>
                  {opts.map((o) => (
                    <ShopPill key={o.key} on={false} onClick={() => add(axis, o.key)}>
                      {o.label} {o.count}
                    </ShopPill>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {/* 하단 실행독 — 집 규격 그대로(비주요 고정폭 · 주요 나머지 전부). */}
        <ShopDock side={<ShopDockAction tone="quiet" onClick={onClose}>취소</ShopDockAction>}>
          <ShopDockAction tone="brand" onClick={() => onSave(picked)}>
            {saving ? '저장하는 중' : '저장'}
          </ShopDockAction>
        </ShopDock>
      </div>
    </div>
  );
}
