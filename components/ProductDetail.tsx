'use client';
import { useState, useEffect, useRef, type ReactNode } from 'react';
import { type EntityRecord } from '@/lib/intake/entities';
import { detailSections, type Audience } from '@/lib/domain/product';
import { useProductPhotoState } from '@/components/use-product-photos';
import { getRole } from '@/lib/domain/deal';
import { Badge, C, R, NUM, FW, FS, ICON, CloseBtn, IconBtn, SCRIM, DetailTable, DT, KV_LABEL_W } from '@/components/ui';
import { toast } from '@/components/Toaster';
import { downloadSinglePhoto } from '@/lib/client/download-photo-zip';
import {
  badges, Plate, idParts, CardBenefits, CardEvents, OptionChips, plateSpecLine,
} from '@/components/product-card-atoms';
import { FavHeart } from '@/components/FavHeart';
import { ProductStateMarks } from '@/components/ProductStateMarks';
import { ProductPhotoImage, ProductPhotoPlaceholder } from '@/components/ProductPhoto';
import { ProductPriceTable } from '@/components/ProductPriceTable';
import { useIsMobile } from '@/lib/use-mobile';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Download } from 'lucide-react';
import { sectionIcon, sectionAccent } from '@/components/section-icons';
import { ColorValue } from '@/components/color-swatch';

/**
 * 매물 상세 SSOT — 웹·모바일 **동일 원자·동일 타이포**.
 * 차이는 페이지 껍데기 배열(패딩·하단바·스와이프)만. dense/모바일 폰트 분기 금지.
 * /m · 소통·계약 패널 · /q 공용.
 */
/** work(영업자 작업화면) 사진 **폭** 상한 — 16:10 그대로 460×288. 상세 칸이 넓어져도 사진만 커지진 않는다. */
const WORK_PHOTO_W = 460;
/**
 * 세로 썸네일 칸 폭. 큰 사진 옆에 붙어 그 높이만큼만 쓰고 안에서 위아래로 굴린다.
 * 웹·모바일 같은 값 — 폰에서도 «옆에 더 있다»가 보여야 한다(줄이면 무슨 사진인지 안 보인다).
 */
const THUMB_COL_W = 72;
/** 세로 썸네일 사이 간격 — 한 칸 이동 거리 계산에 같이 쓴다(값이 갈리면 반 칸씩 어긋난다). */
const THUMB_GAP = 6;
/** ∧∨ 버튼 높이 — 썸네일보다 낮게(칸의 주인공은 사진이다). */
const THUMB_STEP_H = 18;

/**
 * 빈 슬롯(`-`)을 흐리게 — 지우지는 않는다.
 * 「가솔린 · - · 1,000cc · 5인승」의 `-`는 «구동방식을 모른다»는 정보다. 지우면 그 축이 있었다는 것조차
 * 안 보여 영업자가 손님에게 «없다»고 잘못 말한다. 그래서 **정보는 남기고 무게만 낮춘다.**
 * 구분자는 gSlots 가 만든 ` · ` 하나뿐이라 쪼개도 값이 깨지지 않는다.
 */
function dimDashes(v: ReactNode): ReactNode {
  if (typeof v !== 'string' || !v.includes('-')) return v;
  const parts = v.split(' · ');
  if (parts.length < 2 || !parts.some((x) => x === '-')) return v;
  return parts.map((x, i) => (
    <span key={i}>
      {i > 0 && <span style={{ color: C.faint }}> · </span>}
      {x === '-' ? <span style={{ color: C.faint }}>-</span> : x}
    </span>
  ));
}

/**
 * `brochure` = 손님에게 보여주는 순서(사진 먼저). `/q`·공급사·손님 화면의 문법.
 * `work` = 영업자 작업화면. 사진도 헤더 바로 아래(폭만 WORK_PHOTO_W).
 *   아래로 숨기면 «사진 없음»으로 오해한다.
 */
export type DetailLayout = 'brochure' | 'work';

export function ProductDetail({ p, audience, layout = 'brochure' }: {
  p: EntityRecord;
  audience?: Audience;
  layout?: DetailLayout;
}) {
  const mobile = useIsMobile();
  const [lb, setLb] = useState<number | null>(null);
  const [main, setMain] = useState(0);
  const { photos, pending } = useProductPhotoState(p);
  const thumbRef = useRef<HTMLDivElement | null>(null);
  /** 썸네일이 칸을 넘치는가 — 넘칠 때만 ∧∨ 를 세운다(3장짜리 매물에서 버튼이 썸네일을 가리지 않게). */
  const [thumbOverflow, setThumbOverflow] = useState(false);
  useEffect(() => { setMain(0); }, [p.product_code]);
  const mainIdx = Math.min(main, Math.max(0, photos.length - 1));
  /**
   * ★**상세를 열면 그 페이지 사진을 미리 받아 둔다**(사장님 2026-08-22 「모바일에서는 사진 1장씩 다운받는 거 없어도 되고,
   *   화면 열리면 미리 다 다운받는 거 있잖아, 무리 안 하는 선에서」 · 「웹도 어느 정도 표준만큼은 해야지, 상세페이지 열면
   *   미리 받아둬야지 그 페이지 만큼은」).
   *   폰에는 썸네일 칸이 없어 «넘겨야» 다음 장을 안다 — 그때부터 받으면 한 박자 하얗게 뜬다.
   *   웹은 썸네일이 작은 판으로만 뜨므로, 큰 사진으로 넘길 때 다시 기다린다.
   *
   * ⚠ «무리 안 하는 선» — 세 가지로 지킨다:
   *   ① **앞 8장까지만.** 26장짜리 매물도 있는데 다 받으면 데이터·메모리를 그만큼 쓴다. 손님 앞에서 넘기는 건 대개 앞쪽이다.
   *   ② **유휴 시간에.** 큰 사진이 먼저 떠야 하므로 `requestIdleCallback` 뒤로 미룬다(미지원 브라우저는 600ms 뒤).
   *   ③ **낮은 우선순위.** `fetchPriority='low'` 로 지금 보는 사진의 대역을 뺏지 않는다.
   *   ⚠ 이 페이지 사진만 데운다 — 목록의 다른 매물까지 미리 받지 않는다(그게 «무리»다).
   */
  /**
   * ★**사진 보기가 열려 있는 동안만 확대를 되돌린다**(사장님 2026-08-22 「사진 눌러서 사진 볼 때 사진은 확대되어야지」).
   *
   * ⚠ `touch-action` 은 **조상이 막으면 자식이 못 되살린다**(효과는 조상들과의 교집합이다).
   *   그래서 라이트박스 판에 `auto` 를 줘도, body 에 걸린 `manipulation` 이 이미 더블탭 확대를 끈 뒤라 소용이 없다.
   *   열려 있는 동안만 **root 에 표식**을 달아 globals.css 가 body 규칙을 풀게 한다(닫으면 원래대로).
   */
  useEffect(() => {
    const root = document.documentElement;
    if (lb === null) { root.classList.remove('fp-photo-zoom'); return; }
    root.classList.add('fp-photo-zoom');
    return () => root.classList.remove('fp-photo-zoom');
  }, [lb]);
  const photoKey = photos.join('|');
  useEffect(() => {
    if (photos.length < 2) return;
    const targets = photos.slice(0, 8).filter((src, i) => src && i !== mainIdx && !src.startsWith('data:'));
    if (!targets.length) return;
    let cancelled = false;
    const warm = () => {
      if (cancelled) return;
      for (const src of targets) {
        const img = new Image();
        img.decoding = 'async';
        (img as HTMLImageElement & { fetchPriority?: string }).fetchPriority = 'low';
        img.src = src;
      }
    };
    const idle = typeof window.requestIdleCallback === 'function'
      ? window.requestIdleCallback(warm, { timeout: 2_000 })
      : window.setTimeout(warm, 600);
    return () => {
      cancelled = true;
      if (typeof window.cancelIdleCallback === 'function' && typeof idle === 'number') window.cancelIdleCallback(idle);
      else window.clearTimeout(idle as number);
    };
    // photoKey = 사진 목록이 «내용»으로 바뀔 때만 다시 데운다(배열 identity 는 렌더마다 바뀐다).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photoKey]);
  /**
   * 메인 사진을 넘기면 **옆 썸네일 칸도 따라간다**.
   *
   * 지금까지는 테두리만 옮겨 다녀서, 26장짜리 매물에서 몇 장 넘기면 «지금 보는 사진»이
   * 썸네일 칸 밖으로 나가 어디쯤인지 안 보였다(사장님 지적 2026-08-11).
   * `scrollIntoView` 는 페이지까지 같이 움직여 화면이 튀므로 칸 안 스크롤만 직접 옮긴다.
   * 썸네일이 세로 칸이 되면서(2026-08-20) 축이 가로→세로로 바뀌었다.
   */
  useEffect(() => {
    const strip = thumbRef.current;
    const el = strip?.children?.[mainIdx] as HTMLElement | undefined;
    if (!strip || !el) return;
    const target = el.offsetTop - (strip.clientHeight - el.clientHeight) / 2;
    const max = strip.scrollHeight - strip.clientHeight;
    strip.scrollTo({ top: Math.max(0, Math.min(target, max)), behavior: 'smooth' });
  }, [mainIdx, photos.length]);
  // 칸이 넘치는지 = 칸 높이(큰 사진 높이)와 썸네일 수에 함께 달렸다 → 둘 다 볼 수 있게 ResizeObserver.
  useEffect(() => {
    const strip = thumbRef.current;
    if (!strip) { setThumbOverflow(false); return; }
    const measure = () => setThumbOverflow(strip.scrollHeight > strip.clientHeight + 1);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(strip);
    return () => ro.disconnect();
  }, [photos.length]);
  const aud: Audience = audience || (getRole() === 'admin' ? 'admin' : 'agent');
  const work = layout === 'work';
  const [swipeX, setSwipeX] = useState<number | null>(null); // 메인 사진 좌우 스와이프
  const stepPhoto = (dir: number) => { if (photos.length > 1) setMain((m) => (m + dir + photos.length) % photos.length); };
  /**
   * 썸네일 칸을 **한 칸씩** 굴린다(사장님 2026-08-20 「한칸씩 옮길수 있는 표시가 있어야지」).
   * 한 칸 높이는 재서 쓴다 — 칸 폭이 화면에 따라 달라지므로 숫자를 박으면 반 칸씩 어긋난다.
   * 사진을 «고르지는» 않는다. 고르는 건 썸네일 클릭·메인 사진의 ‹ › 이고, 이건 목록을 넘기는 것이다.
   */
  const stepThumbs = (dir: number) => {
    const strip = thumbRef.current;
    const first = strip?.children?.[0] as HTMLElement | undefined;
    if (!strip || !first) return;
    strip.scrollBy({ top: dir * (first.offsetHeight + THUMB_GAP), behavior: 'smooth' });
  };
  const secs = detailSections(p, aud);
  const { idMain, idExt } = idParts(p);
  const photoFileName = String(p.car_number || p.vehicle_no || p.plate_no || p.product_code || idMain || '차량사진');
  const downloadOnePhoto = async (url: string, index: number) => {
    try {
      await downloadSinglePhoto(url, index, photoFileName);
      toast(`사진 ${index + 1} 저장 완료`, 'ok');
    } catch (error) {
      toast(String((error as Error)?.message || '사진 다운로드 실패'), 'error');
    }
  };
  /** work = 차량번호를 요약바가 이미 들고 있다. 세부표에서 한 번 더 찍지 않는다(같은 값 세 번 → 표가 길어 보인다). */
  const kvRows = (rows: [string, string][]) => (work ? rows.filter(([k]) => k !== '차량번호') : rows);

  return (
    <div>
      {/* 1 헤더 — 차명 → 차번·상태·상품·심사 → 우대·이벤트 (원자 공용).
          work 에서는 차명·차번은 우측 카드·상단바가 들고 있어 제목 줄을 뺀다.
          대신 사진 위에 얹혀 있던 관심(하트)이 사라지지 않게 칩 줄로 내려 붙인다. */}
      {/* 12 = 섹션 사이 공통 리듬(2026-08-22 여백 규격화 — 11 같은 어중간한 값 금지). */}
      <div style={{ marginBottom: 12 }}>
        {!work && (
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
            <h1 style={{ fontSize: FS.page, fontWeight: FW.title, letterSpacing: '-0.02em', margin: 0, lineHeight: 1.25 }}>{idMain}</h1>
            {idExt && <span style={{ fontSize: FS.title, fontWeight: FW.meta, color: C.mute }}>{idExt}</span>}
          </div>
        )}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
          marginTop: work ? 0 : 8, rowGap: 6,
        }}>
          {aud !== 'customer' && !work && <Plate p={p} />}
          {/* 차번 옆 한 줄 — 연식 · 주행 · 연료(사장님 2026-08-20 「차량번호에 26년 주행거리 연료까지는 넣어주자」). */}
          {!work && plateSpecLine(p) && (
            <span style={{ fontSize: FS.sub, color: C.mute, fontVariantNumeric: 'tabular-nums' }}>{plateSpecLine(p)}</span>
          )}
          {/* work = 차번·상태를 요약바가 이미 들고 있다. 같은 값을 두 번 찍지 않는다.
              ★**상단은 「출고상태 + 상품구분」 둘만**(사장님 2026-08-23 「모바일에서 상단에 출고가능 중고렌트 무심사
                이거를 무심사/소득확인 이거는 아래 하단에 조건으로 보내자 — 계약조건이니까. 위에는 출고상태랑
                상품구분 뱃지만 두자」). 심사(무심사·소득확인)는 «지금 살 수 있나»가 아니라 «어떤 조건인가»라
                아래 「계약조건」 섹션이 든다 — 거기 이미 「심사」 줄로 서 있어 그동안 같은 값이 두 번 나갔다. */}
          {badges(p, false, true, false, aud, { hideStatus: work })}
          <CardBenefits p={p} inline />
          <CardEvents p={p} inline />
          {/* 사진 없음도 매물의 성질이다 — 별도 줄을 잡아먹지 않게 칩으로 붙인다.
              (안 그리면 «없는 건지 안 뜬 건지»를 모른다. 사진 없는 차가 절반 가까이다.) */}
          {work && photos.length === 0 && !pending && <Badge tone="gray" variant="quiet" title="등록된 사진이 없습니다">사진없음</Badge>}
          {work && aud !== 'customer' && <ProductStateMarks p={p} showSeen={false} />}
          {work && aud !== 'customer' && <FavHeart p={p} compact />}
        </div>
      </div>

      {/* 2 사진 — 웹·work 모두 헤더 바로 아래(안 보이면 없다고 판단함).
          work만 폭 상한(WORK_PHOTO_W)으로 가격표가 같이 보이게. */}
      <div>
      {(photos.length ? (
        <div style={work ? { maxWidth: WORK_PHOTO_W, marginBottom: 4 } : undefined}>
          {/* 이름표 없음 — 사진을 보고 「차량사진」이라 적는 건 빈말이다(사장님 2026-08-20 「없어도 되지 않을까」).
              원래 이 줄에 「전체받기」가 붙어 있어 제목이 필요했는데, 그 동작이 우측 영업자 패널의
              「사진 N장 내려받기」로 옮겨 가면서 이름표만 껍데기로 남아 있었다. */}
          {/*
            사진 = 큰 사진 + **세로 썸네일 칸**(사장님 2026-08-20 「세로로 하기로 했잖아 · 거기서 또 상하스크롤이 되니까」).
            가로 줄이던 때는 사진이 20장 넘으면 옆으로 한참 밀어야 했고, 밀다가 페이지가 같이 움직였다.
            세로 칸은 큰 사진 높이만큼만 쓰고 그 안에서 위아래로 굴린다 — 페이지는 안 움직인다.

            칸 높이를 큰 사진에 맞추는 법: 줄(flex)에 `alignItems:'stretch'` 를 걸어 칸이 사진 높이를 받고,
            칸 «안»의 스크롤러는 `position:absolute; inset:0` 로 띄운다. 그냥 두면 썸네일이 많을 때
            칸이 늘어나 사진까지 같이 커진다(칸이 줄 높이를 밀어 올린다).
          */}
          <div style={{ display: 'flex', gap: 6, alignItems: 'stretch' }}>
          <div
            onPointerDown={(e) => {
              if ((e.target as HTMLElement).closest('button, a')) return;
              setSwipeX(e.clientX);
            }}
            onPointerUp={(e) => {
              const sx = swipeX; setSwipeX(null);
              if ((e.target as HTMLElement).closest('button, a')) return;
              if (sx != null && Math.abs(e.clientX - sx) > 40) { stepPhoto(e.clientX < sx ? 1 : -1); return; }
              setLb(mainIdx);
            }}
            style={{ flex: '1 1 auto', minWidth: 0, position: 'relative', aspectRatio: '16 / 10', background: C.placeholder, borderRadius: R, overflow: 'hidden', cursor: 'zoom-in', touchAction: 'pan-y', userSelect: 'none' }}
          >
            <ProductPhotoImage
              src={photos[mainIdx]}
              alt=""
              draggable={false}
              style={{ width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none' }}
            />
            {photos.length > 1 && (
              <>
                <IconBtn
                  title="이전 사진"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => { e.stopPropagation(); stepPhoto(-1); }}
                  style={{
                    position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', zIndex: 2,
                    border: 'none', background: C.ink, color: C.taupeBg, opacity: 0.7, borderRadius: '50%',
                  }}
                ><ChevronLeft size={ICON.xl} strokeWidth={2.5} /></IconBtn>
                <IconBtn
                  title="다음 사진"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => { e.stopPropagation(); stepPhoto(1); }}
                  style={{
                    position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', zIndex: 2,
                    border: 'none', background: C.ink, color: C.taupeBg, opacity: 0.7, borderRadius: '50%',
                  }}
                ><ChevronRight size={ICON.xl} strokeWidth={2.5} /></IconBtn>
              </>
            )}
            {aud !== 'customer' && !work && (
              <span style={{ position: 'absolute', top: 8, right: 8, zIndex: 2, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <ProductStateMarks p={p} onPhoto showSeen={false} />
                <FavHeart p={p} onPhoto />
              </span>
            )}
            <span style={{ position: 'absolute', right: 8, bottom: 8, background: SCRIM.heavy, color: C.inverse, fontSize: FS.cap, fontWeight: FW.strong, padding: '2px 8px', borderRadius: R, fontFamily: NUM, fontVariantNumeric: 'tabular-nums', pointerEvents: 'none' }}>{mainIdx + 1} / {photos.length}</span>
          </div>
          {/*
            **폰에서는 작은 사진칸을 안 만든다**(사장님 2026-08-20 「모바일에서는 작은 사진칸 필요 없지, 그냥 눌러서 보는 형태가 더 빠르잖아」).
            좁은 폭에서 72px 을 썸네일에 떼 주면 큰 사진이 그만큼 줄어드는데, 정작 폰에서는
            큰 사진을 눌러 전체보기로 넘기는 게 빠르다(좌우 넘김·핀치줌이 다 된다).
            웹은 마우스가 있어 «훑어보고 고르는» 썸네일이 값을 한다 — 그래서 화면마다 다르게 둔다.
          */}
          {photos.length > 1 && !mobile && (
            <div style={{ flex: `0 0 ${THUMB_COL_W}px`, position: 'relative' }}>
              {thumbOverflow && (
                <IconBtn
                  title="썸네일 위로"
                  onClick={() => stepThumbs(-1)}
                  style={{
                    position: 'absolute', top: 0, left: 0, right: 0, zIndex: 2,
                    width: '100%', height: THUMB_STEP_H, minHeight: THUMB_STEP_H, borderRadius: R,
                    border: 'none', background: C.ink, color: C.taupeBg, opacity: 0.72,
                  }}
                ><ChevronUp size={ICON.sm} strokeWidth={2.5} /></IconBtn>
              )}
              <div
                ref={thumbRef}
                style={{
                  position: 'absolute', left: 0, right: 0,
                  top: thumbOverflow ? THUMB_STEP_H + THUMB_GAP : 0,
                  bottom: thumbOverflow ? THUMB_STEP_H + THUMB_GAP : 0,
                  overflowY: 'auto', overscrollBehavior: 'contain',
                  display: 'flex', flexDirection: 'column', gap: THUMB_GAP, WebkitOverflowScrolling: 'touch',
                }}
              >
                {photos.map((ph, i) => (
                  <IconBtn
                    key={i}
                    title={`사진 ${i + 1}`}
                    onClick={() => setMain(i)}
                    style={{
                      flex: '0 0 auto', width: '100%', aspectRatio: '16 / 10', height: 'auto',
                      borderRadius: R, overflow: 'hidden',
                      border: `2px solid ${i === mainIdx ? C.brand : 'transparent'}`,
                      padding: 0, background: C.placeholder,
                    }}
                  >
                    <ProductPhotoImage
                      src={ph}
                      alt=""
                      draggable={false}
                      compactPlaceholder
                      style={{ width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none' }}
                    />
                  </IconBtn>
                ))}
              </div>
              {thumbOverflow && (
                <IconBtn
                  title="썸네일 아래로"
                  onClick={() => stepThumbs(1)}
                  style={{
                    position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 2,
                    width: '100%', height: THUMB_STEP_H, minHeight: THUMB_STEP_H, borderRadius: R,
                    border: 'none', background: C.ink, color: C.taupeBg, opacity: 0.72,
                  }}
                ><ChevronDown size={ICON.sm} strokeWidth={2.5} /></IconBtn>
              )}
            </div>
          )}
          </div>
        </div>
      ) : work ? (
        pending ? <div style={{ fontSize: FS.cap, color: C.faint, marginBottom: 4 }}>사진 불러오는 중…</div> : null
      ) : (
        <div style={{ position: 'relative', aspectRatio: '16 / 10', background: C.placeholder, borderRadius: R, overflow: 'hidden' }}>
          <ProductPhotoPlaceholder style={{ position: 'absolute', inset: 0 }} />
          {aud !== 'customer' && <span style={{ position: 'absolute', top: 8, right: 8 }}><FavHeart p={p} onPhoto /></span>}
        </div>
      ))}
      </div>

      {/* 3 섹션 — 사진 다음 읽기 순서 SSOT:
          차량스펙(제조사) → 대여료조건 → 보험조건 → 계약조건 → 기타사항 → 영업자 전용.
          ★**모든 섹션이 같은 표**(DetailTable)다 — 예전엔 대여료·보험만 표였고 나머지는 라벨 위/값 아래
            격자여서 한 화면에 문법 두 개가 섞였다(사장님 2026-08-20 「맹하다 · 표로 할 건 표로」).
            무게 차이는 tier 로만 준다: main=흰 카드 · sub=바탕 없음 · agent=앰버(손님 화면에선 통째로 빠짐). */}
      {secs.map((sec) => (
        <section key={sec.title} style={{ marginTop: 12 }}>
          {sec.kind === 'price' ? (
            <ProductPriceTable p={p} title={sec.title} hint={sec.hint} tone={sec.tier} />
          ) : sec.kind === 'ins' ? (
            (() => {
              /*
               * 보험 = **가로 배치**(사장님 2026-08-20 「보험은 이렇게 표현해 줘도 되는데」 — 약관 요약표 형태).
               *   담보가 «열»이 되고 「보상 한도 / 사고 시 면책금」이 «행»이 된다.
               *
               * 세로(담보 한 줄씩)에서 바꾼 이유: 보험은 담보마다 값이 한 낱말(무한·1억원·30만원)이라
               * 세로로 세우면 오른쪽이 텅 비고 줄만 길어진다. 가로로 누이면 한 눈에 «어디까지 막아 주나»가
               * 한 줄로 읽히고, 면책금 줄과 세로로 맞물려 담보별 비교도 된다.
               *
               * 긴급출동은 한도·면책이 있는 담보가 아니지만 열로 세운다 — 손님이 늘 같이 묻는 값이라
               * 표 밖 쪽지로 빼면 못 본다(면책 칸은 「없음」으로 채운다).
               */
              const cover = sec.rows.map(([lbl, limit, ded]) => ({ lbl, limit, ded }));
              if (sec.note) cover.push({ lbl: '긴급출동', limit: sec.note, ded: '' });

              /*
               * **모바일은 세로**(사장님 2026-08-20 「모바일은 그냥 세로로 보게 해 줘야지, 웹 화면이랑 다르게 해야 할 것도 있는 거지」).
               * 가로 배치는 담보 6개가 열이 되는데 폰 폭에서는 한 칸이 40px 남짓이라
               * 「무한」이 「무 / 한」으로 서 버린다(실제로 글자가 세로로 섰다).
               * 폰에서는 담보 하나가 한 줄이고, 한도·면책이 그 줄의 두 칸이 된다 — 값이 옆으로 눕는다.
               */
              if (mobile) {
                return (
                  <DetailTable
                    title={sec.title}
                    hint={sec.hint}
                    icon={sectionIcon(sec.title)}
                    accent={sectionAccent(sec.title)}
                    tone={sec.tier}
                    span={3}
                    label="보험 보장한도와 면책금"
                    widths={['34%', '33%', '33%']}
                    cols={<>
                      <th scope="col" style={DT.colTh}>항목</th>
                      <th scope="col" style={{ ...DT.colTh, textAlign: 'right' }}>보상 한도</th>
                      <th scope="col" style={{ ...DT.colTh, textAlign: 'right' }}>면책금</th>
                    </>}
                  >
                    {cover.map((c, i) => {
                      /* 자차 면책 「수리비의 20% · 50~100만원」 은 2줄로(사장님 2026-08-22 「수리비의 00%, 한 칸 내리고 50~100만원」)
                         — 폰 폭 한 줄이면 어중간한 자리에서 접힌다. 비율·구간이 다 있을 때만 「 · 」에서 가른다. */
                      const dedLines = /수리비/.test(c.ded) && c.ded.includes(' · ') ? c.ded.split(' · ') : null;
                      return (
                        <tr key={c.lbl} style={DT.tr(i)}>
                          <th scope="row" style={{ ...DT.labelTh, width: undefined }}>{c.lbl}</th>
                          <td style={{ ...DT.tdR, color: c.limit ? C.ink : C.faint, fontWeight: c.limit ? FW.title : undefined }}>{c.limit || '—'}</td>
                          <td style={{ ...DT.tdR, color: c.ded ? C.ink : C.faint }}>
                            {dedLines ? dedLines.map((l, j) => <div key={j}>{l}</div>) : (c.ded || '없음')}
                          </td>
                        </tr>
                      );
                    })}
                  </DetailTable>
                );
              }

              const span = cover.length + 1;
              const headW = 108;
              const cellW = `calc((100% - ${headW}px) / ${cover.length})`;
              const cell = (v: string, strong?: boolean): React.CSSProperties => ({
                ...DT.td, textAlign: 'center', verticalAlign: 'middle',
                color: v ? C.ink : C.faint,
                ...(strong && v ? { fontSize: FS.title, fontWeight: FW.title } : null),
              });
              return (
            <DetailTable
              title={sec.title}
              hint={sec.hint}
              icon={sectionIcon(sec.title)}
              accent={sectionAccent(sec.title)}
              tone={sec.tier}
              span={span}
              label="보험 보장한도와 면책금"
              widths={[headW, ...cover.map(() => cellW)]}
              cols={<>
                <th scope="col" style={DT.colTh} />
                {cover.map((c) => (
                  <th key={c.lbl} scope="col" style={{ ...DT.colTh, textAlign: 'center' }}>{c.lbl}</th>
                ))}
              </>}
            >
              {/* 보험은 «얼마까지»가 전부인 섹션이다 — 한도 줄만 한 단계 키워 훑을 때 숫자가 먼저 잡히게 한다.
                  면책금은 보조값이라 본문 크기 그대로 둔다(둘 다 키우면 다시 평평해진다). */}
              <tr style={DT.tr(0)}>
                <th scope="row" style={{ ...DT.labelTh, width: undefined }}>보상 한도</th>
                {cover.map((c) => <td key={c.lbl} style={cell(c.limit, true)}>{c.limit || '—'}</td>)}
              </tr>
              <tr style={DT.tr(1)}>
                <th scope="row" style={{ ...DT.labelTh, width: undefined }}>사고 시 면책금</th>
                {cover.map((c) => <td key={c.lbl} style={cell(c.ded)}>{c.ded || '없음'}</td>)}
              </tr>
            </DetailTable>
              );
            })()
          ) : sec.kind === 'chips' ? (
            <DetailTable title={sec.title} hint={sec.hint} icon={sectionIcon(sec.title)} accent={sectionAccent(sec.title)} tone={sec.tier} span={1}>
              <tr style={DT.tr(0)}>
                <td style={DT.td}>
                  <span style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                    {sec.items.map((o) => <span key={o} style={{ fontSize: FS.sub, color: C.mute, background: C.head, borderRadius: R, padding: '2px 8px' }}>{o}</span>)}
                  </span>
                </td>
              </tr>
            </DetailTable>
          ) : (
            (() => {
              /* 값이 짧고 대등한 섹션(차량스펙)만 웹에서 두 열로 흘린다 — 훑는 섹션과 읽는 섹션이 갈린다.
                 모바일은 폭이 없어 늘 한 열. 값이 «문장»인 계약조건은 두 열로 쪼개면 줄이 접혀 더 못 읽는다. */
              const two = !!sec.pair && !mobile;
              const cells = two ? 4 : 2;
              return (
            <DetailTable
              title={sec.title}
              hint={sec.hint}
              icon={sectionIcon(sec.title)}
              accent={sectionAccent(sec.title)}
              tone={sec.tier}
              span={cells}
              mark={sec.tier === 'agent' ? '영업자 전용' : undefined}
              widths={two ? [KV_LABEL_W, undefined, KV_LABEL_W, undefined] : [KV_LABEL_W, undefined]}
            >
              {(() => {
                /* 선택옵션은 «칸 하나»가 아니라 이 표의 한 줄이다 — 칩 뭉치가 표 밖으로 빠지면
                   차량스펙 표만 문법이 달라진다. 칩이 없으면 줄 자체를 안 만든다(빈 줄 방지). */
                const chipRow = (key: string, i: number) => (
                  <tr key={key} style={DT.tr(i)}>
                    <th scope="row" style={DT.labelTh}>{sec.chipsLabel || '선택옵션'}</th>
                    <td style={DT.td} colSpan={cells - 1}><OptionChips p={p} expand /></td>
                  </tr>
                );
                const hasChips = !!sec.chips && sec.chips.length > 0;
                /* 기타사항 = 식별값(코드·날짜). 읽는 값이 아니라 «대조하는 값»이라 가장 조용하게 둔다. */
                const quiet = sec.title === '기타사항';
                const valStyle = quiet ? { ...DT.td, color: C.mute } : DT.td;
                const cell = (k: string, v: string) => (<>
                  <th scope="row" style={DT.labelTh}>{k}</th>
                  {/* 색상만 글자 대신 «점 + 글자» — 상담에서 색은 읽는 값이 아니라 «보는 값»이다
                      (사장님 2026-08-20 「색상은 텍스트로만 보여주는 게 아니고 컬러 뱃지같은 거」). */}
                  <td style={valStyle}>
                    {!v ? <span style={{ color: C.faint }}>—</span>
                      : k === '색상' ? <ColorValue value={v} />
                        : dimDashes(v)}
                  </td>
                </>);
                const rows = kvRows(sec.rows);
                const out: ReactNode[] = [];
                if (two) {
                  /* 칩 줄은 짝을 이루지 않고 통째로 한 줄을 쓴다(칩이 두 열에 걸쳐 흐르면 뭉텅이가 된다). */
                  const head = hasChips && sec.chipsAfter === 1 ? rows.slice(0, 1) : [];
                  const rest = rows.slice(head.length);
                  head.forEach(([k, v], i) => out.push(<tr key={`h-${i}`} style={DT.tr(out.length)}>{cell(k, v)}<th style={DT.labelTh} /><td style={valStyle} /></tr>));
                  if (head.length && hasChips) out.push(chipRow('chips', out.length));
                  for (let i = 0; i < rest.length; i += 2) {
                    const a = rest[i]; const b = rest[i + 1];
                    out.push(
                      <tr key={`p-${i}`} style={DT.tr(out.length)}>
                        {cell(a[0], a[1])}
                        {b ? cell(b[0], b[1]) : <><th style={DT.labelTh} /><td style={valStyle} /></>}
                      </tr>,
                    );
                  }
                  if (hasChips && sec.chipsAfter == null) out.push(chipRow('chips', out.length));
                  return out;
                }
                rows.forEach(([k, v], i) => {
                  out.push(<tr key={`${k}-${i}`} style={DT.tr(out.length)}>{cell(k, v)}</tr>);
                  if (hasChips && sec.chipsAfter === 1 && i === 0) out.push(chipRow('chips', out.length));
                });
                if (hasChips && sec.chipsAfter == null) out.push(chipRow('chips', out.length));
                return out;
              })()}
            </DetailTable>
              );
            })()
          )}
        </section>
      ))}

      {/* ★사진 보기에서는 **확대가 살아야 한다**(사장님 2026-08-22 「사진 눌러서 사진 볼 때 사진은 확대되어야지」).
          페이지 전체에는 `touch-action: manipulation` 을 걸어 «의도 안 한 더블탭 확대»를 막았는데(globals.css),
          여기까지 막으면 사진을 키워 볼 수가 없다 — 열려 있는 동안 root 표식(`fp-photo-zoom`)으로 풀고 이 판도 `auto` 로 둔다. */}
      {lb !== null && photos.length > 0 && (
        <div onClick={() => setLb(null)} style={{ position: 'fixed', inset: 0, zIndex: 80, background: SCRIM.black, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '48px 12px', touchAction: 'auto' }}>
          <CloseBtn
            title="닫기"
            onClick={(e) => { e.stopPropagation(); setLb(null); }}
            style={{
              position: 'fixed', top: 14, right: 14, width: 40, height: 40, borderRadius: '50%',
              border: 'none', background: `color-mix(in srgb, ${C.inverse} 18%, transparent)`, color: C.inverse, zIndex: 1,
            }}
          />
          <div onClick={(e) => e.stopPropagation()} style={{ maxWidth: 880, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
            {photos.map((ph, i) => (
              <div key={i} style={{ position: 'relative' }}>
                {/* 한 장씩 받기 = **웹만**(사장님 2026-08-22 「모바일에서 1장 1장 사진 다운되는 거 버튼 없애라도」).
                    폰은 사진을 길게 눌러 저장하는 게 손에 익고, 여러 장이면 영업자 패널의 「사진 N장 내려받기」(ZIP)가 있다.
                    큰 사진 위 우측 버튼이 손가락에 먼저 걸려 넘기다가 눌리는 일이 잦았다. */}
                {!mobile && (
                  <IconBtn
                    title={`사진 ${i + 1} 한 장 받기`}
                    onClick={(e) => { e.stopPropagation(); void downloadOnePhoto(ph, i); }}
                    style={{ position: 'absolute', top: 10, right: 10, zIndex: 1, background: SCRIM.heavy, color: C.inverse, border: 'none' }}
                  >
                    <Download size={ICON.md} aria-hidden />
                  </IconBtn>
                )}
                <ProductPhotoImage
                  src={ph}
                  alt=""
                  style={{ width: '100%', height: 'auto', borderRadius: R, display: 'block' }}
                  fallbackStyle={{ aspectRatio: '16 / 10' }}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
