export function clamp01(value) {
    return Math.max(0, Math.min(1, value));
}

/**
 * The preset decides; this adds only what is unsafe on a page the app does not own (no console
 * stubbing, no debugger trap, no self-defending, no eval) and the VM options. `overrides` win over all of it.
 */
export function buildObfuscatorConfig({optionsPreset, useVM, vmObfuscationThreshold, seed, overrides}) {
    return {
        optionsPreset,
        target: 'browser-no-eval',
        disableConsoleOutput: false,
        debugProtection: false,
        debugProtectionInterval: 0,
        selfDefending: false,

        ...(seed !== undefined && {seed}),

        ...(useVM && {
            vmObfuscation: true,
            vmObfuscationThreshold: clamp01(vmObfuscationThreshold),
            vmPreprocessIdentifiers: true,
            // Markers only: every guard checks markers, and upstream's default 'root' selects by name.
            vmTargetFunctionsMode: 'comment',

            vmDynamicOpcodes: true,
            vmOpcodeShuffle: true,
            vmBytecodeEncoding: true,
            vmBytecodeArrayEncoding: true,
            vmJumpsEncoding: true,
            vmRuntimeOpcodeDerivation: true,
            vmInstructionShuffle: true,
            vmRandomizeKeys: true,
        }),

        ...overrides,
    };
}
