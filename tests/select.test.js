import {describe, expect, it} from 'vitest';
import {selectTargets} from '../src/select.js';

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
