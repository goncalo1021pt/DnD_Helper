-- A pin may name a place (#312): the marker becomes a door to that place's
-- page, the way a region already can (#262) and a map does (#229). Striking
-- the place unpins nothing — the marker stays where it was, the door goes.
ALTER TABLE map_pins ADD COLUMN location_id UUID REFERENCES locations(id) ON DELETE SET NULL;
CREATE INDEX idx_map_pins_location ON map_pins(location_id);
