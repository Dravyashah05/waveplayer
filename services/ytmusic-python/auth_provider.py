"""Per-user ytmusicapi authentication adapter.

Security model:
- Every Wave user gets their OWN ytmusicapi client bound to THEIR auth file.
- There is deliberately NO shared authenticated session: the anonymous
  (unauthenticated) client is a separate instance used only for public data.
- Auth material lives in files under ``auth_dir`` (0600), one file per user id.
  The user id is sanitized so it can never escape that directory.
- Google OAuth tokens are NOT accepted here: a Google access token does not
  authenticate ytmusicapi, which needs its own browser-cookie or OAuth-device
  credentials. Linking a ytmusicapi session is an explicit, separate step
  (``store_oauth``), never implicit.

``YTMusic`` is imported lazily so unit tests and ``/health`` probing work even
when the dependency is not installed.
"""

import json
import os
import re
import threading
from typing import Any, Callable, Dict, Optional

_USER_ID_RE = re.compile(r"[^A-Za-z0-9_-]")


def sanitize_user_id(user_id: Any) -> str:
    """Map an arbitrary Wave user key to a safe filename stem."""
    text = str(user_id or "").strip()
    cleaned = _USER_ID_RE.sub("_", text)[:64].strip("_")
    return cleaned or "anonymous"


class YTMusicAuthProvider:
    """Owns per-user ytmusicapi clients. No global authenticated client."""

    def __init__(
        self,
        auth_dir: str,
        client_factory: Optional[Callable[..., Any]] = None,
    ) -> None:
        self._auth_dir = auth_dir
        self._clients: Dict[str, Any] = {}
        self._lock = threading.Lock()
        self._factory = client_factory

    # -- storage ---------------------------------------------------------
    def _auth_path(self, user_id: str) -> str:
        return os.path.join(self._auth_dir, "ytmusic-%s.json" % sanitize_user_id(user_id))

    def is_authenticated(self, user_id: str) -> bool:
        """True when a parseable per-user auth file exists."""
        try:
            with open(self._auth_path(user_id), "r", encoding="utf-8") as handle:
                payload = json.load(handle)
            return isinstance(payload, dict) and bool(payload)
        except (OSError, ValueError):
            return False

    def store_oauth(self, user_id: str, payload: Dict[str, Any]) -> None:
        """Persist user-supplied ytmusicapi credentials (server side only).

        ``payload`` is the content of an oauth.json produced by
        ``YTMusic.setup_oauth()`` (or equivalent headers JSON). It must be a
        non-empty object; anything else is rejected without touching disk.
        """
        if not isinstance(payload, dict) or not payload:
            raise ValueError("INVALID_AUTH_PAYLOAD")
        os.makedirs(self._auth_dir, exist_ok=True)
        path = self._auth_path(user_id)
        with open(path, "w", encoding="utf-8") as handle:
            json.dump(payload, handle)
        try:
            os.chmod(path, 0o600)
        except OSError:
            pass
        with self._lock:
            self._clients.pop(sanitize_user_id(user_id), None)

    def clear_session(self, user_id: str) -> bool:
        """Drop the cached client and delete the stored credentials."""
        key = sanitize_user_id(user_id)
        with self._lock:
            self._clients.pop(key, None)
        try:
            os.remove(self._auth_path(user_id))
            return True
        except OSError:
            return False

    # -- clients ----------------------------------------------------------
    def _build(self, auth: Optional[str]) -> Any:
        if self._factory is not None:
            return self._factory(auth)
        from ytmusicapi import YTMusic  # lazy: optional dependency

        if auth is None:
            return YTMusic()
        return YTMusic(auth)

    def get_anonymous_client(self) -> Any:
        """Shared UNAUTHENTICATED client — public data only, never a session."""
        with self._lock:
            client = self._clients.get("__anonymous__")
            if client is None:
                client = self._build(None)
                self._clients["__anonymous__"] = client
            return client

    def get_authenticated_client(self, user_id: str) -> Any:
        """Per-user client bound to that user's auth file. Raises when absent."""
        key = sanitize_user_id(user_id)
        with self._lock:
            cached = self._clients.get(key)
            if cached is not None:
                return cached
        path = self._auth_path(user_id)
        if not self.is_authenticated(user_id):
            raise PermissionError("YTMUSIC_AUTH_REQUIRED")
        client = self._build(path)
        with self._lock:
            self._clients[key] = client
        return client
