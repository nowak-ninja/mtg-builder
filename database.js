"use strict";

const CardDatabase = (() => {
  const normalize = name => name.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  // Older snapshots did not store layout; Art Series still have the distinctive type line.
  const isArtSeries = card => card.layout === "art_series" || /^Card(?:\s*\/\/\s*Card)?$/.test(card.type_line || "");
  let database;

  function open() {
    if (!database) database = new Promise((resolve, reject) => {
      const request = indexedDB.open("mtg-builder-cards", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("data");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return database;
  }

  async function read() {
    const db = await open();
    const snapshot = await new Promise((resolve, reject) => {
      const request = db.transaction("data").objectStore("data").get("snapshot");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return snapshot ? index(snapshot) : null;
  }

  async function save(snapshot, signal) {
    const db = await open();
    signal?.throwIfAborted();
    await new Promise((resolve, reject) => {
      const transaction = db.transaction("data", "readwrite");
      const abort = () => transaction.abort();
      signal?.addEventListener("abort", abort, { once: true });
      transaction.oncomplete = () => { signal?.removeEventListener("abort", abort); resolve(); };
      transaction.onabort = transaction.onerror = () => {
        signal?.removeEventListener("abort", abort);
        reject(transaction.error || new Error("Zapis bazy został przerwany."));
      };
      // One atomic replacement keeps the old database intact if import or storage fails.
      transaction.objectStore("data").put(snapshot, "snapshot");
    });
  }

  function compact(card) {
    if (card.object !== "card" || !card.id || !card.name || !card.rarity || !card.set || !card.collector_number) {
      throw new Error("Niepoprawny rekord w bazie Scryfall.");
    }
    const result = {};
    for (const key of ["id", "oracle_id", "name", "printed_name", "set", "collector_number", "rarity", "colors", "type_line", "released_at", "lang", "games", "layout"]) {
      if (card[key] !== undefined) result[key] = card[key];
    }
    if (card.image_uris?.normal) result.image_uris = { normal: card.image_uris.normal };
    if (card.card_faces) result.card_faces = card.card_faces.map(face => {
      const result = { name: face.name, printed_name: face.printed_name, colors: face.colors, type_line: face.type_line };
      if (face.image_uris?.normal) result.image_uris = { normal: face.image_uris.normal };
      return result;
    });
    return result;
  }

  function index(snapshot) {
    const byName = new Map();
    const byEdition = new Map();
    const rarities = new Map();
    for (const card of snapshot.cards) {
      if (isArtSeries(card)) continue;
      const names = [card.name, card.printed_name, ...(card.card_faces || []).flatMap(face => [face.name, face.printed_name])];
      for (const name of new Set(names.filter(Boolean).map(normalize))) {
        if (!byName.has(name)) byName.set(name, []);
        byName.get(name).push(card);
      }
      byEdition.set(`${card.set}/${card.collector_number}`, card);
      if (card.oracle_id && card.games?.includes("paper")) {
        if (!rarities.has(card.oracle_id)) rarities.set(card.oracle_id, new Set());
        rarities.get(card.oracle_id).add(card.rarity);
      }
    }
    for (const [id, values] of rarities) rarities.set(id, [...values]);
    return {
      count: snapshot.cards.length, updatedAt: snapshot.updatedAt, rarities,
      lookup(entry) {
        const candidates = entry.set && entry.number
          ? [byEdition.get(`${entry.set}/${entry.number}`)].filter(Boolean)
          : (byName.get(normalize(entry.name)) || []).filter(card => !entry.set || card.set === entry.set);
        // Prefer paper cards, then the oldest printing; collector number breaks date ties.
        return candidates.sort((a, b) => Number(b.games?.includes("paper")) - Number(a.games?.includes("paper"))
          || (a.released_at || "9999").localeCompare(b.released_at || "9999")
          || a.collector_number.localeCompare(b.collector_number, "en", { numeric: true }))[0];
      }
    };
  }

  async function* jsonLines(stream) {
    const reader = stream.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const lines = (buffer + value).split("\n");
        buffer = lines.pop();
        for (const line of lines) if (line.trim()) yield JSON.parse(line);
      }
      if (buffer.trim()) yield JSON.parse(buffer);
    } finally { await reader.cancel(); reader.releaseLock(); }
  }

  async function download(metadata, progress, signal) {
    // Scryfall now publishes gzipped JSONL. Stream it instead of loading the raw dump into RAM.
    if (!/^https:\/\/data\.scryfall\.io\//.test(metadata.jsonl_download_uri || "")) throw new Error("Nieznany format pliku bazy Scryfall.");
    await open(); // Fail before downloading if browser storage is unavailable.
    const response = await fetch(metadata.jsonl_download_uri, { signal });
    if (!response.ok) throw new Error(`Pobieranie bazy: HTTP ${response.status}`);
    let bytes = 0;
    const compressed = response.body.pipeThrough(new TransformStream({ transform(chunk, controller) {
      bytes += chunk.byteLength;
      controller.enqueue(chunk);
    } }));
    const cards = [];
    for await (const card of jsonLines(compressed.pipeThrough(new DecompressionStream("gzip")))) {
      signal?.throwIfAborted();
      cards.push(compact(card));
      if (cards.length % 2000 === 0) {
        progress(bytes, metadata.compressed_size, cards.length);
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }
    if (!cards.length) throw new Error("Pobrana baza jest pusta.");
    signal?.throwIfAborted();
    progress(bytes, metadata.compressed_size, cards.length, true);
    const snapshot = { updatedAt: metadata.updated_at, cards };
    await save(snapshot, signal);
    return index(snapshot);
  }

  return { read, download, compact, index, jsonLines, isArtSeries };
})();

if (typeof module !== "undefined") module.exports = CardDatabase;
