import type {Plugin} from 'vite';

export interface ObfuscatorOptions {
    /** Defaults to true. Gate it on an env var; the plugin is build-only either way. */
    enable?: boolean;
    /** Entry SOURCE paths, as written in vite.config — not entry names. */
    include: readonly string[];
    /** Directories whose modules are island code. Required: the boundary guard reads them. */
    islandRoots: readonly string[];
    apiToken?: string;
    vmObfuscation?: boolean;
    vmObfuscationThreshold?: number;
    vmTargetFunctionsMode?: 'comment' | 'name';
    vmTargetFunctions?: readonly string[];
    vmExcludeFunctions?: readonly string[];
    optionsPreset?: string;
    /** False for a script served at a fixed URL, whose name cannot be content-addressed. */
    rehash?: boolean;
    /** Strings that must survive into the obfuscated chunks — a tree-shaking tripwire. */
    mustContain?: readonly string[];
    timeout?: number;
    version?: string;
    overrides?: Record<string, unknown>;
}

export default function obfuscator(options: ObfuscatorOptions): Plugin;
