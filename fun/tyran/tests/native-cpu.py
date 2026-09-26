"""Read owned benchmark process CPU without asking Chrome to sample itself."""
import ctypes
import json
import sys
import time


class RUsageV0(ctypes.Structure):
    _fields_ = [("uuid", ctypes.c_uint8 * 16)] + [
        (name, ctypes.c_uint64) for name in (
            "user_time", "system_time", "pkg_idle_wkups", "interrupt_wkups",
            "pageins", "wired_size", "resident_size", "phys_footprint",
            "proc_start_abstime", "proc_exit_abstime",
        )
    ]


class Timebase(ctypes.Structure):
    _fields_ = [("numer", ctypes.c_uint32), ("denom", ctypes.c_uint32)]


lib = ctypes.CDLL("/usr/lib/libproc.dylib", use_errno=True)
lib.proc_pid_rusage.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_void_p]
lib.proc_pid_rusage.restype = ctypes.c_int
system = ctypes.CDLL("/usr/lib/libSystem.B.dylib")
system.mach_timebase_info.argtypes = [ctypes.POINTER(Timebase)]
system.mach_timebase_info.restype = ctypes.c_int
timebase = Timebase()
if system.mach_timebase_info(ctypes.byref(timebase)) or not timebase.denom:
    raise RuntimeError("Mach timebase unavailable")
tick_seconds = timebase.numer / timebase.denom / 1e9

for line in sys.stdin:
    records = []
    for process in json.loads(line):
        info = RUsageV0()
        result = {"id": process["id"], "type": process["type"]}
        if lib.proc_pid_rusage(process["id"], 0, ctypes.byref(info)):
            result["error"] = ctypes.get_errno()
        else:
            result.update(cpuTime=(info.user_time + info.system_time) * tick_seconds,
                          startTime=info.proc_start_abstime)
        records.append(result)
    print(json.dumps({"at": time.time(), "processInfo": records}), flush=True)
