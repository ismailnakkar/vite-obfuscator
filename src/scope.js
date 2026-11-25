const CLASSIC_FORMATS = ['iife', 'umd'];

/** Rolldown declares a named IIFE's exports as a top-level `var`, unless the name is dotted or `extend` assigns them to `this`. */
function declaresNamedVar({format, name, extend}, chunk) {
    return format === 'iife' && Boolean(name) && !name.includes('.') && !extend && chunk.exports.length > 0;
}

/**
 * javascript-obfuscator declares its string-array helpers beside Rolldown's IIFE or UMD wrapper, not
 * inside it, and a classic script's top-level declarations are window globals another script could
 * replace. A function scope keeps them local, and returns a named IIFE's `var` so it stays global.
 */
export function functionScoped(code, outputOptions, chunk) {
    if (!CLASSIC_FORMATS.includes(outputOptions.format)) return code;

    if (declaresNamedVar(outputOptions, chunk)) {
        return `var ${outputOptions.name} = (function(){${code}\nreturn ${outputOptions.name};}).call(this);`;
    }

    return `(function(){${code}\n}).call(this);`;
}
