import {describe, expect, it} from 'vitest';
import {buildObfuscatorConfig, clamp01} from '../src/config.js';

const base = {optionsPreset: 'low-obfuscation', useVM: false, vmObfuscationThreshold: 1, overrides: {}};

describe('clamp01', () => {
    it('holds the value inside 0..1', () => {
        expect(clamp01(-2)).toBe(0);
        expect(clamp01(2)).toBe(1);
        expect(clamp01(0.5)).toBe(0.5);
    });
});

describe('buildObfuscatorConfig', () => {
    it('lets the preset decide: none of the old forced options appear', () => {
        const config = buildObfuscatorConfig(base);

        expect(config.optionsPreset).toBe('low-obfuscation');
        for (const key of [
            'numbersToExpressions', 'splitStrings', 'transformObjectKeys', 'stringArray', 'stringArrayThreshold',
            'stringArrayEncoding', 'renameGlobals', 'compact', 'simplify', 'vmObfuscation',
        ]) {
            expect(config, key).not.toHaveProperty(key);
        }
    });

    it('is safe on a page the app does not own', () => {
        expect(buildObfuscatorConfig(base)).toMatchObject({
            target: 'browser-no-eval',
            disableConsoleOutput: false,
            debugProtection: false,
            debugProtectionInterval: 0,
            selfDefending: false,
        });
    });

    it('passes a seed through, and only when given', () => {
        expect(buildObfuscatorConfig({...base, seed: 7}).seed).toBe(7);
        expect(buildObfuscatorConfig({...base, seed: 0}).seed).toBe(0);
        expect(buildObfuscatorConfig(base)).not.toHaveProperty('seed');
    });

    it('emits vm options when the VM is on', () => {
        const config = buildObfuscatorConfig({...base, useVM: true});

        expect(config.vmObfuscation).toBe(true);
        expect(config.vmTargetFunctionsMode).toBe('comment');
        expect(config.vmObfuscationThreshold).toBe(1);
    });

    it('lets overrides win over every default', () => {
        const config = buildObfuscatorConfig({
            ...base, overrides: {selfDefending: true, target: 'browser', debugProtection: true},
        });

        expect(config).toMatchObject({selfDefending: true, target: 'browser', debugProtection: true});
    });
});
