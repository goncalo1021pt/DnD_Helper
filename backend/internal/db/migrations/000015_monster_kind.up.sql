-- The Monster Den: monsters join the content library as their own kind.
-- Visibility is special-cased in queries (SRD + own homebrew only — never
-- codex-shared, never listed to players), but storage rides the same table.
ALTER TYPE content_kind ADD VALUE IF NOT EXISTS 'monster';
