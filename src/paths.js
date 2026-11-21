/** Module ids use `/`; a root resolved on Windows, or an include written there, may use `\`. */
export const toPosix = (path) => path.replaceAll('\\', '/');

/** `id` is `root` or under it, on whole segments: '…/links-extra' is not under '…/links'. */
export const isWithin = (id, root) => id === root || id.startsWith(`${root}/`);

/** `id` ends with `suffix` on whole segments: 'first.js' matches '…/x/first.js', not '…/not-first.js'. */
export const endsWithPath = (id, suffix) => id === suffix || id.endsWith(`/${suffix}`);
