import { createContext, useContext, useEffect, useState, type ReactNode, type RefObject } from 'react';

/**
 * Fluent UI creates its portal host lazily, on `document.body`, the first time
 * a popup (dropdown, combobox, popover, tooltip…) is opened. That late DOM
 * mutation makes the whole page flash blank for a moment. The fix Microsoft
 * recommends is to render a host element yourself inside the `FluentProvider`
 * and pass it as `mountNode` to every popup surface — this context carries the
 * ref to that element so the controls can do exactly that.
 */
const PortalMountContext = createContext<HTMLDivElement | undefined>(undefined);

export function PortalMountProvider({ mountRef, children }: { mountRef?: RefObject<HTMLDivElement | null>; children: ReactNode }) {
    // Refs don't trigger a render, so publish the element once it is attached:
    // consumers that rendered before the host existed then pick it up.
    const [mountNode, setMountNode] = useState<HTMLDivElement | undefined>(undefined);

    useEffect(() => {
        setMountNode(mountRef?.current ?? undefined);
    }, [mountRef]);

    return <PortalMountContext.Provider value={mountNode}>{children}</PortalMountContext.Provider>;
}

/**
 * The element Fluent popups must be mounted into, or `undefined` before it has
 * been rendered (in which case Fluent falls back to its default behaviour).
 */
export function usePortalMount(): HTMLDivElement | undefined {
    return useContext(PortalMountContext);
}
