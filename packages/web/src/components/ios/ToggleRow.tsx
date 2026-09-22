import type { MouseEvent } from 'react';
import { ListItem, Toggle } from 'konsta/react';
import { haptic } from '../../lib/haptics';

export interface ToggleRowProps {
    title: string;
    subtitle?: string;
    checked: boolean;
    onChange: (checked: boolean) => void;
}

/**
 * Settings row with a trailing toggle, behaving like iOS Settings: the whole
 * row flips the switch. Taps that land on the switch itself are ignored here so
 * the value only changes once per gesture.
 */
export function ToggleRow({ title, subtitle, checked, onChange }: ToggleRowProps) {
    const toggle = () => {
        haptic.selection();
        onChange(!checked);
    };
    return (
        <ListItem
            title={title}
            subtitle={subtitle}
            after={<Toggle checked={checked} onChange={() => toggle()} />}
            onClick={(e?: MouseEvent) => {
                if ((e?.target as HTMLElement | null)?.closest('.k-toggle')) {
                    return;
                }
                toggle();
            }}
        />
    );
}
