import {parse} from 'acorn';
import {readFileSync} from 'node:fs';

// Sources use the legal-comment form so it survives bundlers; the obfuscator selects on the standard form.
export const VM_COMMENT_LEGAL = '/*! javascript-obfuscator:vm */';
export const VM_COMMENT_STANDARD = '/* javascript-obfuscator:vm */';

export function restoreVmComments(code) {
    return code.replaceAll(VM_COMMENT_LEGAL, VM_COMMENT_STANDARD);
}

export function countMarkers(code, marker) {
    return code.split(marker).length - 1;
}

/**
 * The legal-form markers a chunk's own source modules carry.
 *
 * Every module, not just the ones under an islandRoot: the surviving count this is compared against
 * is taken over the whole chunk, and filtering one side of an equality is how a marked module
 * outside the roots came to fail every build. islandRoots draws the boundary guard's line and
 * nothing else.
 */
export function sourceMarkers(moduleIds) {
    return moduleIds.reduce((total, id) => {
        try {
            return total + countMarkers(readFileSync(id, 'utf8'), VM_COMMENT_LEGAL);
        } catch {
            return total; // a virtual module has no file, and no markers either
        }
    }, 0);
}

// A regex over the source rather than a parse: a module id can name TypeScript, JSX or a .vue file,
// none of which acorn reads, and these declaration heads look the same in all of them. Comments after
// the marker are skipped, as the placement guard skips them. A block comment ends at its first `*/`:
// a lazy match would run on through code to a later one and read the next export as marked.
const MARKED_EXPORT = /^(?:\s|\/\*(?:[^*]|\*(?!\/))*\*\/|\/\/.*)*export\s+(?:(default)\b|(?:async\s+)?function\b\s*\*?\s*([\p{ID_Continue}$]+)|(?:const|let|var)\s+([\p{ID_Continue}$]+))/u;

/**
 * Exported functions marked in a chunk's source modules that the chunk did not render.
 *
 * Tree-shaking drops the function but keeps its legal comment, so the marker count still matches
 * and the marker now sits on whatever followed it — an unmarked function goes to the VM in its
 * place. renderedExports is the only record of the drop, and only exports appear in it: a
 * non-exported marked function dropped as unused leaves no trace here.
 */
export function shakenMarkedExports(chunk) {
    return chunk.moduleIds.flatMap((id) => {
        const rendered = chunk.modules[id]?.renderedExports;

        if (!rendered) return [];

        let source;

        try {
            source = readFileSync(id, 'utf8');
        } catch {
            return []; // a virtual module has no file, and no markers either
        }

        return source.split(VM_COMMENT_LEGAL).slice(1)
            .map((after) => after.match(MARKED_EXPORT))
            .filter(Boolean)
            .map(([, isDefault, fn, binding]) => (isDefault ? 'default' : fn ?? binding))
            .filter((name) => !rendered.includes(name))
            .map((name) => ({id, name}));
    });
}

const FUNCTIONS = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);
const isFunction = (node) => node != null && FUNCTIONS.has(node.type);

// What comment mode can virtualize: the function the marker precedes, or the binding holding it.
function holdsFunction(node) {
    switch (node.type) {
        case 'FunctionDeclaration':
        case 'MethodDefinition':
            return true;
        case 'VariableDeclaration':
            return isFunction(node.declarations[0].init);
        case 'VariableDeclarator':
            return isFunction(node.init);
        case 'ExportNamedDeclaration':
            return node.declaration != null && holdsFunction(node.declaration);
        case 'ExportDefaultDeclaration':
            return isFunction(node.declaration);
        case 'Property':
        case 'PropertyDefinition':
            return isFunction(node.value);
        default:
            return false;
    }
}

function walk(node, visit) {
    visit(node);

    for (const value of Object.values(node)) {
        for (const child of Array.isArray(value) ? value : [value]) {
            if (typeof child?.type === 'string') walk(child, visit);
        }
    }
}

/**
 * Markers in a built chunk that do not lead a function of their own, with their line, column and
 * what follows.
 *
 * The count guard cannot see these: the marker is still there, just no longer on its function.
 * Vite 8's oxc minifier merges `const`/`let`/`var` declarations of functions and moves their
 * markers into a function body or leaves them stacked after the merged statement; terser inlines a
 * function called once and its marker falls onto the next one, doubling up; a marker on a plain
 * variable never had a function to begin with. Either way nothing is virtualized where it was
 * meant and the build would report success.
 *
 * Throws acorn's SyntaxError when the chunk does not parse.
 */
export function misplacedMarkers(code) {
    const comments = [];
    const ast = parse(code, {ecmaVersion: 'latest', sourceType: 'module', locations: true, onComment: comments});

    const functionStarts = new Set();
    walk(ast, (node) => {
        if (holdsFunction(node)) functionStarts.add(node.start);
    });

    const commentsByStart = new Map(comments.map((comment) => [comment.start, comment]));
    const claimed = new Set();
    const whitespace = /\s*/y;

    return comments
        .filter((comment) => [VM_COMMENT_LEGAL, VM_COMMENT_STANDARD].includes(code.slice(comment.start, comment.end)))
        .flatMap((marker) => {
            // The next code after the marker, past whitespace and any comments stacked behind it.
            let at = marker.end;

            for (;;) {
                whitespace.lastIndex = at;
                whitespace.exec(code);
                at = whitespace.lastIndex;

                if (!commentsByStart.has(at)) break;
                at = commentsByStart.get(at).end;
            }

            if (functionStarts.has(at) && !claimed.has(at)) {
                claimed.add(at);

                return [];
            }

            return [{
                line: marker.loc.start.line,
                column: marker.loc.start.column + 1,
                followedBy: code.slice(at, at + 40).replace(/\s+/g, ' '),
            }];
        });
}
