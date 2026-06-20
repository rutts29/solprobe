import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { assert } from "chai";

type AnchorAccount<T> = { fetch(address: anchor.web3.PublicKey): Promise<T> };
type WorkerProfile = {
  reputationScore: number;
  totalJobs: anchor.BN;
  completedJobs: anchor.BN;
  failedJobs: anchor.BN;
  totalStakeSlashed: anchor.BN;
  authority: anchor.web3.PublicKey;
};
type ReputationAccounts = {
  workerProfile: AnchorAccount<WorkerProfile>;
};

describe("solprobe-reputation", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.SolprobeReputation as Program;
  const accounts = program.account as unknown as ReputationAccounts;
  const worker = provider.wallet;

  it("registers worker", async () => {
    await program.methods.registerWorker().accounts({}).rpc();

    const [profilePda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("worker_profile"), worker.publicKey.toBuffer()],
      program.programId
    );
    const profile = await accounts.workerProfile.fetch(profilePda);
    assert.equal(profile.reputationScore, 10000);
    assert.equal(profile.totalJobs.toNumber(), 0);
    assert.ok(profile.authority.equals(worker.publicKey));
  });

  it("records completion and updates score", async () => {
    await program.methods.recordCompletion("job-1").accounts({}).rpc();

    const [profilePda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("worker_profile"), worker.publicKey.toBuffer()],
      program.programId
    );
    const profile = await accounts.workerProfile.fetch(profilePda);
    assert.equal(profile.totalJobs.toNumber(), 1);
    assert.equal(profile.completedJobs.toNumber(), 1);
    assert.equal(profile.reputationScore, 10000); // 100%
  });

  it("records failure and degrades score", async () => {
    await program.methods
      .recordFailure("job-2", new anchor.BN(1_000_000))
      .accounts({})
      .rpc();

    const [profilePda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("worker_profile"), worker.publicKey.toBuffer()],
      program.programId
    );
    const profile = await accounts.workerProfile.fetch(profilePda);
    assert.equal(profile.totalJobs.toNumber(), 2);
    assert.equal(profile.completedJobs.toNumber(), 1);
    assert.equal(profile.failedJobs.toNumber(), 1);
    assert.equal(profile.reputationScore, 5000); // 50%
    assert.equal(profile.totalStakeSlashed.toNumber(), 1_000_000);
  });
});
