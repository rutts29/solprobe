import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { assert } from "chai";

describe("solprobe-attestation", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.SolprobeAttestation as Program;
  const admin = provider.wallet;

  it("initializes config", async () => {
    await program.methods
      .initializeConfig(new anchor.BN(3600))
      .accounts({})
      .rpc();

    const [configPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("attestation_config")],
      program.programId
    );
    const config = await program.account.attestationConfig.fetch(configPda);
    assert.equal(config.maxAttestationAgeSeconds.toNumber(), 3600);
    assert.ok(config.admin.equals(admin.publicKey));
  });

  it("submits attestation", async () => {
    const jobId = "test-job-001";
    const step = new anchor.BN(42);
    const checkpointHash = Buffer.alloc(32, 1);
    const gpuModel = "T4";
    const metricsHash = Buffer.alloc(32, 2);

    await program.methods
      .submitAttestation(jobId, step, Array.from(checkpointHash), gpuModel, Array.from(metricsHash))
      .accounts({})
      .rpc();

    const [attPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("attestation"),
        Buffer.from(jobId),
        step.toArrayLike(Buffer, "le", 8),
        admin.publicKey.toBuffer(),
      ],
      program.programId
    );
    const att = await program.account.attestation.fetch(attPda);
    assert.equal(att.jobId, jobId);
    assert.equal(att.step.toNumber(), 42);
    assert.equal(att.gpuModel, "T4");
    assert.equal(att.verified, false);
  });

  it("verifies attestation", async () => {
    const jobId = "test-job-001";
    const step = new anchor.BN(42);

    const [attPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("attestation"),
        Buffer.from(jobId),
        step.toArrayLike(Buffer, "le", 8),
        admin.publicKey.toBuffer(),
      ],
      program.programId
    );

    await program.methods
      .verifyAttestation()
      .accounts({ attestation: attPda })
      .rpc();

    const att = await program.account.attestation.fetch(attPda);
    assert.equal(att.verified, true);
  });

  it("rejects double verification", async () => {
    const jobId = "test-job-001";
    const step = new anchor.BN(42);

    const [attPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("attestation"),
        Buffer.from(jobId),
        step.toArrayLike(Buffer, "le", 8),
        admin.publicKey.toBuffer(),
      ],
      program.programId
    );

    try {
      await program.methods
        .verifyAttestation()
        .accounts({ attestation: attPda })
        .rpc();
      assert.fail("Should have thrown");
    } catch (err) {
      assert.include(err.toString(), "AlreadyVerified");
    }
  });
});
