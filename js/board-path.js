// 구불구불한 냇물 모양 20칸 경로: 상단 8칸(좌→우) → 우측 4칸(위→아래) → 하단 8칸(우→좌)
// CSS grid 좌표(1-indexed): grid-column, grid-row
export const BOARD_COLS = 8;
export const BOARD_ROWS = 6;

export function buildPath() {
  const path = [];
  // 1~8: 상단, row 1, col 1..8
  for (let c = 1; c <= 8; c++) path.push({ col: c, row: 1 });
  // 9~12: 우측, col 8, row 2..5
  for (let r = 2; r <= 5; r++) path.push({ col: 8, row: r });
  // 13~20: 하단, row 6, col 8..1
  for (let c = 8; c >= 1; c--) path.push({ col: c, row: 6 });
  return path; // length 20, index 0 = 1번칸 ... index 19 = 20번칸
}

export const BOARD_PATH = buildPath();
