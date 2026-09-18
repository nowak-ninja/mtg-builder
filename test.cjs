const assert = require('node:assert/strict');
const CardDatabase = require('./database.js');
const { parseDeck, cardGroup, cardColor, compareCards, loadCardBatch, loadRarities, cardCaption, isProxy, paginateCards, previewBounds } = require('./app.js');

const parsed = parseDeck(`Commander
1 Atraxa, Praetors' Voice
Deck
2 Sol Ring (CMM) 410 *F*
1x Sol Ring (CMM) 410
Cultivate
1 Fire // Ice
0 Counterspell
Sideboard
1 Lightning Bolt
Deck
1 Llanowar Elves # ramp
SB: 1 Brainstorm`);
assert.equal(parsed.entries.length, 5);
assert.equal(parsed.entries[1].quantity, 3);
assert.equal(parsed.entries[3].name, 'Fire // Ice');
assert.equal(parsed.errors.length, 1);
assert.deepEqual(parsed.entries[1], { name: 'Sol Ring', quantity: 3 });
assert.deepEqual(parseDeck('1 Sol Ring\n2 Sol Ring (CMM) 410\n3 Sol Ring (LEA) 270').entries, [{ name: 'Sol Ring', quantity: 6 }]);
assert.equal(parseDeck('1xSol Ring\n2x Sol Ring').entries[0].quantity, 3);

const card = (name, rarity, colors, type_line = 'Creature') => ({ name, rarity, colors, type_line, set: 'tst', collector_number: '1' });
const cards = [];
for (const rarity of ['common', 'uncommon', 'rare', 'mythic']) {
  for (const colors of [['G'], ['B'], ['U'], ['W'], ['R'], [], ['G', 'U']]) {
    cards.push(card('Zulu', rarity, colors), card('Alpha', rarity, colors));
  }
}
cards.push(card('Zulu land', 'common', ['G'], 'Land'), card('Alpha land', 'uncommon', ['R'], 'Land'));
cards.push(card('Zulu rare land', 'rare', [], 'Land'), card('Alpha mythic land', 'mythic', [], 'Land'));
cards.push(card('Forest', 'common', [], 'Basic Land — Forest'));
const sorted = cards.reverse().sort(compareCards);
assert.deepEqual(sorted.slice(0, 14).map(c => `${cardColor(c)}:${c.name}`), ['G', 'B', 'U', 'W', 'R', 'C', 'M'].flatMap(color => [`${color}:Alpha`, `${color}:Zulu`]));
assert.deepEqual(sorted.map(cardGroup), [...Array(14).fill(0), ...Array(14).fill(1), ...Array(28).fill(2), 3, 3, 4, 4, 5]);
assert.deepEqual(sorted.slice(-5).map(c => c.name), ['Alpha land', 'Zulu land', 'Alpha mythic land', 'Zulu rare land', 'Forest']);
assert.deepEqual(sorted.slice(28, 32).map(c => c.name), ['Alpha', 'Alpha', 'Zulu', 'Zulu']);
const dfc = { rarity: 'rare', type_line: 'Sorcery // Land', color_identity: ['G', 'R'], card_faces: [{ colors: ['G'], type_line: 'Sorcery' }, { colors: ['R'], type_line: 'Land' }] };
assert.equal(cardGroup(dfc), 2);
assert.equal(cardColor(dfc), 'G');
assert.equal(cardColor({ colors: [], color_identity: ['G'] }), 'C');
assert.equal(cardColor({ colors: ['R', 'U'], card_faces: [{ colors: ['R'] }, { colors: ['U'] }] }), 'M');
assert.equal(cardGroup(card('Dryad Arbor', 'rare', ['G'], 'Land Creature — Forest Dryad')), 4);
for (const [x, y, vw, vh] of [[0, 0, 1440, 1000], [1400, 950, 1440, 1000], [350, 700, 390, 844]]) {
  const bounds = previewBounds({ left: x, top: y, width: 100, height: 140 }, 488, 680, vw, vh);
  assert(bounds.left >= 12 && bounds.top >= 12);
  assert(bounds.left + bounds.width <= vw - 12 + .001);
  assert(bounds.top + bounds.height <= vh - 12 + .001);
  assert(bounds.width <= 488 && bounds.height <= 680);
  assert(Math.abs(bounds.width / bounds.height - 488 / 680) < .001);
}
console.log('OK: parser, duplicates, ignored edition suffixes, color order, A-Z, combined rarities, lands and double-faced cards.');
for (const density of [30, 20]) {
  const columns = density === 30 ? 6 : 5;
  const rowHeight = density === 30 ? 51 : 61;
  for (const input of [[], sorted, Array.from({ length: 61 }, (_, i) => card(`Card ${i}`, 'common', ['G']))]) {
    const pages = paginateCards(input, density);
    assert.deepEqual(pages.flatMap(page => page.flatMap(group => group.cards)), input);
    for (const page of pages) {
      assert(page.length > 0);
      assert(page.flatMap(group => group.cards).length <= density);
      let height = 0;
      for (const group of page) {
        assert(group.cards.every(c => cardGroup(c) === group.group));
        const rows = Math.ceil(group.cards.length / columns);
        height += 4 + rows * rowHeight + (rows - 1) * 1.5;
      }
      assert(height <= 268);
    }
  }
  const pages = paginateCards(Array.from({ length: 61 }, (_, i) => card(`Card ${i}`, 'common', ['G'])), density);
  assert.equal(pages.length, Math.ceil(61 / density));
  assert.equal(pages[0][0].continued, false);
  assert.equal(pages[1][0].continued, true);
}
console.log('OK: grouped pagination, continuation headings, order, page capacity and print height budget.');


(async () => {
  const cache = new Map();
  const remora = { ...card('Mystic Remora', 'rare', ['U'], 'Enchantment'), oracle_id: 'remora' };
  let calls = 0;
  await loadRarities([remora, remora], async url => {
    calls++;
    if (calls === 1) {
      const query = new URL(url).searchParams;
      assert.equal(query.get('q'), 'game:paper -layout:art_series (oracleid:remora)');
      assert.equal(query.get('unique'), 'prints');
      return { data: [{ oracle_id: 'remora', rarity: 'rare' }], has_more: true, next_page: 'page-2' };
    }
    assert.equal(url, 'page-2');
    return { data: ['common', 'mythic', 'rare'].map(rarity => ({ oracle_id: 'remora', rarity })), has_more: false };
  }, cache);
  assert.equal(calls, 2);
  remora.rarities = cache.get('remora');
  assert.equal(cardCaption(remora), 'Common / Rare / Mythic');
  assert.equal(cardCaption(remora, false), 'Rare');
  assert.equal(cardGroup(remora), 2); // History changes the caption, not the sorting group.
  await loadRarities([remora], () => assert.fail('History should be cached'), cache);
  assert.match(cardCaption(card('Unknown', 'uncommon', ['G'])), /tylko to wydanie/);
  assert.equal(cardCaption({ ...card('Land', 'rare', [], 'Land'), rarities: ['rare', 'common'] }), 'Common / Rare');
  const failed = new Map();
  await assert.rejects(loadRarities([remora], async url => {
    if (url === 'page-2') throw new Error('Offline');
    return { data: [{ oracle_id: 'remora', rarity: 'rare' }], has_more: true, next_page: 'page-2' };
  }, failed), /Offline/);
  assert.equal(failed.size, 0);
  console.log('OK: rarity history, pagination, deduplication, cache, fallback and unchanged sorting.');

  const printing = (overrides = {}) => ({ object: 'card', id: 'old', oracle_id: 'remora', name: 'Mystic Remora', rarity: 'common', set: 'ice', collector_number: '87', games: ['paper'], released_at: '1995-06-03', colors: ['U'], type_line: 'Enchantment', oracle_text: 'Not stored', prices: { usd: '1' }, ...overrides });
  const snapshot = { updatedAt: '2026-09-18', cards: [
    printing({ id: 'art', layout: 'art_series', type_line: 'Card // Card', name: 'Mystic Remora // Mystic Remora', set: 'aart', released_at: '1990-01-01', card_faces: [{ name: 'Mystic Remora', type_line: 'Card' }] }),
    printing({ id: 'legacy-art', type_line: 'Card // Card', set: 'legacy', released_at: '1990-01-01' }),
    printing(), printing({ id: 'new', set: 'dmr', rarity: 'rare', released_at: '2023-01-13' }),
    printing({ id: 'digital', set: 'ana', rarity: 'uncommon', games: ['arena'], released_at: '2027-01-01' }),
    printing({ id: 'dfc', oracle_id: 'delver', name: 'Delver of Secrets // Insectile Aberration', card_faces: [{ name: 'Delver of Secrets', colors: ['U'], type_line: 'Creature', image_uris: { normal: 'https://cards.scryfall.io/front.jpg' } }, { name: 'Insectile Aberration' }] })
  ].map(CardDatabase.compact) };
  assert.equal(snapshot.cards[0].oracle_text, undefined);
  assert.equal(snapshot.cards[0].prices, undefined);
  const local = CardDatabase.index(snapshot);
  assert.equal(local.lookup({ name: 'mystic remora' }).id, 'old');
  assert.equal(local.lookup({ name: 'Mystic Remora', set: 'dmr', number: '87' }).id, 'old');
  assert.equal(local.lookup({ name: 'missing card' }), undefined);
  assert.equal(local.lookup({ name: 'Mystic Remora', set: 'aart', number: '87' }).id, 'old');
  assert.equal(local.lookup({ name: 'Mystic Remora', set: 'legacy' }).id, 'old');
  assert.equal(snapshot.cards[0].layout, 'art_series');
  const onlineEntries = [{ name: 'Mystic Remora' }, { name: 'Missing' }, { name: 'Mystic Remora', set: 'dmr', number: '87' }];
  const online = await loadCardBatch(onlineEntries, async (url, options) => {
    assert.equal(options, undefined);
    assert(new URL(url).pathname.endsWith('/cards/search'));
    const q = new URL(url).searchParams;
    assert.match(q.get('q'), /game:paper -layout:art_series prefer:oldest/);
    assert.match(q.get('q'), /!"Mystic Remora" or !"Missing"/);
    assert.equal(q.get('unique'), 'cards');
    return { data: [printing(), snapshot.cards[0]], has_more: false };
  });
  assert.deepEqual(online.map(card => card?.id || null), ['old', null, 'old']);
  assert.deepEqual(await loadCardBatch([{ name: 'Missing' }], async () => {
    throw Object.assign(new Error('Not found'), { status: 404 });
  }), [null]);
  await assert.rejects(loadCardBatch([{ name: 'Mystic Remora' }], async () => {
    throw Object.assign(new Error('Server unavailable'), { status: 503 });
  }), /Server unavailable/);
  let searchCalls = 0;
  await loadCardBatch(Array.from({ length: 11 }, (_, i) => ({ name: `Card ${i}` })), async () => {
    searchCalls++;
    return { data: [], has_more: false };
  });
  assert.equal(searchCalls, 2);
  console.log('OK: oldest printing locally/online, ignored edition overrides, Art Series including legacy snapshots, missing names and API failures.');

  assert.equal(local.lookup({ name: 'Insectile Aberration' }).id, 'dfc');
  assert.deepEqual(local.rarities.get('remora'), ['common', 'rare']);
  assert.equal(local.lookup({ name: 'Delver of Secrets' }).card_faces[0].image_uris.normal, 'https://cards.scryfall.io/front.jpg');
  assert.throws(() => CardDatabase.compact({ object: 'error' }), /Niepoprawny rekord/);
  const jsonl = new TextEncoder().encode(JSON.stringify(printing({ name: 'Świątynia' })) + '\n\n' + JSON.stringify(printing()));
  const stream = new ReadableStream({ start(controller) {
    for (let i = 0; i < jsonl.length; i += 7) controller.enqueue(jsonl.slice(i, i + 7));
    controller.close();
  } });
  const parsedLines = [];
  for await (const record of CardDatabase.jsonLines(stream)) parsedLines.push(record);
  assert.deepEqual(parsedLines.map(card => card.name), ['Świątynia', 'Mystic Remora']);
  await assert.rejects(async () => {
    for await (const record of CardDatabase.jsonLines(new Blob(['{"name":']).stream())) void record;
  }, SyntaxError);
  console.log('OK: compact local index, printing selection, paper-only rarity history, DFC aliases and streamed JSONL.');
})().catch(error => { console.error(error); process.exitCode = 1; });

const Collection = require('./collection.js');
const collection = Collection.index(Collection.parse('\uFEFFamount,card_name,comment\r\n2,"Atraxa, Praetors\' Voice","line one\nline two"\r\n1,"""Rumors of My Death . . .""",\r\n1,Fire // Ice,\r\n0,Black Lotus,\r\n1,Sol Ring,\r\n3,Sol Ring,\r\n'));
assert.equal(collection.count, 4);
assert(collection.has({ name: 'SOL RING', set: 'different', quantity: 100 }));
assert(collection.has({ name: 'Atraxa, Praetors’ Voice' }));
assert(collection.has({ name: '"Rumors of My Death . . ."' }));
assert(collection.has({ name: 'Ice' }));
assert(collection.has({ name: 'Fire // Ice' }));
assert(!collection.has({ name: 'Black Lotus' }));
assert(!collection.has({ name: 'Sol' }));
assert(Collection.index(Collection.parse('amount,card_name\n1,Delver of Secrets')).has({ name: 'Delver of Secrets // Insectile Aberration' }));
assert(Collection.index(Collection.parse('amount,card_name\n1,Insectile Aberration')).has({ name: 'Delver of Secrets // Insectile Aberration' }));
for (const invalid of ['wrong,header\n1,Sol Ring', 'amount,card_name', 'amount,card_name\n-1,Sol Ring', 'amount,card_name\n1,"Sol Ring', 'amount,card_name\n1,Sol Ring,extra', 'amount,card_name\n1,"Sol Ring"oops']) assert.throws(() => Collection.parse(invalid));
assert.equal(Collection.index(Collection.parse('amount,card_name\n0,Sol Ring')).count, 0);
console.log('OK: collection CSV quotes, commas, multiline fields, BOM, duplicates, zero counts, DFC names, edition-independent matching and invalid imports.');

const selectedProxies = new Set(['Sol Ring']);
assert(isProxy({ name: 'Sol Ring' }, null, selectedProxies));
assert(!isProxy({ name: 'Mystic Remora' }, null, selectedProxies));
assert(isProxy({ name: 'Sol Ring' }, { has: () => true }, selectedProxies));
assert(isProxy({ name: 'Mystic Remora' }, { has: () => false }, selectedProxies));
selectedProxies.delete('Sol Ring');
assert(!isProxy({ name: 'Sol Ring' }, { has: () => true }, selectedProxies));
assert(isProxy({ name: 'Sol Ring' }, { has: () => false }, selectedProxies));
console.log('OK: manual proxies without collection, owned-card override, deselection and automatic missing-card proxies.');
