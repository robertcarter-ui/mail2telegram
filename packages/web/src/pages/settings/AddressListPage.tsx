import type { Address, AddressTestResponse, AddressType } from '@mail2telegram/shared';
import { List, ListInput, ListItem, Preloader } from 'konsta/react';
import { useState } from 'react';
import { api } from '../../api/client';
import { CheckIcon, PlusIcon } from '../../components/ios/Icons';
import { useAsync } from '../../hooks/useAsync';
import { haptic } from '../../lib/haptics';
import { BlockPolicySection } from './BlockPolicySection';
import { SettingsSubPage } from './SettingsSubPage';

export interface AddressListPageProps {
    type: AddressType;
}

const COPY: Record<AddressType, { title: string; section: string; hint: string }> = {
    white: {
        title: 'Always Deliver',
        section: 'White List',
        hint: 'Addresses that are never blocked. Exact addresses and regular expressions are supported.',
    },
    block: {
        title: 'Blocked Senders',
        section: 'Block List',
        hint: 'Addresses to block. White list entries take precedence over this list.',
    },
};

/** Full page for one address list: add, test and delete rules. */
export function AddressListPage({ type }: AddressListPageProps) {
    const copy = COPY[type];
    const [value, setValue] = useState('');
    const [note, setNote] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [testResult, setTestResult] = useState<AddressTestResponse | null>(null);

    const {
        data,
        loading,
        error: loadError,
        reload,
    } = useAsync<{ addresses: Address[] }>(() => api.listAddresses(type), [type]);
    const addresses = data?.addresses ?? [];

    const add = async () => {
        if (!value.trim()) {
            return;
        }
        setBusy(true);
        setError(null);
        try {
            await api.addAddress(value.trim(), type, note.trim() || undefined);
            setValue('');
            setNote('');
            setTestResult(null);
            haptic.notification('success');
            reload();
        } catch (e) {
            haptic.notification('error');
            setError((e as Error).message);
        } finally {
            setBusy(false);
        }
    };

    const remove = async (address: Address) => {
        setBusy(true);
        try {
            await api.removeAddress(address.id);
            haptic.impact();
            reload();
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setBusy(false);
        }
    };

    const test = async () => {
        if (!value.trim()) {
            return;
        }
        setBusy(true);
        setError(null);
        setTestResult(null);
        try {
            setTestResult(await api.testAddress(value.trim()));
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setBusy(false);
        }
    };

    return (
        <SettingsSubPage title={copy.title} error={loadError ?? null} onRetry={reload}>
            {type === 'block' ? <BlockPolicySection /> : null}
            <div className="settings-section-title">Add Entry</div>
            <List strongIos outlineIos className="!mt-0">
                <ListInput
                    label="Address or Regex"
                    placeholder="someone@example.com"
                    value={value}
                    onChange={(e: any) => setValue(e.target.value)}
                    clearButton
                />
                <ListInput
                    label="Note"
                    placeholder="Optional"
                    value={note}
                    onChange={(e: any) => setNote(e.target.value)}
                    clearButton
                />
                <ListItem
                    link
                    title={busy ? 'Adding…' : 'Add to List'}
                    media={<PlusIcon size={20} />}
                    onClick={add}
                    className={busy || !value.trim() ? 'opacity-40' : ''}
                />
                <ListItem
                    link
                    title="Test Address"
                    media={<CheckIcon size={20} />}
                    onClick={test}
                    className={busy || !value.trim() ? 'opacity-40' : ''}
                />
            </List>

            {testResult ? (
                <div className="settings-note">
                    {`Result: ${testResult.status === 'no_match' ? 'no match' : testResult.status}`}
                    {testResult.matchedWhite.length > 0 ? ` · white: ${testResult.matchedWhite.join(', ')}` : ''}
                    {testResult.matchedBlock.length > 0 ? ` · block: ${testResult.matchedBlock.join(', ')}` : ''}
                </div>
            ) : null}
            {error ? (
                <div className="settings-note" style={{ color: '#ff3b30' }}>
                    {error}
                </div>
            ) : null}
            <div className="settings-note">{copy.hint}</div>

            <div className="settings-section-title">{copy.section}</div>
            <List strongIos outlineIos className="!mt-0">
                {loading && addresses.length === 0 ? (
                    <ListItem
                        title={
                            <span className="flex justify-center py-2">
                                <Preloader />
                            </span>
                        }
                    />
                ) : addresses.length === 0 ? (
                    <ListItem title={<span className="text-[var(--ios-gray)]">No Entries</span>} />
                ) : (
                    addresses.map(address => (
                        <ListItem
                            key={address.id}
                            title={address.address}
                            subtitle={address.note || undefined}
                            after={
                                <button
                                    type="button"
                                    className="settings-remove"
                                    disabled={busy}
                                    onClick={() => remove(address)}
                                >
                                    Delete
                                </button>
                            }
                        />
                    ))
                )}
            </List>
        </SettingsSubPage>
    );
}
