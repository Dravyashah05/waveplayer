"""Unit tests for the Wave ytmusic-python service.

Run from this directory:
    python -m unittest test_app -v
No network access. ytmusicapi is stubbed via factory injection.
"""

import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import app  # noqa: E402
from auth_provider import YTMusicAuthProvider, sanitize_user_id  # noqa: E402
from normalize import (  # noqa: E402
    parse_duration,
    pick_artwork,
    to_album_summary,
    to_artist_summary,
    to_music_track,
    to_playlist_summary,
)


class FakeYTMusic:
    instances = []

    def __init__(self, auth=None):
        self.auth = auth
        FakeYTMusic.instances.append(self)


class NormalizeTests(unittest.TestCase):
    def test_track_full(self):
        track = to_music_track({
            "videoId": "dQw4w9WgXcQ",
            "title": " Song ",
            "artists": [{"name": "A"}, {"name": "B"}],
            "album": {"name": "Alb"},
            "thumbnails": [
                {"url": "http://x/s.jpg", "width": 60, "height": 60},
                {"url": "http://x/l.jpg", "width": 544, "height": 544},
            ],
            "duration_seconds": 212,
        })
        self.assertEqual(track["id"], "dQw4w9WgXcQ")
        self.assertEqual(track["title"], "Song")
        self.assertEqual(track["artist"], "A, B")
        self.assertEqual(track["album"], "Alb")
        self.assertEqual(track["artwork"], "http://x/l.jpg")
        self.assertEqual(track["duration"], 212)
        self.assertEqual(track["source"], "ytmusic")
        self.assertEqual(track["youtubeId"], "dQw4w9WgXcQ")
        self.assertNotIn("isrc", track)
        self.assertNotIn("year", track)

    def test_track_rejects_identity_without_video_id(self):
        self.assertIsNone(to_music_track({"title": "No id"}))
        self.assertIsNone(to_music_track(None))
        self.assertIsNone(to_music_track("nope"))

    def test_track_duration_string_clock(self):
        track = to_music_track({"videoId": "dQw4w9WgXcQ", "duration": "3:32"})
        self.assertEqual(track["duration"], 212)

    def test_durations(self):
        self.assertEqual(parse_duration(200), 200)
        self.assertEqual(parse_duration("200"), 200)
        self.assertEqual(parse_duration("1:02:03"), 3723)
        self.assertIsNone(parse_duration(0))
        self.assertIsNone(parse_duration(-5))
        self.assertIsNone(parse_duration("abc"))
        self.assertIsNone(parse_duration("1:2:3:4"))
        self.assertIsNone(parse_duration(None))
        self.assertIsNone(parse_duration(True))

    def test_artwork(self):
        self.assertIsNone(pick_artwork(None))
        self.assertIsNone(pick_artwork([]))
        self.assertIsNone(pick_artwork([{"width": 1}]))

    def test_playlist_requires_id(self):
        self.assertIsNone(to_playlist_summary({"title": "No id"}))
        pl = to_playlist_summary({"playlistId": "PL1", "title": "Mix"})
        self.assertEqual(pl["id"], "PL1")
        self.assertNotIn("itemCount", pl)

    def test_album_and_artist(self):
        al = to_album_summary({"browseId": "MP1", "title": "A", "year": 2020})
        self.assertEqual(al["year"], 2020)
        self.assertIsNone(to_album_summary({"nope": 1}))
        ar = to_artist_summary({"browseId": "UC1", "artist": "Singer"})
        self.assertEqual(ar["title"], "Singer")
        self.assertIsNone(to_artist_summary({"browseId": "UC1"}))


class AuthProviderTests(unittest.TestCase):
    def setUp(self):
        FakeYTMusic.instances = []
        self.tmp = tempfile.TemporaryDirectory()
        self.provider = YTMusicAuthProvider(self.tmp.name, client_factory=FakeYTMusic)

    def tearDown(self):
        self.tmp.cleanup()

    def test_user_id_sanitized_against_traversal(self):
        self.assertEqual(sanitize_user_id("../../etc/passwd"), "etc_passwd")
        self.assertEqual(sanitize_user_id(""), "anonymous")
        self.assertNotIn("/", sanitize_user_id("a/b\\c"))
        path = os.path.join(self.tmp.name, "ytmusic-%s.json" % sanitize_user_id("../../x"))
        self.assertTrue(os.path.dirname(os.path.abspath(path)) == os.path.abspath(self.tmp.name))

    def test_unauthenticated_by_default(self):
        self.assertFalse(self.provider.is_authenticated("alice"))

    def test_users_get_isolated_clients(self):
        self.provider.store_oauth("alice", {"access_token": "a"})
        self.provider.store_oauth("bob", {"access_token": "b"})
        client_a = self.provider.get_authenticated_client("alice")
        client_b = self.provider.get_authenticated_client("bob")
        self.assertIsNot(client_a, client_b)
        self.assertIn("alice", client_a.auth)
        self.assertIn("bob", client_b.auth)
        # Same user reuses her own cached client.
        self.assertIs(client_a, self.provider.get_authenticated_client("alice"))

    def test_no_shared_authenticated_session(self):
        self.provider.store_oauth("alice", {"access_token": "a"})
        with self.assertRaises(PermissionError):
            self.provider.get_authenticated_client("mallory")
        anon = self.provider.get_anonymous_client()
        self.assertIsNone(anon.auth)
        self.assertIs(anon, self.provider.get_anonymous_client())

    def test_store_rejects_invalid_payloads(self):
        with self.assertRaises(ValueError):
            self.provider.store_oauth("alice", {})
        with self.assertRaises(ValueError):
            self.provider.store_oauth("alice", [])
        self.assertFalse(self.provider.is_authenticated("alice"))

    def test_clear_session(self):
        self.provider.store_oauth("alice", {"access_token": "a"})
        self.assertTrue(self.provider.is_authenticated("alice"))
        self.assertTrue(self.provider.clear_session("alice"))
        self.assertFalse(self.provider.is_authenticated("alice"))
        self.assertFalse(self.provider.clear_session("alice"))


class AppHelperTests(unittest.TestCase):
    def test_clamp_limit(self):
        self.assertEqual(app._clamp_limit(None), 25)
        self.assertEqual(app._clamp_limit("abc"), 25)
        self.assertEqual(app._clamp_limit("0"), 1)
        self.assertEqual(app._clamp_limit("500"), 100)
        self.assertEqual(app._clamp_limit("10"), 10)

    def test_clean_drops_failures(self):
        out = app._clean([{"videoId": "dQw4w9WgXcQ"}, {"nope": 1}, None], to_music_track)
        self.assertEqual(len(out), 1)


if __name__ == "__main__":
    unittest.main()
