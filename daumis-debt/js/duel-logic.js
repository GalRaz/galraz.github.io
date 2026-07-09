// Pure decision logic for weekly duels, kept free of Firebase/DOM imports so
// it can be unit-tested in Node (see duel-logic.test.mjs).

/**
 * Given this week's duel docs (plain data objects) and a user's uid, decide
 * whether that user has already played this week.
 *
 * @param {Array<object>} duelDocsData - `.data()` of each duel doc for the week
 * @param {string} uid - the user we're checking
 * @returns {boolean}
 */
export function hasPlayedThisWeek(duelDocsData, uid) {
  return duelDocsData.some((d) => {
    // Single-player games (coin-flip / wheel / scratch-card) record a
    // per-player doc tagged with playedBy — it gates ONLY that player.
    if (d.playedBy) return d.playedBy === uid;
    // A shared two-player duel (rps / lucky-number) has no playedBy. Once its
    // result is set the week is resolved for BOTH partners.
    if (d.result) return true;
    // Two-player duel still pending: whoever has submitted is done.
    if (d.submissions && d.submissions[uid] != null) return true;
    return false;
  });
}
