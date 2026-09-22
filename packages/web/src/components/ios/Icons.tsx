import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 24, children, ...rest }: IconProps & { children: React.ReactNode }) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
            {...rest}
        >
            {children}
        </svg>
    );
}

/** tray icon used by the Inbox mailbox. */
export function InboxIcon(props: IconProps) {
    return (
        <Svg {...props}>
            <path d="M3 13.5 5.2 5.6A1.6 1.6 0 0 1 6.75 4.4h10.5a1.6 1.6 0 0 1 1.55 1.2L21 13.5v3.9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            <path d="M3 13.5h4.2l1.1 2.1h7.4l1.1-2.1H21" />
        </Svg>
    );
}

/** octagon with exclamation, used by Spam. */
export function SpamIcon(props: IconProps) {
    return (
        <Svg {...props}>
            <path d="M8.4 3h7.2L21 8.4v7.2L15.6 21H8.4L3 15.6V8.4z" />
            <path d="M12 8v4.4" />
            <path d="M12 15.6h.01" />
        </Svg>
    );
}

export function TrashIcon(props: IconProps) {
    return (
        <Svg {...props}>
            <path d="M5 7h14" />
            <path d="M9.5 7V5.4A1.4 1.4 0 0 1 10.9 4h2.2a1.4 1.4 0 0 1 1.4 1.4V7" />
            <path d="M6.6 7l.8 11.2A1.8 1.8 0 0 0 9.2 20h5.6a1.8 1.8 0 0 0 1.8-1.8L17.4 7" />
        </Svg>
    );
}

export function SentIcon(props: IconProps) {
    return (
        <Svg {...props}>
            <path d="M20.5 3.5 10.5 13.5" />
            <path d="M20.5 3.5 14 20.5l-3.5-7-7-3.5z" />
        </Svg>
    );
}

export function ChevronRightIcon(props: IconProps) {
    return (
        <Svg {...props}>
            <path d="M9 5l7 7-7 7" />
        </Svg>
    );
}

export function ChevronLeftIcon(props: IconProps) {
    return (
        <Svg {...props}>
            <path d="M15 5l-7 7 7 7" />
        </Svg>
    );
}

export function ReplyIcon(props: IconProps) {
    return (
        <Svg {...props}>
            <path d="M9.5 7.5 4 12l5.5 4.5" />
            <path d="M4 12h8.5a6.5 6.5 0 0 1 6.5 6.5v.5" />
        </Svg>
    );
}

export function FlagIcon(props: IconProps) {
    return (
        <Svg {...props}>
            <path d="M6.5 21V4" />
            <path d="M6.5 5.2c2-1.4 4-1.4 6 0s4 1.4 6 0v8c-2 1.4-4 1.4-6 0s-4-1.4-6 0z" />
        </Svg>
    );
}

export function StarIcon({ filled, ...props }: IconProps & { filled?: boolean }) {
    return (
        <Svg {...props}>
            <path
                d="M12 3.8l2.6 5.3 5.9.8-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8L3.5 9.9l5.9-.8z"
                fill={filled ? 'currentColor' : 'none'}
            />
        </Svg>
    );
}

export function ComposeIcon(props: IconProps) {
    return (
        <Svg {...props}>
            <path d="M4 20h4.2L19.4 8.8a1.7 1.7 0 0 0 0-2.4l-1.8-1.8a1.7 1.7 0 0 0-2.4 0L4 15.8z" />
            <path d="M14.2 5.6l4.2 4.2" />
        </Svg>
    );
}

export function SearchIcon(props: IconProps) {
    return (
        <Svg {...props}>
            <circle cx="11" cy="11" r="6.2" />
            <path d="M15.6 15.6 20 20" />
        </Svg>
    );
}

export function ArchiveIcon(props: IconProps) {
    return (
        <Svg {...props}>
            <rect x="3.5" y="4.5" width="17" height="4" rx="1" />
            <path d="M5 8.5V19a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19V8.5" />
            <path d="M10 13h4" />
        </Svg>
    );
}

export function MailIcon(props: IconProps) {
    return (
        <Svg {...props}>
            <rect x="3" y="5.5" width="18" height="13" rx="2.5" />
            <path d="M4 7.5l7.1 5.2a1.5 1.5 0 0 0 1.8 0L20 7.5" />
        </Svg>
    );
}

export function GearIcon(props: IconProps) {
    return (
        <Svg {...props}>
            {/* Feather "settings" cog, MIT licensed. */}
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </Svg>
    );
}

/** horizontal three-dot, opens the reader's secondary action menu. */
export function EllipsisIcon(props: IconProps) {
    return (
        <Svg {...props}>
            <circle cx="5" cy="12" r="2" fill="currentColor" stroke="none" />
            <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
            <circle cx="19" cy="12" r="2" fill="currentColor" stroke="none" />
        </Svg>
    );
}

export function CloseIcon(props: IconProps) {
    return (
        <Svg {...props}>
            <path d="M6 6l12 12M18 6L6 18" />
        </Svg>
    );
}

export function CheckIcon(props: IconProps) {
    return (
        <Svg {...props}>
            <path d="M5 12.5l4.5 4.5L19 7" />
        </Svg>
    );
}

export function RefreshIcon(props: IconProps) {
    return (
        <Svg {...props}>
            <path d="M20 11a8 8 0 1 0-2.3 6.3" />
            <path d="M20 5v6h-6" />
        </Svg>
    );
}

export function PlusIcon(props: IconProps) {
    return (
        <Svg {...props}>
            <path d="M12 5v14M5 12h14" />
        </Svg>
    );
}

export function AttachmentIcon(props: IconProps) {
    return (
        <Svg {...props}>
            <path d="M14.5 6.5 8.2 12.8a2.6 2.6 0 0 0 3.7 3.7l6.8-6.8a4.4 4.4 0 0 0-6.2-6.2l-7 7a6.2 6.2 0 0 0 8.8 8.8l6-6" />
        </Svg>
    );
}

export function SparkleIcon(props: IconProps) {
    return (
        <Svg {...props}>
            <path d="M12 4l1.6 4.4L18 10l-4.4 1.6L12 16l-1.6-4.4L6 10l4.4-1.6z" />
            <path d="M18.5 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" />
        </Svg>
    );
}

export function DevicesIcon(props: IconProps) {
    return (
        <Svg {...props}>
            <rect x="2.5" y="5" width="12" height="14" rx="2" />
            <rect x="15.5" y="9" width="6" height="10" rx="1.6" />
            <path d="M17.5 16.5h2" />
        </Svg>
    );
}

export function FastForwardIcon(props: IconProps) {
    return (
        <Svg {...props}>
            <path d="M4 6l6.5 6L4 18z" />
            <path d="M13 6l6.5 6L13 18z" />
        </Svg>
    );
}

export function GitHubIcon(props: IconProps) {
    return (
        <svg
            width={props.size ?? 24}
            height={props.size ?? 24}
            viewBox="0 0 16 16"
            fill="currentColor"
            aria-hidden
            {...props}
        >
            {/* Official Octicon mark, MIT licensed. */}
            <path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z" />
        </svg>
    );
}
