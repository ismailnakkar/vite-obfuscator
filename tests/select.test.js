import {describe, expect, it} from 'vitest';
import {selectTargets, unmatchedIncludes} from '../src/select.js';

const chunk = (fileName, {name = fileName, isEntry = false, facadeModuleId = null, imports = []} = {}) => ({
    type: 'chunk', fileName, name, isEntry, facadeModuleId, imports, dynamicImports: [], moduleIds: [],
});

describe('selectTargets', () => {
    it('selects an included entry', () => {
        const bundle = {
            'a.js': chunk('a.js', {isEntry: true, facadeModuleId: '/app/resources/js/links/first.ts'}),
        };

        expect(selectTargets(bundle, ['resources/js/links/first.ts']).map((c) => c.fileName)).toEqual(['a.js']);
    });

    it('selects a shared chunk reached only by included entries', () => {
        const bundle = {
            'a.js': chunk('a.js', {isEntry: true, facadeModuleId: '/app/resources/js/links/first.ts', imports: ['shared.js']}),
            'b.js': chunk('b.js', {isEntry: true, facadeModuleId: '/app/resources/js/links/last.ts', imports: ['shared.js']}),
            'shared.js': chunk('shared.js'),
        };

        const names = selectTargets(bundle, ['resources/js/links/first.ts', 'resources/js/links/last.ts'])
            .map((c) => c.fileName).sort();

        expect(names).toEqual(['a.js', 'b.js', 'shared.js']);
    });

    it('spares a chunk that a non-included entry also reaches', () => {
        const bundle = {
            'a.js': chunk('a.js', {isEntry: true, facadeModuleId: '/app/resources/js/links/first.ts', imports: ['shared.js']}),
            'site.js': chunk('site.js', {isEntry: true, facadeModuleId: '/app/resources/js/site/app.ts', imports: ['shared.js']}),
            'shared.js': chunk('shared.js'),
        };

        expect(selectTargets(bundle, ['resources/js/links/first.ts']).map((c) => c.fileName)).toEqual(['a.js']);
    });

    it('ignores assets and unreached chunks', () => {
        const bundle = {
            'style.css': {type: 'asset', fileName: 'style.css'},
            'orphan.js': chunk('orphan.js'),
        };

        expect(selectTargets(bundle, ['resources/js/links/first.ts'])).toEqual([]);
    });
});

describe('entry matching is segment-bounded', () => {
    // A bare endsWith makes 'first.js' match '…/not-first.js', so one typo silently obfuscates an
    // entry nobody meant to protect — or, worse, the public site's.
    it('does not let a short include match a longer filename', () => {
        const bundle = {
            'a.js': chunk('a.js', {isEntry: true, facadeModuleId: '/app/resources/js/not-first.js'}),
        };

        expect(selectTargets(bundle, ['first.js'])).toEqual([]);
        expect(unmatchedIncludes(bundle, ['first.js'])).toEqual(['first.js']);
    });

    it('still matches on a real segment boundary, and on the whole id', () => {
        const bundle = {
            'a.js': chunk('a.js', {isEntry: true, facadeModuleId: '/app/resources/js/links/first.js'}),
        };

        expect(selectTargets(bundle, ['resources/js/links/first.js']).map((c) => c.fileName)).toEqual(['a.js']);
        expect(unmatchedIncludes(bundle, ['resources/js/links/first.js'])).toEqual([]);
    });
});

describe('unmatchedIncludes', () => {
    it('reports an entry NAME passed where a source path belongs', () => {
        const bundle = {
            'a.js': chunk('a.js', {isEntry: true, facadeModuleId: '/app/src/widget/index.js'}),
        };

        expect(unmatchedIncludes(bundle, ['widget'])).toEqual(['widget']);
    });

    it('ignores non-entry chunks and entries with no facade module', () => {
        const bundle = {
            'a.js': chunk('a.js', {isEntry: true, facadeModuleId: null}),
            'b.js': chunk('b.js', {facadeModuleId: '/app/src/widget/index.js'}),
        };

        expect(unmatchedIncludes(bundle, ['src/widget/index.js'])).toEqual(['src/widget/index.js']);
    });
});
