import type {Plugin} from 'vite';

export interface ObfuscatorOptions {
    /** Entry SOURCE paths, as written in vite.config — not entry names, and no `./` prefix. */
    include: readonly string[];
    /** Directories of the code to protect, relative to Vite's root. */
    islandRoots: readonly string[];
    apiToken?: string;
    vmObfuscation?: boolean;
    vmObfuscationThreshold?: number;
    optionsPreset?: string;
    /** False for a script served at a fixed URL, whose name cannot be content-addressed. */
    rehash?: boolean;
    timeout?: number;
    version?: string;
    overrides?: Record<string, unknown>;
}

export default function obfuscator(options: ObfuscatorOptions): Plugin;
