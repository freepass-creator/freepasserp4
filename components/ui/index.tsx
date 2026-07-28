'use client';

/* 공용 UI 키트 — 전 페이지가 이걸 써서 통일. 기업형: 각지게(저radius)·고밀도·색 절제. */
// 토큰(C/R/NUM)=tokens.ts SSOT. 리프 분리: 접이식섹션=sec, 데이터표=table, 상태·라벨=badges, 카드원자=objcard. 여기서 배럴 재export.
export { C, R, NUM, FS, FW, CTRL, ctrlH, ctrlFs, ctrlInputFs, ctrlChipH, SH, SCRIM } from './tokens';
export type { CtrlSize } from './tokens';
export * from './sec';
export * from './table';
export * from './badges';
export * from './objcard';
export * from './detail';
export * from './ContextMenu';
export * from './feedrow';
export * from './overlays';
export * from './list';
export * from './form-controls';
export * from './buttons';
export * from './layout';
export * from './navigation';
export * from './feedback';
export * from './metrics';
export * from './filters';
export * from './detail-shell';
export * from './form-grid';
export * from './copy-block';
export * from './add-tile';
export * from './dropzone';
export * from './close-btn';
export * from './formatters';

// Page = components/Page.tsx (모바일=MobilePageShell SSOT).
export { Page } from '../Page';
export { PageToolBar, type PageToolItem } from '../PageToolBar';
export { PageActions, type PageActionSpec } from '../PageActions';
export { BottomSheet, FilterSheet } from '../BottomSheet';
