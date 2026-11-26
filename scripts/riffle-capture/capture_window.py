"""Park the X11 pointer outside the capture window, then run the native app."""
import ctypes
import subprocess
import sys

x11 = ctypes.CDLL("libX11.so.6")
x11.XOpenDisplay.argtypes = [ctypes.c_char_p]
x11.XOpenDisplay.restype = ctypes.c_void_p
x11.XDefaultRootWindow.argtypes = [ctypes.c_void_p]
x11.XDefaultRootWindow.restype = ctypes.c_ulong
x11.XWarpPointer.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.c_ulong,
                            ctypes.c_int, ctypes.c_int, ctypes.c_uint, ctypes.c_uint,
                            ctypes.c_int, ctypes.c_int]
x11.XSync.argtypes = [ctypes.c_void_p, ctypes.c_int]
x11.XCloseDisplay.argtypes = [ctypes.c_void_p]
display = x11.XOpenDisplay(None)
if not display:
    raise RuntimeError("Cannot open capture display")
x11.XWarpPointer(display, 0, x11.XDefaultRootWindow(display), 0, 0, 0, 0, 2550, 1550)
x11.XSync(display, 0)
# Keep this client connected until the app opens its own window. Otherwise Xvfb
# resets when its last client disconnects and recenters the pointer over the UI.
try:
    status = subprocess.call(sys.argv[1:])
finally:
    x11.XCloseDisplay(display)
sys.exit(status)
