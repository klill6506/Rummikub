// Bot players. Bots search their rack for the best combination of runs and
// groups, then (depending on difficulty) lay off tiles onto the table, borrow
// spare tiles from table sets, and split long runs.

import { COLORS, MIN_NUM, MAX_NUM, INITIAL_MELD, analyzeSet, isValidSet } from './rules.js';

const keyOf = (color, num) => `${color}-${num}`;

const NODE_LIMITS = { easy: 3000, normal: 25000, hard: 60000 };

// Finds a set of disjoint runs/groups from `tiles` that plays as many tiles as
// possible (jokers count a little less, so bots hold them when they can).
// Returns { sets: tile[][], value } — sets is empty if nothing reaches minValue.
export function findBestMelds(tiles, { minValue = 0, nodeLimit = 25000 } = {}) {
  const avail = new Map();
  const jokers = [];
  for (const t of tiles) {
    if (t.joker) jokers.push(t);
    else {
      const k = keyOf(t.color, t.num);
      if (!avail.has(k)) avail.set(k, []);
      avail.get(k).push(t);
    }
  }
  const order = [];
  for (const color of COLORS) {
    for (let n = MIN_NUM; n <= MAX_NUM; n++) order.push(keyOf(color, n));
  }
  const has = (color, num) => (avail.get(keyOf(color, num))?.length ?? 0) > 0;
  const take = (color, num) => avail.get(keyOf(color, num)).pop();
  const give = (t) => avail.get(keyOf(t.color, t.num)).push(t);

  let best = { score: 0, sets: [], value: 0 };
  let nodes = 0;
  const current = [];

  function evaluate(value, naturals, jokersUsed) {
    if (current.length === 0 || value < minValue) return;
    const score = naturals * 10 + jokersUsed * 4 + value * 0.01;
    if (score > best.score) {
      best = { score, sets: current.map((s) => s.slice()), value };
    }
  }

  // Candidate sets that include `tile`, described as needed natural
  // (color, num) pairs plus a joker count.
  function candidates(tile) {
    const out = [];
    const { color, num } = tile;
    const j = jokers.length;
    for (let start = Math.max(MIN_NUM, num - 12); start <= num; start++) {
      let missing = 0;
      const needs = [];
      for (let end = start; end <= MAX_NUM; end++) {
        if (end !== num) {
          if (has(color, end)) needs.push([color, end]);
          else missing++;
        }
        if (end < num) {
          if (missing > j) break;
          continue;
        }
        if (missing > j) break;
        if (end - start + 1 >= 3) out.push({ needs: needs.slice(), jokers: missing });
      }
    }
    const others = COLORS.filter((c) => c !== color && has(c, num));
    const subsets = [[]];
    for (const c of others) {
      for (const s of subsets.slice()) subsets.push([...s, c]);
    }
    for (const s of subsets) {
      const naturals = 1 + s.length;
      for (let len = 3; len <= 4; len++) {
        const need = len - naturals;
        if (need >= 0 && need <= j) out.push({ needs: s.map((c) => [c, num]), jokers: need });
      }
    }
    // Bigger sets first so good answers are found before the node limit.
    out.sort((a, b) => b.needs.length + b.jokers - (a.needs.length + a.jokers) || a.jokers - b.jokers);
    return out;
  }

  function search(value, naturals, jokersUsed) {
    if (++nodes > nodeLimit) return;
    const focusKey = order.find((k) => avail.get(k)?.length);
    if (!focusKey) {
      evaluate(value, naturals, jokersUsed);
      return;
    }
    const tile = avail.get(focusKey).pop();
    for (const cand of candidates(tile)) {
      const used = cand.needs.map(([c, n]) => take(c, n));
      const usedJokers = jokers.splice(0, cand.jokers);
      const set = [tile, ...used, ...usedJokers];
      const v = analyzeSet(set).value;
      current.push(set);
      search(value + v, naturals + 1 + used.length, jokersUsed + usedJokers.length);
      current.pop();
      jokers.unshift(...usedJokers);
      used.forEach(give);
      if (nodes > nodeLimit) break;
    }
    // Leave this tile on the rack.
    search(value, naturals, jokersUsed);
    give(tile);
  }

  search(0, 0, 0);
  return { sets: best.sets, value: best.value };
}

// Plans a bot's turn. Returns { board, played } (board = new table as tile
// arrays, played = ids moved from the rack) or null when the bot should draw.
export function planTurn({ hand, board, hasMelded, difficulty = 'normal' }) {
  const nodeLimit = NODE_LIMITS[difficulty] ?? NODE_LIMITS.normal;
  const { sets } = findBestMelds(hand, { minValue: hasMelded ? 0 : INITIAL_MELD, nodeLimit });

  if (!hasMelded) {
    if (!sets.length) return null;
    return { board: [...board.map((s) => s.slice()), ...sets], played: sets.flat().map((t) => t.id) };
  }

  const newBoard = [...board.map((s) => s.slice()), ...sets];
  const usedIds = new Set(sets.flat().map((t) => t.id));
  let leftover = hand.filter((t) => !usedIds.has(t.id));
  const played = [...usedIds];

  if (difficulty !== 'easy') {
    let changed = true;
    while (changed && leftover.length) {
      changed = false;
      const naturalsLeft = leftover.some((t) => !t.joker);
      for (const tile of leftover.slice()) {
        // Hold jokers unless they're the last tiles on the rack.
        if (tile.joker && naturalsLeft) continue;
        let placed = layOff(newBoard, tile);
        if (!placed && difficulty === 'hard') placed = splitRun(newBoard, tile);
        if (placed) {
          leftover = leftover.filter((t) => t !== tile);
          played.push(tile.id);
          changed = true;
        }
      }
      if (!changed && difficulty === 'hard') {
        const borrowed = borrowToMeld(newBoard, leftover);
        if (borrowed) {
          leftover = leftover.filter((t) => !borrowed.includes(t));
          played.push(...borrowed.map((t) => t.id));
          changed = true;
        }
      }
    }
  }

  if (!played.length) return null;
  return { board: newBoard, played };
}

// Add a tile to the end of any set it extends.
function layOff(board, tile) {
  for (const set of board) {
    if (isValidSet([...set, tile])) {
      set.push(tile);
      return true;
    }
  }
  return false;
}

// Split a run like 3-4-5-6-7 with a duplicate 5 into 3-4-5 and 5-6-7.
function splitRun(board, tile) {
  if (tile.joker) return false;
  for (let i = 0; i < board.length; i++) {
    const info = analyzeSet(board[i]);
    if (info.type !== 'run' || info.ordered.length < 5) continue;
    const idx = info.ordered.findIndex((o) => o.as === tile.num);
    if (idx < 0 || info.ordered[idx].tile.joker) continue;
    if (info.ordered[idx].tile.color !== tile.color) continue;
    const left = info.ordered.slice(0, idx + 1).map((o) => o.tile);
    const right = [tile, ...info.ordered.slice(idx + 1).map((o) => o.tile)];
    if (isValidSet(left) && isValidSet(right)) {
      board.splice(i, 1, left, right);
      return true;
    }
  }
  return false;
}

// Take a spare tile (one whose removal leaves its set valid) from the table
// and combine it with two rack tiles to form a new set.
function borrowToMeld(board, leftover) {
  const naturals = leftover.filter((t) => !t.joker);
  const spares = [];
  board.forEach((set, si) => {
    if (set.length < 4) return;
    set.forEach((t, ti) => {
      if (t.joker) return;
      if (isValidSet(set.filter((_, k) => k !== ti))) spares.push({ si, tile: t });
    });
  });
  for (let a = 0; a < naturals.length; a++) {
    for (let b = a + 1; b < naturals.length; b++) {
      for (const { si, tile } of spares) {
        const trio = [naturals[a], naturals[b], tile];
        if (isValidSet(trio)) {
          board[si] = board[si].filter((t) => t !== tile);
          board.push(trio);
          return [naturals[a], naturals[b]];
        }
      }
    }
  }
  return null;
}
