# ts-dustbuster

`ts-dustbuster` is a cross-platform cache and temporary file cleaner featuring both a CLI and a simple web interface. The script runs on Node.js and ships with wrappers for Linux, Windows, and macOS.

## Key features

- cleans common operating system temp folders and popular caches (browsers, package managers);
- supports dry-run mode, summary reporting, and an interactive preview before deletion;
- handles JSON/YAML configurations and presets with inheritance and configuration directories;
- performs concurrent execution with the `--concurrency` limit and optional log file output;
- ships with a lightweight web interface for launching cleanups from the browser.
- localized CLI (ua/en) with automatic detection via the `LANG` environment variable.

## Getting started

Node.js 16 or later is required.

### Linux

```bash
./cleaner.sh
```

### Windows

```cmd
cleaner.cmd
```

The script switches the code page to 65001 (UTF-8) for proper Cyrillic output and, if needed, offers to install Node.js. The `--deep` flag adds thorough cleanup for system directories such as `Prefetch`, `SoftwareDistribution\\Download`, and `System32\\LogFiles`.

### macOS

```bash
./cleaner-macos.sh
```

The wrapper uses Homebrew (if available) to install Node.js and extends the default cache list with macOS-specific locations.

### Direct Node.js execution

```bash
node cleaner.js [options]
```

## CLI options

- `--dry-run` — list what would be removed without deleting anything.
- `--summary` — print an extended summary with run duration, heaviest directories, and permission warnings.
- `--parallel` — enable parallel cleanup; combine with `--concurrency <n>` to limit simultaneous operations.
- `--max-age <duration>` — delete only files older than the specified age (examples: `12h`, `5d`).
- `--dir <path>` — add a custom directory (repeatable flag).
- `--exclude <path>` — skip a directory or file.
- `--config <file|directory>` — apply configuration files (see below).
- `--preset <name|path>` — include a predefined preset.
- `--log <file>` — persist execution logs to a file.
- `--preview` — ask for confirmation before cleaning each directory.

## Configurations and presets

Detailed guidance with JSON/YAML examples, preset structure, and CI/CD tips lives in [docs/configuration.en.md](docs/configuration.en.md). Key points:

- relative paths inside configuration files are resolved from the file location;
- directory and exclusion lists are merged in the order configurations are applied;
- the `presets` field inherits ready-to-use bundles and lets you override only the necessary values.

## Web interface

```bash
node gui.js
```

Open `http://localhost:3000`. The refreshed UI now includes:

- a help panel with prerequisites (permissions, configuration flags, dry-run guidance);
- contextual hints for the clean button with a live status indicator;
- a log explanation block and troubleshooting checklist for common failures;
- direct links to documentation for deeper customization.

The GUI runs locally and has no authentication, so do not expose it to public networks.

## Tests

Execute unit tests with:

```bash
node test.js
```

## Quality checks

Run automated checks before committing to comply with roadmap quality requirements:

- `npm run lint` — runs ESLint with Node.js recommendations and integrated Prettier formatting.
- `npm run format:check` — ensures Prettier style compliance without modifying files.
- `npm run format` — applies Prettier formatting when you need to quickly align the code style.

Husky hooks run `npm run lint` and `npm run format:check` before each commit.

## Next steps

The updated roadmap is available in [ROADMAP.md](ROADMAP.md) and outlines future improvements for the CLI, modularity, automation, and the GUI.
