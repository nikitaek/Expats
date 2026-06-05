/**
 * Collapse flights to one row per fr24_id (last wins).
 * @param {Array<{ fr24Id: string }>} rows
 */
export function dedupeByFr24Id(rows) {
  const map = new Map();
  for (const row of rows) {
    if (!row?.fr24Id) continue;
    map.set(row.fr24Id, row);
  }
  return [...map.values()];
}
