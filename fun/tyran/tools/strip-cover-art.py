#!/usr/bin/env python3
"""Remove the embedded cover picture from a supplied song, changing nothing else.

Usage: python3 -I fun/tyran/tools/strip-cover-art.py in.mp3 out.mp3

Drops the ID3v2.4 APIC (attached picture) frames and keeps every other tag
frame and every byte of the MP3 stream after the tag. Chromium treats the
picture as a second stream and buffers about 1.5 MB before it starts playing
a song that carries one, which defeats streaming on slow connections.
"""
import sys

data = open(sys.argv[1], 'rb').read()
syncsafe = lambda b: (b[0] << 21) | (b[1] << 14) | (b[2] << 7) | b[3]
encode = lambda n: bytes([(n >> 21) & 127, (n >> 14) & 127, (n >> 7) & 127, n & 127])
if data[:3] != b'ID3' or data[3] != 4 or data[5] != 0: sys.exit('expects a plain ID3v2.4 tag without flags')
end, i, kept = 10 + syncsafe(data[6:10]), 10, []
while i < end and data[i] != 0:
    size = syncsafe(data[i + 4:i + 8]); frame = data[i:i + 10 + size]
    if frame[:4] != b'APIC': kept.append(frame)
    i += 10 + size
body = b''.join(kept)
open(sys.argv[2], 'wb').write(data[:6] + encode(len(body)) + body + data[end:])
