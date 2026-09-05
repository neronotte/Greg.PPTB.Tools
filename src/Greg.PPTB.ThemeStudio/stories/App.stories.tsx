import {
    useEffect,
    useSyncExternalStore,
    type ReactNode,
} from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import {
    FluentProvider,
    IdPrefixProvider,
    Spinner,
    makeStyles,
    mergeClasses,
    tokens,
} from '@fluentui/react-components';
import App from '../src/App';
import { StudioHeader } from '../src/components/common/StudioHeader';
import { ConfigPanel } from '../src/components/config/ConfigPanel';
import { FormPreview } from '../src/components/preview/FormPreview';
import { GridPreview } from '../src/components/preview/GridPreview';
import { ThemePanel } from '../src/components/theme/ThemePanel';
import { AppHeader } from '../src/components/preview/shell/AppHeader';
import { NavBar } from '../src/components/preview/shell/NavBar';
import {
    PreviewToolbar,
    type PreviewTab,
} from '../src/components/preview/PreviewToolbar';
import { ThemeProvider, useThemeModel } from '../src/state/ThemeContext';
import { useConfig } from '../src/state/ConfigContext';
import { parseThemeXml } from '../src/model/themeXml';
import { base64ToText } from '../src/services/base64';
import type { ThemeModel } from '../src/model/theme';

const meta: Meta<typeof App> = {
    title: 'Application/App',
    component: App,
    parameters: {
        layout: 'fullscreen',
    },
};

export default meta;
type Story = StoryObj<typeof App>;

export const Default: Story = {
    name: 'Full Studio Shell',
    render: () => (
        <App
            onThemeModelChange={(model) =>
                setPreviewSettings({ model, themeLoaded: true })
            }
        />
    ),
};

export const HeaderAndToolbar: Story = {
    name: 'Studio Header & Toolbar',
    parameters: { fillViewport: false },
    render: () => (
        <>
            <StudioHeader />
            <ConfigPanel />
        </>
    ),
};

const usePreviewOnlyStyles = makeStyles({
    scroll: {
        height: '100vh',
        overflow: 'auto',
        backgroundColor: tokens.colorNeutralBackground3,
        padding: tokens.spacingHorizontalM,
    },
    scaler: {
        transformOrigin: 'top left',
    },
    surface: {
        display: 'flex',
        flexDirection: 'column',
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
});

interface PreviewOnlyProps {
    highlight: boolean;
    zoom: number;
}

// Shared by every story on a docs page, so the toolbar and theme panel stories
// can drive the focused previews rendered alongside them.
let previewSettings: PreviewOnlyProps & {
    tab: PreviewTab;
    themeLoaded: boolean;
    model?: ThemeModel;
} = {
    tab: 'view',
    highlight: false,
    zoom: 100,
    themeLoaded: false,
};
const previewListeners = new Set<() => void>();

function setPreviewSettings(patch: Partial<typeof previewSettings>) {
    previewSettings = { ...previewSettings, ...patch };
    for (const listener of previewListeners) {
        listener();
    }
}

function usePreviewSettings() {
    return useSyncExternalStore(
        (listener) => {
            previewListeners.add(listener);
            return () => previewListeners.delete(listener);
        },
        () => previewSettings
    );
}

/** The most recently saved theme web resource, i.e. whatever another story wrote. */
async function loadSavedTheme(): Promise<ThemeModel | undefined> {
    const query =
        'webresourceset?$select=webresourceid,name&$filter=' +
        encodeURIComponent('webresourcetype eq 4 and ismanaged eq false') +
        '&$orderby=modifiedon desc&$top=1';
    const result = await window.dataverseAPI.queryData(query);
    const id = result.value[0]?.webresourceid;
    if (typeof id !== 'string') {
        return undefined;
    }
    const record = await window.dataverseAPI.retrieve('webresource', id, [
        'content',
    ]);
    return parseThemeXml(base64ToText(String(record.content)));
}

// One fetch per page, however many story canvases are on it.
let savedThemeRequest: Promise<void> | undefined;

function useSharedTheme() {
    const settings = usePreviewSettings();

    useEffect(() => {
        if (settings.model) {
            if (!settings.themeLoaded) {
                setPreviewSettings({ themeLoaded: true });
            }
            return;
        }

        savedThemeRequest ??= loadSavedTheme()
            .then((model) =>
                setPreviewSettings({
                    model: previewSettings.model ?? model,
                    themeLoaded: true,
                })
            )
            .catch((error: unknown) => {
                console.error('Loading the saved theme failed:', error);
                setPreviewSettings({ themeLoaded: true });
            });
    }, [settings.model, settings.themeLoaded]);

    return settings;
}

function ThemedSurface({
    highlight,
    zoom,
    children,
}: PreviewOnlyProps & { children: ReactNode }) {
    const styles = usePreviewOnlyStyles();
    const { previewTheme, model } = useThemeModel();
    const { logoDataUri } = useConfig();

    return (
        <div className={styles.scroll}>
            <div
                className={styles.scaler}
                style={{
                    transform: `scale(${zoom / 100})`,
                    width: `${(100 / zoom) * 100}%`,
                }}
            >
                <IdPrefixProvider value="preview-">
                    <FluentProvider
                        theme={previewTheme.fluentTheme}
                        className={mergeClasses(
                            styles.surface,
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
                            <div className={styles.canvas}>{children}</div>
                        </div>
                    </FluentProvider>
                </IdPrefixProvider>
            </div>
        </div>
    );
}

function SavedThemePreview({
    highlight,
    zoom,
    children,
}: PreviewOnlyProps & { children: ReactNode }) {
    const settings = useSharedTheme();

    // Storybook args seed the shared store; the toolbar story then takes over.
    useEffect(() => {
        setPreviewSettings({ highlight, zoom });
    }, [highlight, zoom]);

    if (!settings.themeLoaded) {
        return <Spinner label="Loading the saved theme…" />;
    }

    return (
        // Remounting is how edits made in the theme panel story reach this one.
        <ThemeProvider
            key={JSON.stringify(settings.model ?? null)}
            initialModel={settings.model}
        >
            <ThemedSurface highlight={settings.highlight} zoom={settings.zoom}>
                {children}
            </ThemedSurface>
        </ThemeProvider>
    );
}

const previewOnlyStoryOptions = {
    args: {
        highlight: false,
        zoom: 100,
    },
    argTypes: {
        highlight: {
            name: 'Highlight themed areas',
            control: 'boolean',
        },
        zoom: {
            name: 'Zoom',
            control: { type: 'range', min: 50, max: 100, step: 10 },
        },
    },
} satisfies Partial<StoryObj<PreviewOnlyProps>>;

export const FormPreviewWithThemePanel: StoryObj<PreviewOnlyProps> = {
    name: 'Form Preview (saved theme)',
    ...previewOnlyStoryOptions,
    render: (args) => (
        <SavedThemePreview {...args}>
            <FormPreview />
        </SavedThemePreview>
    ),
};

export const GridViewPreviewWithThemePanel: StoryObj<PreviewOnlyProps> = {
    name: 'Grid View Preview (saved theme)',
    ...previewOnlyStoryOptions,
    render: (args) => (
        <SavedThemePreview {...args}>
            <GridPreview />
        </SavedThemePreview>
    ),
};

function ConnectedPreviewToolbar() {
    const settings = usePreviewSettings();

    return (
        <PreviewToolbar
            selectedTab={settings.tab}
            onTabChange={(tab) => setPreviewSettings({ tab })}
            highlight={settings.highlight}
            onHighlightChange={(highlight) => setPreviewSettings({ highlight })}
            zoom={settings.zoom}
            onZoomChange={(zoom) => setPreviewSettings({ zoom })}
        />
    );
}

export const PreviewControls: Story = {
    name: 'Preview Toolbar',
    parameters: { fillViewport: false },
    render: () => <ConnectedPreviewToolbar />,
};

function ConnectedFocusedPreview() {
    const settings = usePreviewSettings();

    return (
        <SavedThemePreview highlight={settings.highlight} zoom={settings.zoom}>
            {settings.tab === 'view' ? <GridPreview /> : <FormPreview />}
        </SavedThemePreview>
    );
}

export const FocusedPreview: Story = {
    name: 'Focused Preview (toolbar driven)',
    render: () => <ConnectedFocusedPreview />,
};

/** Publishes every edit made in the panel to the stories rendered next to it. */
function ThemeModelPublisher() {
    const { model } = useThemeModel();

    useEffect(() => {
        setPreviewSettings({ model });
    }, [model]);

    return null;
}

function ConnectedThemePanel() {
    const settings = useSharedTheme();

    if (!settings.themeLoaded) {
        return <Spinner label="Loading the saved theme…" />;
    }

    return (
        <ThemeProvider initialModel={settings.model}>
            <ThemeModelPublisher />
            <ThemePanel />
        </ThemeProvider>
    );
}

export const ThemeTokenEditor: Story = {
    name: 'Theme Token Editor',
    render: () => <ConnectedThemePanel />,
};
