export function clamp01(value) {
    return Math.max(0, Math.min(1, value));
}

export function buildObfuscatorConfig(options) {
    return {
        optionsPreset: options.optionsPreset,
        target: 'browser',

        compact: true,
        simplify: true,
        numbersToExpressions: true,
        splitStrings: true,
        transformObjectKeys: true,
        stringArray: true,
        stringArrayThreshold: 1,
        stringArrayEncoding: ['rc4'],
        stringArrayShuffle: true,
        stringArrayRotate: true,

        renameGlobals: true,
        // No unicodeEscapeSequence: trivially reversible, and +41% size.
        // Breaks only if the code text is edited; unlike debugProtection, no runtime trap.
        selfDefending: true,

        ...(options.useVM && {
            vmObfuscation: true,
            vmObfuscationThreshold: clamp01(options.vmObfuscationThreshold),
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

        ...options.overrides,
    };
}
