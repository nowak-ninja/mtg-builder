"use strict";

const COLOR_ORDER = ["G", "B", "U", "W", "R", "C", "M"];
const RARITIES = ["common", "uncommon", "rare", "mythic", "special", "bonus"];
const GROUP_LABELS = ["Common", "Uncommon", "Rare + mythic", "Non-basic landy · Common + uncommon", "Non-basic landy · Rare + mythic", "Basic landy", "Tokeny"];
const alphabet = new Intl.Collator("en", { sensitivity: "base" });
const cardDatabase = typeof module !== "undefined" ? require("./database.js") : CardDatabase;

function parseDeck(text) {
  const entries = new Map();
  const errors = [];
  let excludedSection = false;
  text.split(/\r?\n/).forEach((raw, index) => {
    let line = raw.trim();
    if (!line || /^(#|\/\/)/.test(line)) return;
    const heading = line.replace(/[:\s]+$/, "");
    if (/^(sideboard|maybeboard|considering)(?:\s*\(\d+\))?$/i.test(heading)) { excludedSection = true; return; }
    if (/^(deck|mainboard|commander|companion)(?:\s*\(\d+\))?$/i.test(heading)) { excludedSection = false; return; }
    if (excludedSection || /^SB:/i.test(line)) return;
    if (/^(creatures?|instants?|sorceries|artifacts?|enchantments?|planeswalkers?|lands?|battles?)\s*(?:\(\d+\))?:?$/i.test(line)) return;
    line = line.replace(/\s+#.*$/, "").replace(/\s+\*[^*]+\*\s*$/, "").trim();
    const count = line.match(/^(\d+)\s*x?\s+(.+)$/i) || line.match(/^(\d+)x\s*(.+)$/i);
    const quantity = count ? Number(count[1]) : 1;
    if (count) line = count[2];
    const edition = line.match(/^(.+?)\s+\(([a-z0-9]+)\)(?:\s+([\w★†-]+))?$/i);
    const name = (edition ? edition[1] : line).trim();
    if (!name || !Number.isSafeInteger(quantity) || quantity < 1) { errors.push(`Wiersz ${index + 1}: niepoprawna liczba lub nazwa karty.`); return; }
    const entry = { name, quantity };
    const key = name.toLowerCase();
    if (entries.has(key)) entries.get(key).quantity += quantity;
    else entries.set(key, entry);
  });
  return { entries: [...entries.values()], errors };
}

function cardGroup(card) {
  if (card.deckToken) return 6;
  const front = card.card_faces?.[0] || card;
  const type = front.type_line || card.type_line || "";
  const land = /\bLand\b/.test(type);
  if (land && /\bBasic\b/.test(type)) return 5;
  if (land) return ["common", "uncommon"].includes(card.rarity) ? 3 : 4;
  return card.rarity === "common" ? 0 : card.rarity === "uncommon" ? 1 : 2;
}

function cardColor(card) {
  const colors = card.colors || card.card_faces?.[0]?.colors || [];
  return colors.length > 1 ? "M" : colors[0] || "C";
}

function compareCards(a, b) {
  const group = cardGroup(a) - cardGroup(b);
  const color = cardGroup(a) < 3 ? COLOR_ORDER.indexOf(cardColor(a)) - COLOR_ORDER.indexOf(cardColor(b)) : 0;
  return group || color || alphabet.compare(a.name, b.name) || alphabet.compare(a.set, b.set) || alphabet.compare(a.collector_number, b.collector_number);
}

async function loadCardBatch(entries, request) {
  const found = new Map();
  for (let index = 0; index < entries.length; index += 10) {
    const batch = entries.slice(index, index + 10);
    const names = batch.map(entry => `!${JSON.stringify(entry.name.split(" // ")[0])}`).join(" or ");
    const query = new URLSearchParams({ q: `game:paper -is:extra -layout:art_series -is:token prefer:oldest (${names})`, unique: "cards", order: "released", dir: "asc" });
    const prints = [];
    let url = `https://api.scryfall.com/cards/search?${query}`;
    while (url) {
      let result;
      try { result = await request(url); }
      catch (error) {
        if (error.status === 404 && !prints.length) break;
        throw error;
      }
      prints.push(...result.data.map(cardDatabase.compact));
      url = result.has_more ? result.next_page : null;
      if (result.has_more && !url) throw new Error("niepełna lista kart");
    }
    const indexByName = cardDatabase.index({ cards: prints });
    for (const entry of batch) found.set(entry, indexByName.lookup(entry));
  }
  return entries.map(entry => found.get(entry) || null);
}

async function loadRarities(cards, request, cache) {
  const ids = [...new Set(cards.map(card => card.oracle_id).filter(Boolean))].filter(id => !cache.has(id));
  for (let index = 0; index < ids.length; index += 10) {
    const batch = ids.slice(index, index + 10);
    const found = new Map(batch.map(id => [id, new Set()]));
    const query = new URLSearchParams({ q: `game:paper -is:extra -layout:art_series -is:token (${batch.map(id => `oracleid:${id}`).join(" or ")})`, unique: "prints", include_extras: "true" });
    let url = `https://api.scryfall.com/cards/search?${query}`;
    while (url) {
      const result = await request(url);
      for (const print of result.data) if (!cardDatabase.isExcludedCard(print)) found.get(print.oracle_id)?.add(print.rarity);
      url = result.has_more ? result.next_page : null;
      if (result.has_more && !url) throw new Error("niepełna lista wydań");
    }
    // Only cache a complete history, never a partially downloaded list of printings.
    for (const [id, rarities] of found) if (rarities.size) cache.set(id, [...rarities]);
  }
}

function cardCaption(card, includeHistory = true) {
  if (card.deckToken) return "Token";
  const rarities = [...new Set((includeHistory && card.rarities) || [card.rarity])].sort((a, b) => RARITIES.indexOf(a) - RARITIES.indexOf(b));
  const label = rarities.map(rarity => rarity[0].toUpperCase() + rarity.slice(1)).join(" / ");
  return `${label}${includeHistory && !card.rarities ? " (tylko to wydanie)" : ""}`;
}

function isProxy(card, collection, manualProxies) {
  return !card.deckToken && (manualProxies.has(card.name) || Boolean(collection && !collection.has(card)));
}

async function loadTokens(cards, request, localDatabase, cache) {
  async function getCards(ids, needRelations = false) {
    const found = new Map(ids.map(id => [id, cache.get(id) || localDatabase?.getById(id)]));
    const missing = ids.filter(id => !found.get(id) || (needRelations && !Array.isArray(found.get(id).token_ids)));
    for (let i = 0; i < missing.length; i += 75) {
      const batch = missing.slice(i, i + 75);
      const result = await request("https://api.scryfall.com/cards/collection", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifiers: batch.map(id => ({ id })) })
      });
      for (const card of result.data) {
        const compact = cardDatabase.compact(card);
        found.set(card.id, compact);
        cache.set(card.id, compact);
      }
      if (batch.some(id => !cache.has(id))) throw new Error("niepełne dane powiązań lub tokenów ze Scryfall");
    }
    return ids.map(id => found.get(id));
  }
  for (const card of cards) if (Array.isArray(card.token_ids)) cache.set(card.id, card);
  const sources = await getCards([...new Set(cards.map(card => card.id))], true);
  const ids = [...new Set(sources.flatMap(card => card.token_ids))];
  const tokens = await getCards(ids);
  // Oracle IDs keep distinct tokens with the same name (e.g. different Zombies) separate.
  const unique = new Map();
  for (const token of tokens.sort((a, b) => (b.released_at || "").localeCompare(a.released_at || ""))) {
    if (cardDatabase.isToken(token) && !unique.has(token.oracle_id || token.id)) {
      unique.set(token.oracle_id || token.id, token);
    }
  }
  const pending = [...unique.values()].filter(token => token.oracle_id
    && !localDatabase?.latestToken(token.oracle_id) && !cache.has(`latest-token:${token.oracle_id}`));
  for (let i = 0; i < pending.length; i += 10) {
    const batch = pending.slice(i, i + 10);
    const query = new URLSearchParams({ q: `game:paper is:token prefer:newest (${batch.map(token => `oracleid:${token.oracle_id}`).join(" or ")})`, unique: "cards", order: "released", dir: "desc", include_extras: "true" });
    const latest = new Map();
    let url = `https://api.scryfall.com/cards/search?${query}`;
    while (url) {
      const result = await request(url);
      for (const token of result.data) if (cardDatabase.isToken(token) && !latest.has(token.oracle_id)) latest.set(token.oracle_id, cardDatabase.compact(token));
      url = result.has_more ? result.next_page : null;
      if (result.has_more && !url) throw new Error("niepełna lista wydań tokenów");
    }
    if (batch.some(token => !latest.has(token.oracle_id))) throw new Error("brak najnowszego wydania tokena");
    for (const [id, token] of latest) cache.set(`latest-token:${id}`, token);
  }
  return [...unique.values()].map(token => ({
    ...(localDatabase?.latestToken(token.oracle_id) || cache.get(`latest-token:${token.oracle_id}`) || token),
    deckToken: true, quantity: 1
  })).sort(compareCards);
}

function paginateCards(cards, perPage) {
  const columns = perPage === 30 ? 6 : 5;
  // Millimetres, matching print CSS: 281 mm page minus 8 mm heading and 5 mm footer.
  const rowHeight = perPage === 30 ? 51 : 61;
  const pages = [];
  let page, used = 0, rows = 0;
  for (let start = 0; start < cards.length;) {
    const group = cardGroup(cards[start]);
    let end = start + 1;
    while (end < cards.length && cardGroup(cards[end]) === group) end++;
    let segment;
    for (let offset = start; offset < end; offset += columns) {
      const extra = rowHeight + (segment ? 1.5 : 4);
      if (!page || used + extra > 268 || rows === perPage / columns) {
        page = [];
        pages.push(page);
        used = rows = 0;
        segment = null;
      }
      if (!segment) {
        segment = { group, continued: offset > start, cards: [] };
        page.push(segment);
        used += 4;
      } else used += 1.5;
      segment.cards.push(...cards.slice(offset, Math.min(offset + columns, end)));
      used += rowHeight;
      rows++;
    }
    start = end;
  }
  return pages;
}

function previewBounds(rect, width, height, viewportWidth, viewportHeight) {
  const scale = Math.min(1, (viewportWidth - 24) / width, (viewportHeight - 24) / height);
  width *= scale;
  height *= scale;
  return {
    width, height,
    left: Math.max(12, Math.min(rect.left + (rect.width - width) / 2, viewportWidth - width - 12)),
    top: Math.max(12, Math.min(rect.top + (rect.height - height) / 2, viewportHeight - height - 12))
  };
}

// Classic scripts also work when index.html is opened directly with file://.
if (typeof module !== "undefined") module.exports = { parseDeck, cardGroup, cardColor, compareCards, loadCardBatch, loadRarities, loadTokens, cardCaption, isProxy, paginateCards, previewBounds };
if (typeof document !== "undefined") init();

function init() {
  const $ = id => document.getElementById(id);
  const cache = new Map();
  const rarityCache = new Map();
  const tokenCache = new Map();
  const copyHint = [...$("copy-status").childNodes];
  let copyStatusTimer;
  let manualProxies = new Set();
  try {
    const saved = JSON.parse(localStorage.getItem("mtg-builder-proxies") || "[]");
    if (Array.isArray(saved)) manualProxies = new Set(saved.filter(name => typeof name === "string"));
  } catch { /* Manual selection still works without storage. */ }
  let localDatabase = null;
  let collection = null;
  let downloadController;
  let cards = [];
  let tokens = [];
  let problems = [];
  let imageRun = 0;
  let busy = false;
  let nextRequest = 0;
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  async function request(url, options = {}) {
    await delay(Math.max(0, nextRequest - Date.now()));
    nextRequest = Date.now() + 550;
    const response = await fetch(url, { ...options, headers: { Accept: "application/json", ...options.headers }, signal: options.signal || AbortSignal.timeout(20000) });
    if (response.status === 429) {
      nextRequest = Date.now() + 31000;
      throw new Error("limit Scryfall - odczekaj 30 sekund");
    }
    if (!response.ok) throw Object.assign(new Error(`Scryfall: HTTP ${response.status}`), { status: response.status });
    return response.json();
  }
  const make = (tag, className, text) => {
    const node = document.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const manaSymbol = color => {
    const symbol = make("span", `mana-symbol mana-${color.toLowerCase()}`);
    symbol.title = { G: "Zielony", B: "Czarny", U: "Niebieski", W: "Biały", R: "Czerwony", C: "Bezkolorowy", M: "Wielokolorowy" }[color];
    symbol.setAttribute("role", "img");
    symbol.setAttribute("aria-label", symbol.title);
    return symbol;
  };
  document.querySelector(".colors").append(...COLOR_ORDER.map(manaSymbol));
  const preview = make("img", "card-preview screen-only");
  preview.alt = "";
  preview.setAttribute("aria-hidden", "true");
  preview.hidden = true;
  document.body.append(preview);
  const hidePreview = () => { preview.hidden = true; };
  const showPreview = image => {
    if (!image.naturalWidth) return;
    const bounds = previewBounds(image.getBoundingClientRect(), image.naturalWidth, image.naturalHeight, innerWidth, innerHeight);
    for (const [property, value] of Object.entries(bounds)) preview.style[property] = `${value}px`;
    preview.src = image.currentSrc;
    preview.hidden = false;
  };
  window.addEventListener("scroll", hidePreview, true);
  ["resize", "blur", "beforeprint"].forEach(event => window.addEventListener(event, hidePreview));
  document.addEventListener("keydown", event => { if (event.key === "Escape") hidePreview(); });

  function databaseSummary() {
    return localDatabase
      ? `${localDatabase.count.toLocaleString("pl-PL")} wydań · baza z ${new Date(localDatabase.updatedAt).toLocaleDateString("pl-PL")}. Karty i rzadkości wyszukiwane lokalnie.`
      : "Bez lokalnej bazy - karty i rzadkości pobierane przez API.";
  }
  const databaseReady = cardDatabase.read().then(result => {
    localDatabase = result;
    $("database-status").textContent = databaseSummary();
    $("download-db").textContent = result ? "Aktualizuj bazę kart" : "Pobierz bazę kart";
  }).catch(() => {
    $("database-status").textContent = "Pamięć bazy jest niedostępna. Możesz nadal korzystać z API. Spróbuj otworzyć stronę przez localhost lub GitHub Pages.";
  });
  const collectionReady = cardDatabase.readCollection().then(snapshot => {
    if (snapshot) collection = Collection.index(snapshot);
    $("collection-status").textContent = collection
      ? `${collection.count.toLocaleString("pl-PL")} nazw kart · ${snapshot.fileName} · kolekcja z ${new Date(snapshot.importedAt).toLocaleDateString("pl-PL")}.`
      : "Nie wczytano kolekcji - posiadanie kart nie jest sprawdzane.";
  }).catch(() => {
    $("collection-status").textContent = "Nie można odczytać zapisanej kolekcji. Spróbuj otworzyć stronę przez localhost lub GitHub Pages.";
  });

  function setBusy(value) {
    busy = value;
    for (const id of ["build", "example", "decklist", "density", "basics", "rarities", "tokens", "download-db", "upload-collection", "collection-file"]) $(id).disabled = value;
    document.querySelectorAll(".proxy-toggle input").forEach(input => { input.disabled = value || input.dataset.automatic === "true"; });
  }
  $("upload-collection").addEventListener("click", () => $("collection-file").click());
  $("collection-file").addEventListener("change", async () => {
    const file = $("collection-file").files[0];
    if (!file || busy) return;
    setBusy(true);
    await collectionReady;
    try {
      const snapshot = { ...Collection.parse(await file.text()), fileName: file.name };
      const next = Collection.index(snapshot);
      await cardDatabase.saveCollection(snapshot);
      collection = next;
      $("collection-status").textContent = `${collection.count.toLocaleString("pl-PL")} nazw kart · ${file.name}. Kolekcja zapisana w przeglądarce.`;
    } catch (error) {
      $("collection-status").textContent = `Nie wczytano kolekcji: ${error.message}${collection ? " Poprzednia kolekcja pozostaje aktywna." : " Posiadanie kart nie jest sprawdzane."}`;
    } finally {
      $("collection-file").value = "";
      setBusy(false);
    }
    render();
  });
  $("copy-missing").addEventListener("click", async () => {
    clearTimeout(copyStatusTimer);
    try {
      await navigator.clipboard.writeText($("missing-list").value);
      $("copy-status").textContent = "Skopiowano listę.";
      clearTimeout(copyStatusTimer);
      copyStatusTimer = setTimeout(() => { $("copy-status").replaceChildren(...copyHint); }, 2000);
    } catch {
      clearTimeout(copyStatusTimer);
      $("missing-list").focus();
      $("missing-list").select();
      $("copy-status").textContent = "Lista zaznaczona. Skopiuj ją przez Ctrl+C / ⌘C.";
    }
  });
  $("cancel-db").addEventListener("click", () => downloadController?.abort());
  $("download-db").addEventListener("click", async () => {
    if (busy) return;
    setBusy(true);
    downloadController = new AbortController();
    $("cancel-db").hidden = false;
    await databaseReady;
    $("database-status").textContent = "Sprawdzanie aktualnej wersji bazy Scryfall…";
    try {
      const metadata = await request("https://api.scryfall.com/bulk-data/default_cards", { signal: downloadController.signal });
      if (metadata.updated_at !== localDatabase?.updatedAt || !localDatabase?.hasTokenData) {
        localDatabase = await cardDatabase.download(metadata, (bytes, total, count, saving) => {
          $("database-status").textContent = saving
            ? `Zapisywanie ${count.toLocaleString("pl-PL")} wydań w przeglądarce…`
            : `Pobieranie i przygotowanie: ${(bytes / 1048576).toFixed(1)} / ${(total / 1048576).toFixed(1)} MiB · ${count.toLocaleString("pl-PL")} wydań`;
        }, downloadController.signal);
        cache.clear();
        rarityCache.clear();
        tokenCache.clear();
      }
      $("download-db").textContent = "Aktualizuj bazę kart";
      $("database-status").textContent = databaseSummary();
      $("status").textContent = "Baza gotowa. Kliknij „Ułóż karty”, aby użyć lokalnych danych.";
    } catch (error) {
      $("database-status").textContent = `${downloadController.signal.aborted ? "Anulowano pobieranie." : `Nie zapisano bazy: ${error.message}.`} ${databaseSummary()}`;
    } finally {
      $("cancel-db").hidden = true;
      downloadController = null;
      setBusy(false);
    }
  });

  try { $("decklist").value = localStorage.getItem("mtg-builder-deck") || ""; } catch { /* Storage can be disabled. */ }
  $("decklist").addEventListener("input", () => {
    try { localStorage.setItem("mtg-builder-deck", $("decklist").value); } catch { /* The app still works without storage. */ }
    if (cards.length) $("status").textContent = "Lista została zmieniona. Kliknij „Ułóż karty”, aby odświeżyć arkusz.";
  });
  $("example").addEventListener("click", () => {
    $("decklist").value = "Commander\n1 Atraxa, Praetors' Voice\n\nDeck\n1 Cultivate\n1 Llanowar Elves\n1 Victimize\n1 Counterspell\n1 Swords to Plowshares\n1 Lightning Bolt\n1 Sol Ring\n1 Arcane Signet\n1 Eternal Witness\n1 Beast Within\n1 Rhystic Study\n1 Smothering Tithe\n1 Birds of Paradise\n1 Baleful Strix\n1 Command Tower\n1 Evolving Wilds\n1 Exotic Orchard\n1 Breeding Pool\n1 Watery Grave\n5 Forest";
    $("decklist").dispatchEvent(new Event("input"));
    $("decklist").focus();
  });
  ["density", "basics"].forEach(id => $(id).addEventListener("change", render));
  $("rarities").addEventListener("change", () => {
    if ($("rarities").checked && cards.length) $("deck-form").requestSubmit();
    else render();
  });
  $("tokens").addEventListener("change", () => {
    $("token-status").textContent = "";
    if ($("tokens").checked && cards.length) $("deck-form").requestSubmit();
    else {
      problems = problems.filter(problem => !problem.startsWith("Nie udało się ustalić pełnej listy tokenów"));
      render();
    }
  });

  function showProblems() {
    $("issues").replaceChildren();
    $("issues").hidden = !problems.length;
    if (!problems.length) return;
    $("issues").append(make("strong", "", "Arkusz jest niekompletny - sprawdź te pozycje:"));
    const list = make("ul", "");
    problems.forEach(problem => list.append(make("li", "", problem)));
    $("issues").append(list);
  }

  async function render() {
    hidePreview();
    const run = ++imageRun;
    const visible = cards.filter(card => $("basics").checked || cardGroup(card) !== 5).sort(compareCards);
    if ($("tokens").checked) visible.push(...tokens);
    const missing = cards.filter(card => isProxy(card, collection, manualProxies)).sort(compareCards);
    $("missing-panel").hidden = !missing.length;
    document.querySelector(".workspace").classList.toggle("has-missing", !!missing.length);
    $("missing-list").value = missing.map(card => `${card.quantity} ${card.name}`).join("\n");
    $("missing-summary").replaceChildren("Karty do proxy: ", make("strong", "", String(missing.length)), ". Braki w kolekcji i ręcznie zaznaczone karty, także ukryte basic landy.");
    clearTimeout(copyStatusTimer);
    $("copy-status").replaceChildren(...copyHint);
    const perPage = Number($("density").value);
    const pageGroups = paginateCards(visible, perPage);
    const pages = pageGroups.length;
    const total = visible.filter(card => !card.deckToken).reduce((sum, card) => sum + card.quantity, 0);
    const basics = cards.filter(card => cardGroup(card) === 5).reduce((sum, card) => sum + card.quantity, 0);
    $("stats").textContent = `${visible.length} obrazków · ${total} szt. w talii${$("tokens").checked ? ` · ${tokens.length} rodz. tokenów` : ""} · ${pages} str. A4`;
    $("sheets").replaceChildren();
    $("empty").hidden = !!visible.length;
    showProblems();
    const loading = [];
    for (let page = 0; page < pages; page++) {
      const sheet = make("section", "sheet");
      sheet.style.setProperty("--columns", perPage === 30 ? 6 : 5);
      sheet.style.setProperty("--card-height", perPage === 30 ? "51mm" : "61mm");
      sheet.style.setProperty("--image-height", perPage === 30 ? "37mm" : "47mm");
      const heading = make("div", "sheet-heading");
      heading.append(make("strong", "", "MTG Builder / Commander"), make("span", "", `${page + 1} / ${pages}`));
      const groups = make("div", "sheet-groups");
      for (const segment of pageGroups[page]) {
        const section = make("section", "card-group");
        const groupHeading = make("h3", "card-group-heading", GROUP_LABELS[segment.group]);
        if (segment.continued) groupHeading.append(make("span", "", "ciąg dalszy"));
        const grid = make("div", "card-grid");
        segment.cards.forEach(card => {
          const figure = make("figure", "card");
          const image = make("img", "");
          image.alt = card.name;
          image.loading = "eager";
          const uri = card.image_uris?.normal || card.card_faces?.[0]?.image_uris?.normal;
          loading.push(new Promise(resolve => {
            let settled = false;
            const finish = ok => { if (!settled) { settled = true; clearTimeout(timer); figure.classList.toggle("image-failed", !ok); resolve(ok); } };
            const timer = setTimeout(() => finish(false), 30000);
            image.onload = () => { figure.classList.remove("image-failed"); finish(true); };
            image.onerror = () => finish(false);
            if (uri) image.src = uri;
            else finish(false);
          }));
          const caption = make("figcaption", "");
          const markers = make("div", "card-markers");
          const initial = make("strong", "card-initial", [...card.name.trim()][0].toLocaleUpperCase("en"));
          initial.setAttribute("aria-label", `Litera: ${initial.textContent}`);
          markers.append(manaSymbol(cardColor(card)), initial, make("span", "card-rarities", cardCaption(card, $("rarities").checked)));
          caption.append(make("span", "card-name", card.name));
          const link = make("a", "card-link");
          link.href = `https://scryfall.com/card/${encodeURIComponent(card.set)}/${encodeURIComponent(card.collector_number)}`;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          link.setAttribute("aria-label", `${card.name} - otwórz na Scryfall w nowej karcie`);
          link.addEventListener("pointerenter", event => { if (event.pointerType !== "touch") showPreview(image); });
          link.addEventListener("pointerleave", hidePreview);
          link.addEventListener("focus", () => { if (link.matches(":focus-visible")) showPreview(image); });
          link.addEventListener("blur", hidePreview);
          link.append(image);
          figure.append(markers, link, caption);
          if (card.quantity > 1) link.append(make("span", "quantity", `×${card.quantity}`));
          const automaticProxy = Boolean(collection && !collection.has(card));
          if (!card.deckToken) {
            const proxyToggle = make("label", "proxy-toggle screen-only");
            proxyToggle.title = automaticProxy ? "Brak w kolekcji - proxy oznaczone automatycznie" : "Oznacz kartę jako proxy";
            const proxyInput = make("input", "");
            proxyInput.type = "checkbox";
            proxyInput.checked = isProxy(card, collection, manualProxies);
            proxyInput.disabled = busy || automaticProxy;
            proxyInput.dataset.automatic = String(automaticProxy);
            proxyInput.dataset.card = card.id;
            proxyInput.setAttribute("aria-label", `${card.name} - proxy${automaticProxy ? " (brak w kolekcji)" : ""}`);
            proxyInput.addEventListener("change", () => {
              if (proxyInput.checked) manualProxies.add(card.name);
              else manualProxies.delete(card.name);
              try { localStorage.setItem("mtg-builder-proxies", JSON.stringify([...manualProxies])); } catch { /* Selection remains active for this visit. */ }
              render();
              document.querySelector(`.proxy-toggle input[data-card="${CSS.escape(card.id)}"]`)?.focus({ preventScroll: true });
            });
            proxyToggle.append(proxyInput, "Proxy");
            figure.append(proxyToggle);
          }
          if (isProxy(card, collection, manualProxies)) {
            const reason = automaticProxy ? "Brak w kolekcji - proxy" : "Ręcznie oznaczone proxy";
            figure.classList.add("proxy");
            figure.title = reason;
            link.setAttribute("aria-label", `${card.name} - ${reason} - otwórz na Scryfall w nowej karcie`);
            const overlay = make("div", "proxy-overlay");
            overlay.setAttribute("aria-hidden", "true");
            overlay.innerHTML = '<svg viewBox="0 0 100 100" preserveAspectRatio="none"><path d="M0 0L100 100M100 0L0 100"/><text x="50" y="94" text-anchor="middle" textLength="80" lengthAdjust="spacingAndGlyphs">P</text></svg>';
            link.append(overlay);
          }
          grid.append(figure);
        });
        section.append(groupHeading, grid);
        groups.append(section);
      }
      const footer = make("div", "sheet-footer");
      const order = make("span", "");
      COLOR_ORDER.forEach((color, index) => {
        if (index) order.append(" → ");
        order.append(manaSymbol(color));
      });
      order.append(" · A-Z w grupach · Obrazki: Scryfall");
      footer.append(order);
      sheet.append(heading, groups, footer);
      $("sheets").append(sheet);
    }
    if (busy) return;
    $("status").textContent = visible.length ? "Wczytywanie obrazków - poczekaj przed drukowaniem…" : "Brak kart do pokazania. Wklej listę lub włącz basic landy.";
    const loaded = await Promise.all(loading);
    if (run !== imageRun) return;
    const failed = loaded.filter(ok => !ok).length;
    $("status").textContent = failed ? `Nie wczytano ${failed} obrazków. Sprawdź połączenie i kliknij ponownie „Ułóż karty”.` : visible.length ? `Obrazki gotowe. Możesz drukować.${!$("basics").checked && basics ? ` Pominięto basic landy: ${basics} szt.` : ""}` : "Brak kart do pokazania. Wklej listę lub włącz basic landy.";
    if (failed) {
      problems.push(`Nie wczytano ${failed} obrazków. Nazwy kart pozostają na arkuszu.`);
      showProblems();
    }
  }

  $("deck-form").addEventListener("submit", async event => {
    event.preventDefault();
    if (busy) return;
    const parsed = parseDeck($("decklist").value);
    problems = [...parsed.errors];
    if (!parsed.entries.length) { showProblems(); $("status").textContent = "Wpisz przynajmniej jedną kartę, np. 1 Sol Ring."; return; }
    setBusy(true);
    hidePreview();
    ++imageRun;
    cards = [];
    tokens = [];
    $("token-status").textContent = "";
    $("sheets").replaceChildren();
    $("missing-panel").hidden = true;
    $("missing-list").value = "";
    document.querySelector(".workspace").classList.remove("has-missing");
    $("empty").hidden = true;
    $("stats").textContent = "Pobieranie kart…";
    showProblems();
    await Promise.all([databaseReady, collectionReady]);
    const key = entry => entry.name.toLowerCase();
    if (localDatabase) {
      cache.clear();
      for (const entry of parsed.entries) {
        const card = localDatabase.lookup(entry);
        if (card) cache.set(key(entry), card);
        else problems.push(`${entry.name}: brak w lokalnej bazie. Sprawdź nazwę lub zaktualizuj bazę.`);
      }
    }
    const pending = localDatabase ? [] : parsed.entries.filter(entry => !cache.has(key(entry)));
    for (let index = 0; index < pending.length; index += 75) {
      const batch = pending.slice(index, index + 75);
      $("status").textContent = `Pobieranie kart: ${Math.min(index + 75, pending.length)}/${pending.length}…`;
      try {
        const result = await loadCardBatch(batch, request);
        result.forEach((card, position) => {
          const entry = batch[position];
          if (card) cache.set(key(entry), card);
          else problems.push(`${entry.name}: nie znaleziono pasującej karty. Sprawdź nazwę.`);
        });
      } catch (error) {
        const remaining = pending.slice(index).map(item => item.name).join(", ");
        problems.push(`Pobieranie przerwane (${error.message}). Nie pobrano: ${remaining}. Sprawdź połączenie i spróbuj ponownie.`);
        break;
      }
    }
    for (const entry of parsed.entries) {
      const card = cache.get(key(entry));
      if (!card) continue;
      const existing = cards.find(item => item.id === card.id);
      if (existing) existing.quantity += entry.quantity;
      else cards.push({ ...card, quantity: entry.quantity });
    }
    if (cards.length && $("rarities").checked) {
      if (!localDatabase) {
        $("status").textContent = "Sprawdzanie rzadkości we wszystkich wydaniach papierowych…";
        try { await loadRarities(cards, request, rarityCache); }
        catch (error) { problems.push(`Nie udało się pobrać pełnej historii rzadkości (${error.message}). Spróbuj ponownie.`); }
      }
      for (const card of cards) card.rarities = (localDatabase?.rarities || rarityCache).get(card.oracle_id);
    }
    if (cards.length && $("tokens").checked) {
      $("status").textContent = "Sprawdzanie tokenów do decka…";
      try {
        tokens = await loadTokens(cards, request, localDatabase, tokenCache);
        if (tokens.length) $("token-status").replaceChildren("Liczba tokenów: ", make("strong", "", String(tokens.length)));
        else $("token-status").textContent = "Scryfall nie wskazuje tokenów dla tej decklisty.";
      } catch (error) {
        problems.push(`Nie udało się ustalić pełnej listy tokenów (${error.message}). Spróbuj ponownie.`);
      }
    }
    setBusy(false);
    render();
  });
}
