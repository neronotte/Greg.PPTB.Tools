import { describe, expect, it } from 'vitest';
import { PALETTE_SLOTS } from '../theme';
import { generateBrandRamp, hexToHsv, hexToRgb, hslToRgb, hsvToHex, isValidHex, normalizeHex, rgbToHex, rgbToHsl } from '../brandRamp';

describe('color conversions', () => {
    it('round-trips hex -> rgb -> hex', () => {
        expect(rgbToHex(...(Object.values(hexToRgb('#00FF00')) as [number, number, number]))).toBe('#00FF00');
    });

    it('round-trips rgb -> hsl -> rgb within rounding tolerance', () => {
        const rgb = hexToRgb('#3366CC');
        const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
        const back = hslToRgb(hsl.h, hsl.s, hsl.l);

        expect(back.r).toBeCloseTo(rgb.r, 0);
        expect(back.g).toBeCloseTo(rgb.g, 0);
        expect(back.b).toBeCloseTo(rgb.b, 0);
    });

    it('throws on invalid hex input', () => {
        expect(() => hexToRgb('not-a-color')).toThrow('Invalid HEX colour: "not-a-color"');
    });
});

describe('generateBrandRamp', () => {
    it('produces all 16 documented slots', () => {
        const ramp = generateBrandRamp({ basePaletteColor: '#00FF00', lockPrimary: false, vibrancy: 0, hueTorsion: 0 });

        for (const slot of PALETTE_SLOTS) {
            expect(ramp[slot]).toMatch(/^#[0-9A-F]{6}$/);
        }
    });

    it('places the seed colour verbatim in primary when lockPrimary is true', () => {
        const ramp = generateBrandRamp({ basePaletteColor: '#00ff00', lockPrimary: true, vibrancy: 0, hueTorsion: 0 });

        expect(ramp.primary).toBe('#00FF00');
    });

    it('darker slots stay darker than lighter slots regardless of lockPrimary', () => {
        const ramp = generateBrandRamp({ basePaletteColor: '#3366CC', lockPrimary: false, vibrancy: 0, hueTorsion: 0 });
        const luminance = (hex: string) => {
            const { r, g, b } = hexToRgb(hex);
            return 0.2126 * r + 0.7152 * g + 0.0722 * b;
        };

        expect(luminance(ramp.darker70)).toBeLessThan(luminance(ramp.primary));
        expect(luminance(ramp.primary)).toBeLessThan(luminance(ramp.lighter80));
    });

    it.each(['#0F6CBD', '#102030', '#F2C744', '#7A3B96'])('produces a ramp that gets lighter slot by slot for %s', (seed) => {
        const ramp = generateBrandRamp({ basePaletteColor: seed, lockPrimary: false, vibrancy: 0, hueTorsion: 0 });
        const luminance = (hex: string) => {
            const { r, g, b } = hexToRgb(hex);
            return 0.2126 * r + 0.7152 * g + 0.0722 * b;
        };

        const values = PALETTE_SLOTS.map((slot) => luminance(ramp[slot]));
        for (let index = 1; index < values.length; index += 1) {
            expect(values[index]).toBeGreaterThan(values[index - 1]);
        }
    });
});

describe('hex validation', () => {
    it('accepts 3- and 6-digit hex values with or without #', () => {
        expect(isValidHex('#0F6CBD')).toBe(true);
        expect(isValidHex('0f6cbd')).toBe(true);
        expect(isValidHex('#abc')).toBe(true);
    });

    it('rejects anything else', () => {
        expect(isValidHex('#12')).toBe(false);
        expect(isValidHex('rebeccapurple')).toBe(false);
        expect(isValidHex('')).toBe(false);
    });

    it('normalises to canonical #RRGGBB uppercase', () => {
        expect(normalizeHex('  #abc ')).toBe('#AABBCC');
        expect(normalizeHex('0f6cbd')).toBe('#0F6CBD');
    });
});

describe('hsv conversions', () => {
    it.each(['#000000', '#FFFFFF', '#0F6CBD', '#00FF00', '#7A3B96'])('round-trips %s through HSV', (hex) => {
        expect(hsvToHex(hexToHsv(hex))).toBe(hex);
    });

    it('reports zero saturation for greys', () => {
        expect(hexToHsv('#808080').s).toBe(0);
    });
});
