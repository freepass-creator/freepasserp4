'use client';
import { useState, useEffect, useRef, type ReactNode } from 'react';
import { type EntityRecord } from '@/lib/intake/entities';
import { detailSections, type Audience } from '@/lib/domain/product';
import { useProductPhotoState } from '@/components/use-product-photos';
import { getRole } from '@/lib/domain/deal';
import { Badge, C, R, NUM, FW, FS, ICON, CloseBtn, IconBtn, SCRIM, DetailTable, DT, KV_LABEL_W } from '@/components/ui';
import { ImageOff } from 'lucide-react';
import { toast } from '@/components/Toaster';
import {
  SignalMarks, MetaIcon, Plate, idParts, CardBenefits, CardEvents, OptionChips, plateSpecLine,
} from '@/components/product-card-atoms';
import { FavHeart } from '@/components/FavHeart';
import { ProductStateMarks } from '@/components/ProductStateMarks';
import { ProductPhotoImage, ProductPhotoPlaceholder } from '@/components/ProductPhoto';
import { ProductPriceTable } from '@/components/ProductPriceTable';
import { useIsMobile } from '@/lib/use-mobile';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from 'lucide-react';
import { sectionIcon } from '@/components/section-icons';

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
  /** work = 차량번호를 요약바가 이미 들고 있다. 세부표에서 한 번 더 찍지 않는다(같은 값 세 번 → 표가 길어 보인다). */
  const kvRows = (rows: [string, string][]) => (work ? rows.filter(([k]) => k !== '차량번호') : rows);

  return (
    <div>
      {/* 1 헤더 — 차명 → 차번·상태·상품·심사 → 우대·이벤트 (원자 공용).
          work 에서는 차명·차번은 우측 카드·상단바가 들고 있어 제목 줄을 뺀다.
          대신 사진 위에 얹혀 있던 관심(하트)이 사라지지 않게 칩 줄로 내려 붙인다. */}
      <div style={{ marginBottom: 11 }}>
        {!work && (
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
            <h1 style={{ fontSize: FS.page, fontWeight: FW.title, letterSpacing: '-0.02em', margin: 0, lineHeight: 1.25 }}>{idMain}</h1>
            {idExt && <span style={{ fontSize: FS.title, fontWeight: FW.meta, color: C.mute }}>{idExt}</span>}
            {/* ★출고상태·상품구분은 **이름 바로 뒤**다(2026-08-23 규격 · product-card-badge-view 주석).
                차번·스펙 줄 뒤에 두면 우대조건·이벤트와 섞여 «어느 갈래인지»가 안 보인다.
                work(작업화면)은 이 h1 줄이 없어 아래 줄이 그대로 든다. */}
            <SignalMarks p={p} audience={aud} />
          </div>
        )}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
          marginTop: work ? 0 : 8, rowGap: 6,
        }}>
          {aud !== 'customer' && !work && <Plate p={p} />}
          {!work && plateSpecLine(p) && (
            <span style={{ fontSize: FS.sub, color: C.mute, fontVariantNumeric: 'tabular-nums' }}>{plateSpecLine(p)}</span>
          )}
          {/* work(작업화면)만 여기 — 위 h1 줄이 없다. 상자 대신 아이콘+글자(2026-08-30 「08-28 게 맞다」). */}
          {work && <SignalMarks p={p} audience={aud} hideStatus />}
          <CardBenefits p={p} inline />
          <CardEvents p={p} inline />
          {/* 사진 없음도 매물의 성질이다 — 별도 줄을 잡아먹지 않게 칩으로 붙인다.
              (안 그리면 «없는 건지 안 뜬 건지»를 모른다. 사진 없는 차가 절반 가까이다.) */}
          {work && photos.length === 0 && !pending && <MetaIcon icon={ImageOff} text="사진없음" size={ICON.sm} strong iconColor={C.mute} title="등록된 사진이 없습니다" />}
          {work && aud !== 'customer' && <ProductStateMarks p={p} />}
          {work && aud !== 'customer' && <FavHeart p={p} compact />}
        </div>
      </div>

      {/* 2 사진 — 웹·work 모두 헤더 바로 아래(안 보이면 없다고 판단함).
          work만 폭 상한(WORK_PHOTO_W)으로 가격표가 같이 보이게. */}
      <div>
      {(photos.length ? (
        <div style={work ? { maxWidth: WORK_PHOTO_W, marginBottom: 4 } : undefined}>
          {/* ★사진 «받기»는 이 화면에 없다(사장님 2026-08-30 「다 삭제해 버리고 싶으니까」) —
              사진은 파일로 주고받지 않고 링크로 보낸다. 여기는 이름표만 남긴다. */}
          {!mobile ? (
            <div style={{ fontSize: FS.title, fontWeight: FW.title, color: C.ink, marginBottom: 4 }}>차량사진</div>
          ) : null}
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
                <ProductStateMarks p={p} onPhoto />
                <FavHeart p={p} onPhoto />
              </span>
            )}
            <span style={{ position: 'absolute', right: 8, bottom: 8, background: SCRIM.heavy, color: C.inverse, fontSize: FS.cap, fontWeight: FW.strong, padding: '2px 8px', borderRadius: R, fontFamily: NUM, fontVariantNumeric: 'tabular-nums', pointerEvents: 'none' }}>{mainIdx + 1} / {photos.length}</span>
          </div>
          {/* ★세로 썸네일 칸 = **웹 전용**(사장님 2026-08-30 「모바일에선 그거 필요없어, 그냥 바로 눌러서 볼 거기 때문에」).
              폰에서는 사진을 «고르지» 않는다 — 큰 사진을 좌우로 밀거나 눌러서 크게 본다.
              그 위에 72px 칸이 붙으면 큰 사진이 그만큼 좁아지는데, 정작 그 칸으로 고르는 사람이 없다.
              넘김 수단은 그대로 남는다: 스와이프 · ‹ › · 우하단 「N / M」 · 눌러서 전체화면.
              ⚠ 썸네일 스크롤 효과들(thumbRef)은 ref 가 null 이면 스스로 물러나므로 여기만 막으면 된다. */}
          {!mobile && photos.length > 1 && (
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
            <DetailTable
              title={sec.title}
              hint={sec.hint}
              icon={sectionIcon(sec.title)}
              tone={sec.tier}
              span={3}
              label="보험 보장한도와 면책금"
              widths={['32%', '34%', '34%']}
              cols={<>
                <th scope="col" style={DT.colTh}>항목</th>
                <th scope="col" style={{ ...DT.colTh, textAlign: 'right' }}>보장한도</th>
                <th scope="col" style={{ ...DT.colTh, textAlign: 'right' }}>면책금</th>
              </>}
            >
              {sec.rows.map(([lbl, limit, ded], i) => (
                <tr key={lbl} style={DT.tr(i)}>
                  <th scope="row" style={{ ...DT.labelTh, width: undefined }}>{lbl}</th>
                  <td style={{ ...DT.tdR, color: limit ? C.ink : C.faint }}>{limit || '—'}</td>
                  <td style={{ ...DT.tdR, color: ded ? C.ink : C.faint }}>{ded || '—'}</td>
                </tr>
              ))}
              {/* 긴급출동은 한도·면책이 아니라 담보가 아니다 — 표 밖 쪽지 대신 마지막 줄로 붙여 표 하나로 끝낸다. */}
              {sec.note ? (
                <tr style={DT.tr(1)}>
                  <th scope="row" style={{ ...DT.labelTh, width: undefined }}>부가</th>
                  <td colSpan={2} style={DT.td}>{sec.note}</td>
                </tr>
              ) : null}
            </DetailTable>
          ) : sec.kind === 'chips' ? (
            <DetailTable title={sec.title} hint={sec.hint} icon={sectionIcon(sec.title)} tone={sec.tier} span={1}>
              <tr style={DT.tr(0)}>
                <td style={DT.td}>
                  <span style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                    {sec.items.map((o) => <span key={o} style={{ fontSize: FS.sub, color: C.mute, background: C.head, borderRadius: R, padding: '2px 8px' }}>{o}</span>)}
                  </span>
                </td>
              </tr>
            </DetailTable>
          ) : (
            <DetailTable
              title={sec.title}
              hint={sec.hint}
              icon={sectionIcon(sec.title)}
              tone={sec.tier}
              headTone={sec.title === '차량스펙' ? 'invert' : 'plain'}
              span={2}
              mark={sec.tier === 'agent' ? '영업자 전용' : undefined}
              widths={[KV_LABEL_W, undefined]}
            >
              {(() => {
                /* 선택옵션은 «칸 하나»가 아니라 이 표의 한 줄이다 — 칩 뭉치가 표 밖으로 빠지면
                   차량스펙 표만 문법이 달라진다. 칩이 없으면 줄 자체를 안 만든다(빈 줄 방지). */
                const chipRow = (key: string, i: number) => (
                  <tr key={key} style={DT.tr(i)}>
                    <th scope="row" style={DT.labelTh}>{sec.chipsLabel || '선택옵션'}</th>
                    <td style={DT.td}><OptionChips p={p} expand /></td>
                  </tr>
                );
                const hasChips = !!sec.chips && sec.chips.length > 0;
                const out: ReactNode[] = [];
                kvRows(sec.rows).forEach(([k, v], i) => {
                  out.push(
                    <tr key={`${k}-${i}`} style={DT.tr(out.length)}>
                      <th scope="row" style={DT.labelTh}>{k}</th>
                      <td style={DT.td}>{v ? dimDashes(v) : <span style={{ color: C.faint }}>—</span>}</td>
                    </tr>,
                  );
                  if (hasChips && sec.chipsAfter === 1 && i === 0) out.push(chipRow('chips', out.length));
                });
                if (hasChips && sec.chipsAfter == null) out.push(chipRow('chips', out.length));
                return out;
              })()}
            </DetailTable>
          )}
        </section>
      ))}

      {lb !== null && photos.length > 0 && (
        <div onClick={() => setLb(null)} style={{ position: 'fixed', inset: 0, zIndex: 80, background: SCRIM.black, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '48px 12px' }}>
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
