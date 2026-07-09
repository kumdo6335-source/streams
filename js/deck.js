// 타일 구성: 1~10 각 1개, 11~19 각 2개, 20~30 각 1개, 조커 1개 (총 40개)
export function createDeck() {
  const tiles = [];
  for (let n = 1; n <= 10; n++) tiles.push(n);
  for (let n = 11; n <= 19; n++) {
    tiles.push(n);
    tiles.push(n);
  }
  for (let n = 20; n <= 30; n++) tiles.push(n);
  tiles.push("J");
  return shuffle(tiles);
}

// 등장 가능한 전체 타일 종류(중복 제외)와 각 숫자별 개수(1~10, 20~30, 조커는 1개, 11~19는 2개)
export const TILE_KINDS = (() => {
  const arr = [];
  for (let n = 1; n <= 10; n++) arr.push(n);
  for (let n = 11; n <= 19; n++) arr.push(n);
  for (let n = 20; n <= 30; n++) arr.push(n);
  arr.push("J");
  return arr;
})();

export function tileTotalCount(label) {
  return typeof label === "number" && label >= 11 && label <= 19 ? 2 : 1;
}

export function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
