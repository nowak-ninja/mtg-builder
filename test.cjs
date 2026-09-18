const assert = require('node:assert/strict');
const { parseDeck, cardGroup, cardColor, compareCards, cardIdentifier, resolveBatch, loadRarities, cardCaption, previewBounds } = require('./app.js');

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
assert.deepEqual(cardIdentifier(parsed.entries[1]), { set: 'cmm', collector_number: '410' });
assert.deepEqual(cardIdentifier({ name: 'Fire // Ice', set: '', number: '' }), { name: 'Fire' });
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
console.log('OK: parser, duplicates, exact editions, color order, A-Z, combined rarities, lands and double-faced cards.');

const batch = [{ name: 'Missing' }, { name: 'Sol Ring' }, { name: 'Wrong', set: 'cmm', number: '410' }, { name: 'Fire // Ice' }];
const batchResult = resolveBatch(batch, { not_found: [{ name: 'Missing' }], data: [{ name: 'Sol Ring' }, { name: 'Another card' }, { name: 'Fire // Ice' }] });
assert.deepEqual(batchResult.map(c => c?.name || null), [null, 'Sol Ring', null, 'Fire // Ice']);
console.log('OK: collection mapping with missing cards and wrong collector numbers.');

(async () => {
  const cache = new Map();
  const remora = { ...card('Mystic Remora', 'rare', ['U'], 'Enchantment'), oracle_id: 'remora' };
  let calls = 0;
  await loadRarities([remora, remora], async url => {
    calls++;
    if (calls === 1) {
      const query = new URL(url).searchParams;
      assert.equal(query.get('q'), 'game:paper (oracleid:remora)');
      assert.equal(query.get('unique'), 'prints');
      return { data: [{ oracle_id: 'remora', rarity: 'rare' }], has_more: true, next_page: 'page-2' };
    }
    assert.equal(url, 'page-2');
    return { data: ['common', 'mythic', 'rare'].map(rarity => ({ oracle_id: 'remora', rarity })), has_more: false };
  }, cache);
  assert.equal(calls, 2);
  remora.rarities = cache.get('remora');
  assert.equal(cardCaption(remora), 'Common / Rare / Mythic · U');
  assert.equal(cardGroup(remora), 2); // History changes the caption, not the sorting group.
  await loadRarities([remora], () => assert.fail('History should be cached'), cache);
  assert.match(cardCaption(card('Unknown', 'uncommon', ['G'])), /tylko to wydanie/);
  assert.equal(cardCaption({ ...card('Land', 'rare', [], 'Land'), rarities: ['rare', 'common'] }), 'Common / Rare · Land');
  const failed = new Map();
  await assert.rejects(loadRarities([remora], async url => {
    if (url === 'page-2') throw new Error('Offline');
    return { data: [{ oracle_id: 'remora', rarity: 'rare' }], has_more: true, next_page: 'page-2' };
  }, failed), /Offline/);
  assert.equal(failed.size, 0);
  console.log('OK: rarity history, pagination, deduplication, cache, fallback and unchanged sorting.');
})().catch(error => { console.error(error); process.exitCode = 1; });
