-- Credit is one payment method with a card behind it: Mashreq, ADCB, CBD, DIB
-- or Tabby. Tabby used to be a payment method of its own.
ALTER TABLE expense ADD COLUMN card TEXT NOT NULL DEFAULT '';
ALTER TABLE card_payment ADD COLUMN card TEXT NOT NULL DEFAULT '';

UPDATE expense SET method = 'Credit Card', card = 'Tabby' WHERE method = 'Tabby';
UPDATE card_payment SET card = method WHERE card = '' AND method <> '';
