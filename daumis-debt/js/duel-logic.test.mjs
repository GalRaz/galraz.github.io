// Pure-logic tests for the duel "has this user played?" gate.
// Run with: node js/duel-logic.test.mjs
import { hasPlayedThisWeek } from './duel-logic.js';
import assert from 'node:assert/strict';

const GAL = 'gal-uid';
const DAUM = 'daum-uid';

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`  ok - ${name}`);
}

// --- Single-player games (coin-flip / wheel / scratch-card) ---
// recordDuelResult() writes a per-player doc: playedBy set, result set,
// submissions null. It must gate ONLY the player who played it.
const galCoinFlip = {
  game: 'Coin Flip', playedBy: GAL, result: { side: 'heads' },
  favoredUser: GAL, submissions: null,
};

test('single-player: player who flipped is done', () => {
  assert.equal(hasPlayedThisWeek([galCoinFlip], GAL), true);
});

test('single-player: partner who has NOT played can still play (regression)', () => {
  // This is the reported bug: Gal's coin flip hid the duel for Daum.
  assert.equal(hasPlayedThisWeek([galCoinFlip], DAUM), false);
});

// --- Two-player games (rps / lucky-number) ---
// Shared doc with submissions from both; no playedBy. Once result is set the
// week is done for BOTH.
const rpsResolved = {
  game: 'Rock Paper Scissors',
  submissions: { [GAL]: 'rock', [DAUM]: 'scissors' },
  result: { [GAL]: 'rock', [DAUM]: 'scissors' },
  favoredUser: GAL,
};

test('two-player resolved: both partners are done', () => {
  assert.equal(hasPlayedThisWeek([rpsResolved], GAL), true);
  assert.equal(hasPlayedThisWeek([rpsResolved], DAUM), true);
});

const rpsPending = {
  game: 'Rock Paper Scissors',
  submissions: { [GAL]: 'rock' },
  result: null,
  favoredUser: null,
};

test('two-player pending: submitter is done, partner still plays', () => {
  assert.equal(hasPlayedThisWeek([rpsPending], GAL), true);
  assert.equal(hasPlayedThisWeek([rpsPending], DAUM), false);
});

// --- No docs yet ---
test('no duels this week: nobody has played', () => {
  assert.equal(hasPlayedThisWeek([], GAL), false);
});

console.log(`\n${passed} passed`);
