// Each overload signature marked: TS strips the signatures but keeps their markers.
/*! javascript-obfuscator:vm */
function pick(a: string): string;
/*! javascript-obfuscator:vm */
function pick(a: number): number;
/*! javascript-obfuscator:vm */
function pick(a: unknown) {
    return a;
}

console.log(pick(1));
