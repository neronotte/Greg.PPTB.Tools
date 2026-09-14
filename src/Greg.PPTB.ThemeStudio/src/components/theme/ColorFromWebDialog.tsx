import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Button,
    Dialog,
    DialogActions,
    DialogBody,
    DialogContent,
    DialogSurface,
    DialogTitle,
    Field,
    Input,
    Label,
    MessageBar,
    MessageBarBody,
    MessageBarTitle,
    Spinner,
    Switch,
    Text,
    Tooltip,
    makeStyles,
    mergeClasses,
    tokens,
} from '@fluentui/react-components';
import { EyedropperRegular, OpenRegular } from '@fluentui/react-icons';
import { useThemeModel } from '../../state/ThemeContext';
import { usePortalMount } from '../../state/PortalMountContext';
import { usePersistedSetting } from '../../hooks/useToolboxAPI';
import {
    extractPalette,
    headerBandCrop,
    pixelAt,
    type ColorCandidate,
    type CropRect,
    type ExtractionOptions,
} from '../../model/colorExtraction';
import {
    checkContrast,
    pickForeground,
    proposeTheme,
} from '../../model/colorRoles';
import { WCAG_AA_MINIMUM_CONTRAST } from '../../model/contrast';
import {
    findImageInDataTransfer,
    importImageFromBlob,
    importImageFromClipboard,
    importImageFromFile,
    type LoadedImage,
} from '../../services/imageImport';
import {
    captureSite,
    ASSISTED_CAPTURE_INSTRUCTIONS,
} from '../../services/siteCapture';
import { ColorField } from './ColorField';

const useStyles = makeStyles({
    body: {
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.spacingVerticalM,
        minHeight: '320px',
    },
    row: {
        display: 'flex',
        alignItems: 'center',
        gap: tokens.spacingHorizontalS,
        flexWrap: 'wrap',
    },
    hint: {
        color: tokens.colorNeutralForeground3,
    },
    dropZone: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: tokens.spacingVerticalS,
        padding: tokens.spacingVerticalXXL,
        border: `2px dashed ${tokens.colorNeutralStroke2}`,
        borderRadius: tokens.borderRadiusMedium,
        backgroundColor: tokens.colorNeutralBackground2,
        textAlign: 'center',
    },
    dropZoneActive: {
        border: `2px dashed ${tokens.colorBrandStroke1}`,
        backgroundColor: tokens.colorNeutralBackground1Selected,
    },
    imageArea: {
        position: 'relative',
        display: 'inline-block',
        maxWidth: '100%',
        lineHeight: 0,
        userSelect: 'none',
    },
    image: {
        maxWidth: '100%',
        maxHeight: '320px',
        display: 'block',
        cursor: 'crosshair',
    },
    cropBox: {
        position: 'absolute',
        border: `2px solid ${tokens.colorBrandStroke1}`,
        backgroundColor: 'rgba(15, 108, 189, 0.15)',
        pointerEvents: 'none',
    },
    swatches: {
        display: 'flex',
        flexWrap: 'wrap',
        gap: tokens.spacingHorizontalS,
    },
    swatch: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: tokens.spacingVerticalXXS,
        padding: tokens.spacingVerticalXS,
        border: `1px solid ${tokens.colorNeutralStroke1}`,
        borderRadius: tokens.borderRadiusMedium,
        backgroundColor: 'transparent',
        cursor: 'grab',
        minWidth: '72px',
    },
    roleDropTarget: {
        padding: tokens.spacingVerticalS,
        border: `2px dashed ${tokens.colorNeutralStroke2}`,
        borderRadius: tokens.borderRadiusMedium,
        backgroundColor: tokens.colorNeutralBackground2,
    },
    roleDropTargetActive: {
        border: `2px dashed ${tokens.colorBrandStroke1}`,
        backgroundColor: tokens.colorNeutralBackground1Selected,
    },
    swatchChip: {
        width: '48px',
        height: '32px',
        borderRadius: tokens.borderRadiusSmall,
        border: `1px solid ${tokens.colorNeutralStroke2}`,
    },
    swatchLabel: {
        color: tokens.colorNeutralForeground1,
    },
    headerPreview: {
        display: 'flex',
        alignItems: 'center',
        gap: tokens.spacingHorizontalM,
        height: '48px',
        padding: `0 ${tokens.spacingHorizontalM}`,
        borderRadius: tokens.borderRadiusMedium,
    },
    fail: {
        color: tokens.colorPaletteRedForeground1,
    },
    pass: {
        color: tokens.colorPaletteGreenForeground1,
    },
});

type WizardStep = 'source' | 'image' | 'roles';
type HeaderDropTarget = 'background' | 'foreground';

const DRAGGED_COLOR_TYPE = 'application/x-theme-studio-color';

export interface ColorFromWebDialogProps {
    open: boolean;
    onDismiss: () => void;
}

interface StoredOptions {
    ignoreGreys: boolean;
    overrideSlots: boolean;
}

const EXTRACTION_MAX_COLORS = 5;

const DEFAULT_STORED_OPTIONS: StoredOptions = {
    ignoreGreys: true,
    overrideSlots: false,
};

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/**
 * The "get colours from a website" wizard (docs/IMPLEMENTATION_PLAN.md §2.14,
 * Phase 6.5): source → image (crop / eyedropper) → colours and roles.
 *
 * Everything stays local: the screenshot is working data that is never stored
 * in `toolboxAPI.settings` nor uploaded anywhere, and a URL is resolved through
 * the assisted-capture flow because PPTB exposes no screenshot API. Applying
 * dispatches a single `applyExtractedColors` action, so undo reverts the whole
 * extraction in one step.
 */
export function ColorFromWebDialog({
    open,
    onDismiss,
}: ColorFromWebDialogProps) {
    const styles = useStyles();
    const mountNode = usePortalMount();
    const { model, dispatch } = useThemeModel();

    const [options, setOptions] = usePersistedSetting<StoredOptions>(
        'colorExtraction.options',
        DEFAULT_STORED_OPTIONS
    );
    const [step, setStep] = useState<WizardStep>('source');
    const [url, setUrl] = useState('');
    const [captureHint, setCaptureHint] = useState<string | undefined>();
    const [image, setImage] = useState<LoadedImage | undefined>();
    const [crop, setCrop] = useState<CropRect | undefined>();
    const [dragging, setDragging] = useState(false);
    const [dragOver, setDragOver] = useState(false);
    const [headerDropTarget, setHeaderDropTarget] = useState<
        HeaderDropTarget | undefined
    >();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | undefined>();

    const [seed, setSeed] = useState<string | undefined>();
    const [headerBackground, setHeaderBackground] = useState<
        string | undefined
    >();
    const [headerForeground, setHeaderForeground] = useState<
        string | undefined
    >();

    const imageRef = useRef<HTMLImageElement | null>(null);
    const dragStart = useRef<{ x: number; y: number } | undefined>(undefined);

    const reset = useCallback(() => {
        setStep('source');
        setUrl('');
        setCaptureHint(undefined);
        setImage(undefined);
        setCrop(undefined);
        setError(undefined);
        setSeed(undefined);
        setHeaderBackground(undefined);
        setHeaderForeground(undefined);
        setHeaderDropTarget(undefined);
    }, []);

    useEffect(() => {
        if (!open) {
            reset();
        }
    }, [open, reset]);

    const extractionOptions = useMemo<ExtractionOptions>(
        () => ({
            ignoreGreys: options.ignoreGreys,
            maxColors: EXTRACTION_MAX_COLORS,
        }),
        [options.ignoreGreys]
    );

    const candidates = useMemo<ColorCandidate[]>(() => {
        if (!image) {
            return [];
        }
        return extractPalette(image.imageData, { ...extractionOptions, crop })
            .candidates;
    }, [image, extractionOptions, crop]);

    const headerCandidates = useMemo<ColorCandidate[]>(() => {
        if (!image) {
            return [];
        }
        // The header background always comes from the top band, whatever the
        // user cropped for the palette itself.
        return extractPalette(image.imageData, {
            ...extractionOptions,
            maxColors: 3,
            crop: crop ?? headerBandCrop(image.imageData),
        }).candidates;
    }, [image, extractionOptions, crop]);

    const proposal = useMemo(
        () =>
            proposeTheme(candidates, headerCandidates, model, {
                overrideSlots: options.overrideSlots,
            }),
        [candidates, headerCandidates, model, options.overrideSlots]
    );

    const loadImage = useCallback(
        async (loader: () => Promise<LoadedImage | undefined>) => {
            setBusy(true);
            setError(undefined);
            try {
                const loaded = await loader();
                if (loaded) {
                    setImage(loaded);
                    setCrop(undefined);
                    setSeed(undefined);
                    setHeaderBackground(undefined);
                    setHeaderForeground(undefined);
                    setStep('image');
                }
            } catch (loadError) {
                setError(errorMessage(loadError));
            } finally {
                setBusy(false);
            }
        },
        []
    );

    // Ctrl+V anywhere in the dialog imports the screenshot, which is the last
    // step of the assisted capture flow.
    useEffect(() => {
        if (!open || step === 'roles') {
            return;
        }
        const handlePaste = (event: ClipboardEvent) => {
            const file = findImageInDataTransfer(event.clipboardData);
            if (file) {
                event.preventDefault();
                void loadImage(() => importImageFromBlob(file, file.name));
            }
        };
        window.addEventListener('paste', handlePaste);
        return () => window.removeEventListener('paste', handlePaste);
    }, [open, step, loadImage]);

    const handleOpenSite = async () => {
        setBusy(true);
        setError(undefined);
        try {
            const result = await captureSite(url);
            setCaptureHint(`${result.url} — ${result.instructions}`);
        } catch (captureError) {
            setError(errorMessage(captureError));
        } finally {
            setBusy(false);
        }
    };

    /** Maps a pointer position on the rendered image back to source pixels. */
    const toImagePoint = (event: { clientX: number; clientY: number }) => {
        const element = imageRef.current;
        if (!element || !image) {
            return undefined;
        }
        const rect = element.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) {
            return undefined;
        }
        const x = Math.round(
            ((event.clientX - rect.left) / rect.width) * image.width
        );
        const y = Math.round(
            ((event.clientY - rect.top) / rect.height) * image.height
        );
        return {
            x: Math.min(Math.max(x, 0), image.width - 1),
            y: Math.min(Math.max(y, 0), image.height - 1),
        };
    };

    const handlePointerDown = (event: React.PointerEvent<HTMLImageElement>) => {
        const point = toImagePoint(event);
        if (!point) {
            return;
        }
        dragStart.current = point;
        setDragging(true);
        event.currentTarget.setPointerCapture(event.pointerId);
    };

    const handlePointerMove = (event: React.PointerEvent<HTMLImageElement>) => {
        if (!dragging || !dragStart.current) {
            return;
        }
        const point = toImagePoint(event);
        if (!point) {
            return;
        }
        setCrop(rectBetween(dragStart.current, point));
    };

    const handlePointerUp = (event: React.PointerEvent<HTMLImageElement>) => {
        if (!dragStart.current) {
            return;
        }
        const point = toImagePoint(event);
        setDragging(false);
        const start = dragStart.current;
        dragStart.current = undefined;

        if (!point) {
            return;
        }
        const rect = rectBetween(start, point);
        if (rect.width < 4 || rect.height < 4) {
            // Too small to be a crop — treat it as the eyedropper.
            setCrop(undefined);
            const picked = image
                ? pixelAt(image.imageData, point.x, point.y)
                : undefined;
            if (picked) {
                setSeed(picked);
            }
            return;
        }
        setCrop(rect);
    };

    const effectiveSeed = seed ?? proposal.basePaletteColor;
    const effectiveBackground = headerBackground ?? proposal.headerBackground;
    const effectiveForeground =
        headerForeground ??
        (effectiveBackground
            ? pickForeground(effectiveBackground, candidates)
            : undefined);
    const contrast = checkContrast(effectiveForeground, effectiveBackground);
    const canApply = Boolean(effectiveSeed || effectiveBackground);

    const handleApply = () => {
        dispatch({
            type: 'applyExtractedColors',
            patch: {
                basePaletteColor: effectiveSeed,
                appHeaderBackground: effectiveBackground,
                appHeaderForeground: effectiveBackground
                    ? effectiveForeground
                    : undefined,
                paletteOverrides: options.overrideSlots
                    ? proposal.paletteOverrides
                    : undefined,
            },
        });
        onDismiss();
    };

    const handleHeaderColorDrop = (
        event: React.DragEvent<HTMLDivElement>,
        target: HeaderDropTarget
    ) => {
        event.preventDefault();
        const color =
            event.dataTransfer.getData(DRAGGED_COLOR_TYPE) ||
            event.dataTransfer.getData('text/plain');
        setHeaderDropTarget(undefined);

        if (!/^#[0-9A-F]{6}$/i.test(color)) {
            return;
        }
        if (target === 'background') {
            setHeaderBackground(color.toUpperCase());
        } else {
            setHeaderForeground(color.toUpperCase());
        }
    };

    return (
        <Dialog
            open={open}
            onOpenChange={(_, data) => (data.open ? undefined : onDismiss())}
        >
            <DialogSurface mountNode={mountNode}>
                <DialogBody>
                    <DialogTitle>Get colors from a website</DialogTitle>
                    <DialogContent className={styles.body}>
                        {error && (
                            <MessageBar intent="error">
                                <MessageBarBody>{error}</MessageBarBody>
                            </MessageBar>
                        )}
                        {busy && <Spinner size="tiny" label="Working…" />}

                        {step === 'source' && (
                            <>
                                <MessageBar intent="info">
                                    <MessageBarBody>
                                        <MessageBarTitle>
                                            Screenshots stay on this machine
                                        </MessageBarTitle>
                                        Power Platform ToolBox can't take a
                                        screenshot for you, so the site is
                                        opened in your browser and you paste the
                                        screenshot back here. Nothing is
                                        uploaded anywhere.
                                    </MessageBarBody>
                                </MessageBar>

                                <Field
                                    label="Website address"
                                    hint="Only http:// and https:// addresses can be opened."
                                >
                                    <div className={styles.row}>
                                        <Input
                                            style={{ flex: 1 }}
                                            value={url}
                                            placeholder="contoso.com"
                                            onChange={(_, data) =>
                                                setUrl(data.value)
                                            }
                                            onKeyDown={(event) => {
                                                if (
                                                    event.key === 'Enter' &&
                                                    url.trim()
                                                ) {
                                                    void handleOpenSite();
                                                }
                                            }}
                                        />
                                        <Button
                                            appearance="secondary"
                                            icon={<OpenRegular />}
                                            disabled={busy || !url.trim()}
                                            onClick={handleOpenSite}
                                        >
                                            Open the site
                                        </Button>
                                    </div>
                                </Field>

                                {captureHint && (
                                    <MessageBar intent="success">
                                        <MessageBarBody>
                                            {captureHint}
                                        </MessageBarBody>
                                    </MessageBar>
                                )}

                                <div
                                    className={mergeClasses(
                                        styles.dropZone,
                                        dragOver && styles.dropZoneActive
                                    )}
                                    onDragOver={(event) => {
                                        event.preventDefault();
                                        setDragOver(true);
                                    }}
                                    onDragLeave={() => setDragOver(false)}
                                    onDrop={(event) => {
                                        event.preventDefault();
                                        setDragOver(false);
                                        const file = findImageInDataTransfer(
                                            event.dataTransfer
                                        );
                                        if (file) {
                                            void loadImage(() =>
                                                importImageFromBlob(
                                                    file,
                                                    file.name
                                                )
                                            );
                                        } else {
                                            setError(
                                                'That item is not a supported image. Use a PNG, JPG, GIF, WEBP or BMP screenshot.'
                                            );
                                        }
                                    }}
                                >
                                    <Text weight="semibold">
                                        Drop a screenshot here
                                    </Text>
                                    <Text size={200} className={styles.hint}>
                                        {ASSISTED_CAPTURE_INSTRUCTIONS}
                                    </Text>
                                    <div className={styles.row}>
                                        <Button
                                            appearance="primary"
                                            disabled={busy}
                                            onClick={() =>
                                                void loadImage(
                                                    importImageFromFile
                                                )
                                            }
                                        >
                                            Browse for an image
                                        </Button>
                                        <Button
                                            appearance="secondary"
                                            disabled={busy}
                                            onClick={() =>
                                                void loadImage(
                                                    importImageFromClipboard
                                                )
                                            }
                                        >
                                            Paste from clipboard
                                        </Button>
                                    </div>
                                </div>
                            </>
                        )}

                        {step === 'image' && image && (
                            <>
                                <Text size={200} className={styles.hint}>
                                    Drag on the image to analyse only that
                                    region, or click a pixel to use its exact
                                    colour as the base palette color.
                                </Text>
                                <div className={styles.imageArea}>
                                    <img
                                        ref={imageRef}
                                        className={styles.image}
                                        src={image.dataUri}
                                        alt="Imported screenshot"
                                        draggable={false}
                                        onPointerDown={handlePointerDown}
                                        onPointerMove={handlePointerMove}
                                        onPointerUp={handlePointerUp}
                                    />
                                    {crop && (
                                        <div
                                            className={styles.cropBox}
                                            style={{
                                                left: `${(crop.x / image.width) * 100}%`,
                                                top: `${(crop.y / image.height) * 100}%`,
                                                width: `${(crop.width / image.width) * 100}%`,
                                                height: `${(crop.height / image.height) * 100}%`,
                                            }}
                                        />
                                    )}
                                </div>

                                <div className={styles.row}>
                                    <Button
                                        size="small"
                                        appearance="secondary"
                                        onClick={() =>
                                            setCrop(
                                                headerBandCrop(image.imageData)
                                            )
                                        }
                                    >
                                        Header only
                                    </Button>
                                    <Button
                                        size="small"
                                        appearance="subtle"
                                        disabled={!crop}
                                        onClick={() => setCrop(undefined)}
                                    >
                                        Whole image
                                    </Button>
                                    <Switch
                                        label="Ignore greys"
                                        checked={options.ignoreGreys}
                                        onChange={(_, data) =>
                                            setOptions({
                                                ...options,
                                                ignoreGreys: data.checked,
                                            })
                                        }
                                    />
                                </div>

                                {seed && (
                                    <Text size={200}>
                                        <EyedropperRegular /> Picked {seed}
                                    </Text>
                                )}

                                {candidates.length === 0 && (
                                    <MessageBar intent="warning">
                                        <MessageBarBody>
                                            No colour stands out in this area —
                                            it is all white, black or grey. Try
                                            another region, or turn "Ignore
                                            greys" off.
                                        </MessageBarBody>
                                    </MessageBar>
                                )}
                            </>
                        )}

                        {step === 'roles' && (
                            <>
                                <MessageBar intent="info">
                                    <MessageBarBody>
                                        <MessageBarTitle>
                                            Assign the extracted colors
                                        </MessageBarTitle>
                                        Click a color to use it as the base
                                        palette color, or drag it onto the app
                                        header background or foreground field.
                                    </MessageBarBody>
                                </MessageBar>
                                <Label size="small">Extracted colors</Label>
                                <div className={styles.swatches}>
                                    {candidates.map((candidate) => (
                                        <Tooltip
                                            key={candidate.hex}
                                            relationship="label"
                                            mountNode={mountNode}
                                            content={`${candidate.hex} — ${Math.round(candidate.coverage * 100)}% of the analysed pixels`}
                                        >
                                            <button
                                                type="button"
                                                className={styles.swatch}
                                                draggable
                                                onClick={() =>
                                                    setSeed(candidate.hex)
                                                }
                                                onDragStart={(event) => {
                                                    event.dataTransfer.effectAllowed =
                                                        'copy';
                                                    event.dataTransfer.setData(
                                                        DRAGGED_COLOR_TYPE,
                                                        candidate.hex
                                                    );
                                                    event.dataTransfer.setData(
                                                        'text/plain',
                                                        candidate.hex
                                                    );
                                                }}
                                                onDragEnd={() =>
                                                    setHeaderDropTarget(
                                                        undefined
                                                    )
                                                }
                                            >
                                                <span
                                                    className={
                                                        styles.swatchChip
                                                    }
                                                    style={{
                                                        backgroundColor:
                                                            candidate.hex,
                                                    }}
                                                />
                                                <Text
                                                    size={100}
                                                    className={
                                                        styles.swatchLabel
                                                    }
                                                >
                                                    {Math.round(
                                                        candidate.coverage * 100
                                                    )}
                                                    %
                                                </Text>
                                            </button>
                                        </Tooltip>
                                    ))}
                                    {candidates.length === 0 && (
                                        <Text
                                            size={200}
                                            className={styles.hint}
                                        >
                                            Nothing was extracted from this
                                            image.
                                        </Text>
                                    )}
                                </div>

                                <ColorField
                                    label="Base palette color"
                                    value={effectiveSeed}
                                    hint="Seed of the 16-slot palette. Not used by an app-header-colors-only document."
                                    onChange={(value) => setSeed(value)}
                                />
                                <div
                                    className={mergeClasses(
                                        styles.roleDropTarget,
                                        headerDropTarget === 'background' &&
                                            styles.roleDropTargetActive
                                    )}
                                    onDragEnter={(event) => {
                                        event.preventDefault();
                                        setHeaderDropTarget('background');
                                    }}
                                    onDragOver={(event) => {
                                        event.preventDefault();
                                        event.dataTransfer.dropEffect = 'copy';
                                    }}
                                    onDragLeave={() =>
                                        setHeaderDropTarget(undefined)
                                    }
                                    onDrop={(event) =>
                                        handleHeaderColorDrop(
                                            event,
                                            'background'
                                        )
                                    }
                                >
                                    <ColorField
                                        label="App header background"
                                        value={effectiveBackground}
                                        onChange={(value) =>
                                            setHeaderBackground(value)
                                        }
                                    />
                                </div>
                                <div
                                    className={mergeClasses(
                                        styles.roleDropTarget,
                                        headerDropTarget === 'foreground' &&
                                            styles.roleDropTargetActive
                                    )}
                                    onDragEnter={(event) => {
                                        event.preventDefault();
                                        setHeaderDropTarget('foreground');
                                    }}
                                    onDragOver={(event) => {
                                        event.preventDefault();
                                        event.dataTransfer.dropEffect = 'copy';
                                    }}
                                    onDragLeave={() =>
                                        setHeaderDropTarget(undefined)
                                    }
                                    onDrop={(event) =>
                                        handleHeaderColorDrop(
                                            event,
                                            'foreground'
                                        )
                                    }
                                >
                                    <ColorField
                                        label="App header foreground"
                                        value={effectiveForeground}
                                        contrastAgainst={effectiveBackground}
                                        onChange={(value) =>
                                            setHeaderForeground(value)
                                        }
                                    />
                                </div>

                                {effectiveBackground && effectiveForeground && (
                                    <>
                                        <Label size="small">Preview</Label>
                                        <div
                                            className={styles.headerPreview}
                                            style={{
                                                backgroundColor:
                                                    effectiveBackground,
                                                color: effectiveForeground,
                                            }}
                                        >
                                            <Text
                                                style={{ color: 'inherit' }}
                                                weight="semibold"
                                            >
                                                Sample app
                                            </Text>
                                            <Text
                                                style={{ color: 'inherit' }}
                                                size={200}
                                            >
                                                Accounts
                                            </Text>
                                        </div>
                                        {contrast && (
                                            <Text
                                                size={200}
                                                className={
                                                    contrast.passes
                                                        ? styles.pass
                                                        : styles.fail
                                                }
                                            >
                                                Header contrast{' '}
                                                {contrast.ratio.toFixed(2)}:1{' '}
                                                {contrast.passes
                                                    ? 'meets'
                                                    : 'is below'}{' '}
                                                the recommended{' '}
                                                {WCAG_AA_MINIMUM_CONTRAST}:1
                                                minimum
                                            </Text>
                                        )}
                                    </>
                                )}

                                <Switch
                                    label="Also override the closest palette slots"
                                    checked={options.overrideSlots}
                                    disabled={model.kind !== 'customTheme'}
                                    onChange={(_, data) =>
                                        setOptions({
                                            ...options,
                                            overrideSlots: data.checked,
                                        })
                                    }
                                />
                                <Text size={100} className={styles.hint}>
                                    Off by default: the generated ramp is the
                                    documented mechanism, and forcing screenshot
                                    colours into the 16 slots produces
                                    incoherent ramps.
                                </Text>
                            </>
                        )}
                    </DialogContent>
                    <DialogActions>
                        {step !== 'source' && (
                            <Button
                                appearance="secondary"
                                onClick={() =>
                                    setStep(
                                        step === 'roles' ? 'image' : 'source'
                                    )
                                }
                            >
                                Back
                            </Button>
                        )}
                        <Button appearance="secondary" onClick={onDismiss}>
                            Cancel
                        </Button>
                        {step === 'image' && (
                            <Button
                                appearance="primary"
                                disabled={candidates.length === 0 && !seed}
                                onClick={() => setStep('roles')}
                            >
                                Next
                            </Button>
                        )}
                        {step === 'roles' && (
                            <Button
                                appearance="primary"
                                disabled={!canApply}
                                onClick={handleApply}
                            >
                                Apply
                            </Button>
                        )}
                    </DialogActions>
                </DialogBody>
            </DialogSurface>
        </Dialog>
    );
}

function rectBetween(
    a: { x: number; y: number },
    b: { x: number; y: number }
): CropRect {
    return {
        x: Math.min(a.x, b.x),
        y: Math.min(a.y, b.y),
        width: Math.abs(a.x - b.x),
        height: Math.abs(a.y - b.y),
    };
}
