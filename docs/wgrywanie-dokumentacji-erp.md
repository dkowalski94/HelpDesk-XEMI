# Wgrywanie dokumentacji ERP do bazy wiedzy HelpDesku

Ta instrukcja jest dla serwisanta. Opisuje, jak raz przygotować komputer i jak potem wgrywać,
sprawdzać i usuwać dokumentację ERP (pliki PDF) w bazie wiedzy HelpDesku. Nie trzeba umieć
programować: wystarczy przepisywać polecenia z ramek do okna PowerShell.

Co robi narzędzie: odczytuje tekst z każdego pliku PDF (bez obrazków i zrzutów ekranu), dzieli go
na fragmenty, wysyła je do OpenAI po „wektory” (dzięki nim HelpDesk potrafi później znaleźć
fragment pasujący do zgłoszenia) i zapisuje wszystko w bazie wiedzy. Dokument trafia do bazy
w całości albo wcale — przerwane wgrywanie niczego nie psuje.

## Spis treści

1. [Jednorazowa konfiguracja](#1-jednorazowa-konfiguracja)
2. [Codzienna praca](#2-codzienna-praca)
3. [Komunikaty i co z nimi zrobić](#3-komunikaty-i-co-z-nimi-zrobić)
4. [Aktualizacja narzędzia](#4-aktualizacja-narzędzia)
5. [Zgłaszanie problemu](#5-zgłaszanie-problemu)

---

## 1. Jednorazowa konfiguracja

Robisz to tylko raz na danym komputerze.

### 1.1. Czego potrzebujesz

- **Konto serwisanta w HelpDesku** — ten sam e-mail i hasło, którymi logujesz się do aplikacji.
  Konto klienta nie wystarczy.
- **Od administratora**:
  - dostęp do repozytorium `HelpDesk-XEMI` na GitHubie (jeśli jest prywatne),
  - adres bazy HelpDesku (`SUPABASE_URL`),
  - klucz publiczny bazy (`SUPABASE_KEY`),
  - klucz API OpenAI (`OPENAI_API_KEY`).
- Komputer z Windows i dostępem do internetu.

### 1.2. Zainstaluj Node.js 22 LTS

1. Wejdź na <https://nodejs.org/> i pobierz instalator **Windows Installer (.msi)** w wersji
   **22 LTS**.
2. Uruchom instalator i klikaj „Next” z ustawieniami domyślnymi.

### 1.3. Zainstaluj Git

1. Wejdź na <https://git-scm.com/download/win> i pobierz instalator.
2. Uruchom go i klikaj „Next” z ustawieniami domyślnymi.

### 1.4. Otwórz PowerShell i sprawdź instalację

1. Kliknij **Start**, wpisz `PowerShell` i otwórz **Windows PowerShell** (albo **Terminal**).
   Jeśli PowerShell był otwarty przed instalacją, zamknij go i otwórz ponownie.
2. Wpisz kolejno (każdą linię zatwierdź klawiszem Enter):

   ```powershell
   node --version
   git --version
   ```

   Pierwsze polecenie powinno pokazać `v22.` i dalsze cyfry, drugie — `git version …`.

> **Jeśli zobaczysz błąd** w rodzaju _„nie można załadować pliku npm.ps1, ponieważ uruchamianie
> skryptów jest wyłączone w tym systemie”_ — w każdym poleceniu z tej instrukcji wpisuj
> `npm.cmd` zamiast `npm` (np. `npm.cmd run ingest -- --lista`). Działa tak samo.

### 1.5. Pobierz narzędzie

W PowerShellu wpisz:

```powershell
cd $HOME\Documents
git clone https://github.com/dkowalski94/HelpDesk-XEMI.git
cd HelpDesk-XEMI
```

Narzędzie jest teraz w folderze `Dokumenty\HelpDesk-XEMI`. Jeśli Git poprosi o zalogowanie do
GitHuba, zaloguj się kontem, któremu administrator dał dostęp.

### 1.6. Zainstaluj składniki narzędzia

Będąc w folderze `HelpDesk-XEMI`, wpisz:

```powershell
npm ci
```

Trwa to kilka minut. Ostrzeżenia (`npm warn …`) są normalne; ważne, żeby na końcu nie było
linii zaczynających się od `npm error`.

### 1.7. Utwórz plik ustawień `.env.ingest`

1. Skopiuj szablon i otwórz go w Notatniku:

   ```powershell
   Copy-Item .env.ingest.example .env.ingest
   notepad .env.ingest
   ```

2. Uzupełnij wartości po znaku `=` (bez spacji i bez cudzysłowów):

   | Ustawienie       | Co wpisać                                                                                  | Skąd to wziąć                                                                        |
   | ---------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
   | `SUPABASE_URL`   | adres bazy, np. `https://abcdefghijklmnop.supabase.co` (musi zaczynać się od `https://`)    | od administratora                                                                    |
   | `SUPABASE_KEY`   | klucz **publiczny** bazy (`sb_publishable_…` albo długi klucz „anon”)                      | od administratora — ten sam, którego używa aplikacja HelpDesk                        |
   | `OPENAI_API_KEY` | klucz OpenAI, zaczyna się od `sk-`                                                          | od administratora                                                                    |
   | `HELPDESK_EMAIL` | (opcjonalnie) Twój e-mail w HelpDesku                                                      | Twoje konto; jeśli zostawisz puste, skrypt zapyta o e-mail przy każdym uruchomieniu |

   Przykład wypełnionej linii: `SUPABASE_URL=https://abcdefghijklmnop.supabase.co`

3. Zapisz plik (**Ctrl+S**) i zamknij Notatnik.

**Ważne:**

- **Hasła nie wpisuj do pliku.** Skrypt zawsze pyta o nie przy uruchomieniu.
- **Pliku `.env.ingest` nie wysyłaj nikomu** — ani e-mailem, ani na czacie, ani w zgłoszeniu.
  Zawiera klucze, za których użycie płaci firma. Git go pomija, więc nie trafi do repozytorium.
- Jeśli administrator przekaże Ci klucz zaczynający się od `sb_secret_` albo nazwany
  „service_role” — to nie ten. Skrypt go odrzuci; poproś o klucz publiczny.
- Twórz i poprawiaj ten plik w Notatniku. Nie twórz go poleceniem `echo … > .env.ingest`
  w PowerShellu — zapisuje ono plik w kodowaniu, którego skrypt nie odczyta.

### 1.8. Sprawdź, czy wszystko działa

```powershell
npm run ingest -- --lista
```

Skrypt zapyta o e-mail (jeśli nie wpisałeś go w pliku) i hasło. Podczas wpisywania hasła nic
się nie wyświetla — to celowe; wpisz je i naciśnij Enter. Jeśli zobaczysz `Zalogowano.`, a potem
listę dokumentów albo komunikat `Baza wiedzy nie zawiera jeszcze żadnych dokumentów ERP.` —
konfiguracja jest gotowa.

---

## 2. Codzienna praca

Za każdym razem zacznij od otwarcia PowerShella i przejścia do folderu narzędzia:

```powershell
cd $HOME\Documents\HelpDesk-XEMI
```

Wszystkie polecenia mają postać `npm run ingest -- …` — dwa myślniki `--` po słowie `ingest` są
potrzebne. **Ścieżki ze spacjami lub polskimi literami podawaj w cudzysłowie**, np.
`"C:\Dokumentacja\Księgowość.pdf"`. Pełną ścieżkę pliku łatwo skopiować: w Eksploratorze kliknij
plik prawym przyciskiem myszy i wybierz **Kopiuj jako ścieżkę** (skopiowana ścieżka ma już
cudzysłów).

### 2.1. Podgląd bez wgrywania (`--dry-run`)

Pokazuje, na ile fragmentów zostanie pocięty dokument, i pierwsze trzy fragmenty. Nie łączy się
z bazą ani z OpenAI, nie pyta o hasło i nie potrzebuje pliku `.env.ingest`.

```powershell
npm run ingest -- --dry-run "C:\Dokumentacja\Magazyn.pdf"
```

Warto go użyć przy nowym dokumencie: jeśli skrypt zgłosi, że PDF nie zawiera tekstu, dokument
trzeba najpierw przepuścić przez OCR (patrz [komunikaty](#3-komunikaty-i-co-z-nimi-zrobić)).

### 2.2. Wgranie dokumentów

Jeden plik:

```powershell
npm run ingest -- "C:\Dokumentacja\Magazyn.pdf"
```

Kilka plików naraz:

```powershell
npm run ingest -- "C:\Dokumentacja\Magazyn.pdf" "C:\Dokumentacja\Księgowość.pdf"
```

Cały folder — wszystkie pliki `.pdf` leżące bezpośrednio w nim (podfoldery są pomijane):

```powershell
npm run ingest -- "C:\Dokumentacja"
```

Skrypt zapyta o e-mail i hasło, sprawdzi, czy to konto serwisanta, a potem przetworzy pliki
jeden po drugim. Przykładowy przebieg:

```text
Logowanie jako jan.kowalski@firma.pl...
Zalogowano.
Wgrywanie do bazy wiedzy: 2 plik(ów).

[1/2] Magazyn.pdf
  Strony:     412 (z tekstem: 398)
  Fragmenty:  305
  Obliczanie wektorów (OpenAI): 7/305
  ...
  Obliczanie wektorów (OpenAI): 305/305
  wysyłanie 1/7
  ...
  wysyłanie 7/7
  Dodano nowy dokument: 305 fragmentów.

[2/2] Księgowość.pdf
  Bez zmian, pominięto (ten sam plik jest już w bazie; --wymus wgra go ponownie).

Podsumowanie: dodano 1, zastąpiono 0, bez zmian 1, błędy 0.
```

Co warto wiedzieć:

- **Nowa wersja dokumentu** — po prostu wgraj plik o tej samej nazwie jeszcze raz. Stara wersja
  zostanie zastąpiona (`Zastąpiono poprzednią wersję dokumentu`), nic się nie zdubluje.
- **Plik bez zmian jest pomijany.** Można więc spokojnie wgrywać co jakiś czas cały folder —
  skrypt wgra tylko pliki, które się zmieniły.
- **Dokument jest rozpoznawany po nazwie pliku** (wielkość liter nie ma znaczenia:
  `Magazyn.pdf` i `magazyn.PDF` to ten sam dokument). Jeśli zmienisz nazwę pliku, skrypt uzna go
  za nowy dokument, a stary zostanie w bazie — usuń go wtedy poleceniem `--usun`
  ([2.5](#25-usunięcie-dokumentu---usun)).
- Dwóch plików o tej samej nazwie (np. z różnych folderów) nie da się wgrać w jednym
  uruchomieniu — drugi zostanie pominięty.
- Wgrywanie dużego dokumentu trwa kilka minut. **Nie zamykaj okna**, dopóki nie pojawi się
  `Podsumowanie`. Jeśli jednak okno zostanie zamknięte albo przerwiesz skrypt (**Ctrl+C**), baza
  zostaje bez zmian — uruchom to samo polecenie ponownie.
- Jeśli w podsumowaniu `błędy` są większe od zera, przewiń wyżej i przeczytaj linię `BŁĄD: …`
  przy danym pliku.

### 2.3. Wgranie ponownie, mimo braku zmian (`--wymus`)

Zwykle niepotrzebne. Użyj, gdy administrator o to poprosi (np. po zmianie sposobu dzielenia
dokumentów na fragmenty):

```powershell
npm run ingest -- --wymus "C:\Dokumentacja"
```

### 2.4. Lista wgranych dokumentów (`--lista`)

```powershell
npm run ingest -- --lista
```

Pokazuje tabelę: nazwa pliku, kiedy i kto go wgrał, liczba stron i fragmentów. Klucz OpenAI nie
jest tu potrzebny.

### 2.5. Usunięcie dokumentu (`--usun`)

Podaj samą nazwę pliku, tak jak w `--lista` (pełna ścieżka też zadziała):

```powershell
npm run ingest -- --usun Magazyn.pdf
npm run ingest -- --usun "Księgowość.pdf"
```

Dokument i wszystkie jego fragmenty znikają z bazy wiedzy. Plik na Twoim dysku zostaje
nietknięty.

### 2.6. Pomoc (`--pomoc`)

```powershell
npm run ingest -- --pomoc
```

Wyświetla krótką listę opcji i przykładów.

`--dry-run`, `--lista` i `--usun` działają osobno — nie łącz ich ze sobą w jednym poleceniu;
`--wymus` łączy się tylko z wgrywaniem plików.

---

## 3. Komunikaty i co z nimi zrobić

Komunikaty o błędach zaczynają się od `BŁĄD:`. Pliku ustawień i konta skrypt sprawdza, zanim
otworzy jakikolwiek plik — taki błąd kończy pracę od razu. Jeśli błąd dotyczy jednego pliku (także
chwilowy brak połączenia z OpenAI), skrypt przechodzi do następnego. Nieprawidłowy klucz OpenAI,
wyczerpany limit OpenAI oraz brak połączenia z bazą, odmowa dostępu lub brak migracji zatrzymują
całe wgrywanie (`Przerwano — pozostałe pliki (…) nie zostały przetworzone.`).

### Plik ustawień `.env.ingest`

| Komunikat                                                                                        | Co zrobić                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Brak ustawienia OPENAI_API_KEY. Uzupełnij plik .env.ingest …` (albo `Brak ustawień: …`)          | Otwórz plik (`notepad .env.ingest`) i wpisz brakującą wartość po `=`. Sprawdź, czy plik nazywa się dokładnie `.env.ingest` i leży w folderze `HelpDesk-XEMI`. |
| `Ustawienie SUPABASE_URL nie jest poprawnym adresem (powinno wyglądać jak https://xxxx.supabase.co).` | Popraw adres — musi zaczynać się od `https://`, bez spacji i cudzysłowów.                                                                                    |
| `Ustawienie SUPABASE_KEY zawiera klucz tajny (service_role / sb_secret_…) …`                     | Wpisano niewłaściwy klucz. Usuń go z pliku i poproś administratora o klucz publiczny.                                                                            |
| `Plik .env.ingest jest zapisany w kodowaniu UTF-16 …`                                            | Otwórz plik w Notatniku, wybierz **Plik → Zapisz jako**, na dole ustaw kodowanie **UTF-8** i zapisz.                                                            |

### Logowanie

| Komunikat                                                                           | Co zrobić                                                                                                                                                                           |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Nieprawidłowy e-mail lub hasło. …`                                                 | Użyj tych samych danych, co w aplikacji HelpDesk. Sprawdź `HELPDESK_EMAIL` w pliku ustawień, jeśli go wpisałeś.                                                                     |
| `To konto nie jest kontem serwisanta. …`                                            | Zalogowałeś się kontem klienta. Użyj konta serwisanta albo poproś administratora o nadanie roli.                                                                                     |
| `Adres e-mail tego konta nie został jeszcze potwierdzony. …`                        | Kliknij link potwierdzający z e-maila od HelpDesku i spróbuj ponownie.                                                                                                              |
| `Nie podano e-maila albo hasła.`                                                    | Uruchom ponownie i wpisz oba.                                                                                                                                                       |
| `Nie można bezpiecznie zapytać o hasło, bo skrypt nie działa w zwykłym oknie terminala. …` | Uruchom polecenie w PowerShellu lub Windows Terminal (nie w Git Bash ani w oknie edytora).                                                                                   |
| `Anulowano.`                                                                        | Przerwałeś wpisywanie (Ctrl+C). Uruchom ponownie.                                                                                                                                   |

### Baza HelpDesku

| Komunikat                                                                           | Co zrobić                                                                                                                                  |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `Nie można połączyć się z bazą HelpDesku …`                                         | Sprawdź internet i `SUPABASE_URL`. Jeśli wszystko się zgadza, spróbuj za kilka minut.                                                      |
| `Wysyłanie dokumentu zostało przerwane lub zakłócone … Baza HelpDesku jest bez zmian — uruchom wgrywanie ponownie.` | Uruchom to samo polecenie ponownie. Upewnij się, że nikt inny nie wgrywa w tym samym czasie tego samego dokumentu. |
| `Baza przerwała zapis dokumentu, bo trwał za długo. …`                              | Spróbuj ponownie; jeśli się powtarza, zgłoś administratorowi.                                                                               |
| `Baza nie ma jeszcze migracji — skontaktuj się z administratorem.`                  | Baza nie jest jeszcze przygotowana na dokumentację ERP. Zgłoś administratorowi — sam nic tu nie zrobisz.                                  |
| `Baza odmówiła dostępu — ta operacja jest dostępna tylko dla konta serwisanta.`     | Zgłoś administratorowi (Twoje konto mogło stracić rolę serwisanta).                                                                        |
| `Baza odpowiedziała błędem: …`                                                      | Zgłoś administratorowi razem z treścią komunikatu ([sekcja 5](#5-zgłaszanie-problemu)).                                                    |

### OpenAI

| Komunikat                                                                              | Co zrobić                                                                                          |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `OpenAI chwilowo nie odpowiada lub ogranicza liczbę zapytań — ponowna próba za … s …`  | Nic — to nie błąd. Skrypt sam poczeka i spróbuje ponownie.                                         |
| `Klucz OpenAI jest nieprawidłowy. …`                                                   | Sprawdź `OPENAI_API_KEY` w pliku ustawień (cały klucz, bez spacji). Jeśli jest dobry, poproś administratora o nowy. |
| `Konto OpenAI nie ma już środków (limit wykorzystany). …`                              | Zgłoś administratorowi — trzeba doładować konto OpenAI.                                            |
| `Nie można połączyć się z OpenAI … mimo kilku prób. …`                                 | Sprawdź internet i spróbuj ponownie.                                                               |
| `OpenAI odpowiedziało błędem: …` / `OpenAI zwróciło nieoczekiwaną odpowiedź …`          | Spróbuj ponownie; jeśli się powtarza, zgłoś administratorowi.                                      |

### Pliki PDF

| Komunikat                                                                                    | Co zrobić                                                                                                                                   |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `Bez zmian, pominięto (ten sam plik jest już w bazie; --wymus wgra go ponownie).`            | Nic — ten dokument jest już aktualny.                                                                                                       |
| `PDF nie zawiera tekstu — możliwe, że to skan. …`                                            | Dokument jest zeskanowany (same obrazy). Przepuść go przez OCR (np. w programie do PDF), zapisz i wgraj ponownie.                           |
| `PDF jest chroniony hasłem — zapisz go bez hasła i spróbuj ponownie.`                         | Otwórz PDF, zapisz kopię bez hasła i wgraj ją.                                                                                              |
| `Plik nie jest poprawnym PDF-em albo jest uszkodzony.`                                       | Pobierz lub wyeksportuj plik ponownie.                                                                                                      |
| `Nie znaleziono: … — pominięto.`                                                             | Sprawdź ścieżkę. Ścieżkę ze spacjami podaj w cudzysłowie; najprościej użyj **Kopiuj jako ścieżkę**.                                         |
| `To nie jest plik PDF: … — pominięto.`                                                       | Narzędzie wgrywa tylko pliki `.pdf`.                                                                                                        |
| `W folderze nie ma plików PDF: … — pominięto.`                                               | Pliki PDF leżą pewnie w podfolderze — podaj ścieżkę do niego.                                                                               |
| `Nie można odczytać: … — pominięto.` / `Nie można odczytać pliku …`                          | Zamknij plik, jeśli jest otwarty w innym programie, i sprawdź, czy masz do niego dostęp.                                                   |
| `Pominięto …: plik o tej samej nazwie (…) jest już na liście. …`                             | Dwa pliki o tej samej nazwie. Zmień nazwę jednego albo wgraj tylko właściwy.                                                                |

### Polecenie

| Komunikat                                                                    | Co zrobić                                                                                               |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `Nieprawidłowe wywołanie: nieznana opcja …`                                  | Literówka w opcji. Opcje piszemy bez polskich liter: `--usun`, `--wymus`, `--lista`.                    |
| `Nieprawidłowe wywołanie: opcja --usun wymaga wartości, np. --usun Magazyn.pdf.` | Podaj nazwę pliku po `--usun`.                                                                       |
| `Tych opcji nie można łączyć: …`                                             | Uruchom każdą operację osobnym poleceniem (patrz [2.6](#26-pomoc---pomoc)).                             |
| `Nie podano żadnego pliku PDF ani folderu. …`                                | Dopisz ścieżkę pliku lub folderu na końcu polecenia.                                                    |
| `Nie znaleziono dokumentu … w bazie wiedzy (--lista pokazuje wgrane dokumenty).` | Sprawdź nazwę w `--lista` i wpisz ją dokładnie tak samo.                                            |
| Zamiast wyniku pojawia się sam tekst pomocy (`Wgrywanie dokumentacji ERP (PDF) …`) | Prawdopodobnie PowerShell zgubił `--`. Wpisz to samo polecenie z `npm.cmd` zamiast `npm`.         |
| `Nieoczekiwany błąd: …`                                                      | Zgłoś administratorowi ([sekcja 5](#5-zgłaszanie-problemu)).                                           |

---

## 4. Aktualizacja narzędzia

Gdy administrator poinformuje o nowej wersji narzędzia (albo raz na jakiś czas), w folderze
narzędzia wpisz:

```powershell
cd $HOME\Documents\HelpDesk-XEMI
git pull
npm ci
```

Plik `.env.ingest` zostaje nietknięty. Jeśli `git pull` zgłosi konflikt lub zmiany lokalne —
nie próbuj ich rozwiązywać sam, zgłoś to administratorowi.

---

## 5. Zgłaszanie problemu

Jeśli komunikat nie pomógł, uruchom to samo polecenie w trybie szczegółowym i przekaż
administratorowi cały wynik:

```powershell
$env:DEBUG = "1"
npm run ingest -- "C:\Dokumentacja\Magazyn.pdf"
Remove-Item Env:DEBUG
```

W zgłoszeniu podaj: jakie polecenie wpisałeś, cały tekst z okna i nazwę pliku PDF. **Nie
wklejaj zawartości pliku `.env.ingest`** ani hasła — administrator ich nie potrzebuje.
