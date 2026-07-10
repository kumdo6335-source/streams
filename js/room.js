import {
  db, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, collection, runTransaction, serverTimestamp,
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

// 방장이 방을 나갈 때 방을 닫는다. 두 단계로 처리해 규칙 배포 여부와 무관하게 안전하게 동작한다.
//  1) 먼저 'closed'로 표시 → 참가자 클라이언트가 이를 감지해 스스로 기록을 지우고 입장 화면으로 돌아간다.
//     (이전처럼 'waiting'으로 되돌리면 옛 참가자가 버려진 방에 자동 복귀해 갇히는 문제가 있어 'closed'로 닫는다.)
//  2) 이어서 실제 삭제를 시도 → Firestore 규칙에서 delete를 허용(배포)한 경우에만 성공하며,
//     방/참가자 문서를 지워 기록이 쌓이지 않게 하고 4자리 코드를 재사용할 수 있게 한다.
//     규칙 미배포 시엔 삭제가 거부되지만 (1)의 'closed' 상태로 기능은 정상 동작한다.
export async function closeRoom(code) {
  try {
    await updateDoc(doc(db, "rooms", code), { status: "closed", currentTile: null });
  } catch (e) {
    // 이미 삭제되었거나 존재하지 않는 경우 등은 무시
  }
  try {
    const playersSnap = await getDocs(collection(db, "rooms", code, "players"));
    await Promise.all(playersSnap.docs.map((d) => deleteDoc(d.ref)));
    await deleteDoc(doc(db, "rooms", code));
  } catch (e) {
    // 규칙에서 delete를 아직 허용하지 않으면 여기서 거부된다. 'closed' 상태로 남겨 두면 되므로 무시.
    console.warn("방 삭제를 건너뜁니다(Firestore 규칙에 delete 허용이 배포되지 않았을 수 있음):", e.message);
  }
}
