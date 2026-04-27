INSERT OR IGNORE INTO categories (id, name, description, status) VALUES
  ('cat-ingredients', 'Ingredients', 'Speaker names specific compounds or explains ingredient choices (NMN, PQQ, CoQ10, etc).', 'seed'),
  ('cat-experience', 'Experience / Testimonial', 'Speaker describes personal experience or results from using the product.', 'seed'),
  ('cat-science', 'Science / Mechanism', 'Speaker explains the biological or chemical mechanism behind an ingredient or effect.', 'seed'),
  ('cat-routine', 'Routine (AM/PM)', 'Speaker describes when/how they incorporate the product into their daily routine.', 'seed'),
  ('cat-preworkout', 'Pre-workout', 'Speaker discusses use before training or competition.', 'seed'),
  ('cat-postworkout', 'Post-workout', 'Speaker discusses recovery or use after training.', 'seed'),
  ('cat-travel', 'Travel', 'Speaker discusses use while traveling, jet lag, or on the go.', 'seed'),
  ('cat-sleep', 'Sleep', 'Speaker discusses sleep quality, bedtime routine, or wake-up feeling.', 'seed'),
  ('cat-energy', 'Energy', 'Speaker discusses energy levels or sustained focus.', 'seed'),
  ('cat-gut', 'Gut / Digestion', 'Speaker discusses digestion, bloating, or gut health.', 'seed'),
  ('cat-skin', 'Skin / Beauty', 'Speaker discusses skin, hair, or beauty outcomes.', 'seed'),
  ('cat-recovery', 'Recovery', 'Speaker discusses recovery from injury, illness, or hard training.', 'seed'),
  ('cat-dosage', 'Dosage / How-to-take', 'Speaker explains dosing, timing, or how they take the product.', 'seed'),
  ('cat-founder', 'Founder Story', 'Speaker tells the origin story of IM8, the founders, or the company.', 'seed'),
  ('cat-athlete', 'Athlete Story', 'Speaker shares athletic background or performance-related anecdotes.', 'seed');

INSERT OR IGNORE INTO schema_migrations (version) VALUES (2);
