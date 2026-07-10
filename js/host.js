import { db, doc, onSnapshot, collection } from "./firebase-init.js";
import { createRoom, drawTile, cancelDraw, finalizeGame, getRoom, closeRoom } from "./room.js";
import { tileLabel } from "./ui-common.js";

const LS_KEY = "streams_host_room";

const screens = {
  create: document.getElementById("screen-create"),
  lobby: document.getElementById("screen-lobby"),
  playing: document.getElementById("screen-playing"),
  ended: document.getElementById("screen-ended"),
};

function showScreen(name) {
  Object.entries(screens).forEach(([key, el]) => {
    el.style.display = key === name ? "" : "none";
  });
}

const params = new URLSearchParams(location.search);
if (params.get("new") === "1") {
  localStorage.removeItem(LS_KEY);
  history.replaceState(null, "", "host.html");
}

let roomCode = localStorage.getItem(LS_KEY);
let players = {}; // id -> data
let finalizeTriggered = false;
let autoMode = false;
let autoDrawInFlight = false;

document.getElementById("btn-create").addEventListener("click", async () => {
  const errEl = document.getElementById("create-error");
  errEl.textContent = "";
  try {
    roomCode = await createRoom();
    localStorage.setItem(LS_KEY, roomCode);
    subscribeRoom();
  } catch (e) {
    errEl.textContent = e.message;
  }
});

document.getElementById("btn-start-draw").addEventListener("click", () => draw());
document.getElementById("btn-draw").addEventListener("click", () => draw());
document.getElementById("btn-cancel").addEventListener("click", () => cancel());

document.getElementById("auto-mode-toggle").addEventListener("change", (e) => {
  autoMode = e.target.checked;
  maybeAutoDraw();
});

// 방장이 방을 나갈 때(처음으로/새 방 만들기): 방을 종료(closed) 처리해 참가자들도 옛 방에서 나가도록 한다
async function leaveRoom(e, destination) {
  e.preventDefault();
  const codeToClose = roomCode;
  if (codeToClose && latestRoom && latestRoom.status !== "ended") {
    const ok = confirm("진행 중인 게임을 종료하고 나가시겠습니까? 참가자들은 다시 입장해야 합니다.");
    if (!ok) return;
  }
  localStorage.removeItem(LS_KEY);
  roomCode = null;
  if (codeToClose) {
    try {
      await closeRoom(codeToClose);
    } catch (err) {
      console.warn(err);
    }
  }
  location.href = destination;
}

document.getElementById("btn-back-home").addEventListener("click", (e) => leaveRoom(e, "index.html"));
document.getElementById("btn-new-room").addEventListener("click", (e) => leaveRoom(e, "host.html?new=1"));

async function draw() {
  const playerIds = Object.keys(players);
  if (playerIds.length === 0) {
    document.getElementById("lobby-error").textContent = "참가자가 1명 이상 있어야 시작할 수 있습니다.";
    return;
  }
  document.getElementById("btn-draw").disabled = true;
  try {
    await drawTile(roomCode, playerIds);
  } catch (e) {
    document.getElementById("playing-error").textContent = e.message;
    document.getElementById("lobby-error").textContent = e.message;
  }
}

async function cancel() {
  try {
    await cancelDraw(roomCode, Object.keys(players));
  } catch (e) {
    document.getElementById("playing-error").textContent = e.message;
  }
}

function subscribeRoom() {
  showScreen("lobby");
  document.getElementById("room-code").textContent = roomCode;
  document.getElementById("playing-code").textContent = roomCode;
  setupJoinInfo();

  onSnapshot(doc(db, "rooms", roomCode), (snap) => {
    if (!snap.exists()) return;
    render(snap.data());
  });

  onSnapshot(collection(db, "rooms", roomCode, "players"), (snap) => {
    players = {};
    snap.forEach((d) => { players[d.id] = d.data(); });
    renderPlayers();
    updateDrawButtonState();
  });
}

function setupJoinInfo() {
  const joinUrl = location.href.replace(/host\.html.*$/, `player.html?code=${roomCode}`);
  const linkInput = document.getElementById("join-link");
  linkInput.value = joinUrl;

  const qrBox = document.getElementById("qr-canvas");
  if (window.qrcode) {
    try {
      const qr = window.qrcode(0, "M");
      qr.addData(joinUrl);
      qr.make();
      qrBox.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
    } catch (err) {
      console.warn("QR 코드 생성 실패:", err);
    }
  }

  document.getElementById("btn-copy-link").addEventListener("click", async () => {
    const hint = document.getElementById("copy-hint");
    try {
      await navigator.clipboard.writeText(joinUrl);
    } catch {
      linkInput.select();
      document.execCommand("copy");
    }
    hint.textContent = "복사되었습니다!";
    setTimeout(() => { hint.textContent = ""; }, 2000);
  });
}

let latestRoom = null;

function render(room) {
  latestRoom = room;

  if (room.status === "waiting") {
    showScreen("lobby");
  } else if (room.status === "playing") {
    showScreen("playing");
    document.getElementById("tiles-left").textContent = room.deck.length;
    const tileEl = document.getElementById("current-tile");
    if (room.currentTile === null) {
      tileEl.textContent = "대기중";
      tileEl.classList.add("placeholder");
    } else {
      tileEl.textContent = tileLabel(room.currentTile);
      tileEl.classList.remove("placeholder");
    }
  } else if (room.status === "ended") {
    showScreen("ended");
    const list = document.getElementById("leaderboard");
    list.innerHTML = "";
    (room.finalScores || []).forEach(({ nickname, total }) => {
      const li = document.createElement("li");
      li.innerHTML = `<span>${nickname}</span><span>${total}점</span>`;
      list.appendChild(li);
    });
  }

  renderPlayers();
  updateDrawButtonState();
}

function renderPlayers() {
  const ids = Object.keys(players);
  const lastIndex = latestRoom ? latestRoom.drawHistory.length - 1 : -1;

  const lobbyList = document.getElementById("lobby-players");
  lobbyList.innerHTML = "";
  document.getElementById("lobby-count").textContent = ids.length;

  const playingList = document.getElementById("playing-players");
  playingList.innerHTML = "";

  let doneCount = 0;
  ids.forEach((id) => {
    const p = players[id];
    const done = lastIndex >= 0 && p.placements[lastIndex] !== null && p.placements[lastIndex] !== undefined;
    if (done) doneCount++;

    const li1 = document.createElement("li");
    li1.textContent = p.nickname;
    lobbyList.appendChild(li1);

    const li2 = document.createElement("li");
    li2.textContent = p.nickname + (done ? " ✓" : "");
    li2.className = done ? "done" : "";
    playingList.appendChild(li2);
  });

  document.getElementById("placed-count").textContent = doneCount;
  document.getElementById("total-players").textContent = ids.length;
  const pct = ids.length > 0 ? Math.round((doneCount / ids.length) * 100) : 0;
  document.getElementById("progress-fill").style.width = pct + "%";

  maybeFinalize(ids, lastIndex, doneCount);
  maybeAutoDraw();
}

// 자동 모드가 켜져 있고 모든 참가자가 배치를 마쳤다면 방장이 뽑기 버튼을 누르지 않아도 다음 숫자를 자동으로 뽑음
async function maybeAutoDraw() {
  if (!autoMode || autoDrawInFlight) return;
  if (!latestRoom || latestRoom.status !== "playing") return;
  if (latestRoom.deck.length === 0) return;

  const ids = Object.keys(players);
  const lastIndex = latestRoom.drawHistory.length - 1;
  if (ids.length === 0 || lastIndex < 0) return;
  const allPlaced = ids.every((id) => {
    const v = players[id].placements[lastIndex];
    return v !== null && v !== undefined;
  });
  if (!allPlaced) return;

  autoDrawInFlight = true;
  try {
    await drawTile(roomCode, ids);
  } catch (e) {
    document.getElementById("playing-error").textContent = e.message;
  } finally {
    autoDrawInFlight = false;
  }
}

async function maybeFinalize(ids, lastIndex, doneCount) {
  if (!latestRoom || finalizeTriggered) return;
  if (latestRoom.status !== "playing") return;
  if (latestRoom.drawHistory.length !== 20) return;
  if (ids.length === 0 || doneCount !== ids.length) return;

  finalizeTriggered = true;
  const playerList = ids.map((id) => players[id]);
  try {
    await finalizeGame(roomCode, playerList);
  } catch (e) {
    finalizeTriggered = false;
  }
}

function updateDrawButtonState() {
  if (!latestRoom) return;
  const ids = Object.keys(players);
  const lastIndex = latestRoom.drawHistory.length - 1;
  const allPlaced = lastIndex < 0 || ids.every((id) => {
    const v = players[id].placements[lastIndex];
    return v !== null && v !== undefined;
  });
  const canDraw = latestRoom.status !== "ended" && latestRoom.deck.length > 0 && ids.length > 0 && allPlaced;
  document.getElementById("btn-draw").disabled = !canDraw;
  document.getElementById("btn-start-draw").disabled = ids.length === 0;
  document.getElementById("btn-cancel").disabled = latestRoom.drawHistory.length === 0 || latestRoom.status === "ended";
}

// 초기 진입: 저장된 방이 있으면 복귀, 없으면 생성 화면
if (roomCode) {
  getRoom(roomCode).then((data) => {
    if (data && data.status !== "closed") {
      subscribeRoom();
    } else {
      localStorage.removeItem(LS_KEY);
      roomCode = null;
      showScreen("create");
    }
  });
} else {
  showScreen("create");
}
