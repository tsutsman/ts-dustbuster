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

Скрипти автоматично перевіряють наявність Node.js і за потреби встановлюють його. Під Windows додатково очищаються системні каталоги `Prefetch`, `SoftwareDistribution\Download` та `System32\LogFiles`. Під macOS для встановлення використовується Homebrew, якщо він наявний.
The scripts automatically check for Node.js and install it if needed. On Windows the system folders `Prefetch`, `SoftwareDistribution\Download` and `System32\LogFiles` are cleaned as well. On macOS installation is done via Homebrew when available.

### Додаткові опції / Additional options

Скрипт `cleaner.js` підтримує кілька параметрів командного рядка:
The `cleaner.js` script supports several command-line options:

- `--dry-run` — лише показати, які файли буде видалено.
- `--dry-run` — only show which files would be removed.
- `--parallel` — виконувати очищення декількох директорій одночасно.
- `--parallel` — clean several directories in parallel.
- `--dir <шлях>` — додати власну директорію до списку для очистки (можна вказувати кілька разів).
- `--dir <path>` — add a custom directory to the cleanup list (can be used multiple times).
- `--config <файл>` — JSON-файл з полем `dirs`, що містить масив шляхів.
- `--config <file>` — JSON file with a `dirs` array of paths.
- `--log <файл>` — зберігати інформацію про виконання у вказаний файл.
- `--log <file>` — store execution information in the specified file.

### Графічний режим

Для запуску простого веб‑інтерфейсу виконайте:

```bash
node gui.js
```

Після цього відкрийте у браузері `http://localhost:3000` та натисніть кнопку очищення.
