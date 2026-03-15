use anchor_lang::prelude::*;

declare_id!("2YPzTvGkQkR5G8vLPBm2cfDXfMkYkQwgNANjKdW4tSMc");

#[program]
pub mod solprobe_reputation {
    use super::*;

    pub fn register_worker(ctx: Context<RegisterWorker>) -> Result<()> {
        let profile = &mut ctx.accounts.worker_profile;
        profile.authority = ctx.accounts.worker.key();
        profile.total_jobs = 0;
        profile.completed_jobs = 0;
        profile.failed_jobs = 0;
        profile.total_stake_slashed = 0;
        profile.reputation_score = 10_000;
        profile.registered_at = Clock::get()?.unix_timestamp;
        profile.bump = ctx.bumps.worker_profile;
        Ok(())
    }

    pub fn record_completion(ctx: Context<UpdateProfile>, _job_id: String) -> Result<()> {
        let profile = &mut ctx.accounts.worker_profile;
        profile.total_jobs = profile.total_jobs.checked_add(1).unwrap();
        profile.completed_jobs = profile.completed_jobs.checked_add(1).unwrap();
        profile.reputation_score = ((profile.completed_jobs as u128 * 10_000) / profile.total_jobs as u128) as u16;
        Ok(())
    }

    pub fn record_failure(ctx: Context<UpdateProfile>, _job_id: String, slash_amount: u64) -> Result<()> {
        let profile = &mut ctx.accounts.worker_profile;
        profile.total_jobs = profile.total_jobs.checked_add(1).unwrap();
        profile.failed_jobs = profile.failed_jobs.checked_add(1).unwrap();
        profile.total_stake_slashed = profile.total_stake_slashed.checked_add(slash_amount).unwrap();
        profile.reputation_score = ((profile.completed_jobs as u128 * 10_000) / profile.total_jobs as u128) as u16;
        Ok(())
    }
}

#[derive(Accounts)]
pub struct RegisterWorker<'info> {
    #[account(
        init,
        payer = worker,
        space = 8 + WorkerProfile::INIT_SPACE,
        seeds = [b"worker_profile", worker.key().as_ref()],
        bump,
    )]
    pub worker_profile: Account<'info, WorkerProfile>,
    #[account(mut)]
    pub worker: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateProfile<'info> {
    #[account(
        mut,
        seeds = [b"worker_profile", authority.key().as_ref()],
        bump = worker_profile.bump,
        has_one = authority @ ReputationError::NotAuthority,
    )]
    pub worker_profile: Account<'info, WorkerProfile>,
    pub authority: Signer<'info>,
}

#[account]
#[derive(InitSpace)]
pub struct WorkerProfile {
    pub authority: Pubkey,
    pub total_jobs: u64,
    pub completed_jobs: u64,
    pub failed_jobs: u64,
    pub total_stake_slashed: u64,
    pub reputation_score: u16,
    pub registered_at: i64,
    pub bump: u8,
}

#[error_code]
pub enum ReputationError {
    #[msg("Worker profile already registered")]
    AlreadyRegistered,
    #[msg("Signer is not the profile authority")]
    NotAuthority,
}
