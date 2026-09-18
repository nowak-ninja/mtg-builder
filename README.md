# MTG Builder

Prosty frontend do wyszukiwania fizycznych kart w bibliotece. Bez instalacji, zależności, klucza API i backendu.

## Uruchomienie

Otwórz `index.html` w przeglądarce. Do pobrania danych i obrazków potrzebne jest połączenie z internetem. Alternatywnie uruchom dowolny serwer plików statycznych, np. `python3 -m http.server 8000`, i wejdź na `http://localhost:8000`.

## GitHub Pages

W repozytorium ustaw **Settings → Pages → Build and deployment → Source: GitHub Actions**. Workflow `.github/workflows/pages.yml` po każdym pushu na `master` uruchamia `node test.cjs`, pakuje pliki aplikacji wraz z katalogiem `assets` i publikuje stronę. Można go też uruchomić ręcznie przez **Actions → Deploy GitHub Pages → Run workflow**. Jeśli zmienisz główną gałąź, zmień również `branches` w workflow. Nie potrzeba npm ani kompilacji.

Ścieżki plików są względne, więc strona działa również pod adresem projektu, np. `https://nowak-ninja.github.io/mtg-builder/`. Do publikacji trafiają tylko pliki aplikacji i font; testy i lokalne artefakty nie są publikowane.

Baza Scryfall nie jest plikiem w repozytorium. Przeglądarka pobiera ją bezpośrednio ze Scryfall na żądanie użytkownika i przechowuje w IndexedDB. Codzienny workflow pobierający bazę nie jest potrzebny: nie zaktualizowałby automatycznie bazy już zapisanej w przeglądarce. Aktualizację uruchamia przycisk w aplikacji.

## Lokalna baza kart

Pobieranie uruchamia wyłącznie przycisk **Pobierz bazę kart**, nie wklejenie decklisty ani otwarcie strony. Przy kolejnych wizytach zapisana baza jest odczytywana automatycznie z IndexedDB. Aplikacja pobierze oficjalny zrzut Scryfall **Default Cards**: wszystkie wydania w języku angielskim oraz wydania dostępne wyłącznie w innym języku. Baza zawiera również karty cyfrowe; historia rzadkości uwzględnia wyłącznie papierowe wydania. Nie trzeba pobierać wielokrotnie tych samych wydań we wszystkich tłumaczeniach z większego pliku All Cards.

Plik `jsonl.gz` jest rozpakowywany strumieniowo przez przeglądarkę. W IndexedDB zapisują się tylko pola potrzebne aplikacji, w tym adresy obrazków, bez samych obrazków, cen i tekstu zasad. Rozmiar zrzutu jest pokazywany podczas pobierania. Sprawdzony zrzut z 18.09.2026 miał 74,8 MiB, 118 239 wydań i zajmował około 18 MB w IndexedDB Chromium (rozmiar zależy od przeglądarki).

Po imporcie karty, konkretne wydania i wszystkie rzadkości są wyszukiwane lokalnie, także po zamknięciu strony. Decklisty nie powodują wtedy zapytań do API. Obrazki i otwierane strony kart nadal wymagają dostępu do Scryfall. Bez lokalnej bazy aplikacja działa jak wcześniej, korzystając z API.

**Aktualizuj bazę kart** sprawdza wersję zrzutu i pobiera ją tylko wtedy, gdy jest nowsza. Aktualizacja jest ręczna, np. po premierze dodatku; data bazy jest widoczna w panelu. Brakująca karta nie jest po cichu pobierana przez API - aplikacja sugeruje sprawdzenie nazwy lub aktualizację. Anulowanie, błąd pobierania i nieudany zapis zachowują poprzednią bazę. Po udanej aktualizacji kliknij ponownie **Ułóż karty**.

Baza należy do konkretnej przeglądarki i adresu strony. Plik HTML, localhost i GitHub Pages mają osobne dane. Usunięcie danych witryny lub tryb prywatny mogą usunąć zapis. Gdy przeglądarka nie pozwala używać IndexedDB dla `file://`, uruchom lokalny serwer plików albo GitHub Pages.

## Lista i sortowanie

- Jedna karta w wierszu: `Sol Ring`, `1 Sol Ring`, `1x Sol Ring` albo `1 Sol Ring (CMM) 410`. Angielskie nazwy Scryfall; dokładna nazwa, bez zgadywania literówek.
- Obsługiwane są nagłówki Commander/Deck i kategorie typów. Sekcje Sideboard/Maybeboard/Considering oraz linie `SB:` są pomijane. Kolejny nagłówek Deck/Commander wraca do głównej listy.
- Powtórzenia tego samego wydania są łączone; liczba sztuk jest widoczna na obrazku. Różne wydania pozostają osobno.
- Common → uncommon → rare + mythic. W każdej grupie: G, B, U, W, R, bezkolorowe, wielokolorowe, potem A-Z.
- Następnie non-basic landy common + uncommon A-Z, potem rare + mythic A-Z, bez podziału na kolory. Basic landy są domyślnie pokazywane na końcu; można je wyłączyć checkboxem.
- Używany jest kolor karty, nie jej commander color identity. Dla kart dwustronnych wyświetlany i klasyfikowany jest przód. Spell z landem na odwrocie pozostaje w grupie spelli.
- Obrazek i miejsce w kolejności odpowiadają konkretnemu wydaniu. Bez setu wybierane jest najstarsze wydanie, z preferencją dla papieru. API używa `prefer:oldest`, a baza lokalna daty premiery (remisy rozstrzyga numer kolekcjonerski). Art Series są wykluczone z wyszukiwania, także przy wskazaniu konkretnego wydania. Filtr działa również na wcześniej pobranej bazie, bez ponownego importu. Może się różnić od posiadanej karty.
- Checkbox **Sprawdzaj wszystkie rzadkości karty** jest domyślnie zaznaczony. Podpis bez kodu edycji pokazuje wszystkie rzadkości papierowych wydań karty, np. `Common / Rare / Mythic` z symbolem koloru, połączone według Oracle ID. Po odznaczeniu pokazuje tylko rzadkość wydania na obrazku i nie wykonuje skanowania API. Gdy sprawdzanie jest włączone, ale historia jest niedostępna, podpis wyraźnie mówi „tylko to wydanie”.
- Lista jest zapisywana wyłącznie lokalnie w przeglądarce. Bez pobranej bazy zapytania o karty trafiają bezpośrednio do publicznego API Scryfall, a wyniki są buforowane w pamięci do odświeżenia strony.
- W trybie API konkretne wydania są pobierane paczkami do 75 kart, a najstarsze wydania wyszukiwane po 10 nazw. Wszystkie zapytania mają odstęp co najmniej 550 ms. Odpowiedź HTTP 429 przerywa pobieranie i wymusza przerwę przed ponowną próbą.

## Drukowanie

Kliknięcie obrazka otwiera dane wydanie na Scryfall w nowej karcie. Najechanie myszą lub wybranie linku klawiszem Tab pokazuje obrazek w jego naturalnym rozmiarze, pomniejszony tylko gdy wymaga tego wielkość okna. Powiększenie nie przechwytuje kursora: sąsiednie karty pozostają aktywne pod nim. Escape zamyka podgląd; podgląd znika też przy przewijaniu i nie jest drukowany.

Poczekaj na „Obrazki gotowe”, użyj Ctrl+P / Cmd+P. Papier A4, pionowo, skala 100%, wyłącz nagłówki i stopki przeglądarki. CSS ustawia marginesy 8 mm i jawny podział stron. Domyślnie 30 obrazków (6 × 5), opcjonalnie 20 (5 × 4). Nazwy są też wypisane pod obrazkami. Grupy nie zostawiają pustych wierszy między sobą. Arkusz nie jest wydrukiem kart w rozmiarze do gry.

Błędne nazwy i niepobrane obrazki są zgłaszane. Jeśli lista jest niekompletna, ostrzeżenie trafia na osobną stronę wydruku, aby nie pomylić częściowego wyniku z pełnym deckiem.

## Sprawdzenie logiki

`node test.cjs`

Dane i obrazki: [Scryfall](https://scryfall.com/docs/api). Magic: The Gathering należy do Wizards of the Coast. Projekt nie jest oficjalnym produktem tych firm.

Symbole kolorów: [Mana 1.18.0](https://github.com/andrewgioia/mana), Andrew Gioia. Niezmieniony font jest dołączony lokalnie w `assets/fonts/mana.woff`; licencja SIL OFL 1.1 i źródło w `assets/fonts/LICENSE.txt`. Ikony mają polskie opisy dostępne dla czytników ekranu i po najechaniu kursorem.
