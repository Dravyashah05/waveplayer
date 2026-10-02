"""Wave YT Music service: stdlib HTTP wrapper around sigma67/ytmusicapi.

Run:
    pip install -r requirements.txt
    python app.py            # PORT via YTMUSIC_PY_PORT (default 8002)

Only the Express gateway talks to this service (shared-secret header).
It is never exposed to browsers directly.

Endpoints (all GET unless noted):
    /health                    service + dependency status (no auth)
    /home?limit=               public home sections (anonymous ok)
    /library/playlists?limit=  per-user auth required
    /library/songs?limit=&order=
    /library/albums?limit=&order=
    /library/liked?limit=
    /library/history
    /auth/status               { authenticated } for X-Wave-User
    POST /auth/link            store user-supplied ytmusicapi credentials
"""

import json
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

from auth_provider import YTMusicAuthProvider
from normalize import (
    to_album_summary,
    to_artist_summary,
    to_music_track,
    to_playlist_summary,
)

try:
    from ytmusicapi import __version__ as _YT_VERSION  # type: ignore
    YTMUSIC_AVAILABLE = True
except Exception:
    _YT_VERSION = None
    YTMUSIC_AVAILABLE = False

PORT = int(os.environ.get("YTMUSIC_PY_PORT", "8002"))
AUTH_DIR = os.environ.get("YT_AUTH_DIR", os.path.join(os.path.dirname(os.path.abspath(__file__)), "auth"))
# Node gateway sends YTMUSIC_PY_SECRET; accept the legacy YT_PY_SECRET alias
# so a production deploy setting either name actually hardens the service.
SHARED_SECRET = os.environ.get("YTMUSIC_PY_SECRET", "") or os.environ.get("YT_PY_SECRET", "")
MAX_BODY_BYTES = 64 * 1024
ORDERS = {"a-z", "z-a", "recently_added"}

provider = YTMusicAuthProvider(AUTH_DIR)


def _clamp_limit(raw, default=25, maximum=100):
    try:
        value = int(raw)
    except (TypeError, ValueError):
        return default
    return max(1, min(maximum, value))


def _clean(items, convert):
    out = []
    for item in items or []:
        try:
            model = convert(item)
        except Exception:
            continue
        if model:
            out.append(model)
    return out


class Handler(BaseHTTPRequestHandler):
    server_version = "WaveYTMusicPy/1.0"

    # -- helpers ---------------------------------------------------------
    def _deny(self, code, error):
        body = json.dumps({"error": error}).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _ok(self, payload, code=200):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _trusted(self):
        """Loopback or shared-secret. Everything else is rejected."""
        if SHARED_SECRET:
            presented = self.headers.get("X-Wave-Secret", "")
            return bool(presented) and presented == SHARED_SECRET
        host = (self.client_address[0] if self.client_address else "")
        return host in ("127.0.0.1", "::1", "localhost")

    def _user(self):
        return (self.headers.get("X-Wave-User") or "anonymous").strip()[:128] or "anonymous"

    # -- routing ----------------------------------------------------------
    def do_GET(self):
        if not self._trusted():
            self._deny(403, "FORBIDDEN")
            return
        parsed = urlparse(self.path)
        query = parse_qs(parsed.query)
        path = parsed.path.rstrip("/") or "/"
        try:
            if path == "/health":
                self._ok({
                    "ok": True,
                    "service": "wave-ytmusic-python",
                    "ytmusicapi": _YT_VERSION or "missing",
                    "ytmusicapi_available": YTMUSIC_AVAILABLE,
                })
                return
            if path == "/auth/status":
                user = self._user()
                self._ok({"authenticated": provider.is_authenticated(user)})
                return
            if path == "/home":
                limit = _clamp_limit((query.get("limit") or [None])[0])
                yt = provider.get_anonymous_client()
                sections = yt.get_home(limit=limit)
                self._ok(_clean(sections, _pass_section))
                return
            user = self._user()
            try:
                yt = provider.get_authenticated_client(user)
            except PermissionError:
                self._deny(401, "YTMUSIC_AUTH_REQUIRED")
                return
            if path == "/library/playlists":
                limit = _clamp_limit((query.get("limit") or [None])[0])
                self._ok(_clean(yt.get_library_playlists(limit=limit), to_playlist_summary))
            elif path == "/library/songs":
                limit = _clamp_limit((query.get("limit") or [None])[0])
                order = (query.get("order") or [None])[0]
                kwargs = {"limit": limit}
                if order in ORDERS:
                    kwargs["order"] = order
                self._ok(_clean(yt.get_library_songs(**kwargs), to_music_track))
            elif path == "/library/albums":
                limit = _clamp_limit((query.get("limit") or [None])[0])
                order = (query.get("order") or [None])[0]
                kwargs = {"limit": limit}
                if order in ORDERS:
                    kwargs["order"] = order
                self._ok(_clean(yt.get_library_albums(**kwargs), to_album_summary))
            elif path == "/library/liked":
                limit = _clamp_limit((query.get("limit") or [None])[0])
                self._ok(_clean(yt.get_liked_songs(limit=limit), to_music_track))
            elif path == "/library/history":
                self._ok(_clean(yt.get_history(), to_music_track))
            elif path == "/library/artists":
                limit = _clamp_limit((query.get("limit") or [None])[0])
                order = (query.get("order") or [None])[0]
                kwargs = {"limit": limit}
                if order in ORDERS:
                    kwargs["order"] = order
                self._ok(_clean(yt.get_library_artists(**kwargs), to_artist_summary))
            else:
                self._deny(404, "NOT_FOUND")
        except Exception as exc:  # controlled error, never a traceback
            print("[ytmusic-py] request failed: %s" % type(exc).__name__)
            self._deny(502, "YTMUSIC_UPSTREAM_ERROR")

    def do_POST(self):
        if not self._trusted():
            self._deny(403, "FORBIDDEN")
            return
        parsed = urlparse(self.path)
        if (parsed.path.rstrip("/") or "/") != "/auth/link":
            self._deny(404, "NOT_FOUND")
            return
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        if length <= 0 or length > MAX_BODY_BYTES:
            self._deny(400, "INVALID_AUTH_PAYLOAD")
            return
        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            self._deny(400, "INVALID_AUTH_PAYLOAD")
            return
        try:
            provider.store_oauth(self._user(), payload)
        except ValueError:
            self._deny(400, "INVALID_AUTH_PAYLOAD")
            return
        except Exception:
            self._deny(502, "AUTH_STORE_FAILED")
            return
        self._ok({"ok": True})

    def log_message(self, fmt, *args):  # quieter stdlib logging
        print("[ytmusic-py] %s" % (fmt % args))


def _pass_section(section):
    """Home sections vary by shelf type; pass through normalized items only."""
    if not isinstance(section, dict):
        return None
    title = section.get("title")
    contents = section.get("contents")
    if not isinstance(contents, list):
        return None
    items = []
    for item in contents:
        if not isinstance(item, dict):
            continue
        model = None
        if item.get("videoId"):
            model = to_music_track(item)
        elif item.get("playlistId"):
            model = to_playlist_summary(item)
        elif item.get("browseId") and (item.get("title") or item.get("artist")):
            model = to_album_summary(item) or to_artist_summary(item)
        if model:
            items.append(model)
    if not items:
        return None
    out = {"title": title, "items": items}
    return {k: v for k, v in out.items() if v is not None}


def main():
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    mode = "secret" if SHARED_SECRET else "loopback-only (set YTMUSIC_PY_SECRET to harden)"
    print("[ytmusic-py] listening on 127.0.0.1:%d (%s), auth_dir=%s" % (PORT, mode, AUTH_DIR))
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
