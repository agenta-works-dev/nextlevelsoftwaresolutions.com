const normalize = (s) =>
  String(s).normalize("NFKC").replace(/\s+/g, " ").trim().toUpperCase();
const tokens = (s) => normalize(s).match(/[\p{L}\p{N}]+/gu) || [];
// PDF table labels can wrap across separately anchored text rows. Preserve all
// cited locations and allow their words in reading order; never invent words.
export function printedSpanPresent(value, quotations, allowWrapped = true) {
  const wanted = normalize(value);
  if (!wanted) return false;
  if (quotations.some((quote) => normalize(quote).includes(wanted)))
    return true;
  if (!allowWrapped || quotations.length < 2) return false;
  const needle = tokens(value),
    haystack = tokens(quotations.join(" "));
  let at = 0;
  for (const word of haystack) if (word === needle[at]) at++;
  return needle.length > 0 && at === needle.length;
}
