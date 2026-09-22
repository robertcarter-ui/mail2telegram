const dateFormatter = new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
});

const timeFormatter = new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
});

const fullFormatter = new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
});

/** Short relative date for list rows: time today, otherwise a compact date. */
export function formatListDate(iso: string): string {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) {
        return '';
    }
    const now = new Date();
    const sameDay = date.toDateString() === now.toDateString();
    if (sameDay) {
        return timeFormatter.format(date);
    }
    if (date.getFullYear() === now.getFullYear()) {
        return dateFormatter.format(date);
    }
    return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
}

export function formatFullDate(iso: string): string {
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? '' : fullFormatter.format(date);
}

export function formatBytes(bytes: number): string {
    if (!bytes) {
        return '0 B';
    }
    const units = ['B', 'KB', 'MB', 'GB'];
    const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const value = bytes / 1024 ** index;
    return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

/** Human readable sender: display name when present, else the address. */
export function senderLabel(email: { sender: string; sender_name: string | null }): string {
    return email.sender_name || email.sender || '(unknown sender)';
}

/** Short sender for narrow list rows. */
export function initialOf(value: string): string {
    const char = value.trim().charAt(0);
    return char ? char.toUpperCase() : '#';
}
