-- #314: when a token was last refused for going over its ceiling, written at
-- most once a minute, so the profile can say a script is looping.
ALTER TABLE api_tokens ADD COLUMN throttled_at TIMESTAMPTZ;
