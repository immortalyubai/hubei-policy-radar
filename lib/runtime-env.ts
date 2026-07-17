export interface PolicyRuntimeEnv {
  DB?: D1Database;
  POLICY_INGEST_KEY?: string;
}

const ENV_KEY = "__POLICY_RADAR_RUNTIME_ENV__";

export function setRuntimeEnv(value: PolicyRuntimeEnv): void {
  (globalThis as unknown as Record<string, unknown>)[ENV_KEY] = value;
}

export function getRuntimeEnv(): PolicyRuntimeEnv {
  return (
    ((globalThis as unknown as Record<string, unknown>)[ENV_KEY] as
      | PolicyRuntimeEnv
      | undefined) ?? {}
  );
}
