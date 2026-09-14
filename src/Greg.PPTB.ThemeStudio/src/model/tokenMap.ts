import {
  createLightTheme,
  type BrandVariants,
  type Theme,
} from "@fluentui/react-theme";
import {
  PALETTE_SLOTS,
  type AppHeaderColors,
  type PaletteSlot,
  type ThemeModel,
} from "./theme";
import {
  applyPaletteOverrides,
  generateBrandRamp,
  hexToRgb,
  hslToRgb,
  rgbToHex,
  rgbToHsl,
} from "./brandRamp";
import { relativeLuminance } from "./contrast";

/**
 * Maps the 16 documented palette slots 1:1 onto Fluent v9's `BrandVariants`
 * ramp keys (docs/THEME_XML_REFERENCE.md §4): `darker70`..`darker10` → `10`..`70`,
 * `primary` → `80`, `lighter10`..`lighter80` → `90`..`160`.
 */
const SLOT_TO_BRAND_KEY: Record<PaletteSlot, keyof BrandVariants> = {
  darker70: 10,
  darker60: 20,
  darker50: 30,
  darker40: 40,
  darker30: 50,
  darker20: 60,
  darker10: 70,
  primary: 80,
  lighter10: 90,
  lighter20: 100,
  lighter30: 110,
  lighter40: 120,
  lighter50: 130,
  lighter60: 140,
  lighter70: 150,
  lighter80: 160,
};

/** Builds a Fluent v9 `BrandVariants` ramp from a resolved 16-slot palette. */
export function paletteToBrandVariants(
  palette: Record<PaletteSlot, string>,
): BrandVariants {
  const brand = {} as BrandVariants;
  for (const slot of PALETTE_SLOTS) {
    brand[SLOT_TO_BRAND_KEY[slot]] = palette[slot];
  }
  return brand;
}

/** A resolved preview theme: the Fluent v9 `Theme` plus the header colour overrides. */
export interface PreviewTheme {
  fluentTheme: Theme;
  brand: BrandVariants;
  /** Every app-header colour, with the platform's fallbacks already applied. */
  headerColors: ResolvedAppHeaderColors;
  /** The font family the preview renders with (the theme's `font`, or Fluent's default). */
  fontFamily: string;
}

/** The 8 `AppHeaderColors` attributes, all resolved to a concrete colour. */
export type ResolvedAppHeaderColors = Required<AppHeaderColors>;

const FALLBACK_SEED = "#0F6CBD";
const LIGHT_FOREGROUND = "#FFFFFF";
const DARK_FOREGROUND = "#242424";

/** Picks the foreground with the better contrast against `background`. */
function readableForeground(background: string): string {
  return relativeLuminance(background) > 0.4
    ? DARK_FOREGROUND
    : LIGHT_FOREGROUND;
}

/** Moves a colour towards black (negative) or white (positive) by `amount` lightness points. */
function shiftLightness(hex: string, amount: number): string {
  const { r, g, b } = hexToRgb(hex);
  const hsl = rgbToHsl(r, g, b);
  const lightness = Math.min(100, Math.max(0, hsl.l + amount));
  const shifted = hslToRgb(hsl.h, hsl.s, lightness);
  return rgbToHex(shifted.r, shifted.g, shifted.b);
}

/**
 * Resolves the app-header colours the preview must paint with. The platform
 * only requires `background`; every other attribute is calculated from it when
 * left empty (docs/THEME_XML_REFERENCE.md §3), and the whole element is
 * optional — without it the header follows the palette.
 */
export function resolveAppHeaderColors(
  colors: AppHeaderColors | undefined,
  brandPrimary: string,
): ResolvedAppHeaderColors {
  const background = colors?.background?.trim() || brandPrimary;
  // Lighten a dark header on interaction, darken a light one, so the states
  // stay visible whatever the user picked.
  const direction = relativeLuminance(background) > 0.4 ? -1 : 1;
  const foreground =
    colors?.foreground?.trim() || readableForeground(background);
  const backgroundHover =
    colors?.backgroundHover?.trim() ||
    shiftLightness(background, direction * 8);
  const backgroundPressed =
    colors?.backgroundPressed?.trim() ||
    shiftLightness(background, direction * 14);
  const backgroundSelected =
    colors?.backgroundSelected?.trim() ||
    shiftLightness(background, direction * 20);

  return {
    background,
    foreground,
    backgroundHover,
    foregroundHover:
      colors?.foregroundHover?.trim() || readableForeground(backgroundHover),
    backgroundPressed,
    foregroundPressed:
      colors?.foregroundPressed?.trim() ||
      readableForeground(backgroundPressed),
    backgroundSelected,
    foregroundSelected:
      colors?.foregroundSelected?.trim() ||
      readableForeground(backgroundSelected),
  };
}

/**
 * Makes a user-typed font-family list safe to inject into the generated CSS.
 * A half-typed quote (`'Seg`) or a stray `;` would swallow the rest of the
 * theme's custom properties and leave the preview unstyled.
 */
export function sanitizeFontFamily(font: string): string {
  const stripped = font.replace(/[;{}<>\\]/g, "");
  const balanced = ["'", '"'].reduce(
    (value, quote) =>
      (value.split(quote).length - 1) % 2 === 0
        ? value
        : value.split(quote).join(""),
    stripped,
  );
  return balanced.trim();
}

/**
 * Projects a `ThemeModel` into a previewable Fluent v9 theme. The preview
 * never reads the theme XML directly — this is the only place the model is
 * translated into rendering primitives (docs/IMPLEMENTATION_PLAN.md §3).
 */
export function themeModelToPreviewTheme(model: ThemeModel): PreviewTheme {
  const seed = model.basePaletteColor ?? FALLBACK_SEED;
  const ramp = generateBrandRamp({
    basePaletteColor: seed,
    lockPrimary: model.lockPrimary,
    vibrancy: model.vibrancy,
    hueTorsion: model.hueTorsion,
  });
  const palette = applyPaletteOverrides(ramp, model.paletteOverrides);
  const brand = paletteToBrandVariants(palette);
  const baseTheme = createLightTheme(brand);
  // The app font is a themed surface too, so it must reach the Fluent
  // controls the preview renders — those read `fontFamilyBase`, not the
  // inherited CSS font (docs/THEME_XML_REFERENCE.md §5).
  const fontFamily =
    sanitizeFontFamily(model.font ?? "") || baseTheme.fontFamilyBase;

  return {
    fluentTheme: { ...baseTheme, fontFamilyBase: fontFamily },
    brand,
    headerColors: resolveAppHeaderColors(
      model.appHeaderColors,
      palette.primary,
    ),
    fontFamily,
  };
}
