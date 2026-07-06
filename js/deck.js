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

export function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
