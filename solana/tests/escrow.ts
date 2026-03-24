import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { assert } from "chai";

describe("solprobe-escrow", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.SolprobeEscrow as Program;
  const creator = provider.wallet;

  const jobId = "escrow-test-001";
  const worker1 = anchor.web3.Keypair.generate();
  const worker2 = anchor.web3.Keypair.generate();
  const perWorkerAllocation = new anchor.BN(500_000_000); // 0.5 SOL each

  it("creates job with SOL deposit", async () => {
    await program.methods
      .createJob(jobId, [worker1.publicKey, worker2.publicKey], perWorkerAllocation)
      .accounts({})
      .rpc();

    const [escrowPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("escrow_job"), Buffer.from(jobId)],
      program.programId
    );
    const escrow = await program.account.escrowJob.fetch(escrowPda);
    assert.equal(escrow.jobId, jobId);
    assert.equal(escrow.totalBudget.toNumber(), 1_000_000_000);
    assert.equal(escrow.releasedAmount.toNumber(), 0);
    assert.equal(escrow.workers.length, 2);
    assert.ok(escrow.creator.equals(creator.publicKey));
  });

  it("releases payment to worker", async () => {
    // Airdrop to worker1 so they can sign
    const sig = await provider.connection.requestAirdrop(
      worker1.publicKey,
      100_000_000
    );
    await provider.connection.confirmTransaction(sig);

    const balBefore = await provider.connection.getBalance(worker1.publicKey);

    await program.methods
      .releasePayment(jobId)
      .accounts({ worker: worker1.publicKey })
      .signers([worker1])
      .rpc();

    const balAfter = await provider.connection.getBalance(worker1.publicKey);
    assert.isAbove(balAfter, balBefore); // Worker got paid

    const [escrowPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("escrow_job"), Buffer.from(jobId)],
      program.programId
    );
    const escrow = await program.account.escrowJob.fetch(escrowPda);
    assert.equal(escrow.releasedAmount.toNumber(), 500_000_000);
  });

  it("slashes worker payment", async () => {
    const evidenceHash = Buffer.alloc(32, 3);

    await program.methods
      .slashPayment(jobId, 1, "bad compute", Array.from(evidenceHash))
      .accounts({})
      .rpc();

    const [escrowPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("escrow_job"), Buffer.from(jobId)],
      program.programId
    );
    const escrow = await program.account.escrowJob.fetch(escrowPda);
    assert.equal(escrow.releasedAmount.toNumber(), 1_000_000_000); // Both allocations handled
  });

  it("rejects close_job before all workers settled", async () => {
    const unsettledJobId = "escrow-unsettled-001";
    const w = anchor.web3.Keypair.generate();

    await program.methods
      .createJob(unsettledJobId, [w.publicKey], new anchor.BN(100_000_000))
      .accounts({})
      .rpc();

    try {
      await program.methods.closeJob(unsettledJobId).accounts({}).rpc();
      assert.fail("Should have thrown WorkersNotSettled");
    } catch (err) {
      assert.include(err.toString(), "WorkersNotSettled");
    }
  });

  it("closes job and reclaims remaining", async () => {
    await program.methods.closeJob(jobId).accounts({}).rpc();

    const [escrowPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("escrow_job"), Buffer.from(jobId)],
      program.programId
    );
    const escrow = await program.account.escrowJob.fetch(escrowPda);
    assert.deepEqual(escrow.status, { completed: {} });
  });
});
