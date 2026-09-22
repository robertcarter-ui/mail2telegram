-- mail2telegram schema: mail history, attachments, address lists and runtime settings.

CREATE TABLE IF NOT EXISTS emails (
    id TEXT PRIMARY KEY,
    message_id TEXT,
    folder TEXT NOT NULL DEFAULT 'inbox',
    subject TEXT NOT NULL DEFAULT '',
    sender TEXT NOT NULL DEFAULT '',
    sender_name TEXT,
    recipient TEXT NOT NULL DEFAULT '',
    cc TEXT,
    bcc TEXT,
    date TEXT NOT NULL,
    is_read INTEGER NOT NULL DEFAULT 0,
    is_starred INTEGER NOT NULL DEFAULT 0,
    body_html TEXT,
    body_text TEXT,
    raw_key TEXT,
    size INTEGER NOT NULL DEFAULT 0,
    in_reply_to TEXT,
    references_json TEXT,
    thread_id TEXT,
    raw_headers TEXT,
    has_attachments INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_emails_folder_date ON emails (folder, date DESC);
CREATE INDEX IF NOT EXISTS idx_emails_message_id ON emails (message_id);
CREATE INDEX IF NOT EXISTS idx_emails_thread_id ON emails (thread_id);

CREATE TABLE IF NOT EXISTS attachments (
    id TEXT PRIMARY KEY,
    email_id TEXT NOT NULL,
    filename TEXT NOT NULL,
    mimetype TEXT NOT NULL,
    size INTEGER NOT NULL DEFAULT 0,
    content_id TEXT,
    disposition TEXT,
    r2_key TEXT NOT NULL,
    FOREIGN KEY (email_id) REFERENCES emails (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_attachments_email ON attachments (email_id);

CREATE TABLE IF NOT EXISTS addresses (
    id TEXT PRIMARY KEY,
    address TEXT NOT NULL,
    type TEXT NOT NULL,
    note TEXT,
    created_at TEXT NOT NULL,
    UNIQUE (address, type)
);

CREATE INDEX IF NOT EXISTS idx_addresses_type ON addresses (type);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- chat_id binds each notification to the chat that received it, so the
-- reply-to-email command can only be triggered from that chat. Telegram
-- message ids are only unique per chat, so the chat is part of the key:
-- a global id key would let one chat overwrite another's mapping.
CREATE TABLE IF NOT EXISTS telegram_messages (
    telegram_message_id TEXT NOT NULL,
    chat_id TEXT NOT NULL DEFAULT '',
    email_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (chat_id, telegram_message_id)
);

CREATE INDEX IF NOT EXISTS idx_telegram_messages_email ON telegram_messages (email_id);

-- Presence of a row marks that the chat has already seen the one-time /start
-- setup prompt; the insert-only conflict clause in claimFirstStart makes the
-- check atomic.
CREATE TABLE IF NOT EXISTS telegram_starts (
    chat_id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mail_status (
    message_id TEXT PRIMARY KEY,
    telegram INTEGER NOT NULL DEFAULT 0,
    forwards TEXT NOT NULL DEFAULT '[]',
    updated_at TEXT NOT NULL
);
