# MTG Builder

Prosty frontend do wyszukiwania fizycznych kart w bibliotece. Bez instalacji, zależności, klucza API i backendu.

https://nowak-ninja.github.io/mtg-builder

## Uruchomienie

Otwórz `index.html` w przeglądarce. Do pobrania danych i obrazków potrzebne jest połączenie z internetem. Alternatywnie uruchom dowolny serwer plików statycznych, np. `python3 -m http.server 8000`, i wejdź na `http://localhost:8000`.

Przycisk z ikoną w nagłówku przełącza kolejno motyw systemowy (półkole), jasny (słońce) i ciemny (księżyc). Wybór zapisuje się w `localStorage`; tryb systemowy na bieżąco reaguje na ustawienia systemu. Bez zapisanego wyboru używany jest tryb systemowy. Wydruk zawsze zachowuje jasne tło i kolory symboli many. Przy zablokowanej pamięci przycisk nadal działa do zamknięcia strony.

Akcja **Wyczyść** obok **Wstaw przykład** usuwa decklistę również z pamięci przeglądarki, czyści arkusz, listę proxy, filtry i komunikaty dotyczące decka. Usuwa również wszystkie zapamiętane ręczne zaznaczenia i odznaczenia proxy. Zachowuje bazę kart, kolekcję i ustawienia; po ponownym ułożeniu decka proxy wynikają z posiadanej kolekcji. Podczas pobierania jest czasowo nieaktywna.

## GitHub Pages

W repozytorium ustaw **Settings → Pages → Build and deployment → Source: GitHub Actions**. Workflow `.github/workflows/pages.yml` po każdym pushu na `master` uruchamia `node test.cjs`, pakuje pliki aplikacji wraz z katalogiem `assets` i publikuje stronę. Można go też uruchomić ręcznie przez **Actions → Deploy GitHub Pages → Run workflow**. Jeśli zmienisz główną gałąź, zmień również `branches` w workflow. Nie potrzeba npm ani kompilacji.

Ścieżki plików są względne, więc strona działa również pod adresem projektu, np. `https://nowak-ninja.github.io/mtg-builder/`. Do publikacji trafiają tylko pliki aplikacji i font; testy i lokalne artefakty nie są publikowane.

Baza Scryfall nie jest plikiem w repozytorium. Przeglądarka pobiera ją bezpośrednio ze Scryfall na żądanie użytkownika i przechowuje w IndexedDB. Codzienny workflow pobierający bazę nie jest potrzebny: nie zaktualizowałby automatycznie bazy już zapisanej w przeglądarce. Aktualizację uruchamia przycisk w aplikacji.

## Lokalna baza kart

Pobieranie uruchamia wyłącznie przycisk **Pobierz bazę kart**, nie wklejenie decklisty ani otwarcie strony. Przy kolejnych wizytach zapisana baza jest odczytywana automatycznie z IndexedDB. Przy otwarciu strony aplikacja sprawdza jej aktualność przez małe zapytanie o wersję zrzutu Scryfall, bez pobierania całej bazy i bez blokowania układania kart. W punkcie **03** pojawia się status: baza aktualna, dostępna aktualizacja albo brak możliwości sprawdzenia (np. offline). Bez zapisanej bazy zapytanie nie jest wykonywane. Aplikacja pobierze oficjalny zrzut Scryfall **Default Cards**: wszystkie wydania w języku angielskim oraz wydania dostępne wyłącznie w innym języku. Baza zawiera również karty cyfrowe; historia rzadkości uwzględnia wyłącznie papierowe wydania. Nie trzeba pobierać wielokrotnie tych samych wydań we wszystkich tłumaczeniach z większego pliku All Cards.

Plik `jsonl.gz` jest rozpakowywany strumieniowo przez przeglądarkę. W IndexedDB zapisują się tylko pola potrzebne aplikacji, w tym adresy obrazków, bez samych obrazków, cen i tekstu zasad. Zachowujemy też identyfikatory powiązanych tokenów z `all_parts`. Rozmiar zrzutu jest pokazywany podczas pobierania. Sprawdzony zrzut z 18.09.2026 miał 74,8 MiB, 118 239 wydań i zajmował około 18 MB w IndexedDB Chromium (rozmiar zależy od przeglądarki).

Po imporcie karty i wszystkie rzadkości są wyszukiwane lokalnie, także po zamknięciu strony. Decklisty nie powodują wtedy zapytań do API, poza uzupełnianiem brakujących danych opcjonalnej listy tokenów w starszej bazie. Obrazki i otwierane strony kart nadal wymagają dostępu do Scryfall. Bez lokalnej bazy aplikacja działa jak wcześniej, korzystając z API.

**Aktualizuj bazę kart** sprawdza wersję zrzutu i pobiera ją tylko wtedy, gdy jest nowsza albo zapisana baza pochodzi ze starszej wersji aplikacji bez powiązań tokenów. Aktualizacja jest ręczna, np. po premierze dodatku; data bazy jest widoczna w panelu. Brakująca karta nie jest po cichu pobierana przez API - aplikacja sugeruje sprawdzenie nazwy lub aktualizację. Anulowanie, błąd pobierania i nieudany zapis zachowują poprzednią bazę. Po udanej aktualizacji kliknij ponownie **Ułóż karty**.

Baza należy do konkretnej przeglądarki i adresu strony. Plik HTML, localhost i GitHub Pages mają osobne dane. Usunięcie danych witryny lub tryb prywatny mogą usunąć zapis. Gdy przeglądarka nie pozwala używać IndexedDB dla `file://`, uruchom lokalny serwer plików albo GitHub Pages.

## Twoja kolekcja

Kliknij **Wczytaj kolekcję CSV** po lewej i wybierz eksport Deckstats z kolumnami `amount` i `card_name`. Import jest lokalny: plik nie trafia na serwer ani do repozytorium. Nazwy kart są zapisywane w IndexedDB i odczytywane przy kolejnych wizytach. Następny import zastępuje kolekcję; błędny plik lub nieudany zapis zachowuje poprzednią. Kolekcja i baza Scryfall są przechowywane osobno - ich aktualizacje nie nadpisują się wzajemnie.

Dopasowanie ignoruje edycję, foil, wielkość liter i akcenty; uwzględnia nazwy obu stron kart. Wystarczy co najmniej jedna posiadana sztuka. Nie sprawdzamy niedoboru liczby kopii. Bez wczytanej kolekcji karty nie są automatycznie oznaczane jako brakujące.

Karty oznaczone jako proxy zachowują kolor many w ramce i delikatnym tle. Wyróżnia je przerywany obrys (także na wydruku) oraz czarno-biały obrazek bez przygaszenia, przekreślenia i litery P, również na wydruku i w powiększonym podglądzie. Nazwa jest nad obrazkiem, a rzadkość pod nim. Linki i podgląd pozostają aktywne. Po prawej pojawia się lista do skopiowania w formacie `liczba nazwa`, z ilościami z decka; uwzględnia też ukryte basic landy. Na małym ekranie panel jest pod arkuszami. Lista dotyczy kart rozpoznanych przez aplikację - błędy nazw lub pobierania nadal wymagają sprawdzenia komunikatów. Import od razu aktualizuje gotowy arkusz.

Checkbox **Proxy** w prawym górnym rogu ramki pozwala ręcznie oznaczyć posiadaną kartę jako proxy, także bez importowania kolekcji. Trafia ona na tę samą listę po prawej i otrzymuje czarno-biały obrazek. Można też odznaczyć proxy nadane automatycznie za brak w kolekcji. Ręczne zaznaczenia i odznaczenia mają pierwszeństwo przed kolekcją i są zapamiętywane po nazwie w przeglądarce, także po odświeżeniu, zmianie decklisty i ponownym imporcie kolekcji. Akcja **Wyczyść** usuwa te ręczne decyzje również z pamięci przeglądarki. Checkboxy nie są drukowane.

Jeśli posiadana karta nadal jest proxy, sprawdź podpowiedź po najechaniu na jej ramkę: „Ręcznie oznaczone proxy” oznacza zapamiętane ręczne zaznaczenie. Odznacz **Proxy** przy tej karcie. Przy komunikacie „Brak w kolekcji - proxy” wczytaj aktualny CSV. Przecinki w nazwach ujętych w podwójne cudzysłowy (np. `"Yavimaya, Cradle of Growth"`) są częścią nazwy i nie rozdzielają jej podczas importu.

## Lista i sortowanie

- Jedna karta w wierszu, nazwa lub liczba i nazwa: `1 Sol Ring`. Działa też sama nazwa `Sol Ring` oraz zapis `1x Sol Ring`. Angielskie nazwy Scryfall; dokładna nazwa, bez zgadywania literówek. Dopiski edycji i numeru w starszych eksportach są ignorowane.
- Nazwy kart dzielonych i dwustronnych mogą używać `/` lub `//`, ze spacjami albo bez, np. `Dollmaker's Shop/Porcelain Gallery`. Zapisy są automatycznie ujednolicane przed wyszukiwaniem w bazie lokalnej lub API. Różne zapisy tej samej karty są łączone i sumują liczbę sztuk. Nie trzeba ponownie pobierać bazy.
- Obsługiwane są nagłówki Commander/Deck i kategorie typów. Sekcje Sideboard/Maybeboard/Considering oraz linie `SB:` są pomijane. Kolejny nagłówek Deck/Commander wraca do głównej listy.
- Powtórzenia tej samej karty są łączone, także przy różnych dopiskach edycji w starszym eksporcie; liczba sztuk jest widoczna w lewym górnym rogu ramki, poza grafiką karty. Etykieta ma jasne tło także w ciemnym motywie.
- Common → uncommon → rare + mythic. W każdej grupie: G, B, U, W, R, bezkolorowe, wielokolorowe, potem A-Z.
- Następnie non-basic landy Common + Uncommon A-Z, potem rare + mythic A-Z, bez podziału na kolory. Basic landy są domyślnie pokazywane na końcu; można je wyłączyć checkboxem.
- Używany jest kolor karty, nie jej commander color identity. Dla kart dwustronnych wyświetlany i klasyfikowany jest przód. Spell z landem na odwrocie pozostaje w grupie spelli.
- Obrazek i miejsce w kolejności odpowiadają konkretnemu wydaniu. Automatycznie wybierane jest najstarsze wydanie, z preferencją dla papieru. API używa `prefer:oldest`, a baza lokalna daty premiery (remisy rozstrzyga numer kolekcjonerski). Art Series, tokeny i dodatki spoza talii (emblematy, Plane/Phenomenon, Scheme, Vanguard, Conspiracy, Dungeon, Attraction i Contraption) są wykluczone z wyszukiwania decklisty. Filtr działa również na wcześniej pobranej bazie, bez ponownego importu. Może się różnić od posiadanej karty.
- Checkbox **Sprawdzaj wszystkie rzadkości karty** jest domyślnie zaznaczony. Podpis pod obrazkiem bez kodu edycji pokazuje wszystkie rzadkości papierowych wydań karty, np. `Common / Rare / Mythic`, połączone według Oracle ID. Po odznaczeniu pokazuje tylko rzadkość wydania na obrazku i nie wykonuje skanowania API. Gdy sprawdzanie jest włączone, ale historia jest niedostępna, podpis wyraźnie mówi „tylko to wydanie”.
- Lista jest zapisywana wyłącznie lokalnie w przeglądarce. Bez pobranej bazy zapytania o karty trafiają bezpośrednio do publicznego API Scryfall, a wyniki są buforowane w pamięci do odświeżenia strony.
- W trybie API najstarsze wydania są wyszukiwane paczkami po 10 nazw. Wszystkie zapytania mają odstęp co najmniej 550 ms. Odpowiedź HTTP 429 przerywa pobieranie i wymusza przerwę przed ponowną próbą.

Zapisana decklista jest automatycznie układana po otwarciu strony. Aplikacja najpierw odczytuje lokalną bazę i kolekcję; bez lokalnej bazy korzysta z API tak jak po kliknięciu **Ułóż karty**. Pusta lista nie uruchamia pobierania kart.

Nazwy rarity w podpisach, nagłówkach, filtrach i opisie sortowania mają własne kolory: Common neutralny, Uncommon srebrny, Rare złoty, Mythic pomarańczowoczerwony, Special fioletowy. Bonus ma pomocniczy odcień miedziany. Jasny i ciemny motyw używają odcieni dopasowanych do tła; druk zachowuje paletę jasną.

## Filtry arkusza

Panel **Filtry kart** nad siatką jest domyślnie zwinięty. Kliknięcie nagłówka rozwija lub zwija panel; jego stan nie jest zapisywany, a po odświeżeniu znów jest zwinięty. Zwijanie nie wyłącza aktywnych filtrów.

W panelu można wybierać kilka rarity i kolorów, status proxy przez checkboxy **Proxy** i **Bez proxy** po prawej oraz fragment nazwy karty (bez rozróżniania wielkości liter, także nazwy odwrotu). Zmiany działają od razu, bez przycisku zatwierdzania i bez nowych zapytań o dane kart. W jednej grupie wystarczy dowolna zaznaczona opcja; między grupami warunki muszą być spełnione razem. Brak zaznaczeń oznacza wszystkie opcje; zaznaczenie obu checkboxów proxy również pokazuje oba warianty. Kolory odpowiadają sekcjom biblioteki, z osobnymi bezkolorowymi i wielokolorowymi.

Filtr rarity bierze pod uwagę wszystkie znane papierowe rarity karty z lokalnej bazy lub pobranej historii, nawet gdy podpis pokazuje tylko pojedyncze wydanie. Bez historii używa rarity widocznego wydania i pokazuje informację o ograniczeniu. Filtry obejmują też włączone tokeny (według rarity ich wydania); tokeny zawsze są „bez proxy”.

Arkusze i licznik stron przeliczają się po filtrowaniu, a druk obejmuje wyłącznie widoczne karty. Lista proxy po prawej nadal obejmuje cały deck. „Wyczyść filtry” przywraca pełny widok. Filtry nie trafiają do localStorage, IndexedDB ani adresu URL; po odświeżeniu strony wszystkie wracają do ustawień domyślnych.

## Tokeny

Opcja **Dodaj tokeny do decka** jest domyślnie wyłączona. Po włączeniu na końcu arkusza (po basic landach) pojawia się sekcja **Tokeny**, sortowana A-Z, z obrazkami, linkami i podglądem. Sekcja korzysta z tego samego podziału stron i jest drukowana.

Lista pochodzi z powiązań `all_parts` / `component: token` udostępnianych przez Scryfall, bez zgadywania z tekstu zasad. Pokazujemy najnowsze papierowe wydanie każdej tożsamości Oracle tokena dostępne w używanej bazie; różne tokeny o tej samej nazwie pozostają osobno. To rodzaje tokenów, nie wymagana liczba sztuk. Lista zależy od powiązań Scryfall i nie obejmuje każdej możliwej kopii dowolnego permanenta. Emblematy i inne dodatki nie trafiają do tej sekcji.

Nowo pobrana baza zachowuje powiązania i rekordy tokenów, ale nie dopasowuje ich jako kart talii. W starszej bazie brakujące powiązania lub tokeny są uzupełniane paczkami do 75 identyfikatorów przez API i buforowane do odświeżenia strony. Najnowsze wydania tokenów są wybierane lokalnie, a przy brakujących danych wyszukiwane przez API paczkami po 10 tożsamości Oracle. **Aktualizuj bazę kart** zapisuje nowy format na kolejne wizyty. Wyłączona opcja nie pobiera danych tokenów. Błędy pobierania zgłaszamy jako niekompletny arkusz.

Tokeny nie są sprawdzane w kolekcji ani dodawane do listy proxy: sama nazwa z CSV nie rozróżnia wariantów tokena ani tokena od zwykłej karty o tej samej nazwie (np. Timeless Witness).

## Drukowanie

Kliknięcie obrazka otwiera dane wydanie na Scryfall w nowej karcie. Najechanie myszą lub wybranie linku klawiszem Tab pokazuje obrazek w jego naturalnym rozmiarze, pomniejszony tylko gdy wymaga tego wielkość okna. Zaokrąglenia rogów skalują się razem z obrazkiem, także w powiększeniu i na wydruku. Powiększenie nie przechwytuje kursora: sąsiednie karty pozostają aktywne pod nim. Escape zamyka podgląd; podgląd znika też przy przewijaniu i nie jest drukowany.

Poczekaj na „Karty gotowe”, użyj Ctrl+P / Cmd+P. Papier A4, pionowo, skala 100%, wyłącz nagłówki i stopki przeglądarki. CSS ustawia marginesy 8 mm i jawny podział stron. Domyślnie do 30 kart (6 kolumn), opcjonalnie do 20 (5 kolumn). Każda karta ma ramkę i blade tło w kolorze many (szare dla bezkolorowych, złote dla wielokolorowych), także na wydruku. W ciemnym motywie tło jest przyciemnione. Nad obrazkiem jest pasek: symbol koloru, duża pierwsza litera nazwy i nazwa karty. Pod obrazkiem są dostępne rzadkości. Grupy biblioteki zaczynają się od nowego wiersza z nagłówkiem i odstępem od poprzedniej sekcji (2 mm na wydruku); rare i mythic pozostają razem, a landy mają osobne sekcje. Na kolejnej stronie nagłówek jest powtarzany z dopiskiem „ciąg dalszy”. Podział stron uwzględnia miejsce na nagłówki i nie dzieli kart; częściowo zapełnione wiersze grup mogą zwiększyć liczbę stron. Arkusz nie jest wydrukiem kart w rozmiarze do gry.

Błędne nazwy i niepobrane obrazki są zgłaszane. Jeśli lista jest niekompletna, ostrzeżenie trafia na osobną stronę wydruku, aby nie pomylić częściowego wyniku z pełnym deckiem.

## Sprawdzenie logiki

`node test.cjs`

Dane i obrazki: [Scryfall](https://scryfall.com/docs/api). Magic: The Gathering należy do Wizards of the Coast. Projekt nie jest oficjalnym produktem tych firm.

Symbole kolorów: [Mana 1.18.0](https://github.com/andrewgioia/mana), Andrew Gioia. Niezmieniony font jest dołączony lokalnie w `assets/fonts/mana.woff`; licencja SIL OFL 1.1 i źródło w `assets/fonts/LICENSE.txt`. Symbole mają kolorowe tła również na wydruku (wielokolorowe - złote, bezkolorowe - szare); CSS zachowuje ich kolory. Ikony mają polskie opisy dostępne dla czytników ekranu i po najechaniu kursorem.
