CREATE TABLE IF NOT EXISTS public_playlists (
  id TEXT PRIMARY KEY,
  owner_name TEXT NOT NULL,
  owner_avatar TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  tracks_json TEXT NOT NULL,
  edit_key_hash TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_public_playlists_updated ON public_playlists(updated_at DESC);
