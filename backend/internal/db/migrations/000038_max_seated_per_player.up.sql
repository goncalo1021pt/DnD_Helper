-- #171: a table seats a bounded number of heroes per player. The dial is the
-- DM's, defaulting to one seat each; existing multi-seated heroes stay seated —
-- the cap holds the door, it never evicts.
ALTER TABLE campaigns ADD COLUMN max_seated_per_player SMALLINT NOT NULL DEFAULT 1;
