"""Normalize raw ytmusicapi payloads into Wave music models.

Rules:
- Only copy fields the upstream payload actually supplied.
- Optional fields stay absent when unknown — never fabricated.
- Thumbnails: pick the largest available; artwork stays a plain URL string.
"""

from typing import Any, Dict, List, Optional


def _str(value: Any) -> Optional[str]:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _int(value: Any) -> Optional[int]:
    try:
        number = int(value)
    except (TypeError, ValueError):
        return None
    return number if number >= 0 else None


def pick_artwork(thumbnails: Any) -> Optional[str]:
    """Largest thumbnail URL, or None. Accepts ytmusicapi thumbnail lists."""
    best_url: Optional[str] = None
    best_area = -1
    if isinstance(thumbnails, list):
        for thumb in thumbnails:
            if not isinstance(thumb, dict):
                continue
            url = thumb.get("url")
            if not url:
                continue
            try:
                area = int(thumb.get("width") or 0) * int(thumb.get("height") or 0)
            except (TypeError, ValueError):
                area = 0
            if area >= best_area:
                best_area = area
                best_url = str(url)
    return best_url


def _parse_clock(nums: List[int]) -> Optional[int]:
    total = 0
    for part in nums:
        if part < 0:
            return None
        total = total * 60 + part
    return total if total > 0 else None


def parse_duration(value: Any) -> Optional[int]:
    """Accept upstream seconds (int/float/numeric str) or m:ss / h:mm:ss."""
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        seconds = int(value)
        return seconds if seconds > 0 else None
    text = str(value).strip()
    if not text:
        return None
    if text.isdigit():
        seconds = int(text)
        return seconds if seconds > 0 else None
    parts = text.split(":")
    if not parts or len(parts) > 3:
        return None
    try:
        nums = [int(p) for p in parts]
    except ValueError:
        return None
    return _parse_clock(nums)


def _artist_name(raw: Dict[str, Any]) -> Optional[str]:
    artists = raw.get("artists")
    if isinstance(artists, list) and artists:
        names = [_str(a.get("name") if isinstance(a, dict) else a) for a in artists]
        names = [n for n in names if n]
        if names:
            return ", ".join(names)
    for key in ("artist", "author", "uploader"):
        name = _str(raw.get(key))
        if name:
            return name
    return None


def _album_name(raw: Dict[str, Any]) -> Optional[str]:
    album = raw.get("album")
    if isinstance(album, dict):
        return _str(album.get("name"))
    return _str(album)


def to_music_track(raw: Any) -> Optional[Dict[str, Any]]:
    """Wave MusicTrack. None when no video identity exists."""
    if not isinstance(raw, dict):
        return None
    video_id = _str(raw.get("videoId"))
    if not video_id:
        return None
    track: Dict[str, Any] = {
        "id": video_id,
        "title": _str(raw.get("title")),
        "artist": _artist_name(raw),
        "album": _album_name(raw),
        "artwork": pick_artwork(raw.get("thumbnails")),
        "duration": parse_duration(raw.get("duration_seconds", raw.get("duration"))),
        "source": "ytmusic",
        "sourceId": "ytmusic-python",
        "youtubeId": video_id,
        "ytmusicId": video_id,
        "isrc": _str(raw.get("isrc")),
        "year": _int(raw.get("year")),
    }
    return {k: v for k, v in track.items() if v is not None}


def to_playlist_summary(raw: Any) -> Optional[Dict[str, Any]]:
    if not isinstance(raw, dict):
        return None
    playlist_id = _str(raw.get("playlistId"))
    if not playlist_id:
        return None
    summary = {
        "id": playlist_id,
        "title": _str(raw.get("title")),
        "author": _artist_name(raw),
        "artwork": pick_artwork(raw.get("thumbnails")),
        "itemCount": _int(raw.get("count")),
        "source": "ytmusic",
        "sourceId": "ytmusic-python",
    }
    return {k: v for k, v in summary.items() if v is not None}


def to_album_summary(raw: Any) -> Optional[Dict[str, Any]]:
    if not isinstance(raw, dict):
        return None
    album_id = _str(raw.get("browseId") or raw.get("albumId"))
    if not album_id and not _str(raw.get("title")):
        return None
    summary = {
        "id": album_id,
        "title": _str(raw.get("title")),
        "artist": _artist_name(raw),
        "artwork": pick_artwork(raw.get("thumbnails")),
        "year": _int(raw.get("year")),
        "source": "ytmusic",
        "sourceId": "ytmusic-python",
    }
    return {k: v for k, v in summary.items() if v is not None}


def to_artist_summary(raw: Any) -> Optional[Dict[str, Any]]:
    if not isinstance(raw, dict):
        return None
    name = _str(raw.get("artist") or raw.get("name") or raw.get("title"))
    if not name:
        return None
    summary = {
        "id": _str(raw.get("browseId") or raw.get("artistId") or raw.get("id")),
        "title": name,
        "artwork": pick_artwork(raw.get("thumbnails")),
        "subscribers": _str(raw.get("subscribers")),
        "source": "ytmusic",
        "sourceId": "ytmusic-python",
    }
    return {k: v for k, v in summary.items() if v is not None}
