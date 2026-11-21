import {join} from 'node:path';
import {describe, expect, it} from 'vitest';
import obfuscator from '../src/index.js';

const base = {include: ['resources/js/a.js'], islandRoots: ['src']};

describe('the plugin', () => {
    it('is a post-enforced build plugin', () => {
        const plugin = obfuscator(base);

        expect(plugin.name).toBe('vite-obfuscator');
        expect(plugin.apply).toBe('build');
        expect(plugin.enforce).toBe('post');
        // 6.x set build.rolldownOptions.output.comments to keep VM markers; 7.0 leaves Vite's config alone.
        expect(plugin).not.toHaveProperty('config');
    });

    // Thrown before Vite has a plugin context to prefix it, so it carries its own.
    it('refuses to be constructed without include or islandRoots', () => {
        const refusal = '[Obfuscator] include and islandRoots are both required: with either empty the plugin obfuscates nothing and the boundary guard passes on any input.';

        expect(() => obfuscator({...base, include: []})).toThrow(refusal);
        expect(() => obfuscator({...base, islandRoots: []})).toThrow(refusal);
        expect(() => obfuscator({})).toThrow(refusal);
    });

    it('refuses a root that is not on disk', () => {
        const plugin = obfuscator({...base, islandRoots: ['src', 'no/such/dir']});
        const errors = [];

        plugin.configResolved({root: process.cwd()});
        plugin.buildStart.call({error: (m) => errors.push(m)});

        // Unprefixed: Vite adds `[plugin vite-obfuscator]`.
        expect(errors).toEqual([
            `islandRoots not found on disk: ${join(process.cwd(), 'no/such/dir')}. A root that matches no module silently disables the boundary guard — check the path.`,
        ]);
    });

    it('resolves islandRoots against Vite\'s root, not the working directory', () => {
        const plugin = obfuscator({...base, islandRoots: ['index.js']});
        const errors = [];

        // 'index.js' exists under src/, so this passes only if config.root was honoured.
        plugin.configResolved({root: join(process.cwd(), 'src')});
        plugin.buildStart.call({error: (m) => errors.push(m)});

        expect(errors).toEqual([]);
    });
});
