import { SCORE_TABLE } from "./scoring.js";
import { BOARD_PATH, BOARD_COLS, BOARD_ROWS } from "./board-path.js";
import { TILE_KINDS, tileTotalCount } from "./deck.js";

export function scoreTableHTML() {
  const entries = Object.entries(SCORE_TABLE);
  const half = 10;
  const left = entries.slice(0, half);
  const right = entries.slice(half);
  const rows = left.map(([len, score], i) => {
    const [len2, score2] = right[i];
    return `<tr><th>${len}</th><td>${fmt(score)}</td><th>${len2}</th><td>${fmt(score2)}</td></tr>`;
  }).join("");
  return `<table class="score-table">
    <caption>구간 점수표</caption>
    <thead><tr><th>개수</th><th>점수</th><th>개수</th><th>점수</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function fmt(score) {
  return score > 0 ? `+${score}` : `${score}`;
}

// board: 20-array(값|null). onCellClick(index)이 있으면 클릭 가능한 빈칸에 이벤트 부여, selectable=true면 강조
export function renderBoard(container, board, { onCellClick, selectableEmpty = false } = {}) {
  container.innerHTML = "";
  container.classList.add("game-board");
  container.style.gridTemplateColumns = `repeat(${BOARD_COLS}, minmax(52px, 1fr))`;
  container.style.gridTemplateRows = `repeat(${BOARD_ROWS}, minmax(52px, 1fr))`;

  BOARD_PATH.forEach((pos, i) => {
    const cell = document.createElement("div");
    const value = board[i];
    cell.className = "cell " + (value !== null ? "filled" : "empty");
    if (value === "J") cell.classList.add("joker");
    if (value === null && selectableEmpty) cell.classList.add("selectable");
    cell.style.gridColumn = pos.col;
    cell.style.gridRow = pos.row;

    const badge = document.createElement("span");
    badge.className = "order-badge";
    badge.textContent = i + 1;
    cell.appendChild(badge);

    const valueSpan = document.createElement("span");
    valueSpan.textContent = value === null ? "" : value;
    cell.appendChild(valueSpan);

    if (value === null && onCellClick) {
      cell.addEventListener("click", () => onCellClick(i));
    }
    container.appendChild(cell);
  });

  const scoreBox = document.createElement("div");
  scoreBox.className = "score-table-inline";
  scoreBox.innerHTML = scoreTableHTML();
  container.appendChild(scoreBox);
}

export function tileLabel(value) {
  return value === "J" ? "★" : String(value);
}

// 등장 가능한 전체 숫자를 보여주고, 뽑힌 만큼 소진된 숫자는 음영 처리.
// 11~19처럼 2개인 숫자는 칸을 2개씩 표시해서, 하나만 나와도 그중 하나만 소진 표시되게 한다.
export function renderNumberTracker(container, drawHistory) {
  const drawnCounts = {};
  drawHistory.forEach((v) => { drawnCounts[v] = (drawnCounts[v] || 0) + 1; });

  container.innerHTML = "";
  container.classList.add("number-tracker");
  TILE_KINDS.forEach((label) => {
    const total = tileTotalCount(label);
    const drawnCount = drawnCounts[label] || 0;
    for (let i = 0; i < total; i++) {
      const used = i < drawnCount;
      const cell = document.createElement("span");
      cell.className = "tracker-cell" + (used ? " used" : "");
      cell.textContent = tileLabel(label);
      container.appendChild(cell);
    }
  });
}
