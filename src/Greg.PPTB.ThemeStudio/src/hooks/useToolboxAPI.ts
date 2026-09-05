import { useCallback, useEffect, useRef, useState } from 'react';

/** Events that can change which environment the tool is talking to. */
const CONNECTION_EVENTS: ToolBoxAPI.ToolBoxEvent[] = [
    'connection:created',
    'connection:updated',
    'connection:deleted',
];

export function useConnection() {
    const [connection, setConnection] = useState<ToolBoxAPI.Connection | null>(
        null
    );
    const [isLoading, setIsLoading] = useState(true);

    const refreshConnection = useCallback(async () => {
        try {
            const conn =
                await window.toolboxAPI.connections.getActiveConnection();
            setConnection(conn);
        } catch (error) {
            console.error('Error refreshing connection:', error);
            setConnection(null);
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        void refreshConnection();
    }, [refreshConnection]);

    // The host can switch, edit or drop the active connection at any time; the
    // tool must follow it instead of keeping a stale environment.
    useToolboxEvents(
        useCallback(
            (event) => {
                if (CONNECTION_EVENTS.includes(event)) {
                    void refreshConnection();
                }
            },
            [refreshConnection]
        )
    );

    return { connection, isLoading, refreshConnection };
}

export function useToolboxEvents(
    onEvent: (event: ToolBoxAPI.ToolBoxEvent, data: unknown) => void
) {
    // Keeps a single subscription alive for the lifetime of the component, even
    // when the callback identity changes (docs: register once, route inside).
    const callbackRef = useRef(onEvent);
    callbackRef.current = onEvent;

    useEffect(() => {
        const handler = (
            _event: unknown,
            payload: ToolBoxAPI.ToolBoxEventPayload
        ) => {
            try {
                callbackRef.current(payload.event, payload.data);
            } catch (error) {
                console.error(
                    'Error handling the ToolBox event',
                    payload.event,
                    error
                );
            }
        };

        window.toolboxAPI.events.on(handler);

        return () => {
            window.toolboxAPI.events.off(handler);
        };
    }, []);
}

/**
 * Tracks the current PPTB host UI theme (light/dark) so the tool's own chrome
 * (not the previewed model-driven app theme) can follow it.
 */
export function useHostTheme() {
    const [hostTheme, setHostTheme] = useState<'light' | 'dark'>('light');

    useEffect(() => {
        let cancelled = false;

        const getTheme = async () => {
            try {
                const currentTheme =
                    await window.toolboxAPI.utils.getCurrentTheme();
                if (!cancelled) {
                    setHostTheme(currentTheme === 'dark' ? 'dark' : 'light');
                }
            } catch (error) {
                console.error('Error getting current theme:', error);
            }
        };

        void getTheme();

        return () => {
            cancelled = true;
        };
    }, []);

    return hostTheme;
}

/**
 * A piece of UI preference persisted through `toolboxAPI.settings` under a
 * namespaced key (docs/IMPLEMENTATION_PLAN.md §2.12). Transient state must not
 * use this hook — only preferences worth restoring on the next launch.
 */
export function usePersistedSetting<T>(
    key: string,
    defaultValue: T
): [T, (value: T) => void] {
    const [value, setValue] = useState<T>(defaultValue);

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            try {
                const stored = await window.toolboxAPI.settings.get(key);
                if (!cancelled && stored !== undefined && stored !== null) {
                    setValue(stored as T);
                }
            } catch (error) {
                console.error(`Error reading the "${key}" setting:`, error);
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [key]);

    const update = useCallback(
        (next: T) => {
            setValue(next);
            window.toolboxAPI.settings
                .set(key, next)
                .catch((error) =>
                    console.error(`Error saving the "${key}" setting:`, error)
                );
        },
        [key]
    );

    return [value, update];
}
