#!/bin/sh
# The processes of Home (com.webos.app.home: the web page's renderer, or LG's own Home program) and when each started, for
# 10-cleanyourtv-home after its app manager restart: those started before its mount are LG's Home, whose window stays on screen while it
# runs (a Flutter program on webOS 24 and newer); those started after are the launcher.
# usage: home-before.sh <uptime of the mount, in s>
# prints one line per process: <pid> <started, s of uptime> old|new <command line>. CYTV_PROC replaces /proc (tests).
PROC=${CYTV_PROC:-/proc}
at=$1
for d in "$PROC"/[0-9]*; do
  p=${d##*/}
  cmd=$(tr '\0' ' ' < "$d/cmdline" 2>/dev/null) || continue
  case "$cmd" in
    *app-id=com.webos.app.home | *app-id=com.webos.app.home\ * | */usr/palm/applications/com.webos.app.home/*) ;;
    *) continue ;;
  esac
  # field 22 of stat, the start in clock ticks (100 a second for user space), counted after the name, which may hold spaces
  st=$(sed 's/^.*) //' "$d/stat" 2>/dev/null | cut -d' ' -f20)
  [ -n "$st" ] || continue
  awk -v s="$st" -v m="$at" -v p="$p" -v c="$cmd" 'BEGIN { t = s / 100; printf "%s %.2f %s %s\n", p, t, (t < m ? "old" : "new"), substr(c, 1, 160) }'
done
exit 0
