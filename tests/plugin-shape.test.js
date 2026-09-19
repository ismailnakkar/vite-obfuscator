import {describe, expect, it} from 'vitest';
import obfuscator from '../src/index.js';

const base = {include: ['resources/js/a.js'], islandRoots: ['resources/js'], apiToken: ''};

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

    it('refuses a VM build with no API token, rather than silently downgrading', () => {
        const plugin = obfuscator({...base, enable: true, vmObfuscation: true});
        const errors = [];

        plugin.buildStart.call({error: (m) => errors.push(m)});

        expect(errors).toHaveLength(1);
        expect(errors[0]).toContain('OBFUSCATOR_API_TOKEN');
    });
});
