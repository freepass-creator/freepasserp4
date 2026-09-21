import { runPresentation } from '../../vendor/freepass-data/scripts/sheet-presentation-online.mjs';
import type { Workbook } from '../domain/f01-f86-presentation';

/** Fresh native readback using the very same planner used by local/AI work. */
export async function verifyPublishedPresentation(api: (url: string, options?: any) => Promise<any>, workbook: Workbook, updatedAt: string) {
  const receipt = await runPresentation({ api, workbook, updatedAt, apply: false, authorizeWrite: undefined, saveBackup: undefined });
  console.log(JSON.stringify({ presentation: receipt }));
  if (receipt.status !== 'PASS') throw new Error(`HOLD: ${workbook} presentation readback differs from canonical contract`);
  return receipt;
}
