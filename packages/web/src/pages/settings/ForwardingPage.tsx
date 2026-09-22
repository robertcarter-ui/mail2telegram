import { List, ListInput, ListItem } from 'konsta/react';
import { useState } from 'react';
import { PlusIcon, TrashIcon } from '../../components/ios/Icons';
import { ToggleRow } from '../../components/ios/ToggleRow';
import { haptic } from '../../lib/haptics';
import { SettingsSubPage } from './SettingsSubPage';
import { useSettingsDraft } from './useSettingsDraft';

/** Forwarding toggle and destination addresses managed as a list. */
export function ForwardingPage() {
    const { draft, loading, error, reload, update } = useSettingsDraft();
    const [value, setValue] = useState('');
    const [note, setNote] = useState<string | null>(null);

    const forwardList = draft?.forwardList ?? [];

    const add = () => {
        const address = value.trim();
        if (!address || !draft) {
            return;
        }
        if (forwardList.some(item => item.toLowerCase() === address.toLowerCase())) {
            setNote('Address is already in the list.');
            return;
        }
        update('forwardList', [...forwardList, address]);
        setValue('');
        setNote(null);
        haptic.notification('success');
    };

    const remove = (index: number) => {
        update(
            'forwardList',
            forwardList.filter((_, i) => i !== index),
        );
        haptic.impact();
    };

    return (
        <SettingsSubPage title="Forwarding" loading={loading || !draft} error={error ?? null} onRetry={reload}>
            {draft ? (
                <>
                    <List strongIos outlineIos className="!mt-3">
                        <ToggleRow
                            title="Forward Mail"
                            checked={draft.forwardEnabled}
                            onChange={checked => update('forwardEnabled', checked)}
                        />
                    </List>
                    {draft.forwardEnabled ? (
                        <>
                            <div className="settings-section-title">Add Address</div>
                            <List strongIos outlineIos className="!mt-0">
                                <ListInput
                                    label="Destination Address"
                                    placeholder="backup@example.com"
                                    value={value}
                                    onChange={(e: any) => {
                                        setValue(e.target.value);
                                        setNote(null);
                                    }}
                                    onKeyDown={(e: any) => {
                                        if (e.key === 'Enter') {
                                            add();
                                        }
                                    }}
                                    clearButton
                                />
                                <ListItem
                                    link
                                    title="Add Address"
                                    media={<PlusIcon size={20} />}
                                    onClick={add}
                                    className={!value.trim() ? 'opacity-40' : ''}
                                />
                            </List>
                            {note ? <div className="settings-note">{note}</div> : null}
                            <div className="settings-section-title">Forward To</div>
                            <List strongIos outlineIos className="!mt-0">
                                {forwardList.length === 0 ? (
                                    <ListItem title={<span className="text-[var(--ios-gray)]">No Addresses</span>} />
                                ) : (
                                    forwardList.map((address, index) => (
                                        <ListItem
                                            key={address}
                                            title={address}
                                            after={
                                                <button
                                                    type="button"
                                                    className="settings-remove"
                                                    aria-label="Delete address"
                                                    onClick={() => remove(index)}
                                                >
                                                    <TrashIcon size={18} />
                                                </button>
                                            }
                                        />
                                    ))
                                )}
                            </List>
                        </>
                    ) : null}
                    <div className="settings-note">
                        Each address must be verified under Email Routing destination addresses.
                    </div>
                </>
            ) : null}
        </SettingsSubPage>
    );
}
