#!/usr/bin/env bash
# Hermes Life service manager — one command for the backend (FastAPI/uvicorn, :8766)
# and the frontend (vite dev server, :5173). Works from any directory: everything is
# resolved from this script's own location, never from the caller's cwd.
#
# Usage: ./hermes-life.sh {start|stop|restart|status}
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUN="$ROOT/.run"
LOG="$RUN/logs"
mkdir -p "$LOG"

BACKEND_PIDFILE="$RUN/backend.pid"
FRONTEND_PIDFILE="$RUN/frontend.pid"
BACKEND_LOG="$LOG/backend.log"
FRONTEND_LOG="$LOG/frontend.log"
BACKEND_PORT=8766
FRONTEND_PORT=5173

_backend_pid() {
  [[ -f "$BACKEND_PIDFILE" ]] || return 1
  local pid
  pid="$(cat "$BACKEND_PIDFILE" 2>/dev/null)" || return 1
  [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null && { echo "$pid"; return 0; }
  rm -f "$BACKEND_PIDFILE"; return 1
}

_frontend_pid() {
  [[ -f "$FRONTEND_PIDFILE" ]] || return 1
  local pid
  pid="$(cat "$FRONTEND_PIDFILE" 2>/dev/null)" || return 1
  [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null && { echo "$pid"; return 0; }
  rm -f "$FRONTEND_PIDFILE"; return 1
}

_health() {  # $1 = url  -> prints HTTP code (000 when unreachable)
  curl -s -o /dev/null -w '%{http_code}' --max-time 3 "$1" 2>/dev/null
  # curl's nonzero exit (connection refused etc.) must not kill the caller under set -e;
  # the printed 000 is the actual signal.
  return 0
}

_listener_pid() {  # $1 = port -> prints pid of the process listening on it ('' if none); always exit 0
  local out
  out="$(ss -ltnp 2>/dev/null | grep ":$1 " | sed -n 's/.*pid=\([0-9]*\).*/\1/p' | head -1)" || true
  [[ -n "$out" ]] && echo "$out"
  return 0
}

_stop_service() {  # $1 = pidfile $2 = port $3 = name — stop ONLY what this manager started
  local pid port="$2" name="$3"
  pid="$(cat "$1" 2>/dev/null || true)"
  if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
    # The recorded pid is the real listener (rewritten at start). Its group TERM
    # covers npm/sh wrappers; fall back to the pid itself when it is not a leader.
    kill -TERM -- "-$pid" "$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
    for _ in $(seq 1 20); do
      kill -0 "$pid" 2>/dev/null || break
      sleep 0.5
    done
    if kill -0 "$pid" 2>/dev/null; then
      kill -KILL -- "-$pid" "$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null || true
    fi
    if [[ "$(_health "http://127.0.0.1:$port/")" != 000 ]] && [[ "$(_listener_pid "$port")" == "$pid" ]]; then
      echo "warning: $name (pid $pid) still listening on :$port after stop" >&2
    else
      echo "stopped $name (pid $pid)"
    fi
  elif [[ "$(_health "http://127.0.0.1:$port/")" != 000 ]]; then
    # Healthy but unmanaged: adopt the port listener and stop it — stop/restart
    # must control the services regardless of which process started them.
    if _adopt "$port" "$1" "$name"; then
      _stop_service "$1" "$port" "$name"; return
    fi
    echo "$name: unmanaged (healthy on :$port, no listener pid found) — left running"
  else
    echo "$name: already stopped"
  fi
  rm -f "$1"
}

_port_healthy() {  # $1=port $2=name -> true if something already listens unmanaged
  local port code
  port="$1"; name="$2"
  code="$(_health "http://127.0.0.1:$port/")"
  if [[ "$code" != 000 ]]; then
    echo "$name: already running (unmanaged — healthy on :$port, started outside this manager; NOT restarted by stop/restart)"
    return 0
  fi
  return 1
}

# Adopt a service this manager did not start: record the port listener's pid so
# stop/restart can take over the process the user (or an old script) launched by
# hand. Only used when the manager would otherwise refuse to control it.
_adopt() {  # $1=port $2=pidfile $3=name
  local lid port="$1" pidfile="$2" name="$3"
  lid="$(_listener_pid "$port")"
  if [[ -n "$lid" ]]; then
    echo "$lid" > "$pidfile"
    echo "$name: adopted unmanaged listener (pid $lid) — now managed"
    return 0
  fi
  return 1
}

start_backend() {
  if pid="$(_backend_pid)"; then
    echo "backend: already running (pid $pid)"; return 0
  fi
  if _port_healthy "$BACKEND_PORT" backend; then
    # Already healthy from a hand-start: adopt it so this manager owns it.
    _adopt "$BACKEND_PORT" "$BACKEND_PIDFILE" backend && return 0
    return 0
  fi
  # Delegate to start.sh: it owns the venv check, env loading and uvicorn exec.
  ( cd "$ROOT" && nohup setsid ./start.sh >"$BACKEND_LOG" 2>&1 & echo $! >"$BACKEND_PIDFILE" )
  pid="$(cat "$BACKEND_PIDFILE")"
  printf 'backend: starting (pid %s, log %s) ' "$pid" "$BACKEND_LOG"
  for _ in $(seq 1 60); do
    code="$(_health "http://127.0.0.1:$BACKEND_PORT/health")"
    if [[ "$code" != 000 ]]; then
      lid="$(_listener_pid "$BACKEND_PORT")"
      [[ -n "$lid" ]] && echo "$lid" > "$BACKEND_PIDFILE"
      echo "→ up (health $code, pid $(cat "$BACKEND_PIDFILE"))"
      return 0
    fi
    if ! kill -0 "$pid" 2>/dev/null; then
      # setsid may have forked: the wrapper pid can exit while the real service
      # lives on. Only a dead wrapper AND no listener counts as failure.
      if [[ "$(_health "http://127.0.0.1:$BACKEND_PORT/health")" == 000 ]]; then
        echo "→ FAILED (died at startup; see $BACKEND_LOG)"; rm -f "$BACKEND_PIDFILE"; return 1
      fi
      lid="$(_listener_pid "$BACKEND_PORT")"
      [[ -n "$lid" ]] && echo "$lid" > "$BACKEND_PIDFILE"
      echo "→ up (health 200, pid $(cat "$BACKEND_PIDFILE"))"
      return 0
    fi
    printf '.'; sleep 1
  done
  echo "→ FAILED (not responding after 60s; see $BACKEND_LOG)"; rm -f "$BACKEND_PIDFILE"; return 1
}

start_frontend() {
  if pid="$(_frontend_pid)"; then
    echo "frontend: already running (pid $pid)"; return 0
  fi
  if _port_healthy "$FRONTEND_PORT" frontend; then
    _adopt "$FRONTEND_PORT" "$FRONTEND_PIDFILE" frontend && return 0
    return 0
  fi
  if [[ ! -d "$ROOT/frontend/node_modules" ]]; then
    echo "frontend: node_modules missing — run 'npm install' in frontend/ first" >&2
    return 1
  fi
  ( cd "$ROOT/frontend" && nohup setsid npm run dev >"$FRONTEND_LOG" 2>&1 & echo $! >"$FRONTEND_PIDFILE" )
  pid="$(cat "$FRONTEND_PIDFILE")"
  printf 'frontend: starting (pid %s, log %s) ' "$pid" "$FRONTEND_LOG"
  for _ in $(seq 1 45); do
    code="$(_health "http://127.0.0.1:$FRONTEND_PORT/")"
    if [[ "$code" != 000 ]]; then
      lid="$(_listener_pid "$FRONTEND_PORT")"
      [[ -n "$lid" ]] && echo "$lid" > "$FRONTEND_PIDFILE"
      echo "→ up (http $code, pid $(cat "$FRONTEND_PIDFILE"))"
      return 0
    fi
    if ! kill -0 "$pid" 2>/dev/null; then
      if [[ "$(_health "http://127.0.0.1:$FRONTEND_PORT/")" == 000 ]]; then
        echo "→ FAILED (died at startup; see $FRONTEND_LOG)"; rm -f "$FRONTEND_PIDFILE"; return 1
      fi
      lid="$(_listener_pid "$FRONTEND_PORT")"
      [[ -n "$lid" ]] && echo "$lid" > "$FRONTEND_PIDFILE"
      echo "→ up (http 200, pid $(cat "$FRONTEND_PIDFILE"))"
      return 0
    fi
    printf '.'; sleep 1
  done
  echo "→ FAILED (not responding after 45s; see $FRONTEND_LOG)"; rm -f "$FRONTEND_PIDFILE"; return 1
}

cmd_start() {
  echo "== starting Hermes Life =="
  start_backend
  start_frontend
}

cmd_stop() {
  echo "== stopping Hermes Life =="
  _stop_service "$FRONTEND_PIDFILE" "$FRONTEND_PORT" frontend
  _stop_service "$BACKEND_PIDFILE" "$BACKEND_PORT" backend
}

cmd_status() {
  local bp fp bcode fcode bpid fpid
  bp=stopped; fp=stopped; bpid='-'; fpid='-'
  bpid="$(_backend_pid 2>/dev/null || true)"; fpid="$(_frontend_pid 2>/dev/null || true)"
  [[ -n "$bpid" ]] && { bp=running; } || bpid='-'
  [[ -n "$fpid" ]] && fp=running || fpid='-'
  bcode="$(_health "http://127.0.0.1:$BACKEND_PORT/health")"
  fcode="$(_health "http://127.0.0.1:$FRONTEND_PORT/")"
  # A healthy port with no pidfile means the service was started outside the manager.
  if [[ "$bp" == stopped && "$bcode" != 000 ]]; then bp=unmanaged; fi
  if [[ "$fp" == stopped && "$fcode" != 000 ]]; then fp=unmanaged; fi
  printf '%-9s %-8s %-8s %-12s %s\n' 'SERVICE' 'STATE' 'PID' 'HTTP' 'ENDPOINT'
  printf '%-9s %-8s %-8s %-12s %s\n' 'backend' "$bp" "$bpid" "$bcode" "http://127.0.0.1:$BACKEND_PORT/health"
  printf '%-9s %-8s %-8s %-12s %s\n' 'frontend' "$fp" "$fpid" "$fcode" "http://127.0.0.1:$FRONTEND_PORT/"
}

cmd_restart() {
  cmd_stop
  echo
  cmd_start
}

case "${1:-}" in
  start)   cmd_start ;;
  stop)    cmd_stop ;;
  restart) cmd_restart ;;
  status)  cmd_status ;;
  *) echo "usage: $(basename "$0") {start|stop|restart|status}" >&2; exit 2 ;;
esac
