import {
  createTiles,
  shuffle,
  analyzeSet,
  validateTurn,
  handValue,
  compareByColor,
  compareByNumber,
  HAND_SIZE,
  INITIAL_MELD,
} from './rules.js';
import { planTurn, findBestMelds } from './ai.js';
import { sfx, setMuted, isMuted } from './sound.js';
import { confetti } from './confetti.js';

const BOT_PROFILES = [
  { name: 'Violet', avatar: '🔮' },
  { name: 'Plum', avatar: '🦄' },
  { name: 'Amethyst', avatar: '🐙' },
];
const SAVE_KEY = 'rummikub.save.v1';
const STATS_KEY = 'rummikub.stats.v1';
const PREFS_KEY = 'rummikub.prefs.v1';

const store = {
  get(key) {
    try {
      return JSON.parse(localStorage.getItem(key));
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* storage unavailable — ignore */
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  },
};

const TILES = createTiles(); // tile ids are their index
const $ = (sel) => document.querySelector(sel);
const el = {
  setup: $('#setup'),
  setupForm: $('#setup-form'),
  name: $('#player-name'),
  continueBtn: $('#continue-btn'),
  statsLine: $('#stats-line'),
  game: $('#game'),
  opponents: $('#opponents'),
  poolCount: $('#pool-count'),
  board: $('#board'),
  sets: $('#sets'),
  boardEmpty: $('#board-empty'),
  rack: $('#rack'),
  turnPill: $('#turn-pill'),
  status: $('#status'),
  log: $('#log'),
  toast: $('#toast'),
  undo: $('#undo-btn'),
  reset: $('#reset-btn'),
  hint: $('#hint-btn'),
  sortColor: $('#sort-color-btn'),
  sortNum: $('#sort-num-btn'),
  draw: $('#draw-btn'),
  end: $('#end-btn'),
  soundBtn: $('#sound-btn'),
  menuBtn: $('#menu-btn'),
  rules: $('#rules'),
  gameover: $('#gameover'),
  confirm: $('#confirm'),
};

let game = null;
let turn = null; // { startBoard, startHand, played: Set, history: [] }
let selected = new Set();
let hintIds = new Set();
let freshIds = new Set(); // one-shot pop-in animation
let recentIds = new Set(); // bot plays since your last turn
let drawnId = null;
let botTimer = null;
let nextSetId = 1;

// ---------------------------------------------------------------- state helpers

const human = () => game.players.find((p) => p.isHuman);
const current = () => game.players[game.current];
const isHumanTurn = () => game && !game.over && current().isHuman;
const boardTiles = (board = game.board) => board.map((s) => s.tiles);
const makeSet = (tiles) => ({ id: nextSetId++, tiles });
const cloneBoard = (board) => board.map((s) => ({ id: s.id, tiles: s.tiles.slice() }));

function locate(id) {
  if (human().hand.some((t) => t.id === id)) return { where: 'hand' };
  const set = game.board.find((s) => s.tiles.some((t) => t.id === id));
  return set ? { where: 'set', set } : { where: 'none' };
}

function canMove(id) {
  if (!isHumanTurn()) return false;
  const loc = locate(id);
  if (loc.where === 'hand') return true;
  if (loc.where === 'set') return human().hasMelded || turn.played.has(id);
  return false;
}

function tileName(t) {
  return t.joker ? 'a Joker' : `${t.color === 'amber' ? 'an orange' : 'a ' + t.color} ${t.num}`;
}

// ---------------------------------------------------------------- game flow

function newGame({ name, bots, difficulty }) {
  clearTimeout(botTimer);
  const pool = shuffle(TILES);
  const players = [
    { name: name || 'You', avatar: '😎', isHuman: true, hand: [], hasMelded: false },
    ...BOT_PROFILES.slice(0, bots).map((b) => ({ ...b, isHuman: false, hand: [], hasMelded: false })),
  ];
  for (let i = 0; i < HAND_SIZE; i++) {
    for (const p of players) p.hand.push(pool.pop());
  }
  game = {
    players,
    pool,
    board: [],
    current: Math.floor(Math.random() * players.length),
    passes: 0,
    difficulty,
    sortMode: 'color',
    over: false,
    settings: { name, bots, difficulty },
  };
  recentIds = new Set();
  store.remove(SAVE_KEY);
  showGame();
  const first = current();
  log(first.isHuman ? 'You go first!' : `${first.name} goes first.`);
  startTurn();
}

function startTurn() {
  if (game.over) return;
  const p = current();
  turn = {
    startBoard: cloneBoard(game.board),
    startHand: p.hand.slice(),
    played: new Set(),
    history: [],
  };
  selected.clear();
  hintIds.clear();
  save();
  render();
  if (!p.isHuman) {
    botTimer = setTimeout(botTurn, 900 + Math.random() * 700);
  }
}

function advance() {
  game.current = (game.current + 1) % game.players.length;
  startTurn();
}

function restoreTurnStart() {
  game.board = cloneBoard(turn.startBoard);
  current().hand = turn.startHand.slice();
  turn.played.clear();
  turn.history = [];
  selected.clear();
  hintIds.clear();
}

function pushHistory() {
  turn.history.push({ board: cloneBoard(game.board), hand: human().hand.slice(), played: new Set(turn.played) });
}

function undo() {
  const prev = turn?.history.pop();
  if (!prev || !isHumanTurn()) return;
  game.board = prev.board;
  human().hand = prev.hand;
  turn.played = prev.played;
  selected.clear();
  sfx('undo');
  render();
}

function resetTurn() {
  if (!isHumanTurn() || (!turn.played.size && !turn.history.length)) return;
  restoreTurnStart();
  sfx('undo');
  render();
}

// Moves tiles to a target: { type: 'set', setId } | { type: 'new' } | { type: 'hand', beforeId? }
function moveTiles(ids, target) {
  if (!isHumanTurn()) return;
  ids = ids.filter(canMove);
  const me = human();

  if (target.type === 'hand') {
    const fromHand = ids.filter((id) => locate(id).where === 'hand');
    ids = ids.filter((id) => turn.played.has(id));
    if (!ids.length && fromHand.length && target.beforeId != null) {
      reorderHand(fromHand, target.beforeId);
      return;
    }
  }
  if (!ids.length) return;

  pushHistory();
  let dest;
  if (target.type === 'set') dest = game.board.find((s) => s.id === target.setId);
  if (target.type === 'new') {
    dest = makeSet([]);
    game.board.push(dest);
  }
  if (target.type === 'set' && !dest) {
    turn.history.pop();
    return;
  }

  const moving = [];
  for (const id of ids) {
    const loc = locate(id);
    if (loc.where === 'set' && loc.set === dest) continue;
    const tile = TILES[id];
    if (loc.where === 'hand') me.hand = me.hand.filter((t) => t.id !== id);
    else loc.set.tiles = loc.set.tiles.filter((t) => t.id !== id);
    moving.push(tile);
  }

  if (target.type === 'hand') {
    me.hand.push(...moving);
    moving.forEach((t) => turn.played.delete(t.id));
  } else {
    dest.tiles.push(...moving);
    moving.forEach((t) => turn.played.add(t.id));
  }
  game.board = game.board.filter((s) => s.tiles.length);
  selected.clear();
  hintIds.clear();
  sfx('drop');
  render();
}

function reorderHand(ids, beforeId) {
  const me = human();
  const order = displayedHand();
  const moving = order.filter((t) => ids.includes(t.id));
  const rest = order.filter((t) => !ids.includes(t.id));
  const idx = rest.findIndex((t) => t.id === beforeId);
  rest.splice(idx < 0 ? rest.length : idx, 0, ...moving);
  me.hand = rest;
  game.sortMode = null;
  selected.clear();
  sfx('drop');
  render();
}

function displayedHand() {
  const hand = human().hand.slice();
  if (game.sortMode === 'color') hand.sort(compareByColor);
  if (game.sortMode === 'number') hand.sort(compareByNumber);
  return hand;
}

function currentValidation() {
  return validateTurn({
    startBoard: boardTiles(turn.startBoard),
    board: boardTiles(),
    playedIds: [...turn.played],
    hasMelded: human().hasMelded,
  });
}

function liveMeldValue() {
  return game.board
    .filter((s) => s.tiles.some((t) => turn.played.has(t.id)))
    .reduce((sum, s) => sum + analyzeSet(s.tiles).value, 0);
}

function endTurn() {
  if (!isHumanTurn()) return;
  const res = currentValidation();
  if (!res.ok) {
    toast(res.error);
    sfx('error');
    for (const node of el.sets.querySelectorAll('.set.invalid')) {
      node.classList.remove('shake');
      void node.offsetWidth;
      node.classList.add('shake');
    }
    return;
  }
  const me = human();
  const count = turn.played.size;
  const firstMeld = !me.hasMelded;
  me.hasMelded = true;
  game.passes = 0;
  recentIds = new Set();
  sfx('play');
  if (firstMeld) log(`Initial meld: ${res.meldValue} points! 🎉`);
  if (!me.hand.length) return finish(me);
  log(`You played ${count} tile${count === 1 ? '' : 's'}.`);
  advance();
}

function drawAction() {
  if (!isHumanTurn()) return;
  if (turn.played.size || turn.history.length) restoreTurnStart();
  recentIds = new Set();
  const me = human();
  if (!game.pool.length) {
    log('You passed.');
    if (++game.passes >= game.players.length) return finish(null);
  } else {
    const tile = game.pool.pop();
    me.hand.push(tile);
    drawnId = tile.id;
    game.passes = 0;
    log(`You drew ${tileName(tile)}.`);
  }
  sfx('draw');
  advance();
}

function botTurn() {
  if (!game || game.over) return;
  const p = current();
  const plan = planTurn({
    hand: p.hand,
    board: boardTiles(),
    hasMelded: p.hasMelded,
    difficulty: game.difficulty,
  });

  if (plan) {
    const res = validateTurn({
      startBoard: boardTiles(),
      board: plan.board,
      playedIds: plan.played,
      hasMelded: p.hasMelded,
    });
    if (res.ok) {
      const played = new Set(plan.played);
      game.board = plan.board.map((tiles) => makeSet(tiles));
      p.hand = p.hand.filter((t) => !played.has(t.id));
      const firstMeld = !p.hasMelded;
      p.hasMelded = true;
      game.passes = 0;
      freshIds = new Set(played);
      played.forEach((id) => recentIds.add(id));
      sfx('bot');
      log(
        firstMeld
          ? `${p.avatar} ${p.name} opened with ${res.meldValue} points (${played.size} tiles).`
          : `${p.avatar} ${p.name} played ${played.size} tile${played.size === 1 ? '' : 's'}.`,
      );
      render();
      if (!p.hand.length) return finish(p);
      botTimer = setTimeout(advance, 1300);
      return;
    }
  }

  if (game.pool.length) {
    p.hand.push(game.pool.pop());
    game.passes = 0;
    log(`${p.avatar} ${p.name} drew a tile.`);
  } else {
    log(`${p.avatar} ${p.name} passed.`);
    if (++game.passes >= game.players.length) return finish(null);
  }
  sfx('tick');
  render();
  botTimer = setTimeout(advance, 650);
}

function finish(winner) {
  game.over = true;
  clearTimeout(botTimer);
  store.remove(SAVE_KEY);

  if (!winner) {
    // Pool ran dry and nobody could play: lowest rack wins.
    winner = game.players.reduce((best, p) => (handValue(p.hand) < handValue(best.hand) ? p : best));
  }
  const rows = game.players.map((p) => ({ p, left: p.hand.length, value: handValue(p.hand) }));
  const losersTotal = rows.filter((r) => r.p !== winner).reduce((s, r) => s + r.value, 0);
  rows.forEach((r) => (r.score = r.p === winner ? losersTotal : -r.value));
  rows.sort((a, b) => b.score - a.score);

  const stats = store.get(STATS_KEY) || { played: 0, won: 0 };
  stats.played++;
  if (winner.isHuman) stats.won++;
  store.set(STATS_KEY, stats);

  render();
  $('#go-emoji').textContent = winner.isHuman ? '🏆' : winner.avatar;
  $('#go-title').textContent = winner.isHuman ? 'You win!' : `${winner.name} wins!`;
  $('#go-scores').innerHTML = rows
    .map(
      (r) => `<tr class="${r.p === winner ? 'winner' : ''}">
        <td>${r.p.avatar} ${escapeHtml(r.p.name)}</td>
        <td>${r.left}</td>
        <td class="${r.score >= 0 ? 'pos' : 'neg'}">${r.score > 0 ? '+' : ''}${r.score}</td>
      </tr>`,
    )
    .join('');
  setTimeout(() => {
    if (winner.isHuman) {
      sfx('win');
      confetti($('#confetti'));
    } else {
      sfx('lose');
    }
    el.gameover.showModal();
  }, 700);
}

// ---------------------------------------------------------------- save / load

function save() {
  if (!game || game.over) return;
  store.set(SAVE_KEY, {
    v: 1,
    players: game.players.map((p) => ({ ...p, hand: p.hand.map((t) => t.id) })),
    pool: game.pool.map((t) => t.id),
    board: game.board.map((s) => s.tiles.map((t) => t.id)),
    current: game.current,
    passes: game.passes,
    difficulty: game.difficulty,
    sortMode: game.sortMode,
    settings: game.settings,
  });
}

function load() {
  const data = store.get(SAVE_KEY);
  if (!data || data.v !== 1) return null;
  try {
    const toTiles = (ids) => ids.map((id) => TILES[id]);
    return {
      players: data.players.map((p) => ({ ...p, hand: toTiles(p.hand) })),
      pool: toTiles(data.pool),
      board: data.board.map((ids) => makeSet(toTiles(ids))),
      current: data.current,
      passes: data.passes,
      difficulty: data.difficulty,
      sortMode: data.sortMode,
      settings: data.settings,
      over: false,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- rendering

function tileEl(tile, { as = null, classes = [] } = {}) {
  const d = document.createElement('div');
  d.className = ['tile', tile.joker ? 'joker' : `c-${tile.color}`, ...classes].join(' ');
  d.dataset.id = tile.id;
  const face = document.createElement('span');
  face.className = 'face';
  face.textContent = tile.joker ? '☺' : tile.num;
  d.append(face);
  if (tile.joker && as) {
    const s = document.createElement('span');
    s.className = 'as';
    s.textContent = as;
    d.append(s);
  }
  d.setAttribute('aria-label', tile.joker ? 'Joker' : `${tile.color} ${tile.num}`);
  return d;
}

function tileClasses(id) {
  const c = [];
  if (canMove(id)) c.push('movable');
  if (selected.has(id)) c.push('selected');
  if (hintIds.has(id)) c.push('hint');
  if (turn?.played.has(id)) c.push('played-now');
  if (freshIds.has(id)) c.push('fresh');
  else if (recentIds.has(id)) c.push('recent');
  if (drawnId === id) c.push('drawn');
  return c;
}

function render() {
  if (!game) return;
  renderOpponents();
  renderBoard();
  renderRack();
  renderStatus();
  el.poolCount.textContent = game.pool.length;
  freshIds = new Set();
  drawnId = null;
}

function renderOpponents() {
  el.opponents.innerHTML = '';
  game.players.forEach((p, i) => {
    if (p.isHuman) return;
    const active = i === game.current && !game.over;
    const d = document.createElement('div');
    d.className = `opp${active ? ' active' : ''}`;
    d.innerHTML = `
      <div class="avatar">${p.avatar}</div>
      <div class="opp-info">
        <div class="opp-name">${escapeHtml(p.name)}</div>
        <div class="opp-meta">
          <span>${p.hand.length} tiles</span>
          ${p.hasMelded ? '<span class="badge-meld" title="Has made initial meld">✓</span>' : ''}
          ${active ? '<span class="thinking"><i></i><i></i><i></i></span>' : ''}
        </div>
      </div>`;
    el.opponents.append(d);
  });
}

function renderBoard() {
  el.sets.innerHTML = '';
  const yours = isHumanTurn();
  for (const set of game.board) {
    const info = analyzeSet(set.tiles);
    const d = document.createElement('div');
    d.className = 'set';
    if (!info.valid) d.classList.add('invalid');
    if (yours && set.tiles.some((t) => turn.played.has(t.id))) d.classList.add('fresh-set');
    if (yours && selected.size) d.classList.add('selectable');
    d.dataset.drop = 'set';
    d.dataset.setId = set.id;
    for (const { tile, as } of info.ordered) {
      d.append(tileEl(tile, { as: info.valid ? as : null, classes: tileClasses(tile.id) }));
    }
    el.sets.append(d);
  }
  if (yours) {
    const n = document.createElement('div');
    n.className = 'new-set';
    n.dataset.drop = 'new';
    n.textContent = '+ New set';
    el.sets.append(n);
  }
  el.boardEmpty.hidden = game.board.length > 0 || yours;
}

function renderRack() {
  el.rack.innerHTML = '';
  for (const tile of displayedHand()) {
    el.rack.append(tileEl(tile, { classes: tileClasses(tile.id) }));
  }
  el.rack.classList.toggle('inactive', !isHumanTurn());
}

function renderStatus() {
  const yours = isHumanTurn();
  const me = human();
  const p = current();
  el.turnPill.className = `turn-pill${yours ? ' yours' : ''}`;
  el.turnPill.textContent = game.over ? 'Game over' : yours ? 'Your turn' : `${p.avatar} ${p.name}’s turn`;

  let status = '';
  let ready = false;
  if (yours) {
    const v = currentValidation();
    ready = v.ok;
    if (!me.hasMelded) {
      const pts = liveMeldValue();
      status = turn.played.size
        ? `Initial meld: <b class="${pts >= INITIAL_MELD ? 'ok' : 'warn'}">${pts}</b> / ${INITIAL_MELD} points`
        : `Make your <b>initial meld</b> — sets worth ${INITIAL_MELD}+ points from your rack.`;
    } else if (turn.played.size) {
      status = ready
        ? `<span class="ok">Looks good!</span> Played <b>${turn.played.size}</b> tile${turn.played.size === 1 ? '' : 's'}.`
        : `Played <b>${turn.played.size}</b> — fix the highlighted sets before ending your turn.`;
    } else {
      status = 'Drag tiles to the table or rearrange sets. Can’t play? Draw a tile.';
    }
    if (selected.size) status += ` · <b>${selected.size}</b> selected — tap a set to move them.`;
  } else if (!game.over) {
    status = `Your rack: <b>${me.hand.length}</b> tiles${me.hasMelded ? '' : ' · initial meld not made yet'}`;
  }
  el.status.innerHTML = status;

  el.undo.disabled = !yours || !turn.history.length;
  el.reset.disabled = !yours || (!turn.played.size && !turn.history.length);
  el.hint.disabled = !yours;
  el.sortColor.disabled = el.sortNum.disabled = game.over;
  el.draw.disabled = !yours;
  el.draw.textContent = game.pool.length ? 'Draw tile' : 'Pass';
  el.end.disabled = !yours || !turn.played.size;
  el.end.classList.toggle('ready', yours && ready);
}

function log(text) {
  const d = document.createElement('div');
  d.className = 'log-item';
  d.textContent = text;
  el.log.append(d);
  while (el.log.children.length > 3) el.log.firstChild.remove();
  setTimeout(() => d.remove(), 3100);
}

let toastTimer = null;
function toast(text, kind = '') {
  el.toast.textContent = text;
  el.toast.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.toast.className = 'toast'), 2800);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// ---------------------------------------------------------------- hint

function showHint() {
  if (!isHumanTurn()) return;
  if (hintIds.size) {
    hintIds.clear();
    render();
    return;
  }
  const me = human();
  const need = me.hasMelded ? 0 : Math.max(0, INITIAL_MELD - liveMeldValue());
  const { sets } = findBestMelds(me.hand, { minValue: need, nodeLimit: 25000 });
  if (sets.length) {
    hintIds = new Set(sets.flat().map((t) => t.id));
    toast(`💡 These tiles make ${sets.length} set${sets.length === 1 ? '' : 's'}.`, 'good');
  } else if (me.hasMelded) {
    const fits = me.hand.filter((t) => game.board.some((s) => analyzeSet([...s.tiles, t]).valid));
    if (fits.length) {
      hintIds = new Set(fits.map((t) => t.id));
      toast('💡 These tiles fit onto sets already on the table.', 'good');
    } else {
      toast('No easy plays spotted — try rearranging, or draw a tile.');
    }
  } else {
    toast(`Can’t reach ${INITIAL_MELD} points yet — draw a tile.`);
  }
  sfx('tick');
  render();
}

// ---------------------------------------------------------------- input: drag & tap

let drag = null;

el.game.addEventListener('pointerdown', (e) => {
  const t = e.target.closest('.tile[data-id]');
  if (!t || e.button > 0) return;
  const id = Number(t.dataset.id);
  if (!canMove(id)) return;
  drag = { id, pointerId: e.pointerId, x: e.clientX, y: e.clientY, active: false };
});

window.addEventListener(
  'pointermove',
  (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    if (!drag.active) {
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 6) return;
      beginDrag();
    }
    e.preventDefault();
    positionGhost(e.clientX, e.clientY);
    setHover(dropTargetAt(e.clientX, e.clientY));
  },
  { passive: false },
);

window.addEventListener('pointerup', (e) => {
  if (!drag || e.pointerId !== drag.pointerId) return;
  const d = drag;
  drag = null;
  if (!d.active) {
    toggleSelect(d.id);
    return;
  }
  const target = dropTargetAt(e.clientX, e.clientY);
  cleanupDrag();
  if (target) moveTiles(d.ids, target);
  else render();
});

window.addEventListener('pointercancel', () => {
  if (!drag) return;
  const wasActive = drag.active;
  drag = null;
  if (wasActive) {
    cleanupDrag();
    render();
  }
});

function beginDrag() {
  drag.active = true;
  drag.ids = selected.has(drag.id) ? [...selected].filter(canMove) : [drag.id];
  const ghost = document.createElement('div');
  ghost.className = 'drag-ghost';
  for (const id of drag.ids) {
    ghost.append(tileEl(TILES[id]));
    document.querySelector(`.tile[data-id="${id}"]`)?.classList.add('drag-source');
  }
  document.body.append(ghost);
  drag.ghost = ghost;
  sfx('pick');
}

function positionGhost(x, y) {
  const r = drag.ghost.getBoundingClientRect();
  drag.ghost.style.transform = `translate(${x - Math.min(r.width, 60) / 2}px, ${y - r.height * 0.75}px)`;
}

function cleanupDrag() {
  document.querySelector('.drag-ghost')?.remove();
  setHover(null);
}

function dropTargetAt(x, y) {
  const node = document.elementFromPoint(x, y);
  const zone = node?.closest('[data-drop]');
  if (!zone) return null;
  const kind = zone.dataset.drop;
  if (kind === 'set') return { type: 'set', setId: Number(zone.dataset.setId), node: zone };
  if (kind === 'new' || kind === 'board') return { type: 'new', node: zone };
  if (kind === 'hand') {
    const before = node.closest('.tile[data-id]');
    return { type: 'hand', beforeId: before ? Number(before.dataset.id) : -1, node: zone };
  }
  return null;
}

let hoverNode = null;
function setHover(target) {
  const node = target?.node ?? null;
  if (node === hoverNode) return;
  hoverNode?.classList.remove('drop-hover');
  hoverNode = node;
  hoverNode?.classList.add('drop-hover');
}

function toggleSelect(id) {
  if (selected.has(id)) selected.delete(id);
  else selected.add(id);
  sfx('tick');
  render();
}

// Tap targets: move the current selection.
el.game.addEventListener('click', (e) => {
  if (!isHumanTurn() || e.target.closest('.tile') || e.target.closest('button')) return;
  const zone = e.target.closest('[data-drop]');
  if (!zone || !selected.size) return;
  const kind = zone.dataset.drop;
  if (kind === 'set') moveTiles([...selected], { type: 'set', setId: Number(zone.dataset.setId) });
  else if (kind === 'new') moveTiles([...selected], { type: 'new' });
  else if (kind === 'hand' && [...selected].some((id) => turn.played.has(id))) {
    moveTiles([...selected], { type: 'hand' });
  } else {
    selected.clear();
    render();
  }
});

// ---------------------------------------------------------------- buttons & keys

el.undo.addEventListener('click', undo);
el.reset.addEventListener('click', resetTurn);
el.hint.addEventListener('click', showHint);
el.draw.addEventListener('click', drawAction);
el.end.addEventListener('click', endTurn);
el.sortColor.addEventListener('click', () => setSort('color'));
el.sortNum.addEventListener('click', () => setSort('number'));

function setSort(mode) {
  game.sortMode = mode;
  sfx('tick');
  render();
}

document.addEventListener('keydown', (e) => {
  if (!isHumanTurn() || document.querySelector('dialog[open]')) return;
  if (e.target.matches('input, button')) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    undo();
  } else if (e.key === 'Enter') endTurn();
  else if (e.key === 'Escape') {
    selected.clear();
    render();
  }
});

document.querySelectorAll('[data-open="rules"]').forEach((b) => b.addEventListener('click', () => el.rules.showModal()));

el.menuBtn.addEventListener('click', () => {
  if (!game || game.over) return showSetup();
  el.confirm.returnValue = '';
  el.confirm.showModal();
});
el.confirm.addEventListener('close', () => {
  if (el.confirm.returnValue === 'yes') showSetup();
});

el.gameover.addEventListener('close', () => {
  if (el.gameover.returnValue === 'again') newGame(game.settings);
  else showSetup();
});

el.soundBtn.addEventListener('click', () => {
  setMuted(!isMuted());
  savePrefs();
  updateSoundBtn();
  sfx('tick');
});

function updateSoundBtn() {
  el.soundBtn.textContent = isMuted() ? '🔇' : '🔊';
}

// ---------------------------------------------------------------- screens

function showGame() {
  el.setup.hidden = true;
  el.game.hidden = false;
}

function showSetup() {
  clearTimeout(botTimer);
  el.game.hidden = true;
  el.setup.hidden = false;
  el.continueBtn.hidden = !store.get(SAVE_KEY);
  const stats = store.get(STATS_KEY);
  el.statsLine.textContent = stats?.played
    ? `You’ve won ${stats.won} of ${stats.played} game${stats.played === 1 ? '' : 's'} 💜`
    : '';
}

function savePrefs() {
  const form = new FormData(el.setupForm);
  store.set(PREFS_KEY, {
    name: el.name.value.trim(),
    bots: form.get('bots'),
    difficulty: form.get('difficulty'),
    muted: isMuted(),
  });
}

function loadPrefs() {
  const prefs = store.get(PREFS_KEY);
  if (!prefs) return;
  if (prefs.name) el.name.value = prefs.name;
  for (const field of ['bots', 'difficulty']) {
    const input = el.setupForm.querySelector(`input[name="${field}"][value="${prefs[field]}"]`);
    if (input) input.checked = true;
  }
  setMuted(!!prefs.muted);
}

el.setupForm.addEventListener('submit', (e) => {
  e.preventDefault();
  savePrefs();
  const form = new FormData(el.setupForm);
  newGame({
    name: el.name.value.trim() || 'You',
    bots: Number(form.get('bots')),
    difficulty: form.get('difficulty'),
  });
});

el.continueBtn.addEventListener('click', () => {
  const saved = load();
  if (!saved) {
    el.continueBtn.hidden = true;
    return;
  }
  game = saved;
  recentIds = new Set();
  showGame();
  log('Welcome back!');
  startTurn();
});

loadPrefs();
updateSoundBtn();
showSetup();
