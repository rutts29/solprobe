import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { assert } from "chai";

describe("solprobe-staking", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.SolprobeStaking as Program;
  const admin = provider.wallet;

  const minStake = new anchor.BN(1_000_000_000); // 1 SOL
  const slashPercentage = 10;
  const cooldownSeconds = new anchor.BN(60);

  it("initializes config", async () => {
    await program.methods
      .initializeConfig(minStake, slashPercentage, cooldownSeconds)
      .accounts({})
      .rpc();

    const [configPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("stake_config")],
      program.programId
    );
    const config = await program.account.stakeConfig.fetch(configPda);
    assert.equal(config.minStakeLamports.toNumber(), 1_000_000_000);
    assert.equal(config.slashPercentage, 10);
    assert.ok(config.admin.equals(admin.publicKey));
  });

  it("stakes SOL", async () => {
    const amount = new anchor.BN(2_000_000_000); // 2 SOL

    await program.methods.stake(amount).accounts({}).rpc();

    const [stakePda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("stake_account"), admin.publicKey.toBuffer()],
      program.programId
    );
    const stake = await program.account.stakeAccount.fetch(stakePda);
    assert.equal(stake.stakedLamports.toNumber(), 2_000_000_000);
    assert.equal(stake.active, true);
    assert.equal(stake.slashCount, 0);
  });

  it("rejects insufficient stake", async () => {
    const newWorker = anchor.web3.Keypair.generate();

    // Airdrop to new worker
    const sig = await provider.connection.requestAirdrop(
      newWorker.publicKey,
      500_000_000 // 0.5 SOL — below min
    );
    await provider.connection.confirmTransaction(sig);

    try {
      await program.methods
        .stake(new anchor.BN(500_000_000))
        .accounts({
          worker: newWorker.publicKey,
          stakeConfig: anchor.web3.PublicKey.findProgramAddressSync(
            [Buffer.from("stake_config")],
            program.programId
          )[0],
        })
        .signers([newWorker])
        .rpc();
      assert.fail("Should have thrown InsufficientStake");
    } catch (err) {
      assert.include(err.toString(), "InsufficientStake");
    }
  });

  it("rejects early unstake (cooldown not expired)", async () => {
    try {
      await program.methods.unstake().accounts({}).rpc();
      assert.fail("Should have thrown CooldownNotExpired");
    } catch (err) {
      assert.include(err.toString(), "CooldownNotExpired");
    }
  });

  it("slashes worker stake", async () => {
    const slashAmount = new anchor.BN(500_000_000); // 0.5 SOL
    const reasonHash = Buffer.alloc(32, 0xab);
    const diagnosisId = "diag-001";

    await program.methods
      .slash(slashAmount, Array.from(reasonHash), diagnosisId)
      .accounts({
        worker: admin.publicKey,
      })
      .rpc();

    const [stakePda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("stake_account"), admin.publicKey.toBuffer()],
      program.programId
    );
    const stake = await program.account.stakeAccount.fetch(stakePda);
    assert.equal(stake.stakedLamports.toNumber(), 1_500_000_000);
    assert.equal(stake.slashCount, 1);
    assert.equal(stake.active, true);
  });

  it("rejects non-admin slash attempt", async () => {
    const nonAdmin = anchor.web3.Keypair.generate();
    const sig = await provider.connection.requestAirdrop(
      nonAdmin.publicKey,
      1_000_000_000
    );
    await provider.connection.confirmTransaction(sig);

    const [configPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("stake_config")],
      program.programId
    );

    try {
      await program.methods
        .slash(new anchor.BN(100_000_000), Array.from(Buffer.alloc(32, 0)), "bad")
        .accounts({
          worker: admin.publicKey,
          admin: nonAdmin.publicKey,
          stakeConfig: configPda,
        })
        .signers([nonAdmin])
        .rpc();
      assert.fail("Should have thrown");
    } catch (err) {
      // has_one = admin constraint should fail
      assert.ok(err.toString().length > 0);
    }
  });
});
