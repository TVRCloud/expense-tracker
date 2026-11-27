// Mathematical sans-serif bold, the styled letters some bank alerts use.
export function styled(text: string): string {
  return [...text]
    .map((c) => {
      const code = c.codePointAt(0)!;
      if (c >= "A" && c <= "Z") return String.fromCodePoint(0x1d5d4 + code - 65);
      if (c >= "a" && c <= "z") return String.fromCodePoint(0x1d5ee + code - 97);
      if (c >= "0" && c <= "9") return String.fromCodePoint(0x1d7ec + code - 48);
      return c;
    })
    .join("");
}
