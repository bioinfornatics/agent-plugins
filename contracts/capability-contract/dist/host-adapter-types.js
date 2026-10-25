export const HOST_ADAPTER_PROTOCOL_VERSION = "1.0.0";
export const HOST_ADAPTER_SCHEMA_ID = "https://agent-plugins.org/schemas/host-execution-adapter/1.0.0/host-execution-adapter.schema.json";
export const HOST_EVENT_SCHEMA_ID = "https://agent-plugins.org/schemas/host-execution-adapter/1.0.0/host-execution-event.schema.json";
export class HostAdapterError extends Error {
    data;
    constructor(data) { super(data.message); this.name = "HostAdapterError"; this.data = data; }
}
