import { db, doc, onSnapshot } from "./firebase-init.js";
import { getRoom, getPlayer, fetchNicknames, joinRoom, placeTile } from "./room.js";
import { renderBoard, tileLabel } from "./ui-common.js";
import { computeScore } from "./scoring.js";

const LS_KEY = "streams_player";

const screens = {
  join: document.getElementById("screen-join"),
  waiting: document.getElementById("screen-waiting"),
  playing: document.getElementById("screen-playing"),
  ended: document.getElementById("screen-ended"),
};

function showScreen(name) {
  Object.entries(screens).forEach(([key, el]) => {
    el.style.display = key === name ? "" : "none";
  });
}

let roomCode = null;
let playerId = null;
let latestRoom = null;
let latestPlayer = null;

document.getElementById("btn-join").addEventListener("click", handleJoin);

async function handleJoin() {
  const errEl = document.getElementById("join-error");
  errEl.textContent = "";
  const code = document.getElementById("input-code").value.trim();
  const nickname = document.getElementById("input-nickname").value.trim();

  if (!/^\d{4}$/.test(code)) {
    errEl.textContent = "방 코드는 4자리 숫자입니다.";
    return;
  }
  if (!nickname) {
    errEl.textContent = "닉네임을 입력해주세요.";
    return;
  }

  try {
    const room = await getRoom(code);
    if (!room) {
      errEl.textContent = "존재하지 않는 방 코드입니다.";
      return;
    }
    if (room.status === "ended") {
      errEl.textContent = "이미 종료된 게임입니다.";
      return;
    }
    const existing = await fetchNicknames(code);
    const id = await joinRoom(code, nickname, existing);
    roomCode = code;
    playerId = id;
    localStorage.setItem(LS_KEY, JSON.stringify({ code, playerId: id }));
    subscribe();
  } catch (e) {
    errEl.textContent = e.message;
  }
}

function subscribe() {
  onSnapshot(doc(db, "rooms", roomCode), (snap) => {
    if (!snap.exists()) return;
    latestRoom = snap.data();
    render();
  });
  onSnapshot(doc(db, "rooms", roomCode, "players", playerId), (snap) => {
    if (!snap.exists()) return;
    latestPlayer = snap.data();
    render();
  });
}

function render() {
  if (!latestRoom || !latestPlayer) return;

  if (latestRoom.status === "waiting") {
    showScreen("waiting");
    document.getElementById("waiting-nickname").textContent = latestPlayer.nickname;
    return;
  }

  if (latestRoom.status === "playing") {
    showScreen("playing");
    document.getElementById("playing-nickname").textContent = latestPlayer.nickname;

    const tileEl = document.getElementById("current-tile");
    if (latestRoom.currentTile === null) {
      tileEl.textContent = "대기중";
      tileEl.classList.add("placeholder");
    } else {
      tileEl.textContent = tileLabel(latestRoom.currentTile);
      tileEl.classList.remove("placeholder");
    }

    const lastIndex = latestRoom.drawHistory.length - 1;
    const alreadyPlaced = lastIndex >= 0 &&
      latestPlayer.placements[lastIndex] !== null &&
      latestPlayer.placements[lastIndex] !== undefined;

    const banner = document.getElementById("status-banner");
    const canPlace = lastIndex >= 0 && !alreadyPlaced;
    if (alreadyPlaced) {
      banner.style.display = "";
      banner.className = "status-banner done";
      banner.textContent = "배치 완료! 다음 숫자를 기다리는 중...";
    } else if (lastIndex < 0) {
      banner.style.display = "";
      banner.className = "status-banner waiting";
      banner.textContent = "방장이 첫 숫자를 뽑을 때까지 기다려주세요.";
    } else {
      banner.style.display = "none";
    }

    const boardEl = document.getElementById("board");
    renderBoard(boardEl, latestPlayer.board, {
      selectableEmpty: canPlace,
      onCellClick: canPlace ? (idx) => handlePlace(idx) : undefined,
    });
    return;
  }

  if (latestRoom.status === "ended") {
    showScreen("ended");
    const list = document.getElementById("leaderboard");
    list.innerHTML = "";
    (latestRoom.finalScores || []).forEach(({ nickname, total }) => {
      const li = document.createElement("li");
      const mine = nickname === latestPlayer.nickname;
      li.innerHTML = `<span>${nickname}${mine ? " (나)" : ""}</span><span>${total}점</span>`;
      list.appendChild(li);
    });

    const { total } = computeScore(latestPlayer.board);
    document.getElementById("my-total").textContent = total;
    renderBoard(document.getElementById("my-board"), latestPlayer.board, {});
  }
}

async function handlePlace(index) {
  try {
    await placeTile(roomCode, playerId, index);
  } catch (e) {
    // 동시에 다른 칸을 눌렀거나 이미 배치된 경우 등은 조용히 무시(다음 스냅샷으로 화면이 갱신됨)
    console.warn(e.message);
  }
}

// 새로고침/재접속 시 자동 복귀
(async function init() {
  const saved = localStorage.getItem(LS_KEY);
  if (!saved) {
    showScreen("join");
    return;
  }
  try {
    const { code, playerId: id } = JSON.parse(saved);
    const [room, player] = await Promise.all([getRoom(code), getPlayer(code, id)]);
    if (room && player) {
      roomCode = code;
      playerId = id;
      subscribe();
    } else {
      localStorage.removeItem(LS_KEY);
      showScreen("join");
    }
  } catch {
    localStorage.removeItem(LS_KEY);
    showScreen("join");
  }
})();
