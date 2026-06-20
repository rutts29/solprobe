import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { assert } from "chai";

type AnchorAccount<T> = { fetch(address: anchor.web3.PublicKey): Promise<T> };
type AttestationConfig = {
  maxAttestationAgeSeconds: anchor.BN;
  admin: anchor.web3.PublicKey;
};
type Attestation = {
  jobId: string;
  step: anchor.BN;
  gpuModel: string;
  verified: boolean;
};
type AttestationAccounts = {
  attestationConfig: AnchorAccount<AttestationConfig>;
  attestation: AnchorAccount<Attestation>;
};

describe("solprobe-attestation", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.SolprobeAttestation as Program;
  const accounts = program.account as unknown as AttestationAccounts;
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
    const config = await accounts.attestationConfig.fetch(configPda);
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
    const att = await accounts.attestation.fetch(attPda);
    assert.equal(att.jobId, jobId);
    assert.equal(att.step.toNumber(), 42);
    assert.equal(att.gpuModel, "T4");
    assert.equal(att.verified, false);
  });

  it("accepts realistic GPU model names", async () => {
    const jobId = "test-job-apple";
    const step = new anchor.BN(1);
    const checkpointHash = Buffer.alloc(32, 5);
    const gpuModel = "Apple Silicon";
    const metricsHash = Buffer.alloc(32, 6);

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
    const att = await accounts.attestation.fetch(attPda);
    assert.equal(att.jobId, jobId);
    assert.equal(att.gpuModel, gpuModel);
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

    const att = await accounts.attestation.fetch(attPda);
    assert.equal(att.verified, true);
  });

  it("rejects non-admin verify attempt", async () => {
    const nonAdmin = anchor.web3.Keypair.generate();
    const sig = await provider.connection.requestAirdrop(
      nonAdmin.publicKey,
      1_000_000_000
    );
    await provider.connection.confirmTransaction(sig);

    // Submit a new attestation as nonAdmin
    const jobId2 = "test-job-002";
    const step2 = new anchor.BN(1);
    const checkpointHash2 = Buffer.alloc(32, 3);
    const metricsHash2 = Buffer.alloc(32, 4);

    await program.methods
      .submitAttestation(jobId2, step2, Array.from(checkpointHash2), "L4", Array.from(metricsHash2))
      .accounts({ worker: nonAdmin.publicKey })
      .signers([nonAdmin])
      .rpc();

    const [attPda2] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("attestation"),
        Buffer.from(jobId2),
        step2.toArrayLike(Buffer, "le", 8),
        nonAdmin.publicKey.toBuffer(),
      ],
      program.programId
    );

    try {
      await program.methods
        .verifyAttestation()
        .accounts({
          attestation: attPda2,
          admin: nonAdmin.publicKey,
        })
        .signers([nonAdmin])
        .rpc();
      assert.fail("Should have thrown");
    } catch (err) {
      // has_one = admin constraint should produce ConstraintHasOne error
      assert.include(err.toString(), "ConstraintHasOne");
    }
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
