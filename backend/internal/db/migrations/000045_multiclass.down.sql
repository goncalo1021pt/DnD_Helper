-- Going back loses any hero who is genuinely multiclassed: characters can
-- hold one class_id, so the classes after the first have nowhere to go. The
-- starting class is already on the row, so a single-classed hero survives
-- the round trip intact.
DROP TABLE IF EXISTS character_classes;
