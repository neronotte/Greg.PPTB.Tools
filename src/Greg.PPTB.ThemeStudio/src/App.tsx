import { useEffect, useRef } from 'react';
import {
    FluentProvider,
    webLightTheme,
    webDarkTheme,
    makeStyles,
    tokens,
} from '@fluentui/react-components';
import { ErrorBoundary } from './components/ErrorBoundary';
import { StudioHeader } from './components/common/StudioHeader';
import { ConfigPanel } from './components/config/ConfigPanel';
import { ThemePanel } from './components/theme/ThemePanel';
import { PreviewFrame } from './components/preview/PreviewFrame';
import { useHostTheme } from './hooks/useToolboxAPI';
import { ThemeProvider } from './state/ThemeContext';
import { useThemeModel } from './state/ThemeContext';
import { ConfigProvider } from './state/ConfigContext';
import { PortalMountProvider } from './state/PortalMountContext';
import type { ThemeModel } from './model/theme';

const useStyles = makeStyles({
    root: {
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        width: '100%',
        maxWidth: '100%',
        backgroundColor: tokens.colorNeutralBackground1,
        overflow: 'hidden',
    },
    body: {
        display: 'flex',
        flex: 1,
        minHeight: 0,
    },
    main: {
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minWidth: 0,
    },
    // Host element for every Fluent portal (popovers, dropdowns, tooltips).
    // Fixed positioning keeps it out of the shell layout and prevents the
    // portal content from being clipped by the overflow of the root element.
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
 * Application shell: config bar on top, preview + theme panel below.
 * The tool's own chrome follows the PPTB host theme; the preview area will
 * nest its own FluentProvider with the user-authored theme (Phase 3, see
 * docs/IMPLEMENTATION_PLAN.md §2.10).
 */
function ThemeModelChangeBridge({
    onThemeModelChange,
}: {
    onThemeModelChange?: (model: ThemeModel) => void;
}) {
    const { model } = useThemeModel();

    useEffect(() => {
        onThemeModelChange?.(model);
    }, [model, onThemeModelChange]);

    return null;
}

function App({
    onThemeModelChange,
}: {
    onThemeModelChange?: (model: ThemeModel) => void;
}) {
    const hostTheme = useHostTheme();
    const styles = useStyles();
    // Without an explicit mount node, Fluent creates its portal host lazily on
    // `document.body` the first time a popup is opened, which makes the whole
    // page flash blank for a moment. The host `<div>` below lives inside the
    // provider (so it inherits the theme classes) and every popup/picklist in
    // the tool receives it through `PortalMountProvider` as its `mountNode`.
    const portalMountRef = useRef<HTMLDivElement | null>(null);

    return (
        <ErrorBoundary>
            <FluentProvider
                theme={hostTheme === 'dark' ? webDarkTheme : webLightTheme}
                className={styles.root}
            >
                <div ref={portalMountRef} className={styles.portalHost} />
                <PortalMountProvider mountRef={portalMountRef}>
                    <StudioHeader />
                    <ThemeProvider>
                        <ThemeModelChangeBridge
                            onThemeModelChange={onThemeModelChange}
                        />
                        <ConfigProvider>
                            <ConfigPanel />
                            <div className={styles.body}>
                                <div className={styles.main}>
                                    <PreviewFrame />
                                </div>
                                <ThemePanel />
                            </div>
                        </ConfigProvider>
                    </ThemeProvider>
                </PortalMountProvider>
            </FluentProvider>
        </ErrorBoundary>
    );
}

export default App;
