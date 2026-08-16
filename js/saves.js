// Pause/resume support. Solo & Pass-and-Play games are pure client-side
// state, so we store a full snapshot in localStorage. Online games already
// live in Firestore (see online.js) — resuming one just means remembering
// the room code (the player's persistent id is already kept in
// localStorage by getOrCreateLocalPlayerId) so we can rejoin later.

const LOCAL_SAVE_KEYS = { solo: "nature_save_solo", pass: "nature_save_pass" };
const ONLINE_SAVE_KEY = "nature_save_online";

function saveLocalGame(mode) {
  if (mode !== "solo" && mode !== "pass") return;
  if (!STATE) return;
  try {
    localStorage.setItem(LOCAL_SAVE_KEYS[mode], JSON.stringify({
      state: STATE,
      setupPlayers: LOCAL_SETUP_PLAYERS,
      savedAt: Date.now()
    }));
  } catch (e) {
    // Storage full/unavailable — saving is best-effort, don't block play.
  }
}

function loadLocalSave(mode) {
  try {
    const raw = localStorage.getItem(LOCAL_SAVE_KEYS[mode]);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function clearLocalSave(mode) {
  localStorage.removeItem(LOCAL_SAVE_KEYS[mode]);
}

function saveOnlineJoin(code, name) {
  try {
    localStorage.setItem(ONLINE_SAVE_KEY, JSON.stringify({ code, name, savedAt: Date.now() }));
  } catch (e) {
    // ignore
  }
}

function loadOnlineSave() {
  try {
    const raw = localStorage.getItem(ONLINE_SAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function clearOnlineSave() {
  localStorage.removeItem(ONLINE_SAVE_KEY);
}
