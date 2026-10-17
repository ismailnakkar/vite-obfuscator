// The shape of a real consumer: markers on non-exported `const` arrows, one on the exported entry point.
const config = globalThis.appConfig ?? {};

/*! javascript-obfuscator:vm */
const warning = () =>
    '<div class="alert">' + config.message + '</div>';

/*! javascript-obfuscator:vm */
const clearLoading = (button) => {
    button.querySelectorAll('.spinner').forEach((el) => el.remove());
    button.disabled = false;
};

/*! javascript-obfuscator:vm */
const detect = async () => {
    const response = await fetch('/ads.js').catch(() => null);

    return response === null;
};

/*! javascript-obfuscator:vm */
export function init(button) {
    detect().then((blocked) => {
        if (blocked) button.innerHTML = warning();
        else clearLoading(button);
    });
}
