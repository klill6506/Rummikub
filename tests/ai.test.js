import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTiles, shuffle, validateTurn, isValidSet, INITIAL_MELD } from '../js/rules.js';
import { findBestMelds, planTurn } from '../js/ai.js';

let nextId = 2000;
const t = (color, num) => ({ id: nextId++, color, num, joker: false });
const J = () => ({ id: nextId++, color: null, num: 0, joker: true });

function seeded(seed) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

test('finds runs and groups in a rack', () => {
  const hand = [t('red', 3), t('red', 4), t('red', 5), t('blue', 9), t('green', 9), t('black', 9), t('blue', 1)];
  const { sets } = findBestMelds(hand);
  assert.equal(sets.flat().length, 6);
  assert.ok(sets.every(isValidSet));
});

test('respects the initial meld minimum', () => {
  const hand = [t('red', 1), t('red', 2), t('red', 3), t('blue', 2)];
  assert.equal(findBestMelds(hand, { minValue: INITIAL_MELD }).sets.length, 0);
  assert.equal(planTurn({ hand, board: [], hasMelded: false }), null);
});

test('uses jokers to complete sets', () => {
  const hand = [t('red', 10), t('red', 12), J(), t('blue', 1)];
  const { sets, value } = findBestMelds(hand, { minValue: INITIAL_MELD });
  assert.equal(sets.length, 1);
  assert.equal(value, 33);
});

test('lays off tiles onto the table after melding', () => {
  const board = [[t('red', 3), t('red', 4), t('red', 5)]];
  const six = t('red', 6);
  const plan = planTurn({ hand: [six, t('blue', 13)], board, hasMelded: true });
  assert.deepEqual(plan.played, [six.id]);
});

test('hard bots split runs', () => {
  const board = [[t('red', 3), t('red', 4), t('red', 5), t('red', 6), t('red', 7)]];
  const five = t('red', 5);
  const plan = planTurn({ hand: [five], board, hasMelded: true, difficulty: 'hard' });
  assert.ok(plan);
  assert.equal(plan.board.length, 2);
  assert.ok(plan.board.every(isValidSet));
});

test('bot plans are always legal across many random racks', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const pool = shuffle(createTiles(), seeded(seed));
    const board = [];
    const hands = [pool.splice(0, 20), pool.splice(0, 20)];
    const melded = [false, false];
    for (let round = 0; round < 6; round++) {
      for (let p = 0; p < 2; p++) {
        const difficulty = ['easy', 'normal', 'hard'][(seed + p) % 3];
        const plan = planTurn({ hand: hands[p], board, hasMelded: melded[p], difficulty });
        if (!plan) {
          if (pool.length) hands[p].push(pool.pop());
          continue;
        }
        const res = validateTurn({ startBoard: board, board: plan.board, playedIds: plan.played, hasMelded: melded[p] });
        assert.ok(res.ok, `seed ${seed}: ${res.error}`);
        const played = new Set(plan.played);
        hands[p] = hands[p].filter((x) => !played.has(x.id));
        board.splice(0, board.length, ...plan.board);
        melded[p] = true;
      }
    }
  }
});
