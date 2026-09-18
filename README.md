# MTG Builder

Prosty frontend do wyszukiwania fizycznych kart w bibliotece. Bez instalacji, zależności, klucza API i backendu.

## Uruchomienie

Otwórz `index.html` w przeglądarce. Do pobrania danych i obrazków potrzebne jest połączenie z internetem. Alternatywnie uruchom dowolny serwer plików statycznych, np. `python3 -m http.server 8000`, i wejdź na `http://localhost:8000`.

Na GitHub Pages opublikuj katalog zawierający `index.html`, `styles.css` i `app.js` (Settings → Pages → Deploy from a branch → katalog główny). Nie ma procesu budowania.

## Lista i sortowanie

- Jedna karta w wierszu: `Sol Ring`, `1 Sol Ring`, `1x Sol Ring` albo `1 Sol Ring (CMM) 410`. Angielskie nazwy Scryfall; dokładna nazwa, bez zgadywania literówek.
- Obsługiwane są nagłówki Commander/Deck i kategorie typów. Sekcje Sideboard/Maybeboard/Considering oraz linie `SB:` są pomijane. Kolejny nagłówek Deck/Commander wraca do głównej listy.
- Powtórzenia tego samego wydania są łączone; liczba sztuk jest widoczna na obrazku. Różne wydania pozostają osobno.
- Common → uncommon → rare + mythic. W każdej grupie: G, B, U, W, R, bezkolorowe, wielokolorowe, potem A-Z.
- Następnie non-basic landy common + uncommon A-Z, potem rare + mythic A-Z, bez podziału na kolory. Basic landy opcjonalnie na końcu.
- Używany jest kolor karty, nie jej commander color identity. Dla kart dwustronnych wyświetlany i klasyfikowany jest przód. Spell z landem na odwrocie pozostaje w grupie spelli.
- Obrazek i miejsce w kolejności odpowiadają konkretnemu wydaniu. Bez setu wersję wybiera Scryfall - może różnić się od posiadanej karty. Podpis bez kodu edycji pokazuje wszystkie rzadkości papierowych wydań karty, np. `Common / Rare / Mythic · U`. Historia jest wyszukiwana według Oracle ID, z uwzględnieniem wszystkich stron wyników, i buforowana w pamięci. Gdy nie uda się jej pobrać, podpis wyraźnie mówi „tylko to wydanie”.
- Lista jest zapisywana wyłącznie lokalnie w przeglądarce. Zapytania o karty trafiają bezpośrednio do publicznego API Scryfall. Dane kart są buforowane w pamięci do odświeżenia strony.
- Pobieranie odbywa się paczkami do 75 kart, z odstępem co najmniej 550 ms. Odpowiedź HTTP 429 przerywa pobieranie i wymusza przerwę przed ponowną próbą.

## Drukowanie

Kliknięcie obrazka otwiera dane wydanie na Scryfall w nowej karcie. Najechanie myszą lub wybranie linku klawiszem Tab pokazuje obrazek w jego naturalnym rozmiarze, pomniejszony tylko gdy wymaga tego wielkość okna. Powiększenie nie przechwytuje kursora: sąsiednie karty pozostają aktywne pod nim. Escape zamyka podgląd; podgląd znika też przy przewijaniu i nie jest drukowany.

Poczekaj na „Obrazki gotowe”, użyj Ctrl+P / Cmd+P. Papier A4, pionowo, skala 100%, wyłącz nagłówki i stopki przeglądarki. CSS ustawia marginesy 8 mm i jawny podział stron. Domyślnie 30 obrazków (6 × 5), opcjonalnie 20 (5 × 4). Nazwy są też wypisane pod obrazkami. Grupy nie zostawiają pustych wierszy między sobą. Arkusz nie jest wydrukiem kart w rozmiarze do gry.

Błędne nazwy i niepobrane obrazki są zgłaszane. Jeśli lista jest niekompletna, ostrzeżenie trafia na osobną stronę wydruku, aby nie pomylić częściowego wyniku z pełnym deckiem.

## Sprawdzenie logiki

`node test.cjs`

Dane i obrazki: [Scryfall](https://scryfall.com/docs/api). Magic: The Gathering należy do Wizards of the Coast. Projekt nie jest oficjalnym produktem tych firm.
