import type { RuntimeSettings } from '@mail2telegram/shared';
import { List } from 'konsta/react';
import { ToggleRow } from '../../components/ios/ToggleRow';
import { useSettingsDraft } from './useSettingsDraft';

const BLOCK_POLICIES: { key: RuntimeSettings['blockPolicy'][number]; label: string }[] = [
    { key: 'telegram', label: 'Do Not Notify' },
    { key: 'forward', label: 'Do Not Forward' },
    { key: 'reject', label: 'Reject Message' },
];

/** What happens when a message matches the block list. */
export function BlockPolicySection() {
    const { draft, update } = useSettingsDraft();

    const toggle = (policy: RuntimeSettings['blockPolicy'][number]) => {
        if (!draft) {
            return;
        }
        const has = draft.blockPolicy.includes(policy);
        update('blockPolicy', has ? draft.blockPolicy.filter(item => item !== policy) : [...draft.blockPolicy, policy]);
    };

    if (!draft) {
        return null;
    }

    return (
        <>
            <div className="settings-section-title">Blocked Mail Policy</div>
            <List strongIos outlineIos className="!mt-0">
                {BLOCK_POLICIES.map(policy => (
                    <ToggleRow
                        key={policy.key}
                        title={policy.label}
                        checked={draft.blockPolicy.includes(policy.key)}
                        onChange={() => toggle(policy.key)}
                    />
                ))}
            </List>
            <div className="settings-note">Choose what happens to blocked mail. Multiple actions can be combined.</div>
        </>
    );
}
