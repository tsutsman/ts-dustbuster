# ts-dustbuster configuration guide

This document explains how to control `cleaner.js` using JSON/YAML configuration files and presets. Pass a file via the `--config` flag or point to a directory that contains several configuration files. Configurations support inheritance through the `presets` field, letting you customize cleanup behaviour for CI/CD and workstations without modifying code.

## Core principles

- A configuration must be an object (key–value map).
- All paths are resolved relative to the configuration file.
- Allowed keys: `dirs`, `exclude`, `maxAge`, `summary`, `parallel`, `dryRun`, `deep`, `logFile`, `concurrency`, `preview`, `presets`.
- Boolean flags (`summary`, `parallel`, `dryRun`, `deep`, `preview`) accept `true`/`false` values.
- `dirs` and `exclude` accept either a string or an array of strings.
- `maxAge` is a duration in hours (`12`, `0.5`) or with the `m`, `h`, `d`, `w` suffix (minutes, hours, days, weeks).
- `concurrency` expects a positive number or `null` to fall back to the default behaviour.
- Use the `presets` field to include shared settings from other files.

## Basic JSON structure

```json
{
  "dirs": ["./tmp", "/var/cache/app"],
  "exclude": ["./tmp/keep.log", "./tmp/snapshots"],
  "maxAge": "7d",
  "summary": true,
  "parallel": true,
  "concurrency": 4,
  "logFile": "./logs/cleanup.log"
}
```

### Field reference

- `dirs` — directories scheduled for cleanup. Both absolute and relative paths are supported.
- `exclude` — paths that must never be deleted (recursive).
- `maxAge` — minimum age of files/folders to remove. In this example, only items older than 7 days are deleted.
- `summary` — prints a summary with counts of files, directories, and reclaimed space.
- `parallel` and `concurrency` — enable parallel execution and limit the number of concurrent operations.
- `logFile` — stores the cleanup log at a custom location.

## YAML with deep cleanup and presets

```yaml
presets:
  - ./base-common.yaml
  - prod-extra

dirs:
  - ../artifacts
  - /var/lib/app/cache
exclude:
  - ../artifacts/.gitkeep
maxAge: 48h
summary: true
parallel: true
deep: true
preview: false
dryRun: false
concurrency: 8
logFile: ../logs/prod-clean.log
```

### Preset mechanics

- `presets` accepts a list of names or paths.
- When the name is provided without a path, the tool looks in the same directory, the `presets` subdirectory, the current working directory, and the bundled presets.
- Order matters: later presets and the current file override earlier values, while list fields (`dirs`, `exclude`) are merged.
- Avoid recursive inclusion loops when linking presets together.

## Configuration directories

Passing a directory, e.g. `--config ./configs`, instructs the utility to load every `.json`, `.yaml`, and `.yml` file in alphabetical order and merge them into a single configuration. This is useful when you separate settings by environment:

```
configs/
├── 10-common.yaml
├── 20-ci.json
└── 30-overrides.yaml
```

Each file may include additional presets and contain only the fields that differ; missing fields do not override previous values.

## CI/CD recommendations

- Store configurations in the repository for reproducibility and code review.
- Split files by baseline settings, environments (`dev`, `staging`, `prod`), and extra tweaks for specific pipelines.
- Configure `logFile` to point to build artefacts so you retain cleanup history.
- Use `preview: true` for dry-runs in verification pipelines, but disable `preview` and `dryRun` for automated jobs.
- Tune `concurrency` to avoid overloading the CI agent's file system.
- Set `maxAge` for critical directories to prevent deletion of freshly produced artefacts.

## Typical scenarios

1. **Local development:**
   - Create `configs/local.yaml` with `dirs: ["~/Library/Caches", "./tmp"]`, `preview: true`, `dryRun: true`.
   - Run `node cleaner.js --config configs/local.yaml` and confirm directories manually.
2. **Nightly CI:**
   - Combine `configs/10-common.yaml` and `configs/50-nightly.yaml` with `parallel: true`, `concurrency: 6`, `summary: true`.
   - Execute `node cleaner.js --config configs` in a cron job or Task Scheduler.
3. **Release agent maintenance:**
   - Use the `prod-extra` preset for additional directories, enable `logFile`, and archive the log as a build artefact.

Follow these practices to centralize cleanup management and keep ts-dustbuster aligned with your automation roadmap.
