-- A name somebody chose for themselves (#302). Until now every sign-in through
-- Discord or Google wrote the provider's name over users.name, so the only way
-- to be called something else was to be called it there. Once a person picks
-- their own name the provider's stops reaching it; the avatar still refreshes.
ALTER TABLE users ADD COLUMN name_chosen BOOLEAN NOT NULL DEFAULT false;
