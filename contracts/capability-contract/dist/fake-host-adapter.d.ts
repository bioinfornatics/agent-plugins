import type { HostArtifactExchange, HostArtifactRequest, HostCancellationRequest, HostCancellationResponse, HostCapabilityReport, HostEventEnvelope, HostExecutionAdapter, HostNegotiationRequest, HostNegotiationResult, HostResumeRequest, HostRunRequest } from "./host-adapter-types.js";
export interface FakeHostAdapterOptions {
    report?: HostCapabilityReport;
    clock?: string;
}
export declare function createFakeCapabilityReport(overrides?: Partial<HostCapabilityReport>): HostCapabilityReport;
export declare class FakeHostAdapter implements HostExecutionAdapter {
    readonly report: HostCapabilityReport;
    private readonly runs;
    private readonly clock;
    constructor(options?: FakeHostAdapterOptions);
    discover(request: HostNegotiationRequest): Promise<HostNegotiationResult>;
    private event;
    submit(request: HostRunRequest): AsyncIterable<HostEventEnvelope>;
    cancel(request: HostCancellationRequest): Promise<HostCancellationResponse>;
    resume(request: HostResumeRequest): AsyncIterable<HostEventEnvelope>;
    exchangeArtifact(request: HostArtifactRequest): Promise<HostArtifactExchange>;
}
