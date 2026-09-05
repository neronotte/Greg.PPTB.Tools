import { useRef, useState } from 'react';
import {
    FluentProvider,
    IdPrefixProvider,
    makeStyles,
    mergeClasses,
    tokens,
} from '@fluentui/react-components';
import { useThemeModel } from '../../state/ThemeContext';
import { useConfig } from '../../state/ConfigContext';
import { PortalMountProvider } from '../../state/PortalMountContext';
import { usePersistedSetting } from '../../hooks/useToolboxAPI';
import { AppHeader } from './shell/AppHeader';
import { NavBar } from './shell/NavBar';
import { GridPreview } from './GridPreview';
import { FormPreview } from './FormPreview';
import {
    MAX_ZOOM,
    PreviewToolbar,
    type PreviewTab,
} from './PreviewToolbar';

const useStyles = makeStyles({
    root: {
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        containerType: 'inline-size',
        containerName: 'previewPanel',
    },
    scroll: {
        flex: 1,
        minHeight: 0,
        overflow: 'auto',
        backgroundColor: tokens.colorNeutralBackground3,
        padding: tokens.spacingHorizontalM,
    },
    scaler: {
        transformOrigin: 'top left',
    },
    app: {
        display: 'flex',
        flexDirection: 'column',
        // Keep the mock at a realistic app width whatever the tool panel width is.
        minWidth: '1100px',
        minHeight: '760px',
        border: `1px solid ${tokens.colorNeutralStroke2}`,
        borderRadius: tokens.borderRadiusMedium,
        overflow: 'hidden',
    },
    body: {
        display: 'flex',
        flex: 1,
        minHeight: 0,
    },
    canvas: {
        display: 'flex',
        flex: 1,
        minWidth: 0,
        backgroundColor: tokens.colorNeutralBackground3,
    },
    highlight: {
        '& [data-themed]': {
            outline: `2px dashed ${tokens.colorPaletteRedBorder2}`,
            outlineOffset: '-2px',
        },
    },
    // Popups opened inside the mock mount here instead of on `document.body`.
    // It sits outside the zoom transform so it is neither scaled nor clipped.
    portalHost: {
        position: 'fixed',
        top: 0,
        left: 0,
        width: 0,
        height: 0,
        zIndex: 1000000,
    },
});

/**
 * Main panel: a non-functional replica of the modern (Wave 1) model-driven app
 * shell, with a **view** tab (sample grid) and a **form** tab (sample form).
 *
 * The user-authored theme is applied by nesting a `FluentProvider` — the
 * pattern Microsoft documents for rendering a subtree with a token set that
 * differs from the surrounding app — so the tool's own chrome keeps following
 * the PPTB host theme (docs/IMPLEMENTATION_PLAN.md §2.10).
 */
export function PreviewFrame() {
    const styles = useStyles();
    const { previewTheme, model } = useThemeModel();
    const { logoDataUri } = useConfig();
    const [selectedTab, setSelectedTab] = usePersistedSetting<PreviewTab>(
        'ui.previewTab',
        'view'
    );
    const [zoom, setZoom] = usePersistedSetting('ui.previewZoom', MAX_ZOOM);
    const [highlight, setHighlight] = useState(false);
    const portalMountRef = useRef<HTMLDivElement | null>(null);

    return (
        <div className={styles.root}>
            <IdPrefixProvider value="preview-">
                <FluentProvider
                    theme={previewTheme.fluentTheme}
                    className={styles.portalHost}
                    style={{ fontFamily: previewTheme.fontFamily }}
                >
                    <div ref={portalMountRef} />
                </FluentProvider>
            </IdPrefixProvider>
            <PortalMountProvider mountRef={portalMountRef}>
                <div className={styles.scroll}>
                    <div
                        className={styles.scaler}
                        style={{
                            transform: `scale(${zoom / 100})`,
                            width: `${(100 / zoom) * 100}%`,
                        }}
                    >
                        {/* An id prefix of its own keeps the previewed theme's generated
                            ids from colliding with the tool's own Fluent instance. */}
                        <IdPrefixProvider value="preview-">
                            <FluentProvider
                                theme={previewTheme.fluentTheme}
                                className={mergeClasses(
                                    styles.app,
                                    highlight && styles.highlight
                                )}
                                style={{ fontFamily: previewTheme.fontFamily }}
                            >
                                <AppHeader
                                    colors={previewTheme.headerColors}
                                    logoDataUri={logoDataUri}
                                    logoTooltip={model.logoTooltip}
                                    appName="Sales Hub"
                                />
                                <div className={styles.body}>
                                    <NavBar />
                                    <div className={styles.canvas}>
                                        {selectedTab === 'view' ? (
                                            <GridPreview />
                                        ) : (
                                            <FormPreview />
                                        )}
                                    </div>
                                </div>
                            </FluentProvider>
                        </IdPrefixProvider>
                    </div>
                </div>
            </PortalMountProvider>

            <PreviewToolbar
                selectedTab={selectedTab}
                onTabChange={setSelectedTab}
                highlight={highlight}
                onHighlightChange={setHighlight}
                zoom={zoom}
                onZoomChange={setZoom}
            />
        </div>
    );
}
