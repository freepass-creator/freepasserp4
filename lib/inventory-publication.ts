/** 판매시트·ERP·화이트라벨이 함께 쓰는 마지막 성공 반영 기록. */
export const INVENTORY_PUBLICATION_COLLECTION = 'ops';
export const INVENTORY_PUBLICATION_DOCUMENT = 'inventory_publication';

export type InventoryPublication = {
  schema_version: 'inventory_publication_v1';
  publishedAt: string;
  publishedMs: number;
  source: 'firestore/products';
  sheetId: string;
  productCount: number;
  listableCount: number;
  publishedRowCount: number;
  tabCounts: Record<string, number>;
};
