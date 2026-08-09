-- The Rulebook (#199): the game's keywords join the content library as their
-- own kind — conditions, weapon properties, masteries, actions, glossary
-- terms. Storage rides the same table; the seed ships the SRD glossary and
-- packs may add book subsystems (Circle Magic, Renown) the same way.
ALTER TYPE content_kind ADD VALUE IF NOT EXISTS 'rule';
