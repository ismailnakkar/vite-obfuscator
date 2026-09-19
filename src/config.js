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
        // No unicodeEscapeSequence: escape sequences are trivially reversible and measured +41% on
        // an obfuscated chunk. The high-obfuscation preset leaves it off; so do we.
        // Trips only when the code text is modified, so no runtime behaviour of its own — unlike
        // debugProtection, which the preset turns ON. Override it off if that trap is unwanted.
        selfDefending: true,

        ...(options.useVM && {
            vmObfuscation: true,
            vmObfuscationThreshold: clamp01(options.vmObfuscationThreshold),
            vmPreprocessIdentifiers: true,
            vmTargetFunctionsMode: options.vmTargetFunctionsMode,
            ...(options.vmTargetFunctions && {vmTargetFunctions: options.vmTargetFunctions}),
            ...(options.vmExcludeFunctions && {vmExcludeFunctions: options.vmExcludeFunctions}),

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
