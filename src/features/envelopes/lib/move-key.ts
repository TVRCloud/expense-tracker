// The Idempotency-Key of a move. One key stands for one exact move (month, source,
// destination, amount and the overdraw switch), and it is kept until that move is
// SETTLED: it succeeded, or the server refused it outright. Everything in between (a
// timeout, a dropped connection, a 5xx, an in-progress conflict) may have moved the
// money, so a resend of that move must use the same key and be replayed, not run again.
// A different move gets its own key, and going back to an earlier unsettled move finds
// its key again. The store is module scope, not component state: leaving the page
// mid-request must not forget the key, and the mutation (not a per-call callback)
// settles it. It holds at most MAX_UNSETTLED keys; the oldest go first.
export type MoveSpec = { month: string; from: string; to: string; amount: number; allowOverdraw: boolean };

export const MAX_UNSETTLED = 200;

const idOf = (m: MoveSpec) => JSON.stringify([m.month, m.from, m.to, m.amount, m.allowOverdraw]);

export function createMoveKeys(newKey: () => string = () => crypto.randomUUID()) {
  const keys = new Map<string, string>();
  return {
    /** The key for this move: the one it already has, or a new one. */
    keyFor(move: MoveSpec): string {
      const id = idOf(move);
      let key = keys.get(id);
      if (key === undefined) {
        key = newKey();
        keys.set(id, key);
        if (keys.size > MAX_UNSETTLED) keys.delete(keys.keys().next().value as string);
      }
      return key;
    },
    /** The move went through or was refused outright: nothing is pending under its key any more. */
    settle(move: MoveSpec) {
      keys.delete(idOf(move));
    },
    /** The person checked the plan and wants to send this move again as a new request. */
    startOver(move: MoveSpec) {
      keys.delete(idOf(move));
    },
    size: () => keys.size,
  };
}

/** The one store the move dialog and its mutation share. */
export const moveKeys = createMoveKeys();
