-- Loans and cards you already owe on: a total outstanding and a monthly
-- instalment, paid down by ordinary expenses that name the plan. Tabby had
-- this first, under keys of its own.
ALTER TABLE expense ADD COLUMN plan TEXT NOT NULL DEFAULT '';

UPDATE expense SET plan = 'Tabby' WHERE plan = '' AND category = 'Tabby';
UPDATE settings SET key = 'plan:Tabby:outstanding' WHERE key = 'tabby:outstanding';
UPDATE settings SET key = 'plan:Tabby:monthly' WHERE key = 'tabby:monthly';
