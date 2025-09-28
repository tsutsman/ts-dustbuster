# ts-dustbuster

Цей репозиторій містить простий скрипт для очищення тимчасових файлів у різних операційних системах.
This repository contains a simple script for cleaning temporary files on various operating systems.

## Використання / Usage

Для зручності додаються окремі запускні файли під Windows, Linux та macOS.
Separate startup files are provided for Windows, Linux and macOS.

**Linux**:
```bash
./cleaner.sh
```

**Windows**:
```cmd
cleaner.cmd
```
Скрипт встановлює кодову сторінку 65001 (UTF‑8) для коректного відображення кирилиці в консолі.
The script sets code page 65001 (UTF‑8) to display Cyrillic characters correctly.
Після завершення роботи відображається повідомлення та очікується натискання клавіші,
щоб користувач міг побачити результат.
A message is shown after completion and the script waits for a key press so the user can see the result.
Для глибшого очищення під Windows додайте прапорець `--deep`:
```cmd
cleaner.cmd --deep
```

**macOS**:
```bash
./cleaner-macos.sh
```

В обох випадках викликається Node.js-скрипт `cleaner.js`, який видаляє вміст стандартних тимчасових директорій (наприклад, `/tmp` у Linux та `%TEMP%` у Windows).
In both cases the Node.js script `cleaner.js` is executed. It removes contents of standard temporary directories (like `/tmp` on Linux or `%TEMP%` on Windows).

Починаючи з версії 1.1 скрипт під Linux також очищає каталоги `/var/tmp`, `/var/cache/apt/archives` та `~/.cache` при їх наявності.
Since version 1.1 the Linux script also cleans `/var/tmp`, `/var/cache/apt/archives` and `~/.cache` if they exist.

У поточній версії додатково перевіряються типові кеші браузерів (Chrome, Edge) та менеджерів пакетів (npm, yarn, pip) на Windows, macOS і Linux — вони очищаються лише за наявності.
In the current version the tool also targets common caches of browsers (Chrome, Edge) and package managers (npm, yarn, pip) on Windows, macOS and Linux — they are cleaned only when present.

Скрипти автоматично перевіряють наявність Node.js і за потреби встановлюють його. Під Windows додатково очищаються системні каталоги `Prefetch`, `SoftwareDistribution\Download` та `System32\LogFiles`. Під macOS для встановлення використовується Homebrew, якщо він наявний.
The scripts automatically check for Node.js and install it if needed. On Windows the system folders `Prefetch`, `SoftwareDistribution\Download` and `System32\LogFiles` are cleaned as well. On macOS installation is done via Homebrew when available.

### Додаткові опції / Additional options

Скрипт `cleaner.js` підтримує кілька параметрів командного рядка:
The `cleaner.js` script supports several command-line options:

- `--dry-run` — лише показати, які файли буде видалено.
- `--dry-run` — only show which files would be removed.
- `--parallel` — виконувати очищення декількох директорій одночасно.
- `--parallel` — clean several directories in parallel.
- `--concurrency <число>` — обмежити кількість одночасних операцій очищення (значення > 1 автоматично вмикає паралельний режим).
- `--concurrency <number>` — limit the amount of concurrent cleanup operations (values > 1 enable parallel mode automatically).
- `--dir <шлях>` — додати власну директорію до списку для очистки (можна вказувати кілька разів).
- `--dir <path>` — add a custom directory to the cleanup list (can be used multiple times).
- `--config <файл>` — файл налаштувань у форматі JSON або YAML з описом директорій, виключень та додаткових опцій.
- `--preset <назва|шлях>` — застосувати попередньо підготовлений пресет (шукається у поточному каталозі, `./presets` або за повним шляхом).
- `--config <file>` — JSON file with a `dirs` array of paths.
- `--log <файл>` — зберігати інформацію про виконання у вказаний файл.
- `--log <file>` — store execution information in the specified file.
- `--summary` — наприкінці показати підсумок із кількістю видалених файлів/тек та звільненим місцем.
- `--summary` — print a summary with the number of removed files/folders and reclaimed space.
- `--max-age <тривалість>` — видаляти лише елементи, старші за задану тривалість (наприклад, `12h`, `30m`, `5d`; без суфікса — години).
- `--max-age <duration>` — delete only items older than the given duration (for example `12h`, `30m`, `5d`; default unit is hours when no suffix is provided).
- `--exclude <шлях>` — ігнорувати вказаний шлях та його вміст під час очищення.
- `--exclude <path>` — skip the specified path (and its contents) during cleanup.

Поле `--config` тепер може містити не лише список директорій, а й опції `exclude`, `maxAge`, `summary`, `parallel`, `dryRun`, `deep`, `logFile`, `concurrency`. Відносні шляхи всередині конфігурації інтерпретуються відносно каталогу цього файлу. Конфігурації можуть включати інші пресети через поле `presets`, яке приймає перелік назв або шляхів до додаткових JSON/YAML файлів. Будь-які помилки в структурі або значеннях конфігурацій відображаються як дружні повідомлення, а зміни не застосовуються до виправлення помилки.

Прапорець `--preset` дозволяє комбінувати кілька пресетів безпосередньо з CLI, наприклад:

```bash
dustbuster --preset базовий --preset prod-extra
```

Послідовність пресетів має значення: останні перевизначають значення попередніх, а списки директорій та виключень об'єднуються.
The `--config` option can now include not only `dirs`, but also `exclude`, `maxAge`, `summary`, `parallel`, `dryRun`, `deep`, `logFile`, `concurrency`. Relative paths in the configuration are resolved against the file location.

Під час очищення збирається статистика: кількість видалених файлів, тек, пропущених елементів та звільнений простір. За прапорцем `--summary` ці дані виводяться наприкінці роботи.
During cleanup the tool gathers statistics: number of removed files, folders, skipped entries and reclaimed space. With the `--summary` flag this information is printed at the end of execution.

### Графічний режим

Для запуску простого веб‑інтерфейсу виконайте:

```bash
node gui.js
```

Після цього відкрийте у браузері `http://localhost:3000` та натисніть кнопку очищення.
