import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTiles, analyzeSet, validateTurn, handValue } from '../js/rules.js';

let nextId = 1000;
const t = (color, num) => ({ id: nextId++, color, num, joker: false });
const J = () => ({ id: nextId++, color: null, num: 0, joker: true });

test('deck has 106 tiles with 2 jokers', () => {
  const tiles = createTiles();
  assert.equal(tiles.length, 106);
  assert.equal(tiles.filter((x) => x.joker).length, 2);
  assert.deepEqual(tiles.map((x) => x.id), tiles.map((_, i) => i));
});

test('valid runs', () => {
  assert.equal(analyzeSet([t('red', 3), t('red', 4), t('red', 5)]).type, 'run');
  assert.equal(analyzeSet([t('red', 5), t('red', 3), t('red', 4)]).value, 12);
  assert.ok(analyzeSet([t('blue', 11), t('blue', 12), t('blue', 13)]).valid);
});

test('invalid runs', () => {
  assert.ok(!analyzeSet([t('red', 3), t('red', 4)]).valid);
  assert.ok(!analyzeSet([t('red', 3), t('blue', 4), t('red', 5)]).valid);
  assert.ok(!analyzeSet([t('red', 3), t('red', 4), t('red', 6)]).valid);
  assert.ok(!analyzeSet([t('red', 12), t('red', 13), t('red', 1)]).valid, 'no wrap-around');
  assert.ok(!analyzeSet([t('red', 3), t('red', 3), t('red', 4)]).valid);
});

test('groups', () => {
  const g = analyzeSet([t('red', 7), t('blue', 7), t('green', 7)]);
  assert.equal(g.type, 'group');
  assert.equal(g.value, 21);
  assert.ok(analyzeSet([t('red', 7), t('blue', 7), t('green', 7), t('black', 7)]).valid);
  assert.ok(!analyzeSet([t('red', 7), t('red', 7), t('green', 7)]).valid, 'duplicate color');
  assert.ok(!analyzeSet([t('red', 7), t('blue', 7), t('green', 7), t('black', 7), J()]).valid, 'max 4');
});

test('jokers fill gaps and extend runs upward', () => {
  const gap = analyzeSet([t('red', 3), J(), t('red', 5)]);
  assert.ok(gap.valid);
  assert.deepEqual(gap.ordered.map((o) => o.as), [3, 4, 5]);

  const up = analyzeSet([t('red', 5), t('red', 6), J()]);
  assert.deepEqual(up.ordered.map((o) => o.as), [5, 6, 7]);

  const down = analyzeSet([t('red', 12), t('red', 13), J()]);
  assert.deepEqual(down.ordered.map((o) => o.as), [11, 12, 13]);

  assert.ok(analyzeSet([t('blue', 9), t('red', 9), J()]).valid, 'joker in group');
  assert.ok(analyzeSet([t('blue', 9), J(), J()]).valid);
});

test('ambiguous joker sets score their best reading', () => {
  // 5 + J + J: group = 15, run 5-6-7 = 18
  const s = analyzeSet([t('red', 5), J(), J()]);
  assert.equal(s.type, 'run');
  assert.equal(s.value, 18);
});

test('hand value counts jokers as 30', () => {
  assert.equal(handValue([t('red', 5), J()]), 35);
});

test('initial meld must reach 30 points', () => {
  const low = [t('red', 1), t('red', 2), t('red', 3)];
  let r = validateTurn({ startBoard: [], board: [low], playedIds: low.map((x) => x.id), hasMelded: false });
  assert.equal(r.ok, false);
  assert.match(r.error, /30/);

  const high = [t('red', 10), t('blue', 10), t('green', 10)];
  r = validateTurn({ startBoard: [], board: [high], playedIds: high.map((x) => x.id), hasMelded: false });
  assert.equal(r.ok, true);
  assert.equal(r.meldValue, 30);
});

test('initial meld cannot touch existing sets', () => {
  const existing = [t('red', 1), t('red', 2), t('red', 3)];
  const mine = t('red', 4);
  const meld = [t('blue', 10), t('green', 10), t('black', 10)];
  const r = validateTurn({
    startBoard: [existing],
    board: [[...existing, mine], meld],
    playedIds: [mine.id, ...meld.map((x) => x.id)],
    hasMelded: false,
  });
  assert.equal(r.ok, false);
});

test('after melding you can rearrange the table', () => {
  const a = [t('red', 1), t('red', 2), t('red', 3), t('red', 4)];
  const b = [t('blue', 4), t('green', 4)];
  const mine = t('black', 4);
  const r = validateTurn({
    startBoard: [a],
    board: [a.slice(0, 3), [a[3], ...b]],
    playedIds: [...b.map((x) => x.id)],
    hasMelded: true,
  });
  assert.equal(r.ok, true);
  void mine;
});

test('turn fails with an invalid set or no tiles played', () => {
  const a = [t('red', 1), t('red', 2), t('red', 3)];
  assert.equal(validateTurn({ startBoard: [a], board: [a], playedIds: [], hasMelded: true }).ok, false);
  const bad = [t('blue', 4), t('green', 9)];
  const r = validateTurn({ startBoard: [a], board: [a, bad], playedIds: bad.map((x) => x.id), hasMelded: true });
  assert.equal(r.ok, false);
});

test('table tiles cannot go back to a rack', () => {
  const a = [t('red', 1), t('red', 2), t('red', 3), t('red', 4)];
  const mine = [t('blue', 7), t('green', 7), t('black', 7)];
  const r = validateTurn({
    startBoard: [a],
    board: [a.slice(0, 3), mine],
    playedIds: mine.map((x) => x.id),
    hasMelded: true,
  });
  assert.equal(r.ok, false);
});
