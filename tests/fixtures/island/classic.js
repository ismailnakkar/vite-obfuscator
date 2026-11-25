import {helper} from './lazy.js';

export const result = helper();

globalThis.ran = result;
