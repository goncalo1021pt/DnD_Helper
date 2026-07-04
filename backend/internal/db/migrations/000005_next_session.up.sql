-- Next gathering: when the table meets again, shown as a countdown.
ALTER TABLE campaigns ADD COLUMN next_session_at TIMESTAMPTZ;
