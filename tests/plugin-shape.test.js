import {join} from 'node:path';
import {describe, expect, it} from 'vitest';
import obfuscator from '../src/index.js';

const base = {include: ['resources/js/a.js'], islandRoots: ['src'], apiToken: ''};

describe('the plugin', () => {
    it('is a post-enforced build plugin', () => {
        const plugin = obfuscator({...base, enable: true});

        expect(plugin.name).toBe('vite-obfuscator');
        expect(plugin.apply).toBe('build');
        expect(plugin.enforce).toBe('post');
    });

    it('does nothing at all when disabled', () => {
        expect(obfuscator({...base, enable: false}).writeBundle).toBeUndefined();
    });

    // Both have a silent empty behaviour: no include selects no targets, no islandRoots leaves both
    // guards comparing empty sets. Either way an enabled build ships readable code and says nothing.
    it('refuses to be constructed without include or islandRoots', () => {
        expect(() => obfuscator({...base, include: [], enable: true})).toThrow(/both required/);
        expect(() => obfuscator({...base, islandRoots: [], enable: true})).toThrow(/both required/);
        expect(() => obfuscator({enable: true})).toThrow(/both required/);
    });

    // islandRoots is the boundary guard's own config: a root matching nothing leaves the guard
    // comparing empty sets, exactly like the empty array above, and the build ships readable code.
    it('refuses a root that is not on disk', () => {
        const plugin = obfuscator({...base, islandRoots: ['src', 'no/such/dir'], enable: true});
        const errors = [];

        plugin.configResolved({root: process.cwd()});
        plugin.buildStart.call({error: (m) => errors.push(m)});

        expect(errors).toHaveLength(1);
        expect(errors[0]).toContain('no/such/dir');
    });

    // `vite build --root <dir>` moves Vite's root without moving process.cwd(). Resolving against
    // the wrong one aimed every islandRoot at the wrong tree — silently before the guard existed,
    // and at a bogus path after it.
    it('resolves islandRoots against Vite\'s root, not the working directory', () => {
        const plugin = obfuscator({...base, islandRoots: ['index.js'], enable: true});
        const errors = [];

        // 'index.js' exists under src/, so this passes only if config.root was honoured.
        plugin.configResolved({root: join(process.cwd(), 'src')});
        plugin.buildStart.call({error: (m) => errors.push(m)});

        expect(errors).toEqual([]);
    });

    it('refuses a VM build with no API token, rather than silently downgrading', () => {
        const plugin = obfuscator({...base, enable: true, vmObfuscation: true});
        const errors = [];

        plugin.configResolved({root: process.cwd()});
        plugin.buildStart.call({error: (m) => errors.push(m)});

        expect(errors).toHaveLength(1);
        expect(errors[0]).toContain('OBFUSCATOR_API_TOKEN');
    });
});
