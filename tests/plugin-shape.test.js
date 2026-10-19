import {join} from 'node:path';
import {describe, expect, it} from 'vitest';
import obfuscator from '../src/index.js';

const base = {include: ['resources/js/a.js'], islandRoots: ['src'], apiToken: ''};

describe('the plugin', () => {
    it('is a post-enforced build plugin', () => {
        const plugin = obfuscator(base);

        expect(plugin.name).toBe('vite-obfuscator');
        expect(plugin.apply).toBe('build');
        expect(plugin.enforce).toBe('post');
    });

    it('refuses to be constructed without include or islandRoots', () => {
        expect(() => obfuscator({...base, include: []})).toThrow(/both required/);
        expect(() => obfuscator({...base, islandRoots: []})).toThrow(/both required/);
        expect(() => obfuscator({})).toThrow(/both required/);
    });

    it('refuses a root that is not on disk', () => {
        const plugin = obfuscator({...base, islandRoots: ['src', 'no/such/dir']});
        const errors = [];

        plugin.configResolved({root: process.cwd()});
        plugin.buildStart.call({error: (m) => errors.push(m)});

        expect(errors).toHaveLength(1);
        expect(errors[0]).toContain('no/such/dir');
    });

    it('resolves islandRoots against Vite\'s root, not the working directory', () => {
        const plugin = obfuscator({...base, islandRoots: ['index.js']});
        const errors = [];

        // 'index.js' exists under src/, so this passes only if config.root was honoured.
        plugin.configResolved({root: join(process.cwd(), 'src')});
        plugin.buildStart.call({error: (m) => errors.push(m)});

        expect(errors).toEqual([]);
    });

    it('refuses a VM build with no API token, rather than silently downgrading', () => {
        const plugin = obfuscator({...base, vmObfuscation: true});
        const errors = [];

        plugin.configResolved({root: process.cwd()});
        plugin.buildStart.call({error: (m) => errors.push(m)});

        expect(errors).toHaveLength(1);
        expect(errors[0]).toContain('apiToken is empty');
    });
});
