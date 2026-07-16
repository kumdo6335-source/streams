import { db, doc, onSnapshot } from "./firebase-init.js";
import { getRoom, getPlayer, fetchNicknames, joinRoom, placeTile } from "./room.js";
import { renderBoard, tileLabel, renderNumberTracker } from "./ui-common.js";
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

// 규칙 팝업: 입장 시 규칙을 먼저 보여주고, 확인을 누르면 콜백(대기 구독 시작)을 실행한다
const rulesModal = document.getElementById("rules-modal");
let onRulesConfirm = null;
function openRulesModal(onConfirm) {
  onRulesConfirm = typeof onConfirm === "function" ? onConfirm : null;
  rulesModal.style.display = "flex";
}
function closeRulesModal() {
  rulesModal.style.display = "none";
  const cb = onRulesConfirm;
  onRulesConfirm = null;
  if (cb) cb();
}
document.getElementById("btn-rules-confirm").addEventListener("click", closeRulesModal);
document.getElementById("btn-show-rules").addEventListener("click", () => openRulesModal());

document.getElementById("btn-join").addEventListener("click", handleJoin);

// 이전에 참가했던 방(특히 이미 종료된 게임)에 계속 붙잡혀 있지 않도록,
// 대기/진행/종료 화면 어디서든 저장된 기록을 지우고 입장 화면으로 나갈 수 있게 한다.
["btn-leave-waiting", "btn-leave-playing", "btn-leave-ended"].forEach((id) => {
  document.getElementById(id).addEventListener("click", () => resetToJoin());
});
document.getElementById("link-home").addEventListener("click", () => {
  localStorage.removeItem(LS_KEY);
});

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
    if (room.status === "closed") {
      errEl.textContent = "종료된 방입니다. 방장에게 새 코드를 받아 입장해주세요.";
      return;
    }
    const existing = await fetchNicknames(code);
    const id = await joinRoom(code, nickname, existing);
    roomCode = code;
    playerId = id;
    localStorage.setItem(LS_KEY, JSON.stringify({ code, playerId: id }));
    // 바로 대기 화면으로 가지 않고 규칙 팝업을 먼저 보여준 뒤, 확인을 누르면 대기 구독을 시작한다
    openRulesModal(() => subscribe());
  } catch (e) {
    errEl.textContent = e.message;
  }
}

let unsubRoom = null;
let unsubPlayer = null;

function cleanupSubscriptions() {
  if (unsubRoom) { unsubRoom(); unsubRoom = null; }
  if (unsubPlayer) { unsubPlayer(); unsubPlayer = null; }
}

// 방이 종료(closed)되었거나 사라진 경우: 구독을 끊고 이 참가자의 기록을 지운 뒤 입장 화면으로 돌아간다.
// (다음 게임은 방장이 새 코드로 안내하므로, 옛 방에 갇히지 않고 새로 입장할 수 있게 한다.)
function resetToJoin() {
  cleanupSubscriptions();
  localStorage.removeItem(LS_KEY);
  roomCode = null;
  playerId = null;
  latestRoom = null;
  latestPlayer = null;
  showScreen("join");
}

function subscribe() {
  cleanupSubscriptions(); // 이전 방 구독이 남아 새 방 화면을 덮어쓰지 않도록 먼저 정리
  unsubRoom = onSnapshot(doc(db, "rooms", roomCode), (snap) => {
    if (!snap.exists() || snap.data().status === "closed") {
      resetToJoin();
      return;
    }
    latestRoom = snap.data();
    render();
  });
  unsubPlayer = onSnapshot(doc(db, "rooms", roomCode, "players", playerId), (snap) => {
    if (!snap.exists()) {
      resetToJoin();
      return;
    }
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
    renderNumberTracker(document.getElementById("number-tracker"), latestRoom.drawHistory);

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
    const canPlace = lastIndex >= 0;
    if (alreadyPlaced) {
      banner.style.display = "";
      banner.className = "status-banner done";
      banner.textContent = "배치 완료! 다음 숫자가 나오기 전까지는 다른 칸을 눌러 위치를 바꿀 수 있어요.";
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
    const codeFromUrl = new URLSearchParams(location.search).get("code");
    if (codeFromUrl) {
      document.getElementById("input-code").value = codeFromUrl;
      document.getElementById("input-nickname").focus();
    }
    return;
  }
  try {
    const { code, playerId: id } = JSON.parse(saved);
    const [room, player] = await Promise.all([getRoom(code), getPlayer(code, id)]);
    // 종료(closed)된 방에는 재접속하지 않고, 저장된 기록을 지워 새 게임에 입장할 수 있게 한다
    if (room && player && room.status !== "closed") {
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
