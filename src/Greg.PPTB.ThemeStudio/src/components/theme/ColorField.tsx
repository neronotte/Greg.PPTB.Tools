import { useEffect, useMemo, useState } from 'react';
import {
    Button,
    ColorPicker,
    ColorArea,
    ColorSlider,
    Popover,
    PopoverSurface,
    PopoverTrigger,
    Input,
    Label,
    Text,
    Tooltip,
    makeStyles,
    tokens,
} from '@fluentui/react-components';
import { ArrowResetRegular } from '@fluentui/react-icons';
import { usePortalMount } from '../../state/PortalMountContext';
import {
    hexToHsv,
    hsvToHex,
    isValidHex,
    normalizeHex,
} from '../../model/brandRamp';
import { contrastRatio, WCAG_AA_MINIMUM_CONTRAST } from '../../model/contrast';

const useStyles = makeStyles({
    root: {
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.spacingVerticalXXS,
    },
    row: {
        display: 'flex',
        alignItems: 'center',
        gap: tokens.spacingHorizontalXS,
    },
    swatch: {
        width: '32px',
        minWidth: '32px',
        height: '32px',
        padding: 0,
        border: `1px solid ${tokens.colorNeutralStroke1}`,
        borderRadius: tokens.borderRadiusMedium,
        cursor: 'pointer',
    },
    input: {
        flex: 1,
        minWidth: 0,
    },
    picker: {
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.spacingVerticalS,
    },
    hint: {
        color: tokens.colorNeutralForeground3,
    },
    fail: {
        color: tokens.colorPaletteRedForeground1,
    },
    pass: {
        color: tokens.colorPaletteGreenForeground1,
    },
});

export interface ColorFieldProps {
    label: string;
    /** Current value, or `undefined` when the attribute is not set. */
    value: string | undefined;
    /** Called with a normalised `#RRGGBB` value, or `undefined` when cleared. */
    onChange: (value: string | undefined) => void;
    /** Colour shown when `value` is unset — what the platform would compute/generate. */
    placeholder?: string;
    /** Shows a reset button that clears the value back to unset. */
    onReset?: () => void;
    /** When set, the field shows the live WCAG contrast ratio against this colour. */
    contrastAgainst?: string;
    /** Extra explanation shown below the field. */
    hint?: string;
    disabled?: boolean;
}

/**
 * A single colour input: a Fluent v9 `ColorPicker` behind a swatch button plus
 * a free-text HTML colour value with inline validation (requirement §42,
 * docs/IMPLEMENTATION_PLAN.md §4.3), optionally with a live contrast readout
 * for the documented `AppHeaderColors` pairings (§2.11).
 */
export function ColorField({
    label,
    value,
    onChange,
    placeholder,
    onReset,
    contrastAgainst,
    hint,
    disabled,
}: ColorFieldProps) {
    const styles = useStyles();
    const mountNode = usePortalMount();
    const [text, setText] = useState(value ?? '');
    const [open, setOpen] = useState(false);

    useEffect(() => {
        setText(value ?? '');
    }, [value]);

    const invalid = text.trim() !== '' && !isValidHex(text);
    const effective = value ?? placeholder;

    const hsv = useMemo(() => {
        try {
            return hexToHsv(effective ?? '#FFFFFF');
        } catch {
            return hexToHsv('#FFFFFF');
        }
    }, [effective]);

    const contrast = useMemo(() => {
        if (!contrastAgainst || !effective) {
            return undefined;
        }
        try {
            return contrastRatio(effective, contrastAgainst);
        } catch {
            return undefined;
        }
    }, [contrastAgainst, effective]);

    const commitText = (raw: string) => {
        const trimmed = raw.trim();
        if (trimmed === '') {
            onChange(undefined);
            return;
        }
        if (isValidHex(trimmed)) {
            onChange(normalizeHex(trimmed));
        }
    };

    return (
        <div className={styles.root}>
            <Label size="small">{label}</Label>
            <div className={styles.row}>
                <Popover
                    open={open}
                    onOpenChange={(_, data) => setOpen(data.open)}
                    trapFocus
                    mountNode={mountNode}
                >
                    <PopoverTrigger disableButtonEnhancement>
                        <button
                            type="button"
                            aria-label={`Pick a colour for ${label}`}
                            className={styles.swatch}
                            disabled={disabled}
                            style={{
                                backgroundColor: effective ?? 'transparent',
                            }}
                        />
                    </PopoverTrigger>
                    <PopoverSurface>
                        <div className={styles.picker}>
                            <ColorPicker
                                color={hsv}
                                onColorChange={(_, data) =>
                                    onChange(hsvToHex(data.color))
                                }
                            >
                                <ColorArea
                                    inputX={{ 'aria-label': 'Saturation' }}
                                    inputY={{ 'aria-label': 'Brightness' }}
                                />
                                <ColorSlider aria-label="Hue" />
                            </ColorPicker>
                            <Button
                                appearance="secondary"
                                onClick={() => setOpen(false)}
                            >
                                Close
                            </Button>
                        </div>
                    </PopoverSurface>
                </Popover>
                <Input
                    className={styles.input}
                    size="small"
                    value={text}
                    disabled={disabled}
                    placeholder={placeholder ?? '#RRGGBB'}
                    aria-label={`${label} HTML colour value`}
                    onChange={(_, data) => setText(data.value)}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                            event.currentTarget.blur();
                        }
                    }}
                    onBlur={() => {
                        if (invalid) {
                            setText(value ?? '');
                        } else {
                            commitText(text);
                        }
                    }}
                />
                {onReset && (
                    <Tooltip
                        content={`Reset ${label}`}
                        relationship="label"
                        mountNode={mountNode}
                    >
                        <Button
                            appearance="subtle"
                            size="small"
                            icon={<ArrowResetRegular />}
                            disabled={disabled || value === undefined}
                            onClick={onReset}
                        />
                    </Tooltip>
                )}
            </div>
            {invalid && (
                <Text size={100} className={styles.fail}>
                    Enter a valid HTML colour, e.g. #0F6CBD.
                </Text>
            )}
            {contrast !== undefined && (
                <Text
                    size={100}
                    className={
                        contrast >= WCAG_AA_MINIMUM_CONTRAST
                            ? styles.pass
                            : styles.fail
                    }
                >
                    Contrast {contrast.toFixed(2)}:1{' '}
                    {contrast >= WCAG_AA_MINIMUM_CONTRAST
                        ? 'meets'
                        : 'is below'}{' '}
                    the recommended {WCAG_AA_MINIMUM_CONTRAST}:1 minimum
                </Text>
            )}
            {hint && (
                <Text size={100} className={styles.hint}>
                    {hint}
                </Text>
            )}
        </div>
    );
}
