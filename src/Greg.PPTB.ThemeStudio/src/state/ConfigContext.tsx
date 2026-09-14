import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
    type ReactNode,
} from 'react';
import { useThemeModel } from './ThemeContext';
import { useConnection } from '../hooks/useToolboxAPI';
import {
    dataverseSolutionService,
    type SolutionSummary,
} from '../services/dataverseSolutionService';
import {
    dataverseWebResourceService,
    type WebResourceSummary,
} from '../services/dataverseWebResourceService';
import {
    dataverseThemeScopeService,
    type ScopeCapabilities,
} from '../services/dataverseThemeScopeService';
import {
    logoSizeWarning,
    measureImage,
    readLogoDataUri,
} from '../services/logo';

/**
 * Everything the tool needs to talk to Dataverse: the active connection, the
 * mandatory target solution, the theme web resource currently open, the
 * resolved logo image and what this environment supports for scope assignment
 * (docs/IMPLEMENTATION_PLAN.md §3, Phase 4).
 *
 * The theme itself stays in `ThemeContext` — this context never edits it.
 */

/** Key used to remember the last chosen solution across sessions (§2.12). */
const LAST_SOLUTION_KEY = 'last.solutionUniqueName';

export interface OpenThemeResource {
    resource: WebResourceSummary;
    /** The XML exactly as it was loaded, for the pre-save diff (§2.6). */
    originalXml: string;
}

interface ConfigContextValue {
    connection: ToolBoxAPI.Connection | null;
    connectionLoading: boolean;
    refreshConnection: () => Promise<void>;

    solutions: SolutionSummary[];
    solutionsLoading: boolean;
    solutionsError?: string;
    reloadSolutions: () => Promise<void>;
    selectedSolution?: SolutionSummary;
    selectSolution: (solution: SolutionSummary | undefined) => void;

    openTheme?: OpenThemeResource;
    setOpenTheme: (open: OpenThemeResource | undefined) => void;

    /** The logo image the preview renders, when one could be resolved. */
    logoDataUri?: string;
    logoWarning?: string;
    logoLoading: boolean;
    /** Shows a locally picked image in the preview before it is uploaded. */
    setPendingLogo: (dataUri: string | undefined, warning?: string) => void;

    scope?: ScopeCapabilities;
    scopeLoading: boolean;
    refreshScope: () => Promise<void>;
}

const ConfigContext = createContext<ConfigContextValue | undefined>(undefined);

function message(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export function ConfigProvider({ children }: { children: ReactNode }) {
    const {
        connection,
        isLoading: connectionLoading,
        refreshConnection,
    } = useConnection();
    const { model } = useThemeModel();

    const [solutions, setSolutions] = useState<SolutionSummary[]>([]);
    const [solutionsLoading, setSolutionsLoading] = useState(false);
    const [solutionsError, setSolutionsError] = useState<string | undefined>();
    const [selectedSolution, setSelectedSolution] = useState<
        SolutionSummary | undefined
    >();

    const [openTheme, setOpenTheme] = useState<OpenThemeResource | undefined>();

    const [logoDataUri, setLogoDataUri] = useState<string | undefined>();
    const [logoWarning, setLogoWarning] = useState<string | undefined>();
    const [logoLoading, setLogoLoading] = useState(false);
    const [pendingLogo, setPendingLogoState] = useState<
        { dataUri?: string; warning?: string } | undefined
    >();

    const [scope, setScope] = useState<ScopeCapabilities | undefined>();
    const [scopeLoading, setScopeLoading] = useState(false);

    // Everything below is resolved per environment, so it is keyed on the
    // connection id rather than on the connection object: the host hands out a
    // new object on every refresh, even when the environment is unchanged.
    const connectionId = connection?.id;
    // Updated during render so that a request started against one environment
    // can detect, once it resolves, that the user has already moved on.
    const activeConnectionId = useRef(connectionId);
    activeConnectionId.current = connectionId;

    const reloadSolutions = useCallback(async () => {
        if (!connectionId) {
            return;
        }
        setSolutionsLoading(true);
        setSolutionsError(undefined);
        try {
            const loaded =
                await dataverseSolutionService.listWritableSolutions();
            const remembered = await window.toolboxAPI.settings
                .get(LAST_SOLUTION_KEY)
                .catch(() => undefined);
            if (activeConnectionId.current !== connectionId) {
                return;
            }
            setSolutions(loaded);
            setSelectedSolution(
                (current) =>
                    current ??
                    loaded.find(
                        (solution) => solution.uniqueName === remembered
                    )
            );
        } catch (error) {
            if (activeConnectionId.current === connectionId) {
                setSolutionsError(message(error));
            }
        } finally {
            if (activeConnectionId.current === connectionId) {
                setSolutionsLoading(false);
            }
        }
    }, [connectionId]);

    const refreshScope = useCallback(async () => {
        if (!connectionId) {
            return;
        }
        setScopeLoading(true);
        try {
            const capabilities =
                await dataverseThemeScopeService.discoverScopeCapabilities();
            if (activeConnectionId.current === connectionId) {
                setScope(capabilities);
            }
        } finally {
            if (activeConnectionId.current === connectionId) {
                setScopeLoading(false);
            }
        }
    }, [connectionId]);

    // A connection switch (or drop) invalidates every piece of state that was
    // read from the previous environment. The theme model itself is left alone:
    // it is the user's work and can legitimately be saved somewhere else.
    const knownConnectionId = useRef<string | undefined>(connectionId);
    useEffect(() => {
        if (knownConnectionId.current === connectionId) {
            return;
        }
        knownConnectionId.current = connectionId;

        setSolutions([]);
        setSolutionsError(undefined);
        setSelectedSolution(undefined);
        setScope(undefined);
        setPendingLogoState(undefined);
        setLogoDataUri(undefined);
        setLogoWarning(undefined);
        setOpenTheme(undefined);

        if (openTheme) {
            void window.toolboxAPI.utils
                .showNotification({
                    title: 'Environment changed',
                    body: `"${openTheme.resource.name}" was closed because the active connection changed. Your edits are kept and can be saved to the new environment.`,
                    type: 'warning',
                })
                .catch(() => undefined);
        }
    }, [connectionId, openTheme]);

    useEffect(() => {
        void reloadSolutions();
        void refreshScope();
    }, [reloadSolutions, refreshScope]);

    const selectSolution = useCallback(
        (solution: SolutionSummary | undefined) => {
            setSelectedSolution(solution);
            if (solution) {
                void window.toolboxAPI.settings
                    .set(LAST_SOLUTION_KEY, solution.uniqueName)
                    .catch(() => undefined);
            }
        },
        []
    );

    const setPendingLogo = useCallback(
        (dataUri: string | undefined, warning?: string) => {
            setPendingLogoState(dataUri ? { dataUri, warning } : undefined);
        },
        []
    );

    // Resolve the logo named in the theme into an image the preview can show.
    // A locally picked file always wins: it is what the user is looking at.
    useEffect(() => {
        if (pendingLogo) {
            setLogoDataUri(pendingLogo.dataUri);
            setLogoWarning(pendingLogo.warning);
            return;
        }

        const name = model.logoWebResource?.trim();
        if (!name || !connectionId) {
            setLogoDataUri(undefined);
            setLogoWarning(undefined);
            return;
        }

        let cancelled = false;
        setLogoLoading(true);
        void (async () => {
            try {
                const found =
                    await dataverseWebResourceService.findWebResourceByName(
                        name
                    );
                if (cancelled) {
                    return;
                }
                if (!found) {
                    setLogoDataUri(undefined);
                    setLogoWarning(
                        `No web resource named "${name}" exists in this environment yet.`
                    );
                    return;
                }
                const dataUri = await readLogoDataUri(found.id);
                if (cancelled) {
                    return;
                }
                setLogoDataUri(dataUri);
                setLogoWarning(
                    dataUri
                        ? logoSizeWarning(await measureImage(dataUri))
                        : undefined
                );
            } catch (error) {
                if (!cancelled) {
                    setLogoDataUri(undefined);
                    setLogoWarning(message(error));
                }
            } finally {
                if (!cancelled) {
                    setLogoLoading(false);
                }
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [model.logoWebResource, connectionId, pendingLogo]);

    const value = useMemo<ConfigContextValue>(
        () => ({
            connection,
            connectionLoading,
            refreshConnection,
            solutions,
            solutionsLoading,
            solutionsError,
            reloadSolutions,
            selectedSolution,
            selectSolution,
            openTheme,
            setOpenTheme,
            logoDataUri,
            logoWarning,
            logoLoading,
            setPendingLogo,
            scope,
            scopeLoading,
            refreshScope,
        }),
        [
            connection,
            connectionLoading,
            refreshConnection,
            solutions,
            solutionsLoading,
            solutionsError,
            reloadSolutions,
            selectedSolution,
            selectSolution,
            openTheme,
            logoDataUri,
            logoWarning,
            logoLoading,
            setPendingLogo,
            scope,
            scopeLoading,
            refreshScope,
        ]
    );

    return (
        <ConfigContext.Provider value={value}>
            {children}
        </ConfigContext.Provider>
    );
}

export function useConfig(): ConfigContextValue {
    const context = useContext(ConfigContext);
    if (!context) {
        throw new Error('useConfig must be used within a <ConfigProvider>.');
    }
    return context;
}
