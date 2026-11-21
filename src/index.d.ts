import type {ObfuscatorOptions as JavaScriptObfuscatorOptions} from 'javascript-obfuscator';
import type {Plugin} from 'vite';

export interface ObfuscatorOptions {
    /** Entry SOURCE paths, as written in vite.config — not entry names, and no `./` prefix. */
    include: readonly string[];
    /** Directories of the code to protect, relative to Vite's root. */
    islandRoots: readonly string[];
    /** `javascript-obfuscator` preset; it decides everything `overrides` does not. Default 'low-obfuscation'. */
    optionsPreset?: 'default' | 'low-obfuscation' | 'medium-obfuscation' | 'high-obfuscation';
    /** Leaves node_modules code readable and fails the build if none is found. Default false; needs an unminified chunk. */
    spareNodeModules?: boolean;
    /** Default true. False for a script served at a fixed URL, whose name cannot be content-addressed. */
    rehash?: boolean;
    /** Fails the build when an obfuscated chunk gzips to more bytes than this. 0 is off. */
    maxGzipBytes?: number;
    /** `javascript-obfuscator` options, merged last over the preset and the plugin's own. A non-zero `seed` here makes rebuilds byte-identical. */
    overrides?: JavaScriptObfuscatorOptions;
}

export default function obfuscator(options: ObfuscatorOptions): Plugin;
