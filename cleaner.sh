#!/bin/sh

if ! command -v node >/dev/null 2>&1; then
  # Node.js not found. Trying to install...
  echo "Node.js не знайдено. Спроба встановити..."
  if command -v apt-get >/dev/null 2>&1; then
    curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
    sudo apt-get install -y nodejs
  elif command -v yum >/dev/null 2>&1; then
    curl -fsSL https://rpm.nodesource.com/setup_lts.x | sudo bash -
    sudo yum install -y nodejs
  else
    # Could not determine package manager for automatic Node.js install.
    echo "Не вдалося визначити менеджер пакетів для автоматичної інсталяції Node.js."
    exit 1
  fi
fi

node "$(dirname "$0")/cleaner.js" "$@"
