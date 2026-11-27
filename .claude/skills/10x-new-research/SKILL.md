---
name: 10x-new-research
description: Start a new change and research it in one run - creates context/changes/<change-id>/change.md the way /10x-new does, then continues straight into /10x-research for that change. Use when the user wants to open a change and explore the codebase before planning, or says "new change and research it", "start and research", "nowa zmiana i research". Use /10x-new-plan instead when the change can go directly to a plan.
argument-hint: "<change-id-or-path> [freeform intent or research question]"
allowed-tools:
  - Read
  - Glob
  - Grep
  - Write
  - Bash
  - Agent
  - Task
  - Skill
  - AskUserQuestion
  - TaskCreate
  - TaskUpdate
  - TaskList
  - TaskGet
---
# /10x-new-research — Rozpocznij nową zmianę i zbadaj ją

Uruchom dwie umiejętności kolejno w jednym wywołaniu: `/10x-new` tworzy folder zmiany, a następnie `/10x-research` bada bazę kodu i zapisuje w nim `research.md`. Użytkownik wpisuje jedno polecenie zamiast dwóch i nigdy nie kopiuje między nimi identyfikatora zmiany.

Ta umiejętność nie zawiera własnych reguł dotyczących folderów zmian ani badań. `10x-new` i `10x-research` pozostają jedynym źródłem informacji dla obu etapów; ta umiejętność jedynie je sekwencjonuje i przekazuje między nimi identyfikator zmiany oraz intencję.

## Zanim zaczniesz: obie umiejętności muszą być zainstalowane

Znajdź obie umiejętności przed utworzeniem czegokolwiek:

- Użyj natywnego mechanizmu umiejętności hosta, jeśli taki posiada (narzędzie Claude Code `Skill` lub jego odpowiednik w Codex i OpenCode).
- W przeciwnym razie odczytaj każde `SKILL.md` z katalogów sąsiadujących z tą umiejętnością: `<loaded-skill-dir>/../10x-new/SKILL.md` i `<loaded-skill-dir>/../10x-research/SKILL.md`.

Jeśli którejkolwiek umiejętności brakuje, wyświetl poniższy komunikat i **ZATRZYMAJ SIĘ**, nie tworząc folderu zmiany. Zmiana otwarta tutaj bez możliwości jej zbadania jest gorsza niż brak zmiany.

```
error: /10x-new-research needs both 10x-new and 10x-research installed. Missing: <skill-name>.
Install the missing skill, then run /10x-new-research again.
```

## Etap 1: utwórz zmianę (`10x-new`)

Załaduj `10x-new` i postępuj zgodnie z nią w całości, używając argumentów otrzymanych przez tę umiejętność, bez zmian: jej komunikat przy braku argumentów, analizowanie argumentów, walidacja i kroki tworzenia obowiązują dokładnie tak, jak zostały zapisane.

Dwie różnice względem samodzielnego uruchomienia `/10x-new`:

1. **Pomiń jej sekcję „Next-step suggestion”.** Nie wybieraj następnego polecenia, nie kopiuj niczego do schowka i nie wyświetlaj bloku „Next step”. Wyświetl tylko wiersz potwierdzenia: `✓ Created context/changes/<change-id>/change.md (status: new)`.
2. **Zatrzymanie w `10x-new` zatrzymuje tę umiejętność.** Jeśli poprosi o brakujący argument, poczekaj na odpowiedź, a następnie kontynuuj tutaj. Jeśli walidacja się nie powiedzie (nie jest kebab-case, zmiana już istnieje, brakuje `context/changes/`), wyświetl jej błąd i zatrzymaj się. Nigdy nie prowadź badań w folderze, którego to uruchomienie nie utworzyło: dla istniejącej zmiany użytkownik uruchamia bezpośrednio `/10x-research <change-id>`.

## Etap 2: zbadaj zmianę (`10x-research`)

Kontynuuj w tej samej turze. Nie pytaj użytkownika, czy przejść dalej; uruchomienie tej umiejętności było odpowiedzią.

Załaduj `10x-research` i postępuj zgodnie z nią w całości, tak jakby użytkownik wywołał `/10x-research <change-id>` z identyfikatorem zmiany z Etapu 1:

- **Pytanie badawcze** pochodzi z dowolnie sformułowanej intencji w argumentach, z tego samego tekstu, który Etap 1 zapisał pod `## Notes` w `change.md`. `10x-research` odczytuje artefakty zmiany, aby ustalić pytanie, więc nie proś użytkownika o jego powtórzenie.
- **Pusta intencja**: zmiana ma nazwę, ale nie ma pytania. Pozwól `10x-research` zapytać o brakujące pytanie, tak jak robi to, gdy ani wiadomość, ani artefakty go nie definiują, a następnie kontynuuj.
- **Folder zmiany i `change.md` już istnieją**, więc `10x-research` zapisuje tam `research.md` i aktualizuje `change.md` wyłącznie poprzez własny krok metadanych. Nie może utworzyć drugiego folderu ani wyprowadzić innego identyfikatora zmiany z tematu.

Wszystko pozostałe należy do `10x-research` i nie jest tutaj łagodzone: doprecyzowanie zakresu, równoległe badanie, synteza, kontrole uruchamiane przed zapisaniem `research.md` oraz aktualizacja metadanych `change.md`. Jeśli `10x-research` nie może zapisać pliku (na przykład w trybie tylko do odczytu), folder zmiany z Etapu 1 pozostaje na miejscu. Powiedz użytkownikowi, że istnieje i że `/10x-research <change-id>` wznowi pracę od tego miejsca.

## Zakończenie

Zakończ prezentacją zalecaną przez `10x-research`. Dodaj jeden wiersz wskazujący folder zmiany utworzony na początku, aby użytkownik widział oba rezultaty uruchomienia. Badanie nie oznacza zatwierdzenia planu: wskaż `/10x-plan <change-id>` jako następny krok i go nie rozpoczynaj.

## Czego ta umiejętność NIE robi

- Nie powtarza ani nie nadpisuje reguł `10x-new` ani `10x-research`. Gdy ten plik i któraś z umiejętności są sprzeczne, wygrywa umiejętność.
- Nie uruchamia `/10x-frame` ani `/10x-plan`. Gdy intencja wygląda na podejrzane ramowanie (błąd z dołączoną proponowaną poprawką, „should we even”), powiedz o tym w jednym wierszu przed Etapem 2 i kontynuuj. Użytkownik poprosił o badanie i może zatrzymać uruchomienie.
- Nie bada istniejącej zmiany i nie zapisuje do `context/archive/`.