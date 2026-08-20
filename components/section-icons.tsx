'use client';
import type { ReactNode } from 'react';
import { Car, FileText, Info, ReceiptText, ShieldCheck, UserRoundCog } from 'lucide-react';
import { ICON } from '@/components/ui';

/**
 * 상세 섹션 머리 그림 — **섹션마다 다른 유일한 것**(사장님 2026-08-20 「같은 규격에서 좀 특색있게」).
 *
 * 규격(머리띠·항목칸·값칸)은 전부 같게 두고 여기서만 성격을 준다. 스크롤 중에 글자를 읽기 전에
 * «어느 섹션인지»가 잡힌다. 손님 화면(`/q`)도 같은 원자를 쓰므로 함께 적용된다.
 *
 * ⚠ 칸 «안»에는 그림을 넣지 않는다 — 표가 시끄러워지고 값이 안 읽힌다(DESIGN.md ERP 톤 도그마
 *   「상태는 색+뱃지로, 장식용 아이콘을 남발하지 않는다」). 섹션 머리에 하나씩만.
 *
 * ★왜 별도 파일인가: 이 표를 `ProductDetail` 에 두면 `ProductPriceTable → ProductDetail → ProductPriceTable`
 *   순환 import 가 된다. 세 화면(본문·가격표·영업자 패널)이 모두 쓰는 값이라 아무에게도 안 딸린 자리에 둔다.
 */
const SECTION_ICON: Record<string, ReactNode> = {
  차량스펙: <Car size={ICON.sm} aria-hidden />,
  대여료조건: <ReceiptText size={ICON.sm} aria-hidden />,
  보험조건: <ShieldCheck size={ICON.sm} aria-hidden />,
  계약조건: <FileText size={ICON.sm} aria-hidden />,
  기타사항: <Info size={ICON.sm} aria-hidden />,
  '영업 정보': <UserRoundCog size={ICON.sm} aria-hidden />,
  '계약 조건': <FileText size={ICON.sm} aria-hidden />,
};

/** 섹션 이름 → 머리 그림. 없는 섹션은 그림 없이 선다(빈 자리를 만들지 않는다). */
export function sectionIcon(title: string): ReactNode {
  return SECTION_ICON[title];
}
