// 구간 길이(1~20)별 점수표
export const SCORE_TABLE = {
  1: 0, 2: 1, 3: 3, 4: 5, 5: 7, 6: 9, 7: 11, 8: 15, 9: 20, 10: 25,
  11: 30, 12: 35, 13: 40, 14: 50, 15: 60, 16: 70, 17: 85, 18: 100, 19: 150, 20: 300,
};

// board: 20칸 배열(경로 순서), 값은 숫자 | "J" | null
// 조커는 앞뒤 어느 쪽과도 항상 이어지며 구간을 끊지 않는다 (양옆에 대해 각각 독립적으로 판단, 두 번 이어주는 것으로 계산하지 않고 단순히 "끊기지 않음"으로만 취급).
export function computeScore(board) {
  const segments = [];
  let segStart = 0;

  for (let i = 1; i < board.length; i++) {
    const prev = board[i - 1];
    const curr = board[i];
    const isBreak = !(prev === "J" || curr === "J" || Number(curr) > Number(prev));
    if (isBreak) {
      segments.push({ start: segStart, end: i - 1, length: i - segStart });
      segStart = i;
    }
  }
  segments.push({ start: segStart, end: board.length - 1, length: board.length - segStart });

  let total = 0;
  const scored = segments.map((seg) => {
    const score = SCORE_TABLE[seg.length] ?? 0;
    total += score;
    return { ...seg, score };
  });

  return { segments: scored, total };
}
