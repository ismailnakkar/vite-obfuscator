import {describe, expect, it} from 'vitest';
import {buildObfuscatorConfig} from '../src/config.js';

const base = {optionsPreset: 'low-obfuscation', overrides: {}};

describe('buildObfuscatorConfig', () => {
    it('is the preset plus only what is safe on a page the app does not own', () => {
        expect(buildObfuscatorConfig(base)).toEqual({
            optionsPreset: 'low-obfuscation',
            target: 'browser-no-eval',
            disableConsoleOutput: false,
            debugProtection: false,
            debugProtectionInterval: 0,
            selfDefending: false,
        });
    });

    it('lets overrides win over every default, and passes a seed through them', () => {
        const config = buildObfuscatorConfig({
            ...base, overrides: {selfDefending: true, target: 'browser', debugProtection: true, seed: 1234},
        });

        expect(config).toMatchObject({selfDefending: true, target: 'browser', debugProtection: true, seed: 1234});
    });
});
