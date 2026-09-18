"use strict";

const Collection = (() => {
  const normalize = name => name.normalize("NFD").replace(/\p{M}/gu, "").replace(/[‘’]/g, "'").trim().replace(/\s+/g, " ").toLowerCase();
  const aliases = name => [name, ...name.split(/\s*\/\/\s*/)].map(normalize).filter(Boolean);

  function parse(text) {
    const rows = [];
    let row = [], field = "", quoted = false, closed = false;
    text = text.replace(/^\uFEFF/, "");
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (quoted) {
        if (char === '"' && text[i + 1] === '"') { field += '"'; i++; }
        else if (char === '"') { quoted = false; closed = true; }
        else field += char;
      } else if (char === ',' || char === '\n' || char === '\r') {
        row.push(field); field = ""; closed = false;
        if (char !== ',') {
          if (row.some(value => value.trim())) rows.push(row);
          row = [];
          if (char === '\r' && text[i + 1] === '\n') i++;
        }
      } else if (char === '"' && !field && !closed) quoted = true;
      else {
        if (closed || char === '"') throw new Error("Niepoprawne cudzysłowy w CSV.");
        field += char;
      }
    }
    if (quoted) throw new Error("Niezamknięty cudzysłów w CSV.");
    row.push(field);
    if (row.some(value => value.trim())) rows.push(row);
    const header = rows.shift()?.map(value => value.trim().toLowerCase()) || [];
    const nameColumn = header.indexOf("card_name"), amountColumn = header.indexOf("amount");
    if (nameColumn < 0 || amountColumn < 0) throw new Error("Wymagany CSV Deckstats z kolumnami card_name i amount.");
    const names = new Set();
    for (const [index, values] of rows.entries()) {
      const name = values[nameColumn]?.trim(), amount = values[amountColumn]?.trim();
      if (values.length !== header.length || !name || !/^\d+$/.test(amount || "") || !Number.isSafeInteger(Number(amount))) {
        throw new Error(`Niepoprawny wpis CSV nr ${index + 1}. Sprawdź nazwę i liczbę sztuk.`);
      }
      if (Number(amount) > 0) names.add(name);
    }
    if (!rows.length) throw new Error("CSV nie zawiera wpisów kolekcji.");
    return { names: [...names], importedAt: new Date().toISOString() };
  }

  function index(snapshot) {
    const names = new Set(snapshot.names.flatMap(aliases));
    return {
      count: snapshot.names.length,
      has(card) {
        return [card.name, card.printed_name, ...(card.card_faces || []).flatMap(face => [face.name, face.printed_name])]
          .filter(Boolean).flatMap(aliases).some(name => names.has(name));
      }
    };
  }
  return { parse, index };
})();

if (typeof module !== "undefined") module.exports = Collection;
