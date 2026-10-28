// Exact decimal/rational arithmetic. Financial comparisons never use binary floats.
const gcd = (a, b) => {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b) [a, b] = [b, a % b];
  return a;
};
export function rational(n, d = 1n) {
  if (d === 0n) throw new Error("Division by zero");
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  const g = gcd(n, d) || 1n;
  return { n: n / g, d: d / g };
}
export function decimal(value) {
  const s = String(value ?? "").trim();
  if (!/^-?\d{1,12}(?:\.\d{1,6})?$/.test(s)) return null;
  const [whole, fraction = ""] = s.split(".");
  const sign = s.startsWith("-") ? -1n : 1n;
  return rational(
    sign * BigInt(whole.replace("-", "") + fraction),
    10n ** BigInt(fraction.length),
  );
}
export const add = (a, b) => rational(a.n * b.d + b.n * a.d, a.d * b.d);
export const subtract = (a, b) => rational(a.n * b.d - b.n * a.d, a.d * b.d);
export const multiply = (a, b) => rational(a.n * b.n, a.d * b.d);
export const divide = (a, b) => rational(a.n * b.d, a.d * b.n);
export function conversionFactor(value) {
  const plain = decimal(value);
  if (plain) return plain;
  const parts = String(value ?? "")
    .trim()
    .split("/");
  if (parts.length !== 2) return null;
  const numerator = decimal(parts[0].trim()),
    denominator = decimal(parts[1].trim());
  return numerator && denominator && numerator.n > 0n && denominator.n > 0n
    ? divide(numerator, denominator)
    : null;
}
export const equal = (a, b) => Boolean(a && b && a.n * b.d === b.n * a.d);
export const positive = (a) => Boolean(a && a.n > 0n);
export const nonnegative = (a) => Boolean(a && a.n >= 0n);
export const sum = (values) => values.reduce(add, rational(0n));
export function display(value, places = 6, minimum = 0) {
  if (!value) return "Not determined";
  const sign = value.n < 0n ? "−" : "";
  const n = value.n < 0n ? -value.n : value.n;
  const factor = 10n ** BigInt(places);
  const rounded = (n * factor * 2n + value.d) / (2n * value.d);
  const digits = String(rounded).padStart(places + 1, "0");
  if (!places) return sign + digits;
  const fraction = digits
    .slice(-places)
    .replace(/0+$/, "")
    .padEnd(minimum, "0");
  return `${sign}${digits.slice(0, -places)}${fraction ? "." + fraction : ""}`;
}
export function canonicalText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}
export function canonicalUnit(value) {
  const v = canonicalText(value).replace(/\.$/, "");
  return (
    {
      EA: "EA",
      EACH: "EA",
      PC: "EA",
      PCS: "EA",
      PIECE: "EA",
      PIECES: "EA",
      KG: "KG",
      KGS: "KG",
      KILOGRAM: "KG",
      KILOGRAMS: "KG",
      LB: "LB",
      LBS: "LB",
      POUND: "LB",
      POUNDS: "LB",
    }[v] || v
  );
}
export function isoDate(value) {
  const s = String(value ?? "");
  if (!/^(?:19|20|21)\d{2}-\d{2}-\d{2}$/.test(s)) return null;
  const date = new Date(s + "T00:00:00Z");
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === s
    ? s
    : null;
}
export function ambiguousDate(raw) {
  const m = String(raw ?? "").match(
    /\b(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2}|\d{4})\b/,
  );
  return Boolean(m && +m[1] <= 12 && +m[2] <= 12 && +m[1] !== +m[2]);
}
export const dayDifference = (a, b) =>
  Math.round(
    (Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000,
  );
