#!/usr/bin/env sh
# Inicia o servidor local (offline) e abre o jogo no navegador.
cd "$(dirname "$0")" || exit 1
exec python3 serve.py "$@"
