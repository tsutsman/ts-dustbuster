#!/bin/sh

if ! command -v node >/dev/null 2>&1; then
  # Node.js not found. Trying to install...
  echo "Node.js не знайдено. Спроба встановити..."
  if command -v brew >/dev/null 2>&1; then
    brew install node
  else
    # Homebrew not found. Install Homebrew or Node.js manually.
    echo "Homebrew не встановлений. Встановіть Homebrew або Node.js вручну."
    exit 1
  fi
fi

node "$(dirname "$0")/cleaner.js" "$@"
