"""Envia teclado e mouse (XTEST) a um display X isolado. Uso: xinput.py :77 comando..."""
import sys
import time

from Xlib import X, XK, display
from Xlib.ext import xtest

name = sys.argv[1]
if name.split(".")[0] in (":0", ":1"):
    raise SystemExit("Recusado: use somente um display isolado, nunca o da sua sessão.")
connection = display.Display(name)


def send(event, detail=0, **options):
    xtest.fake_input(connection, event, detail, **options)
    connection.sync()


def keycode(key):
    return connection.keysym_to_keycode(XK.string_to_keysym(key))


for command in sys.argv[2:]:
    operation, *args = command.split(":")
    if operation == "down":
        send(X.KeyPress, keycode(args[0]))
    elif operation == "up":
        send(X.KeyRelease, keycode(args[0]))
    elif operation == "move":
        send(X.MotionNotify, x=int(args[0]), y=int(args[1]))
    elif operation == "rel":
        send(X.MotionNotify, 1, x=int(args[0]), y=int(args[1]))
    elif operation == "click":
        send(X.ButtonPress, 1)
        time.sleep(0.05)
        send(X.ButtonRelease, 1)
    elif operation == "buttondown":
        send(X.ButtonPress, 1)
    elif operation == "buttonup":
        send(X.ButtonRelease, 1)
    elif operation == "wait":
        time.sleep(float(args[0]))
    time.sleep(0.03)
