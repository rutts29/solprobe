import type { Attestation } from "@/components/training/attestations-table";

// SAMPLE DATA: the backend has no /attestations endpoint yet. These rows let
// the Attestations page demonstrate the on-chain feature. The UI labels them
// "devnet sample". Replace getDemoAttestations() with a real fetcher once the
// backend bridge ships.
const MIN = 60_000;

export function getDemoAttestations(): Attestation[] {
  const now = Date.now();
  return [
    { signature: "4Hk2z8qPm7vR3cXy1aDb9wUtNfLe2sJo6VvK0Hp", node_id: "node-a03", outer_step: 8420, job_id: "nano-dilo-01", staked_sol: 16.4, status: "confirmed", slot: 312884071, timestamp_ms: now - 0.4 * MIN, validator: "Probe11...uF9p" },
    { signature: "2rWm8QaZc9FpL3kYxVbN7HdTsEjRoUqi1AeW0Zd", node_id: "node-a01", outer_step: 8420, job_id: "nano-dilo-01", staked_sol: 16.0, status: "confirmed", slot: 312884070, timestamp_ms: now - 1 * MIN, validator: "Probe11...uF9p" },
    { signature: "9Bf3LpQ2sM8vRxKcT6YwHaZdNoEuIj7km0VbC1q", node_id: "node-a07", outer_step: 8419, job_id: "nano-dilo-01", staked_sol: 8.2, status: "pending", slot: 312884069, timestamp_ms: now - 2 * MIN, validator: "ProbeCq...3aKr" },
    { signature: "5KpQ8wZxE2mNvRcHfL6sTbYaD9JjUoIi0nWqV3r", node_id: "node-a02", outer_step: 8419, job_id: "nano-dilo-01", staked_sol: 16.0, status: "confirmed", slot: 312884068, timestamp_ms: now - 4 * MIN, validator: "Probe11...uF9p" },
    { signature: "7HmZkQ1wExNvRcTfL6sPbYaD9JjUoIi2nWqV4tB", node_id: "node-a04", outer_step: 8418, job_id: "nano-dilo-01", staked_sol: 16.0, status: "confirmed", slot: 312884067, timestamp_ms: now - 6 * MIN, validator: "Probe11...uF9p" },
    { signature: "1PqEwZ8kNxMvRcTfL4sPbYaD9JjUoIi3nWqV5cC", node_id: "node-a09", outer_step: 8418, job_id: "nano-dilo-01", staked_sol: 4.1, status: "slashed", slot: 312884066, timestamp_ms: now - 9 * MIN, validator: "ProbeRz...8wQe" },
    { signature: "3TqAwZ7kMxNvRcTfL5sPbYaD9JjUoIi4nWqV6dD", node_id: "node-a05", outer_step: 8417, job_id: "nano-dilo-01", staked_sol: 16.0, status: "confirmed", slot: 312884065, timestamp_ms: now - 12 * MIN, validator: "Probe11...uF9p" },
    { signature: "6UqBwZ5kLxNvRcTfL7sPbYaD9JjUoIi5nWqV7eE", node_id: "node-a06", outer_step: 8417, job_id: "nano-dilo-01", staked_sol: 16.0, status: "confirmed", slot: 312884064, timestamp_ms: now - 18 * MIN, validator: "ProbeCq...3aKr" },
  ];
}
