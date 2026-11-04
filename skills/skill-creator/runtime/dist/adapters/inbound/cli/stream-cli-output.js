/** Adapts two text streams to Commander callbacks; does not own or close them. */
export class StreamCliOutput {
    stdout;
    stderr;
    constructor(stdout, stderr) {
        this.stdout = stdout;
        this.stderr = stderr;
    }
    // Arrow fields retain this when Commander calls them as detached callbacks.
    writeOut = (text) => {
        this.stdout.write(text);
    };
    writeErr = (text) => {
        this.stderr.write(text);
    };
}
