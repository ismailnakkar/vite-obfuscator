import {describe, expect, it} from 'vitest';
import {leakedIslandModules} from '../src/guards.js';

const chunk = (fileName, moduleIds) => ({type: 'chunk', fileName, moduleIds});

describe('leakedIslandModules', () => {
    it('reports an island module that ended up in a chunk nobody obfuscates', () => {
        const island = chunk('a.js', ['/app/resources/js/links/ladder.ts']);
        const shared = chunk('shared.js', ['/app/resources/js/links/dom.ts']);

        expect(leakedIslandModules([island, shared], [island], ['/app/resources/js/links']))
            .toEqual(['/app/resources/js/links/dom.ts']);
    });

    it('reports nothing when every island module sits in a target', () => {
        const island = chunk('a.js', ['/app/resources/js/links/ladder.ts']);

        expect(leakedIslandModules([island], [island], ['/app/resources/js/links'])).toEqual([]);
    });

    it('ignores modules outside every island root', () => {
        const site = chunk('site.js', ['/app/resources/js/site/app.ts']);

        expect(leakedIslandModules([site], [], ['/app/resources/js/links'])).toEqual([]);
    });

    it('treats a module covered by any target as covered', () => {
        const a = chunk('a.js', ['/app/resources/js/links/dom.ts']);
        const b = chunk('b.js', ['/app/resources/js/links/dom.ts']);

        expect(leakedIslandModules([a, b], [a], ['/app/resources/js/links'])).toEqual([]);
    });
});
