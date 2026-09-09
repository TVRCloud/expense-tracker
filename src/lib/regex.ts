// Escapes regex metacharacters so a user-controlled string can be used as a
// literal substring match inside a RegExp (or MongoDB $regex) without being
// interpreted as a pattern — prevents both semantic surprises (e.g. `.` or
// `|` matching more than intended) and catastrophic-backtracking ReDoS
// patterns like `(a+)+$`.
export function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
