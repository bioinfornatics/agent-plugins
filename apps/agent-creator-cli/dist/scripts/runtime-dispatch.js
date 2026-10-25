class EmbeddedExit {
    status;
    constructor(status) {
        this.status = status;
    }
}
export async function runEmbedded(main, argv) {
    const originalArgv = process.argv;
    const originalExit = process.exit;
    const originalLog = console.log;
    const originalError = console.error;
    const originalStdoutWrite = process.stdout.write;
    const originalStderrWrite = process.stderr.write;
    let stdout = "", stderr = "", status = 0;
    const append = (target, values) => {
        const text = values.map(value => typeof value === "string" ? value : String(value)).join(" ") + "\n";
        if (target === "stdout")
            stdout += text;
        else
            stderr += text;
    };
    try {
        process.argv = [originalArgv[0] ?? "creator", "embedded-command", ...argv];
        process.exit = ((code = 0) => { throw new EmbeddedExit(code); });
        console.log = (...values) => append("stdout", values);
        console.error = (...values) => append("stderr", values);
        process.stdout.write = ((chunk) => { stdout += String(chunk); return true; });
        process.stderr.write = ((chunk) => { stderr += String(chunk); return true; });
        const result = await main();
        if (typeof result === "number")
            status = result;
    }
    catch (error) {
        if (error instanceof EmbeddedExit)
            status = error.status;
        else
            throw error;
    }
    finally {
        process.argv = originalArgv;
        process.exit = originalExit;
        console.log = originalLog;
        console.error = originalError;
        process.stdout.write = originalStdoutWrite;
        process.stderr.write = originalStderrWrite;
    }
    return { status, stdout, stderr };
}
