# Compute verification experiments

These Anchor programs explore how training-job evidence could connect to worker payments and reputation in distributed compute. They are separate from SolProbe's telemetry and alert workflow.

| Program | Purpose |
| --- | --- |
| [`solprobe-attestation`](programs/solprobe-attestation/) | Records a worker's job, step, checkpoint hash, metrics hash, and GPU model; an authorized verifier can confirm the record. |
| [`solprobe-escrow`](programs/solprobe-escrow/) | Allocates a job budget across workers and models releasing or slashing their payments. |
| [`solprobe-reputation`](programs/solprobe-reputation/) | Tracks worker reputation records. |
| [`solprobe-staking`](programs/solprobe-staking/) | Models worker stake and withdrawal or penalty operations. |

The monitoring backend does not submit transactions to these programs. The dashboard's attestation view uses labelled sample data. These programs and the [Anchor tests](tests/) let readers inspect the compute-verification design independently of the local monitoring demo.

[`Anchor.toml`](Anchor.toml) contains the local-validator configuration and test command. The workspace is in [`Cargo.toml`](Cargo.toml), with JavaScript test dependencies in [`package.json`](package.json). Chain deployment and token operations require a separate, deliberate setup; the main SolProbe quick start does not invoke them.

[MIT](LICENSE). Copyright (c) 2026 Ruttansh Bhatelia.
