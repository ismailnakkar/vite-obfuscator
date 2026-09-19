const READY = 'ready';

/*! javascript-obfuscator:vm */
export async function run() {
    const {helper} = await import('./lazy.js');

    return helper() + READY;
}

run();
