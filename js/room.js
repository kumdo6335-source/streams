import {
  db, doc, getDoc, getDocs, setDoc, updateDoc, collection, runTransaction, serverTimestamp,
} from "./firebase-init.js";
import { createDeck } from "./deck.js";
import { computeScore } from "./scoring.js";

const EMPTY_BOARD = () => Array(20).fill(null);

function randomCode() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

export async function createRoom() {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = randomCode();
    const ref = doc(db, "rooms", code);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        status: "waiting",
        deck: createDeck(),
        drawHistory: [],
        currentTile: null,
        finalScores: null,
        createdAt: serverTimestamp(),
        lastDrawAt: null,
      });
      return code;
    }
  }
  throw new Error("방 코드 생성에 실패했습니다. 다시 시도해주세요.");
}

export async function getRoom(code) {
  const snap = await getDoc(doc(db, "rooms", code));
  return snap.exists() ? snap.data() : null;
}

export async function getPlayer(code, playerId) {
  const snap = await getDoc(doc(db, "rooms", code, "players", playerId));
  return snap.exists() ? snap.data() : null;
}

export async function fetchNicknames(code) {
  const snap = await getDocs(collection(db, "rooms", code, "players"));
  return snap.docs.map((d) => d.data().nickname);
}

// 닉네임 중복 시 "이름(2)", "이름(3)" ... 접미사 부여
export async function joinRoom(code, rawNickname, existingNicknames) {
  let nickname = rawNickname.trim();
  if (!nickname) throw new Error("닉네임을 입력해주세요.");
  let candidate = nickname;
  let n = 2;
  while (existingNicknames.includes(candidate)) {
    candidate = `${nickname}(${n})`;
    n++;
  }
  const playerId = candidate;
  await setDoc(doc(db, "rooms", code, "players", playerId), {
    nickname: candidate,
    board: EMPTY_BOARD(),
    placements: [],
    joinedAt: serverTimestamp(),
  });
  return playerId;
}

export async function drawTile(code, playerIds) {
  await runTransaction(db, async (tx) => {
    const roomRef = doc(db, "rooms", code);
    const roomSnap = await tx.get(roomRef);
    if (!roomSnap.exists()) throw new Error("방을 찾을 수 없습니다.");
    const room = roomSnap.data();
    if (room.status === "ended") throw new Error("이미 종료된 게임입니다.");
    if (!room.deck || room.deck.length === 0) throw new Error("남은 타일이 없습니다.");

    const playerRefs = playerIds.map((id) => doc(db, "rooms", code, "players", id));
    const playerSnaps = await Promise.all(playerRefs.map((ref) => tx.get(ref)));

    if (room.drawHistory.length > 0) {
      const lastIndex = room.drawHistory.length - 1;
      const allPlaced = playerSnaps.every((snap) => {
        const p = snap.data();
        return p.placements[lastIndex] !== null && p.placements[lastIndex] !== undefined;
      });
      if (!allPlaced) throw new Error("모든 참가자가 아직 배치하지 않았습니다.");
    }

    const deck = room.deck.slice();
    const tile = deck.pop();
    const drawHistory = [...room.drawHistory, tile];

    tx.update(roomRef, {
      deck,
      drawHistory,
      currentTile: tile,
      status: "playing",
      lastDrawAt: serverTimestamp(),
    });

    playerSnaps.forEach((snap, i) => {
      const p = snap.data();
      tx.update(playerRefs[i], { placements: [...p.placements, null] });
    });
  });
}

export async function placeTile(code, playerId, boardIndex) {
  await runTransaction(db, async (tx) => {
    const roomRef = doc(db, "rooms", code);
    const playerRef = doc(db, "rooms", code, "players", playerId);
    const [roomSnap, playerSnap] = await Promise.all([tx.get(roomRef), tx.get(playerRef)]);
    if (!roomSnap.exists() || !playerSnap.exists()) throw new Error("방 또는 참가자를 찾을 수 없습니다.");

    const room = roomSnap.data();
    const player = playerSnap.data();
    const lastIndex = room.drawHistory.length - 1;
    if (lastIndex < 0) throw new Error("아직 뽑힌 타일이 없습니다.");
    if (player.board[boardIndex] !== null) throw new Error("이미 채워진 칸입니다.");

    // 다음 숫자가 뽑히기 전(같은 lastIndex)이면 위치를 바꿀 수 있도록 이전 배치를 비우고 새로 배치
    const board = player.board.slice();
    const placements = player.placements.slice();
    const prevIndex = placements[lastIndex];
    if (prevIndex !== null && prevIndex !== undefined) {
      board[prevIndex] = null;
    }
    board[boardIndex] = room.currentTile;
    placements[lastIndex] = boardIndex;

    tx.update(playerRef, { board, placements });
  });
}

export async function cancelDraw(code, playerIds) {
  await runTransaction(db, async (tx) => {
    const roomRef = doc(db, "rooms", code);
    const roomSnap = await tx.get(roomRef);
    if (!roomSnap.exists()) throw new Error("방을 찾을 수 없습니다.");
    const room = roomSnap.data();
    if (room.drawHistory.length === 0) throw new Error("취소할 타일이 없습니다.");
    if (room.status === "ended") throw new Error("이미 종료된 게임은 취소할 수 없습니다.");

    const lastIndex = room.drawHistory.length - 1;
    const poppedTile = room.drawHistory[lastIndex];
    const drawHistory = room.drawHistory.slice(0, -1);
    const deck = [...room.deck, poppedTile];

    const playerRefs = playerIds.map((id) => doc(db, "rooms", code, "players", id));
    const playerSnaps = await Promise.all(playerRefs.map((ref) => tx.get(ref)));

    tx.update(roomRef, {
      deck,
      drawHistory,
      currentTile: null,
      status: drawHistory.length === 0 ? "waiting" : "playing",
    });

    playerSnaps.forEach((snap, i) => {
      const p = snap.data();
      const board = p.board.slice();
      const placements = p.placements.slice();
      const placedIndex = placements[lastIndex];
      if (placedIndex !== null && placedIndex !== undefined) {
        board[placedIndex] = null;
      }
      placements.pop();
      tx.update(playerRefs[i], { board, placements });
    });
  });
}

// 방장이 모든 참가자의 배치 완료를 감지했을 때 최종 점수를 계산해 room 문서에 기록
export async function finalizeGame(code, players) {
  const finalScores = players
    .map((p) => ({ nickname: p.nickname, total: computeScore(p.board).total }))
    .sort((a, b) => b.total - a.total);
  await updateDoc(doc(db, "rooms", code), { status: "ended", finalScores });
}

export function playersCollection(code) {
  return collection(db, "rooms", code, "players");
}

// 방장이 방을 나갈 때 방/참가자 기록을 초기화(다음 게임에 이전 결과가 남지 않도록).
// Firestore 규칙상 delete가 금지되어 있어(문서 존재는 유지) update로 완전히 새 게임 상태로 되돌린다.
export async function resetRoom(code) {
  const playersSnap = await getDocs(collection(db, "rooms", code, "players"));
  await Promise.all(playersSnap.docs.map((d) =>
    updateDoc(d.ref, { board: EMPTY_BOARD(), placements: [] })
  ));
  await updateDoc(doc(db, "rooms", code), {
    status: "waiting",
    deck: createDeck(),
    drawHistory: [],
    currentTile: null,
    finalScores: null,
    lastDrawAt: null,
  });
}
