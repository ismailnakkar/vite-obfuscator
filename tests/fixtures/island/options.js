// A single-use options object: Rolldown inlines it into its one use, minified or not.
const options = {
    /*! javascript-obfuscator:vm */
    mounted() {
        return 1;
    },
};

console.log(options.mounted());
