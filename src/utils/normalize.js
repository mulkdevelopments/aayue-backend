const normalizeBrandName = (value) => {
  if (value === undefined || value === null) return null;
  const superscripts = "¹²³⁴⁵⁶⁷⁸⁹⁰";
  const digits = "1234567890";
  const replacedSuperscripts = String(value)
    .split("")
    .map((ch) => {
      const idx = superscripts.indexOf(ch);
      return idx === -1 ? ch : digits[idx];
    })
    .join("");

  const normalized = replacedSuperscripts
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  return normalized || null;
};

module.exports = {
  normalizeBrandName,
};
