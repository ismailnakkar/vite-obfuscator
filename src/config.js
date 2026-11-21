/**
 * The preset decides; this adds only what is unsafe on a page the app does not own (no console
 * stubbing, no debugger trap, no self-defending, no eval). `overrides` win over all of it.
 */
export function buildObfuscatorConfig({optionsPreset, overrides}) {
    return {
        optionsPreset,
        target: 'browser-no-eval',
        disableConsoleOutput: false,
        debugProtection: false,
        debugProtectionInterval: 0,
        selfDefending: false,
        ...overrides,
    };
}
