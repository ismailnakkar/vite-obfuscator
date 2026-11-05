import type {Plugin} from 'vite';

export interface ObfuscatorOptions {
    /** Entry SOURCE paths, as written in vite.config — not entry names, and no `./` prefix. */
    include: readonly string[];
    /** Directories of the code to protect, relative to Vite's root. */
    islandRoots: readonly string[];
    /** Pro API token, for `vmObfuscation`. */
    apiToken?: string;
    /** Runs marked functions through the Pro VM. Opt-in; needs `apiToken`. */
    vmObfuscation?: boolean;
    vmObfuscationThreshold?: number;
    /** `javascript-obfuscator` preset; it decides everything `overrides` does not. Default 'low-obfuscation'. */
    optionsPreset?: string;
    /** Leaves node_modules code readable and fails the build if none is found. Default false; needs an unminified chunk. */
    spareNodeModules?: boolean;
    /** `javascript-obfuscator` seed, for reproducible output when non-zero (0 is unseeded). */
    seed?: number;
    /** False for a script served at a fixed URL, whose name cannot be content-addressed. */
    rehash?: boolean;
    /** Fails the build when an obfuscated chunk gzips to more bytes than this. 0 is off. */
    maxGzipBytes?: number;
    timeout?: number;
    version?: string;
    overrides?: Record<string, unknown>;
}

export default function obfuscator(options: ObfuscatorOptions): Plugin;
