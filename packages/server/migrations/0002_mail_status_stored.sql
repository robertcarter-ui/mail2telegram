-- Delivery journal: record parse/persist progress so a retry after a worker
-- failure resumes instead of repeating the work.
--
-- `stored` marks that the mail reached D1; a retry that sees it reuses the row
-- (matched by the identity in `message_id`) instead of parsing and inserting
-- again. `forwards` and `telegram` already tracked their own steps.
ALTER TABLE mail_status ADD COLUMN stored INTEGER NOT NULL DEFAULT 0;

-- The journal key used to be `${Message-ID}|${rawSize}`; it is now the delivery
-- identity (`sha256:…`) that is also stored in `emails.message_id`. Legacy rows
-- can never match a current delivery, so they would only accumulate and can be
-- dropped.
DELETE FROM mail_status WHERE message_id NOT LIKE 'sha256:%';
