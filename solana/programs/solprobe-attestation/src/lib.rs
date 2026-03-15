use anchor_lang::prelude::*;

declare_id!("CBx4v7NFTMbiigjYxCckgany73xH9tGFJL2PAMZcvn4n");

#[program]
pub mod solprobe_attestation {
    use super::*;

    pub fn initialize_config(
        ctx: Context<InitializeConfig>,
        max_attestation_age_seconds: i64,
    ) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.admin = ctx.accounts.admin.key();
        config.max_attestation_age_seconds = max_attestation_age_seconds;
        config.bump = ctx.bumps.config;
        Ok(())
    }

    pub fn submit_attestation(
        ctx: Context<SubmitAttestation>,
        job_id: String,
        step: u64,
        checkpoint_hash: [u8; 32],
        gpu_model: String,
        metrics_hash: [u8; 32],
    ) -> Result<()> {
        require!(job_id.len() <= 32, AttestationError::JobIdTooLong);
        require!(gpu_model.len() <= 8, AttestationError::GpuModelTooLong);

        let clock = Clock::get()?;
        let attestation = &mut ctx.accounts.attestation;
        attestation.worker = ctx.accounts.worker.key();
        attestation.job_id = job_id;
        attestation.step = step;
        attestation.checkpoint_hash = checkpoint_hash;
        attestation.gpu_model = gpu_model;
        attestation.metrics_hash = metrics_hash;
        attestation.timestamp = clock.unix_timestamp;
        attestation.verified = false;
        attestation.bump = ctx.bumps.attestation;
        Ok(())
    }

    pub fn verify_attestation(ctx: Context<VerifyAttestation>) -> Result<()> {
        let attestation = &mut ctx.accounts.attestation;
        require!(!attestation.verified, AttestationError::AlreadyVerified);

        let clock = Clock::get()?;
        let config = &ctx.accounts.config;
        let age = clock.unix_timestamp - attestation.timestamp;
        require!(
            age <= config.max_attestation_age_seconds,
            AttestationError::AttestationTooOld
        );

        attestation.verified = true;
        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(
        init,
        payer = admin,
        space = 8 + AttestationConfig::INIT_SPACE,
        seeds = [b"attestation_config"],
        bump,
    )]
    pub config: Account<'info, AttestationConfig>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(job_id: String, step: u64)]
pub struct SubmitAttestation<'info> {
    #[account(
        init,
        payer = worker,
        space = 8 + Attestation::INIT_SPACE,
        seeds = [
            b"attestation",
            job_id.as_bytes(),
            &step.to_le_bytes(),
            worker.key().as_ref(),
        ],
        bump,
    )]
    pub attestation: Account<'info, Attestation>,
    #[account(mut)]
    pub worker: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct VerifyAttestation<'info> {
    #[account(mut)]
    pub attestation: Account<'info, Attestation>,
    #[account(
        seeds = [b"attestation_config"],
        bump = config.bump,
        has_one = admin,
    )]
    pub config: Account<'info, AttestationConfig>,
    pub admin: Signer<'info>,
}

#[account]
#[derive(InitSpace)]
pub struct AttestationConfig {
    pub admin: Pubkey,
    pub max_attestation_age_seconds: i64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Attestation {
    pub worker: Pubkey,
    #[max_len(32)]
    pub job_id: String,
    pub step: u64,
    pub checkpoint_hash: [u8; 32],
    #[max_len(8)]
    pub gpu_model: String,
    pub metrics_hash: [u8; 32],
    pub timestamp: i64,
    pub verified: bool,
    pub bump: u8,
}

#[error_code]
pub enum AttestationError {
    #[msg("Job ID exceeds maximum length of 32 bytes")]
    JobIdTooLong,
    #[msg("GPU model exceeds maximum length of 8 bytes")]
    GpuModelTooLong,
    #[msg("Attestation has already been verified")]
    AlreadyVerified,
    #[msg("Attestation is too old to verify")]
    AttestationTooOld,
}
