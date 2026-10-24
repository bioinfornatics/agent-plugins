export class PairedExecutionError extends Error {
    code;
    exitReason;
    exitCode;
    evidence;
    provider;
    constructor(code, message, exitReason, exitCode = null, evidence, provider) {
        super(message);
        this.code = code;
        this.exitReason = exitReason;
        this.exitCode = exitCode;
        this.evidence = evidence;
        this.provider = provider;
        this.name = "PairedExecutionError";
    }
}
