ALTER TABLE speakers ADD COLUMN image_url TEXT;

UPDATE speakers SET image_url = 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/93/David_Beckham_2024.jpg/400px-David_Beckham_2024.jpg'
  WHERE normalized_name = 'davidbeckham';

UPDATE speakers SET image_url = 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/2c/Aryna_Sabalenka_%282024%29.jpg/400px-Aryna_Sabalenka_%282024%29.jpg'
  WHERE normalized_name = 'arynasabalenka';

INSERT OR IGNORE INTO schema_migrations (version) VALUES (5);
