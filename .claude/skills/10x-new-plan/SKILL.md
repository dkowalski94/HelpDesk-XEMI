---
name: 10x-new-plan
description: Start a new change and plan it in one run - creates context/changes/<change-id>/change.md the way /10x-new does, then continues straight into /10x-plan for that change. Use when the user wants to open a change and go directly to an implementation plan, or says "new change and plan it", "start and plan", "nowa zmiana i plan". Use /10x-new-research instead when the change needs codebase exploration first.
argument-hint: "<change-id-or-path> [freeform intent]"
allowed-tools:
  - Read
  - Glob
  - Grep
  - Write
  - Edit
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
# /10x-new-plan — Rozpocznij nową zmianę i ją zaplanuj

Uruchom dwie umiejętności jedna po drugiej w ramach jednego wywołania: `/10x-new` tworzy folder zmiany, a następnie `/10x-plan` zapisuje dla niej plan. Użytkownik wpisuje jedno polecenie zamiast dwóch i nigdy nie kopiuje między nimi identyfikatora zmiany.

Ta umiejętność nie zawiera własnych zasad dotyczących folderów zmian ani planów. `10x-new` i `10x-plan` pozostają jedynym źródłem prawdy dla obu etapów; ta umiejętność jedynie je sekwencjonuje oraz przekazuje identyfikator zmiany i intencję.

## Zanim zaczniesz: obie umiejętności muszą być zainstalowane

Znajdź te dwie umiejętności, zanim cokolwiek utworzysz:

- Użyj natywnego mechanizmu umiejętności hosta, jeśli go posiada (narzędzia Claude Code `Skill` lub odpowiednika w Codex i OpenCode).
- W przeciwnym razie odczytaj każde `SKILL.md` z katalogów sąsiadujących z tą umiejętnością: `<loaded-skill-dir>/../10x-new/SKILL.md` i `<loaded-skill-dir>/../10x-plan/SKILL.md`.

Jeśli którejkolwiek umiejętności brakuje, wyświetl poniższy komunikat i **ZATRZYMAJ SIĘ**, nie tworząc folderu zmiany. Zmiana otwarta tutaj bez możliwości jej zaplanowania jest gorsza niż brak zmiany.

```
error: /10x-new-plan needs both 10x-new and 10x-plan installed. Missing: <skill-name>.
Install the missing skill, then run /10x-new-plan again.
```

## Etap 1: utwórz zmianę (`10x-new`)

Załaduj `10x-new` i postępuj zgodnie z nim w całości, używając argumentów otrzymanych przez tę umiejętność, bez zmian: jego komunikat przy braku argumentów, analiza argumentów, walidacja i kroki tworzenia obowiązują dokładnie tak, jak zostały zapisane.

Dwie różnice względem samodzielnego uruchomienia `/10x-new`:

1. **Pomiń jego sekcję „Next-step suggestion”.** Nie wybieraj następnego polecenia, nie kopiuj niczego do schowka i nie wyświetlaj bloku „Next step”. Wyświetl tylko linię potwierdzenia: `✓ Created context/changes/<change-id>/change.md (status: new)`.
2. **Zatrzymanie w `10x-new` zatrzymuje tę umiejętność.** Jeśli poprosi o brakujący argument, zaczekaj na odpowiedź, a następnie kontynuuj tutaj. Jeśli walidacja się nie powiedzie (brak kebab-case, zmiana już istnieje, brak `context/changes/`), wyświetl jego błąd i zakończ. Nigdy nie planuj względem folderu, którego to uruchomienie nie utworzyło: dla istniejącej zmiany użytkownik uruchamia bezpośrednio `/10x-plan <change-id>`.

## Etap 2: zaplanuj zmianę (`10x-plan`)

Kontynuuj w tej samej turze. Nie pytaj użytkownika, czy chcesz przejść dalej; uruchomienie tej umiejętności było odpowiedzią.

Załaduj `10x-plan` i postępuj zgodnie z nim w całości, tak jakby użytkownik wywołał `/10x-plan <change-id>` z identyfikatorem zmiany z Etapu 1:

- **Opis zadania** to swobodnie sformułowana intencja z argumentów, ten sam tekst, który Etap 1 zapisał w `change.md` pod `## Notes`. Odczytaj ponownie `change.md` i traktuj go jako dostarczony plik, aby `10x-plan` pominął komunikat o braku parametrów i rozpoczął badanie.
- **Pusta intencja**: zmiana ma nazwę, ale nie ma zadania. Pozwól `10x-plan` zapytać o opis zadania, tak jak robi to przy wywołaniu bez niego, a następnie kontynuuj.
- **Artefakty nadrzędne**: zmiana utworzona przed chwilą nie ma `frame.md` ani `research.md`, więc `10x-plan` zadaje pytania od poziomu bazowego „tylko zadanie”.

Wszystko pozostałe należy do `10x-plan` i nie jest tutaj łagodzone: jego warunki wstępne dotyczące natywnych pytań, potwierdzenie złożoności i budżetu, wywiad, zatwierdzenie struktury, `plan.md` i `plan-brief.md` oraz aktualizacja metadanych `change.md`. Jeśli `10x-plan` zatrzyma się z powodu braku możliwości hosta (na przykład braku narzędzia do pytań strukturalnych lub trybu tylko do odczytu), folder zmiany z Etapu 1 pozostaje na miejscu. Powiedz użytkownikowi, że istnieje oraz że `/10x-plan <change-id>` wznawia pracę od tego miejsca.

## Zakończenie

Zakończ komunikatem końcowym wymaganym przez `10x-plan`. Dodaj jedną linię wskazującą folder zmiany utworzony na początku, aby użytkownik widział oba wyniki uruchomienia.

## Czego ta umiejętność NIE robi

- Nie powtarza ani nie nadpisuje zasad `10x-new` ani `10x-plan`. Gdy ten plik i którakolwiek umiejętność są ze sobą sprzeczne, umiejętność ma pierwszeństwo.
- Nie uruchamia pomiędzy nimi `/10x-frame` ani `/10x-research`. Gdy intencja wygląda na podejrzane ramowanie problemu (błąd z dołączoną proponowaną poprawką, „should we even”) lub wymaga eksploracji bazy kodu, zanim można napisać plan, powiedz o tym w jednej linii przed Etapem 2 i kontynuuj. Użytkownik poprosił o plan i może zatrzymać uruchomienie.
- Nie planuje istniejącej zmiany i nie zapisuje do `context/archive/`.