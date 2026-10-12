// Core Rummikub rules: tiles, set validation, scoring and turn validation.
// Pure functions only — no DOM — so both the UI and the bots (and tests) share them.

export const COLORS = ['red', 'blue', 'green', 'black'];
export const MIN_NUM = 1;
export const MAX_NUM = 13;
export const HAND_SIZE = 14;
export const INITIAL_MELD = 30;
export const JOKER_PENALTY = 30;

export function createTiles() {
  const tiles = [];
  let id = 0;
  for (let copy = 0; copy < 2; copy++) {
    for (const color of COLORS) {
      for (let num = MIN_NUM; num <= MAX_NUM; num++) {
        tiles.push({ id: id++, color, num, joker: false });
      }
    }
  }
  tiles.push({ id: id++, color: null, num: 0, joker: true });
  tiles.push({ id: id++, color: null, num: 0, joker: true });
  return tiles;
}

export function shuffle(arr, rng = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const colorIndex = (c) => COLORS.indexOf(c);

export function compareByColor(a, b) {
  if (a.joker !== b.joker) return a.joker ? 1 : -1;
  return colorIndex(a.color) - colorIndex(b.color) || a.num - b.num || a.id - b.id;
}

export function compareByNumber(a, b) {
  if (a.joker !== b.joker) return a.joker ? 1 : -1;
  return a.num - b.num || colorIndex(a.color) - colorIndex(b.color) || a.id - b.id;
}

// A group: 3–4 tiles of the same number, all different colours.
function analyzeGroup(tiles) {
  if (tiles.length < 3 || tiles.length > 4) return null;
  const naturals = tiles.filter((t) => !t.joker);
  const jokers = tiles.filter((t) => t.joker);
  if (naturals.length === 0) return null;
  const num = naturals[0].num;
  if (naturals.some((t) => t.num !== num)) return null;
  if (new Set(naturals.map((t) => t.color)).size !== naturals.length) return null;
  const ordered = naturals
    .slice()
    .sort(compareByColor)
    .map((tile) => ({ tile, as: num }))
    .concat(jokers.map((tile) => ({ tile, as: num })));
  return { valid: true, type: 'group', value: num * tiles.length, ordered };
}

// A run: 3+ consecutive numbers of one colour. Jokers fill gaps first, then
// extend the run upward (worth more points), then downward.
function analyzeRun(tiles) {
  if (tiles.length < 3 || tiles.length > MAX_NUM) return null;
  const naturals = tiles.filter((t) => !t.joker).sort((a, b) => a.num - b.num);
  const jokers = tiles.filter((t) => t.joker);
  if (naturals.length === 0) return null;
  const color = naturals[0].color;
  if (naturals.some((t) => t.color !== color)) return null;
  for (let i = 1; i < naturals.length; i++) {
    if (naturals[i].num === naturals[i - 1].num) return null;
  }
  const lo = naturals[0].num;
  const hi = naturals[naturals.length - 1].num;
  const gaps = hi - lo + 1 - naturals.length;
  if (jokers.length < gaps) return null;
  const extra = jokers.length - gaps;
  const up = Math.min(extra, MAX_NUM - hi);
  const start = lo - (extra - up);
  if (start < MIN_NUM) return null;

  const byNum = new Map(naturals.map((t) => [t.num, t]));
  const spare = jokers.slice();
  const ordered = [];
  let value = 0;
  for (let n = start; n < start + tiles.length; n++) {
    ordered.push({ tile: byNum.get(n) ?? spare.pop(), as: n });
    value += n;
  }
  return { valid: true, type: 'run', value, ordered };
}

// Returns { valid, type, value, ordered: [{ tile, as }] }. When both a group
// and a run reading are possible (only with jokers), the higher value wins.
export function analyzeSet(tiles) {
  const group = analyzeGroup(tiles);
  const run = analyzeRun(tiles);
  if (group && run) return run.value >= group.value ? run : group;
  if (group || run) return group || run;
  return {
    valid: false,
    type: null,
    value: 0,
    ordered: tiles.slice().sort(compareByNumber).map((tile) => ({ tile, as: tile.num })),
  };
}

export function isValidSet(tiles) {
  return analyzeSet(tiles).valid;
}

export function tileValue(tile) {
  return tile.joker ? JOKER_PENALTY : tile.num;
}

export function handValue(tiles) {
  return tiles.reduce((sum, t) => sum + tileValue(t), 0);
}

const setKey = (tiles) =>
  tiles
    .map((t) => t.id)
    .sort((a, b) => a - b)
    .join(',');

// Validates the table at the end of a human or bot turn.
//   startBoard / board: arrays of tile arrays
//   playedIds: ids of tiles that moved from the player's hand to the table
export function validateTurn({ startBoard, board, playedIds, hasMelded }) {
  const played = new Set(playedIds);
  if (played.size === 0) {
    return { ok: false, error: 'Play at least one tile from your rack, or draw a tile.' };
  }

  const boardIds = new Set(board.flat().map((t) => t.id));
  for (const t of startBoard.flat()) {
    if (!boardIds.has(t.id)) {
      return { ok: false, error: 'Tiles already on the table must stay on the table.' };
    }
  }
  for (const id of played) {
    if (!boardIds.has(id)) return { ok: false, error: 'Played tiles are missing from the table.' };
  }

  const invalid = board.filter((set) => !isValidSet(set));
  if (invalid.length) {
    return {
      ok: false,
      error:
        invalid.length === 1
          ? 'One set on the table is not a valid run or group.'
          : `${invalid.length} sets on the table are not valid runs or groups.`,
      invalidCount: invalid.length,
    };
  }

  if (!hasMelded) {
    // Initial meld: the existing table must be untouched and the new sets
    // must be made only from your own tiles, worth 30+ points.
    const remaining = new Map();
    for (const set of board) {
      const k = setKey(set);
      remaining.set(k, (remaining.get(k) || 0) + 1);
    }
    for (const set of startBoard) {
      const k = setKey(set);
      const count = remaining.get(k) || 0;
      if (count === 0) {
        return {
          ok: false,
          error: 'You can’t rearrange the table until you’ve made your initial meld.',
        };
      }
      remaining.set(k, count - 1);
    }
    const newSets = board.filter((set) => set.some((t) => played.has(t.id)));
    const meldValue = newSets.reduce((sum, set) => sum + analyzeSet(set).value, 0);
    if (meldValue < INITIAL_MELD) {
      return {
        ok: false,
        error: `Your initial meld is worth ${meldValue} points — it needs at least ${INITIAL_MELD}.`,
        meldValue,
      };
    }
    return { ok: true, meldValue };
  }

  return { ok: true };
}
