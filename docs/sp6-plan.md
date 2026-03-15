# SolProbe SP-6: Solana Trust Verification Layer

## Context

SolProbe SP-1 through SP-5 are complete. The system detects GPU training anomalies, diagnoses root causes via LLM, and provides a real-time dashboard. SP-6 adds the **Solana-based trust verification layer** for decentralized compute networks where untrusted workers contribute to training runs.

**Why Solana matters here:** In decentralized training (Prime Intellect's INTELLECT-1/2, EigenLayer's EigenCloud), you can't trust that workers are honest. Solana handles what trust cannot: stake/slash for bad actors, conditional payment release, compute attestation, and on-chain reputation.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                  SOLANA PROGRAMS                     │
│                                                      │
│  ┌─────────────────┐  ┌──────────────────────────┐  │
│  │ Compute          │  │ Job Escrow               │  │
│  │ Attestation      │  │ - Create job with budget │  │
│  │ - Submit proof   │  │ - Deposit SOL            │  │
│  │ - Verify proof   │  │ - Release on completion  │  │
│  │ - Query history  │  │ - Slash on bad compute   │  │
│  └─────────────────┘  └──────────────────────────┘  │
│  ┌─────────────────┐  ┌──────────────────────────┐  │
│  │ Worker           │  │ Stake/Slash              │  │
│  │ Reputation       │  │ - Stake SOL to join      │  │
│  │ - Score tracking │  │ - Slash on fault         │  │
│  │ - Job history    │  │ - Withdraw after cooldown│  │
│  │ - Query by worker│  └──────────────────────────┘  │
│  └─────────────────┘                                 │
└─────────────────────────────────────────────────────┘
         │
         │ (RPC / anchor-client)
         ▼
┌─────────────────────────────────────────────────────┐
│  FastAPI Backend (existing)                          │
│  New: /api/v1/solana/* endpoints                    │
│  - Submit attestation after diagnosis               │
│  - Query worker reputation                          │
│  - Trigger slash when LLM diagnosis confirms fault  │
└─────────────────────────────────────────────────────┘
```

## Programs to Build (Anchor/Rust)

### 1. Compute Attestation (`solprobe_attestation`)
- **Purpose:** Workers submit cryptographic proofs that they completed training steps
- **Accounts:**
  - `Attestation` PDA: worker pubkey + job_id + step → stores checkpoint_hash, timestamp, gpu_model, metrics_hash
  - `AttestationConfig` PDA: admin-controlled config (max attestation age, required fields)
- **Instructions:**
  - `submit_attestation(job_id, step, checkpoint_hash, gpu_model, metrics_hash)`
  - `verify_attestation(job_id, step, worker)` → returns bool
  - `query_attestations(job_id)` → returns all attestations for a job
- **Size:** ~200 bytes per attestation (fits in one Solana account)

### 2. Job Escrow (`solprobe_escrow`)
- **Purpose:** Hold SOL payment for training jobs, release on valid completion, withhold on faults
- **Accounts:**
  - `EscrowJob` PDA: job_id → stores creator, total_budget_lamports, released_lamports, worker_allocations, status (active/completed/disputed)
  - `EscrowVault` PDA: holds the actual SOL
- **Instructions:**
  - `create_job(job_id, budget, worker_pubkeys, per_worker_allocation)` — creator deposits SOL
  - `release_payment(job_id, worker)` — release allocation to worker on valid attestation
  - `slash_payment(job_id, worker, reason, evidence_hash)` — withhold allocation, return to creator
  - `close_job(job_id)` — creator closes completed job, reclaims unallocated funds

### 3. Worker Reputation (`solprobe_reputation`)
- **Purpose:** Track on-chain history of worker performance
- **Accounts:**
  - `WorkerProfile` PDA: worker_pubkey → stores total_jobs, completed_jobs, failed_jobs, total_stake_slashed, reputation_score (u16, 0-10000 = 0-100.00%), registered_at
- **Instructions:**
  - `register_worker()` — create profile
  - `record_completion(worker, job_id)` — increment completed_jobs, update score
  - `record_failure(worker, job_id, slash_amount)` — increment failed_jobs, update score
  - `get_reputation(worker)` → returns WorkerProfile

### 4. Stake/Slash (`solprobe_staking`)
- **Purpose:** Workers stake SOL to participate, slashed on confirmed faults
- **Accounts:**
  - `StakeAccount` PDA: worker_pubkey → stores staked_lamports, locked_until, slash_count
  - `StakeVault` PDA: holds staked SOL
  - `StakeConfig` PDA: admin → min_stake, slash_percentage, cooldown_period
- **Instructions:**
  - `stake(amount)` — deposit SOL, must meet min_stake
  - `slash(worker, amount, reason, diagnosis_id)` — transfer from stake to slash recipient (job creator or protocol)
  - `unstake()` — withdraw after cooldown_period, only if no active jobs
  - `update_config(min_stake, slash_pct, cooldown)` — admin only

## Directory Structure

```
solana/
├── Anchor.toml
├── Cargo.toml              # workspace
├── programs/
│   ├── solprobe-attestation/
│   │   ├── Cargo.toml
│   │   └── src/lib.rs
│   ├── solprobe-escrow/
│   │   ├── Cargo.toml
│   │   └── src/lib.rs
│   ├── solprobe-reputation/
│   │   ├── Cargo.toml
│   │   └── src/lib.rs
│   └── solprobe-staking/
│       ├── Cargo.toml
│       └── src/lib.rs
├── tests/
│   ├── attestation.ts
│   ├── escrow.ts
│   ├── reputation.ts
│   └── staking.ts
├── migrations/
│   └── deploy.ts
└── package.json            # for Anchor test framework (mocha + @coral-xyz/anchor)
```

## Implementation Steps

### Step 1: Anchor workspace scaffold
- `anchor init solana` or manually create workspace
- Configure Anchor.toml for localnet
- Set up 4 programs in workspace

### Step 2: Compute Attestation program
- Define Attestation account struct (PDA seeds: [b"attestation", job_id, step, worker])
- Implement submit_attestation, verify_attestation instructions
- Add constraints: worker must be signer, step must be sequential
- Tests: submit, verify, reject invalid worker

### Step 3: Job Escrow program
- Define EscrowJob + EscrowVault accounts
- Implement create_job (SOL transfer to vault), release_payment, slash_payment, close_job
- CPI to system_program for SOL transfers
- Tests: create job, release payment, slash, close and reclaim

### Step 4: Worker Reputation program
- Define WorkerProfile account (PDA seeds: [b"worker", worker_pubkey])
- Implement register, record_completion, record_failure
- Reputation score: completed_pct * 10000 (e.g., 9500 = 95.00%)
- Tests: register, complete jobs, fail jobs, verify score

### Step 5: Stake/Slash program
- Define StakeAccount + StakeVault + StakeConfig accounts
- Implement stake (transfer SOL to vault), slash (transfer from vault), unstake (with cooldown)
- Admin-only config updates
- Tests: stake, slash, unstake after cooldown, reject early unstake

### Step 6: Integration tests
- Cross-program test: worker stakes → joins job → submits attestation → job releases payment → reputation updated
- Fault scenario: worker stakes → bad attestation → LLM diagnosis → slash → reputation degraded

### Step 7: Backend integration (optional, if time)
- New endpoint: POST /api/v1/solana/attest — submit attestation after diagnosis
- New endpoint: GET /api/v1/solana/reputation/{worker} — query worker score
- Uses anchor-client or solana-py to interact with devnet

## Testing

```bash
cd solana
anchor build
anchor test  # runs mocha tests against localnet
solana-test-validator  # for manual testing
```

## Verification

1. All 4 programs compile: `anchor build`
2. All tests pass: `anchor test`
3. Programs deploy to localnet
4. Full flow: stake → create job → submit attestation → release payment → update reputation
