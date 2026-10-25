// The Idempotency-Key of a move in the dialog. One key stands for one move: the same
// destination, amount and overdraw switch. A retry of that move (after a timeout, a
// dropped connection or a 5xx, where the first try may have run) must reuse the key so
// the server replays instead of moving twice. A different move gets a new key, but only
// at the moment it is sent, never while an earlier request may still be in flight (the
// form is disabled then). A definite refusal ends the attempt, so the next send is new.
export type MoveTuple = { to: string; amount: number; allowOverdraw: boolean };

export function createMoveKey(newKey: () => string = () => crypto.randomUUID()) {
  let key = newKey();
  let sent: string | null = null;
  const tag = (t: MoveTuple) => `${t.to}|${t.amount}|${t.allowOverdraw}`;
  return {
    /** The key to send this move with. Call once per send. */
    keyFor(move: MoveTuple): string {
      const next = tag(move);
      if (sent !== null && sent !== next) key = newKey();
      sent = next;
      return key;
    },
    /** The server refused outright: nothing ran, so the next send starts a new attempt. */
    refused() {
      key = newKey();
      sent = null;
    },
  };
}

/**
 * The keys of every move in flight or unsettled, by month and source envelope. It lives
 * above the dialog so closing and reopening the dialog (or a second submit after an
 * ambiguous failure) finds the same key; an entry goes only when the move succeeded.
 */
export function createMoveKeys(newKey?: () => string) {
  const byMove = new Map<string, ReturnType<typeof createMoveKey>>();
  return {
    get(id: string) {
      let keys = byMove.get(id);
      if (!keys) byMove.set(id, (keys = createMoveKey(newKey)));
      return keys;
    },
    /** The move went through: the next one from here starts fresh. */
    done(id: string) {
      byMove.delete(id);
    },
  };
}
