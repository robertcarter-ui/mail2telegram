import type { Email, EmailListResponse } from '@mail2telegram/shared';
import { Preloader, Searchbar, Segmented, SegmentedButton } from 'konsta/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client';
import { useApp } from '../AppContext';
import { CloseIcon, ComposeIcon, GearIcon, SearchIcon } from '../components/ios/Icons';
import { MessageList } from '../components/ios/MessageList';
import { NavBar } from '../components/ios/NavBar';
import { PullToRefresh } from '../components/ios/PullToRefresh';
import { useAsync } from '../hooks/useAsync';

const PAGE_SIZE = 30;

export interface InboxPageProps {
    selectedId: string | null;
    onSelect: (id: string | null) => void;
    /** Split layout: the list is the master column and gets a Settings footer. */
    hasSidebar: boolean;
    /** Split only: the settings pages currently occupy the detail column. */
    isSettings?: boolean;
    /** Split only: bumped when the detail column edits mail, forcing a reload. */
    refreshToken?: number;
    /** Split only: toggles between the inbox and the settings hub. */
    onOpenSettings?: () => void;
    /** Opens the compose screen; only offered when Resend sending is enabled. */
    onCompose?: () => void;
    onUnreadChange: (unread: number) => void;
}

/** iOS Mail message list with search and filters. */
export function InboxPage({
    selectedId,
    onSelect,
    hasSidebar,
    isSettings = false,
    refreshToken = 0,
    onOpenSettings,
    onCompose,
    onUnreadChange,
}: InboxPageProps) {
    const { me } = useApp();
    const [query, setQuery] = useState('');
    const [appliedQuery, setAppliedQuery] = useState('');
    const [limit, setLimit] = useState(PAGE_SIZE);
    const [filter, setFilter] = useState<'all' | 'unread' | 'starred'>('all');
    const [searching, setSearching] = useState(false);
    const scrollRef = useRef<HTMLDivElement | null>(null);
    const searchRef = useRef<HTMLDivElement | null>(null);

    const { data, loading, error, reload } = useAsync<EmailListResponse>(
        () =>
            api.listEmails({
                q: appliedQuery || undefined,
                limit,
                unread: filter === 'unread' ? true : undefined,
                starred: filter === 'starred' ? true : undefined,
            }),
        [appliedQuery, limit, filter, refreshToken],
    );

    const emails = data?.emails ?? [];
    const hasMore = data ? emails.length < data.total : false;

    useEffect(() => {
        if (data?.unread !== undefined) {
            onUnreadChange(data.unread);
        }
    }, [data?.unread, onUnreadChange]);

    // Telegram parks the WebView in the background; picking the chat back up
    // should show the mail that arrived meanwhile.
    useEffect(() => {
        const onVisible = () => {
            if (document.visibilityState === 'visible') {
                reload();
            }
        };
        document.addEventListener('visibilitychange', onVisible);
        return () => document.removeEventListener('visibilitychange', onVisible);
    }, [reload]);

    // Swipe-to-delete permanently erases the message together with its stored
    // bodies and attachments, and drops the selection if it was the open one.
    const removeEmail = async (email: Email) => {
        try {
            await api.deleteEmail(email.id);
        } catch {
            return;
        }
        if (email.id === selectedId) {
            onSelect(null);
        }
        reload();
    };

    useEffect(() => {
        const timer = setTimeout(() => {
            setAppliedQuery(query);
            setLimit(PAGE_SIZE);
        }, 350);
        return () => clearTimeout(timer);
    }, [query]);

    // Open search with the field focused, like iOS Mail; cancelling clears the
    // active query so the list never keeps filtering invisibly.
    useEffect(() => {
        if (!searching) {
            return;
        }
        searchRef.current?.querySelector('input')?.focus();
    }, [searching]);

    const closeSearch = () => {
        setSearching(false);
        setQuery('');
        setAppliedQuery('');
    };

    // Reset the scroll position when the query or filter changes.
    useEffect(() => {
        scrollRef.current?.scrollTo({ top: 0 });
    }, [appliedQuery, filter]);

    const empty = useMemo(() => {
        if (appliedQuery) {
            return { title: 'No Results', subtitle: `No messages matching \u201C${appliedQuery}\u201D.` };
        }
        if (filter === 'unread') {
            return { title: 'No Unread Mail', subtitle: '' };
        }
        if (filter === 'starred') {
            return { title: 'No Starred Mail', subtitle: '' };
        }
        return { title: 'No Mail', subtitle: 'Messages you receive will appear here.' };
    }, [appliedQuery, filter]);

    const nav = (
        <NavBar
            title="Inbox"
            // On the phone the root list offers Close; while a message is
            // open the reader owns the native button instead, so the two
            // never subscribe at the same time.
            close={!hasSidebar && !selectedId}
            right={
                <button
                    type="button"
                    aria-label={searching ? 'Close search' : 'Search'}
                    className="bar-button icon-hit p-1 text-[var(--ios-blue)]"
                    onClick={() => (searching ? closeSearch() : setSearching(true))}
                >
                    {searching ? <CloseIcon size={20} /> : <SearchIcon size={22} />}
                </button>
            }
        />
    );

    const header = (
        <div className="list-header">
            {searching ? (
                <div className="px-2 py-1" ref={searchRef}>
                    <Searchbar
                        placeholder="Search"
                        value={query}
                        onChange={(e: any) => setQuery(e.target.value)}
                        onClear={() => {
                            setQuery('');
                            setAppliedQuery('');
                        }}
                        disableButton
                    />
                </div>
            ) : null}
            <div className="px-3 pb-2 pt-2">
                <Segmented strong className="ios-segmented">
                    <SegmentedButton active={filter === 'all'} onClick={() => setFilter('all')}>
                        All
                    </SegmentedButton>
                    <SegmentedButton active={filter === 'unread'} onClick={() => setFilter('unread')}>
                        Unread
                    </SegmentedButton>
                    <SegmentedButton active={filter === 'starred'} onClick={() => setFilter('starred')}>
                        Starred
                    </SegmentedButton>
                </Segmented>
            </div>
        </div>
    );

    const list = (
        <PullToRefresh className="page-scroll" scrollRef={scrollRef} onRefresh={reload}>
            {loading && emails.length === 0 ? (
                <div className="spin-center">
                    <Preloader />
                </div>
            ) : error ? (
                <div className="reader-empty">
                    <div>
                        <p className="mb-3">{error.message}</p>
                        <button type="button" className="text-button" onClick={reload}>
                            Try Again
                        </button>
                    </div>
                </div>
            ) : emails.length === 0 ? (
                <div className="empty-state">
                    <div className="empty-state__title">{empty.title}</div>
                    {empty.subtitle ? <div className="empty-state__subtitle">{empty.subtitle}</div> : null}
                </div>
            ) : (
                <MessageList
                    emails={emails}
                    selectedId={selectedId}
                    onSelect={(email: Email) => onSelect(email.id)}
                    onDelete={removeEmail}
                    onEndReached={hasMore ? () => setLimit(value => value + PAGE_SIZE) : undefined}
                />
            )}
        </PullToRefresh>
    );

    // Floating "new message" button, offered whenever the worker can send
    // through Resend; it hovers over the list in both layouts.
    const composeFab =
        me.resendEnabled && onCompose ? (
            <button
                type="button"
                className={`compose-fab ${hasSidebar ? 'compose-fab--lifted' : ''}`}
                aria-label="New message"
                onClick={onCompose}
            >
                <ComposeIcon size={22} />
            </button>
        ) : null;

    // Split layout: the list is the master column and carries the big Settings
    // button at the bottom; the detail column lives outside this component.
    if (hasSidebar) {
        return (
            <div className="compose-anchor">
                {nav}
                {header}
                {list}
                {composeFab}
                <div className="master-pane__footer">
                    <button
                        type="button"
                        className={`master-pane__settings ${isSettings ? 'is-active' : ''}`}
                        onClick={onOpenSettings}
                    >
                        <GearIcon size={20} />
                        <span>{isSettings ? 'Done' : 'Settings'}</span>
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="split-column compose-anchor">
            {nav}
            {header}
            {list}
            {composeFab}
        </div>
    );
}
