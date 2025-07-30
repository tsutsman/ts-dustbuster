#!/bin/sh

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js не знайдено. Спроба встановити..."
  if command -v brew >/dev/null 2>&1; then
    brew install node
  else
    echo "Homebrew не встановлений. Встановіть Homebrew або Node.js вручну."
    exit 1
  fi
fi

node "$(dirname "$0")/cleaner.js"
