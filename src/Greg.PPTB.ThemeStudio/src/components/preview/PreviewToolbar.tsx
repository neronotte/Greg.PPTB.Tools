import {
    Slider,
    Switch,
    Tab,
    TabList,
    Text,
    makeStyles,
    mergeClasses,
    tokens,
} from '@fluentui/react-components';

// Container-query breakpoints (panel width, narrowest first): the highlight
// toggle fades before the zoom control, purely via CSS - no ResizeObserver.
const HIDE_HIGHLIGHT_QUERY = '(max-width: 760px)';
const HIDE_ZOOM_QUERY = '(max-width: 560px)';

export type PreviewTab = 'view' | 'form';

export const MIN_ZOOM = 50;
export const MAX_ZOOM = 100;

const useStyles = makeStyles({
    toolbar: {
        display: 'flex',
        alignItems: 'center',
        gap: tokens.spacingHorizontalL,
        padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalL} 0`,
        borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
        textWrap: 'nowrap',
    },
    toolbarEnd: {
        display: 'flex',
        alignItems: 'center',
        gap: tokens.spacingHorizontalM,
        marginLeft: 'auto',
        paddingBottom: tokens.spacingVerticalXS,
        minWidth: 0,
        overflow: 'hidden',
    },
    fadeItem: {
        display: 'flex',
        alignItems: 'center',
        opacity: 1,
        transition:
            `opacity ${tokens.durationNormal} ${tokens.curveEasyEase}, ` +
            `width ${tokens.durationNormal} ${tokens.curveEasyEase}, ` +
            `margin ${tokens.durationNormal} ${tokens.curveEasyEase}`,
    },
    fadeHighlight: {
        [`@container previewPanel ${HIDE_HIGHLIGHT_QUERY}`]: {
            opacity: 0,
            width: 0,
            marginLeft: `calc(-1 * ${tokens.spacingHorizontalM})`,
            overflow: 'hidden',
            pointerEvents: 'none',
        },
    },
    fadeZoom: {
        [`@container previewPanel ${HIDE_ZOOM_QUERY}`]: {
            opacity: 0,
            width: 0,
            marginLeft: `calc(-1 * ${tokens.spacingHorizontalM})`,
            overflow: 'hidden',
            pointerEvents: 'none',
        },
    },
    zoom: {
        display: 'flex',
        alignItems: 'center',
        gap: tokens.spacingHorizontalXS,
        flexShrink: 0,
    },
    zoomSlider: {
        width: '100px',
        minWidth: '80px',
    },
    zoomValue: {
        minWidth: '36px',
        textAlign: 'right',
        color: tokens.colorNeutralForeground3,
    },
});

export interface PreviewToolbarProps {
    selectedTab: PreviewTab;
    onTabChange: (tab: PreviewTab) => void;
    highlight: boolean;
    onHighlightChange: (highlight: boolean) => void;
    zoom: number;
    onZoomChange: (zoom: number) => void;
}

/** The preview panel's footer: view/form tabs, the highlight toggle and the zoom slider. */
export function PreviewToolbar({
    selectedTab,
    onTabChange,
    highlight,
    onHighlightChange,
    zoom,
    onZoomChange,
}: PreviewToolbarProps) {
    const styles = useStyles();

    return (
        <div className={styles.toolbar}>
            <TabList
                selectedValue={selectedTab}
                onTabSelect={(_, data) => onTabChange(data.value as PreviewTab)}
            >
                <Tab value="view">View</Tab>
                <Tab value="form">Form</Tab>
            </TabList>
            <div className={styles.toolbarEnd}>
                <div
                    className={mergeClasses(
                        styles.fadeItem,
                        styles.fadeHighlight
                    )}
                >
                    <Switch
                        size="small"
                        checked={highlight}
                        onChange={(_, data) => onHighlightChange(data.checked)}
                        label="Highlight themed areas"
                        aria-label="Highlight the areas of the app the theme changes"
                    />
                </div>
                <div
                    className={mergeClasses(
                        styles.fadeItem,
                        styles.zoom,
                        styles.fadeZoom
                    )}
                >
                    <Text size={200}>Zoom</Text>
                    <Slider
                        className={styles.zoomSlider}
                        size="small"
                        min={MIN_ZOOM}
                        max={MAX_ZOOM}
                        step={10}
                        value={zoom}
                        aria-label="Preview zoom"
                        onChange={(_, data) => onZoomChange(data.value)}
                    />
                    <Text size={200} className={styles.zoomValue}>
                        {zoom}%
                    </Text>
                </div>
            </div>
        </div>
    );
}
