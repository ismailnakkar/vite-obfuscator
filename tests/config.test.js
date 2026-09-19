import {describe, expect, it} from 'vitest';
import {buildObfuscatorConfig, clamp01} from '../src/config.js';

const base = {optionsPreset: 'high-obfuscation', useVM: false, vmObfuscationThreshold: 1, vmTargetFunctionsMode: 'comment', overrides: {}};

describe('clamp01', () => {
    it('holds the value inside 0..1', () => {
        expect(clamp01(-2)).toBe(0);
        expect(clamp01(2)).toBe(1);
        expect(clamp01(0.5)).toBe(0.5);
    });
});

describe('buildObfuscatorConfig', () => {
    it('emits no vm options when the VM is off', () => {
        const config = buildObfuscatorConfig(base);

        expect(config.vmObfuscation).toBeUndefined();
        expect(config.stringArrayEncoding).toEqual(['rc4']);
        expect(config.selfDefending).toBe(true);
    });

    it('emits vm options when the VM is on', () => {
        const config = buildObfuscatorConfig({...base, useVM: true});

        expect(config.vmObfuscation).toBe(true);
        expect(config.vmTargetFunctionsMode).toBe('comment');
        expect(config.vmObfuscationThreshold).toBe(1);
    });

    it('lets overrides win over every default', () => {
        expect(buildObfuscatorConfig({...base, overrides: {selfDefending: false}}).selfDefending).toBe(false);
    });
});
