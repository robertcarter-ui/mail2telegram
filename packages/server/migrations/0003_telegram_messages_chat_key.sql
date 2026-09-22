-- Realign `telegram_messages` with the schema the code expects.
--
-- Databases created before the chat-scoped key exist with a single-column
-- primary key (`telegram_message_id`), and because 0001_init.sql uses
-- `CREATE TABLE IF NOT EXISTS` the newer composite definition never applied.
-- `saveTelegramMessage` writes `ON CONFLICT (chat_id, telegram_message_id)`,
-- which then fails on every notification with
--   "ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint"
-- so the message -> email mapping was never stored and reply-by-Telegram-reply
-- silently could not find its email.
--
-- A unique index alone would not be enough: the leftover global primary key
-- still forbids the same Telegram message id in two different chats, and ids
-- are only unique per chat. Rebuilding is what matches the intended schema.
-- The copy is `INSERT OR IGNORE` so pre-existing rows can never abort it.
CREATE TABLE IF NOT EXISTS telegram_messages_new (
    telegram_message_id TEXT NOT NULL,
    chat_id TEXT NOT NULL DEFAULT '',
    email_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (chat_id, telegram_message_id)
);

INSERT OR IGNORE INTO telegram_messages_new (telegram_message_id, chat_id, email_id, created_at)
    SELECT telegram_message_id, chat_id, email_id, created_at FROM telegram_messages;

DROP TABLE telegram_messages;

ALTER TABLE telegram_messages_new RENAME TO telegram_messages;

CREATE INDEX IF NOT EXISTS idx_telegram_messages_email ON telegram_messages (email_id);
