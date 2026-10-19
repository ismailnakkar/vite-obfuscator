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

/** Legal markers in all of a chunk's modules, island or not: the chunk-side count covers them all. */
export function sourceMarkers(moduleIds) {
    return moduleIds.reduce((total, id) => {
        try {
            return total + countMarkers(readFileSync(id, 'utf8'), VM_COMMENT_LEGAL);
        } catch {
            return total; // a virtual module has no file
        }
    }, 0);
}

// A regex, not a parse: acorn cannot read TS, JSX or .vue sources, and these heads look alike in all.
// Skips comments after the marker; a block comment ends at its first `*/`, never a later one.
const MARKED_EXPORT = /^(?:\s|\/\*(?:[^*]|\*(?!\/))*\*\/|\/\/.*)*export\s+(?:(default)\b|(?:async\s+)?function\b\s*\*?\s*([\p{ID_Continue}$]+)|(?:const|let|var)\s+([\p{ID_Continue}$]+))/u;

/**
 * Marked exports the chunk did not render. Tree-shaking keeps a dropped function's legal comment, so
 * the counts still match while the marker lands on the next statement. Only exports are visible
 * (renderedExports): a dropped non-exported function goes unseen.
 */
export function shakenMarkedExports(chunk) {
    return chunk.moduleIds.flatMap((id) => {
        const rendered = chunk.modules[id]?.renderedExports;

        if (!rendered) return [];

        let source;

        try {
            source = readFileSync(id, 'utf8');
        } catch {
            return []; // a virtual module has no file
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
 * Markers that lead no function of their own, which the count guard misses.
 *
 * @throws {SyntaxError} acorn's, when the chunk does not parse
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
            // Skip whitespace and any comments stacked after the marker.
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
