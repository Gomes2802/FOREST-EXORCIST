#!/usr/bin/env python3
"""Servidor HTTP local do Forest Exorcist.

Usa apenas a biblioteca padrão do Python, escuta somente em 127.0.0.1 e não
precisa de internet.
"""

import argparse
import functools
import shutil
import subprocess
import sys
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HOST = "127.0.0.1"
DEFAULT_PORT = 8000
PORT_ATTEMPTS = 20


class GameHandler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript; charset=utf-8",
        ".mjs": "text/javascript; charset=utf-8",
        ".json": "application/json; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".html": "text/html; charset=utf-8",
        ".png": "image/png",
        ".mp3": "audio/mpeg",
    }

    def end_headers(self):
        # Sem cache: um sprite substituído aparece ao recarregar a página.
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def send_head(self):
        # Ignora pedidos condicionais para nunca responder com versão antiga.
        if "If-Modified-Since" in self.headers:
            del self.headers["If-Modified-Since"]
        return super().send_head()

    def log_message(self, format, *args):
        pass

    def log_error(self, format, *args):
        sys.stderr.write("[servidor] %s %s\n" % (self.path, format % args))


class GameServer(ThreadingHTTPServer):
    # O jogo pede dezenas de arquivos de uma vez; a fila padrão (5) faz o
    # sistema recusar conexões, sobretudo no Windows.
    request_queue_size = 64


def create_server(directory, port, attempts):
    handler = functools.partial(GameHandler, directory=str(directory))
    last_error = None
    for candidate in range(port, port + attempts):
        try:
            return GameServer((HOST, candidate), handler)
        except OSError as error:
            last_error = error
    raise SystemExit(f"Nenhuma porta livre a partir de {port}: {last_error}")


def open_browser(url):
    chrome = shutil.which("google-chrome") or shutil.which("google-chrome-stable")
    if chrome:
        subprocess.Popen(
            [chrome, "--new-window", url],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
    else:
        webbrowser.open(url)


def main():
    parser = argparse.ArgumentParser(description="Servidor local do Forest Exorcist.")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help="porta (0 = automática)")
    parser.add_argument("--no-browser", action="store_true", help="não abrir o navegador")
    parser.add_argument(
        "--qualidade",
        choices=["auto", "alto", "medio", "baixo", "muito-baixo"],
        help="qualidade gráfica inicial (padrão: auto)",
    )
    options = parser.parse_args()

    directory = Path(__file__).resolve().parent
    attempts = 1 if options.port == 0 else PORT_ATTEMPTS
    with create_server(directory, options.port, attempts) as server:
        url = f"http://{HOST}:{server.server_address[1]}/"
        if options.qualidade:
            url += f"?qualidade={options.qualidade}"
        print(f"Forest Exorcist em {url}", flush=True)
        print("Pressione Ctrl+C para encerrar.", flush=True)
        if not options.no_browser:
            open_browser(url)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print("\nServidor encerrado.")


if __name__ == "__main__":
    main()
