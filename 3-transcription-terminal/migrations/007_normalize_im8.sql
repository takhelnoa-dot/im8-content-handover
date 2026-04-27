-- Whisper consistently mishears "IM8" as "IMA" or "I am eight". Fix existing
-- segments. The segments_au trigger keeps FTS5 in sync automatically.

UPDATE segments SET text = REPLACE(text, 'I am eight', 'IM8') WHERE text LIKE '%I am eight%';
UPDATE segments SET text = REPLACE(text, 'i am eight', 'IM8') WHERE text LIKE '%i am eight%';
UPDATE segments SET text = REPLACE(text, 'IMA', 'IM8') WHERE text LIKE '%IMA%' AND text NOT LIKE '%IMAGE%' AND text NOT LIKE '%IMAGINE%' AND text NOT LIKE '%IMAGIN%';
UPDATE segments SET text = REPLACE(text, 'Ima', 'IM8') WHERE text LIKE '%Ima%' AND text NOT LIKE '%Image%' AND text NOT LIKE '%Imagine%' AND text NOT LIKE '%Imagin%';
UPDATE segments SET text = REPLACE(text, ' ima ', ' IM8 ') WHERE text LIKE '% ima %';

INSERT OR IGNORE INTO schema_migrations (version) VALUES (7);
