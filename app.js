"use strict";

const COLOR_ORDER = ["G", "B", "U", "W", "R", "C", "M"];
const RARITIES = ["common", "uncommon", "rare", "mythic", "special", "bonus"];
const alphabet = new Intl.Collator("en", { sensitivity: "base" });

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
    const entry = { name, quantity, set: edition?.[2].toLowerCase() || "", number: edition?.[3] || "" };
    const key = JSON.stringify([name.toLowerCase(), entry.set, entry.number]);
    if (entries.has(key)) entries.get(key).quantity += quantity;
    else entries.set(key, entry);
  });
  return { entries: [...entries.values()], errors };
}

function cardGroup(card) {
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

function cardIdentifier(entry) {
  if (entry.set && entry.number) return { set: entry.set, collector_number: entry.number };
  const name = entry.name.split(" // ")[0];
  return entry.set ? { name, set: entry.set } : { name };
}

function resolveBatch(entries, result) {
  let index = 0;
  return entries.map(entry => {
    const identifier = cardIdentifier(entry);
    if (result.not_found.some(missing => Object.entries(identifier).every(([key, value]) => missing[key] === value))) return null;
    const card = result.data[index++];
    const names = [card?.name, card?.printed_name, ...(card?.card_faces || []).flatMap(face => [face.name, face.printed_name])].filter(Boolean);
    return names.some(name => alphabet.compare(name, entry.name) === 0) ? card : null;
  });
}

async function loadRarities(cards, request, cache) {
  const ids = [...new Set(cards.map(card => card.oracle_id).filter(Boolean))].filter(id => !cache.has(id));
  for (let index = 0; index < ids.length; index += 10) {
    const batch = ids.slice(index, index + 10);
    const found = new Map(batch.map(id => [id, new Set()]));
    const query = new URLSearchParams({ q: `game:paper (${batch.map(id => `oracleid:${id}`).join(" or ")})`, unique: "prints", include_extras: "true" });
    let url = `https://api.scryfall.com/cards/search?${query}`;
    while (url) {
      const result = await request(url);
      for (const print of result.data) found.get(print.oracle_id)?.add(print.rarity);
      url = result.has_more ? result.next_page : null;
      if (result.has_more && !url) throw new Error("niepełna lista wydań");
    }
    // Only cache a complete history, never a partially downloaded list of printings.
    for (const [id, rarities] of found) if (rarities.size) cache.set(id, [...rarities]);
  }
}

function cardCaption(card, includeHistory = true) {
  const rarities = [...new Set((includeHistory && card.rarities) || [card.rarity])].sort((a, b) => RARITIES.indexOf(a) - RARITIES.indexOf(b));
  const label = rarities.map(rarity => rarity[0].toUpperCase() + rarity.slice(1)).join(" / ");
  return `${label}${includeHistory && !card.rarities ? " (tylko to wydanie)" : ""}`;
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
if (typeof module !== "undefined") module.exports = { parseDeck, cardGroup, cardColor, compareCards, cardIdentifier, resolveBatch, loadRarities, cardCaption, previewBounds };
if (typeof document !== "undefined") init();

function init() {
  const $ = id => document.getElementById(id);
  const cache = new Map();
  const rarityCache = new Map();
  let localDatabase = null;
  let downloadController;
  let cards = [];
  let problems = [];
  let imageRun = 0;
  let busy = false;
  let nextRequest = 0;
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  async function request(url, options = {}) {
    await delay(Math.max(0, nextRequest - Date.now()));
    nextRequest = Date.now() + 550;
    const response = await fetch(url, { ...options, headers: { Accept: "application/json", ...(options.body ? { "Content-Type": "application/json" } : {}) }, signal: options.signal || AbortSignal.timeout(20000) });
    if (response.status === 429) {
      nextRequest = Date.now() + 31000;
      throw new Error("limit Scryfall - odczekaj 30 sekund");
    }
    if (!response.ok) throw new Error(`Scryfall: HTTP ${response.status}`);
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
  document.querySelector(".colors").append(...COLOR_ORDER.map(color => {
    const badge = make("span", `mana ${color.toLowerCase()}`);
    badge.append(manaSymbol(color));
    return badge;
  }));
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
  const databaseReady = CardDatabase.read().then(result => {
    localDatabase = result;
    $("database-status").textContent = databaseSummary();
    $("download-db").textContent = result ? "Aktualizuj bazę kart" : "Pobierz bazę kart";
  }).catch(() => {
    $("database-status").textContent = "Pamięć bazy jest niedostępna. Możesz nadal korzystać z API. Spróbuj otworzyć stronę przez localhost lub GitHub Pages.";
  });

  function setBusy(value) {
    busy = value;
    for (const id of ["build", "example", "decklist", "density", "basics", "rarities", "download-db"]) $(id).disabled = value;
  }
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
      if (metadata.updated_at !== localDatabase?.updatedAt) {
        localDatabase = await CardDatabase.download(metadata, (bytes, total, count, saving) => {
          $("database-status").textContent = saving
            ? `Zapisywanie ${count.toLocaleString("pl-PL")} wydań w przeglądarce…`
            : `Pobieranie i przygotowanie: ${(bytes / 1048576).toFixed(1)} / ${(total / 1048576).toFixed(1)} MiB · ${count.toLocaleString("pl-PL")} wydań`;
        }, downloadController.signal);
        cache.clear();
        rarityCache.clear();
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
    const perPage = Number($("density").value);
    const pages = Math.ceil(visible.length / perPage);
    const total = visible.reduce((sum, card) => sum + card.quantity, 0);
    const basics = cards.filter(card => cardGroup(card) === 5).reduce((sum, card) => sum + card.quantity, 0);
    $("stats").textContent = `${visible.length} obrazków · ${total} szt. · ${pages} str. A4`;
    $("sheets").replaceChildren();
    $("empty").hidden = !!visible.length;
    showProblems();
    const loading = [];
    for (let page = 0; page < pages; page++) {
      const sheet = make("section", "sheet");
      sheet.style.setProperty("--columns", perPage === 30 ? 6 : 5);
      const heading = make("div", "sheet-heading");
      heading.append(make("strong", "", "MTG Builder / Commander"), make("span", "", `${page + 1} / ${pages}`));
      const grid = make("div", "card-grid");
      visible.slice(page * perPage, (page + 1) * perPage).forEach(card => {
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
        const meta = make("span", "card-meta", `${cardCaption(card, $("rarities").checked)} · `);
        meta.append(cardGroup(card) >= 3 ? (cardGroup(card) === 5 ? "Basic land" : "Land") : manaSymbol(cardColor(card)));
        caption.append(make("span", "card-name", card.name), meta);
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
        figure.append(link, caption);
        if (card.quantity > 1) figure.append(make("span", "quantity", `×${card.quantity}`));
        grid.append(figure);
      });
      const footer = make("div", "sheet-footer");
      const order = make("span", "");
      COLOR_ORDER.forEach((color, index) => {
        if (index) order.append(" → ");
        order.append(manaSymbol(color));
      });
      order.append(" · A-Z w grupach · Obrazki: Scryfall");
      footer.append(order);
      sheet.append(heading, grid, footer);
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
    $("sheets").replaceChildren();
    $("empty").hidden = true;
    $("stats").textContent = "Pobieranie kart…";
    showProblems();
    await databaseReady;
    const key = entry => JSON.stringify(cardIdentifier(entry));
    if (localDatabase) {
      cache.clear();
      for (const entry of parsed.entries) {
        const card = localDatabase.lookup(entry);
        if (card) cache.set(key(entry), card);
        else problems.push(`${entry.name}: brak w lokalnej bazie. Sprawdź nazwę i wydanie lub zaktualizuj bazę.`);
      }
    }
    const pending = localDatabase ? [] : parsed.entries.filter(entry => !cache.has(key(entry)));
    for (let index = 0; index < pending.length; index += 75) {
      const batch = pending.slice(index, index + 75);
      $("status").textContent = `Pobieranie kart: ${Math.min(index + 75, pending.length)}/${pending.length}…`;
      try {
        const result = await request("https://api.scryfall.com/cards/collection", {
          method: "POST",
          body: JSON.stringify({ identifiers: batch.map(cardIdentifier) })
        });
        resolveBatch(batch, result).forEach((card, position) => {
          const entry = batch[position];
          if (card) cache.set(key(entry), card);
          else problems.push(`${entry.name}${entry.set ? ` (${entry.set.toUpperCase()}) ${entry.number}` : ""}: nie znaleziono pasującej karty. Sprawdź nazwę i wydanie.`);
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
      // Validate names even for cached set/number identifiers.
      if (!resolveBatch([entry], { data: [card], not_found: [] })[0]) {
        problems.push(`${entry.name}: numer wydania wskazuje inną kartę (${card.name}).`);
        continue;
      }
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
    setBusy(false);
    render();
  });
}
