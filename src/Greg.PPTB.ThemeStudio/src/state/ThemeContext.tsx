import { createContext, useContext, useMemo, useReducer, type Dispatch, type ReactNode } from 'react';
import type { PaletteSlot, ThemeModel } from '../model/theme';
import { themeModelToPreviewTheme, type PreviewTheme } from '../model/tokenMap';
import { applyPaletteOverrides, generateBrandRamp } from '../model/brandRamp';
import { createInitialThemeState, isDirty, themeReducer, type ThemeAction, type ThemeState } from './themeReducer';

const FALLBACK_SEED = '#0F6CBD';

interface ThemeContextValue {
    state: ThemeState;
    model: ThemeModel;
    dispatch: Dispatch<ThemeAction>;
    /** True when the edited model differs from the last loaded/saved one. */
    dirty: boolean;
    canUndo: boolean;
    canRedo: boolean;
    /** The 16-slot palette that the generator produces, before overrides. */
    generatedPalette: Record<PaletteSlot, string>;
    /** The generated palette with the user's slot overrides applied. */
    resolvedPalette: Record<PaletteSlot, string>;
    /** The Fluent v9 projection used by the preview (docs/IMPLEMENTATION_PLAN.md §3). */
    previewTheme: PreviewTheme;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

/**
 * Holds the single source of truth for the tool — the `ThemeModel` — together
 * with its undo/redo history, and derives the palette and the Fluent preview
 * theme from it. Everything else in the UI reads from here, so a change in the
 * Theme Panel repaints the preview with no manual refresh (requirement §43).
 */
export function ThemeProvider({ children, initialModel }: { children: ReactNode; initialModel?: ThemeModel }) {
    const [state, dispatch] = useReducer(themeReducer, initialModel, createInitialThemeState);
    const model = state.present;

    const generatedPalette = useMemo(() => {
        // A loaded file may carry a colour the generator can't read; never let
        // that take the whole tool down, fall back to the default seed instead.
        try {
            return generateBrandRamp({
                basePaletteColor: model.basePaletteColor ?? FALLBACK_SEED,
                lockPrimary: model.lockPrimary,
                vibrancy: model.vibrancy,
                hueTorsion: model.hueTorsion,
            });
        } catch {
            return generateBrandRamp({ basePaletteColor: FALLBACK_SEED, lockPrimary: false, vibrancy: 0, hueTorsion: 0 });
        }
    }, [model.basePaletteColor, model.lockPrimary, model.vibrancy, model.hueTorsion]);

    const resolvedPalette = useMemo(() => applyPaletteOverrides(generatedPalette, model.paletteOverrides), [generatedPalette, model.paletteOverrides]);

    const previewTheme = useMemo(() => {
        try {
            return themeModelToPreviewTheme(model);
        } catch {
            return themeModelToPreviewTheme({ ...model, basePaletteColor: FALLBACK_SEED, paletteOverrides: {} });
        }
    }, [model]);

    const value = useMemo<ThemeContextValue>(
        () => ({
            state,
            model,
            dispatch,
            dirty: isDirty(state),
            canUndo: state.past.length > 0,
            canRedo: state.future.length > 0,
            generatedPalette,
            resolvedPalette,
            previewTheme,
        }),
        [state, model, generatedPalette, resolvedPalette, previewTheme],
    );

    return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useThemeModel(): ThemeContextValue {
    const context = useContext(ThemeContext);
    if (!context) {
        throw new Error('useThemeModel must be used within a <ThemeProvider>.');
    }
    return context;
}
