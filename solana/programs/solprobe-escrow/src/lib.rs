use anchor_lang::prelude::*;
use anchor_lang::system_program;

declare_id!("HmbTLCmaGtYhSJaoxkmkiQuogZwkN5x1hKXEDoN6BqeN");

const MAX_JOB_ID_LEN: usize = 32;
const MAX_WORKERS: usize = 10;

#[program]
pub mod solprobe_escrow {
    use super::*;

    pub fn create_job(
        ctx: Context<CreateJob>,
        job_id: String,
        worker_pubkeys: Vec<Pubkey>,
        per_worker_allocation: u64,
    ) -> Result<()> {
        require!(job_id.len() <= MAX_JOB_ID_LEN, EscrowError::JobIdTooLong);
        require!(!worker_pubkeys.is_empty(), EscrowError::NoWorkers);
        require!(worker_pubkeys.len() <= MAX_WORKERS, EscrowError::TooManyWorkers);
        require!(per_worker_allocation > 0, EscrowError::ZeroAllocation);

        let total_budget = per_worker_allocation
            .checked_mul(worker_pubkeys.len() as u64)
            .ok_or(EscrowError::Overflow)?;

        // Transfer SOL from creator to vault
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.creator.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                },
            ),
            total_budget,
        )?;

        let escrow = &mut ctx.accounts.escrow_job;
        escrow.creator = ctx.accounts.creator.key();
        escrow.job_id = job_id;
        escrow.total_budget = total_budget;
        escrow.released_amount = 0;
        escrow.status = JobStatus::Active;
        escrow.workers = worker_pubkeys
            .iter()
            .map(|pk| WorkerAllocation {
                worker: *pk,
                allocation: per_worker_allocation,
                released: false,
            })
            .collect();
        escrow.created_at = Clock::get()?.unix_timestamp;
        escrow.bump = ctx.bumps.escrow_job;

        Ok(())
    }

    pub fn release_payment(ctx: Context<ReleasePayment>, _job_id: String) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow_job;
        require!(escrow.status == JobStatus::Active, EscrowError::JobNotActive);

        let worker_key = ctx.accounts.worker.key();
        let allocation_entry = escrow
            .workers
            .iter_mut()
            .find(|w| w.worker == worker_key)
            .ok_or(EscrowError::WorkerNotFound)?;

        require!(!allocation_entry.released, EscrowError::AlreadyReleased);

        let amount = allocation_entry.allocation;
        allocation_entry.released = true;
        escrow.released_amount = escrow
            .released_amount
            .checked_add(amount)
            .ok_or(EscrowError::Overflow)?;

        // Transfer from vault to worker via PDA signer
        let vault = &ctx.accounts.vault;
        let worker_info = &ctx.accounts.worker;

        **vault.to_account_info().try_borrow_mut_lamports()? -= amount;
        **worker_info.to_account_info().try_borrow_mut_lamports()? += amount;

        Ok(())
    }

    pub fn slash_payment(
        ctx: Context<SlashPayment>,
        _job_id: String,
        worker_index: u8,
        _reason: String,
        _evidence_hash: [u8; 32],
    ) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow_job;
        require!(escrow.status == JobStatus::Active, EscrowError::JobNotActive);
        require!(
            (worker_index as usize) < escrow.workers.len(),
            EscrowError::InvalidWorkerIndex
        );

        let allocation_entry = &mut escrow.workers[worker_index as usize];
        require!(!allocation_entry.released, EscrowError::AlreadyReleased);

        let amount = allocation_entry.allocation;
        allocation_entry.released = true;

        escrow.released_amount = escrow
            .released_amount
            .checked_add(amount)
            .ok_or(EscrowError::Overflow)?;

        // Transfer from vault back to creator
        let vault = &ctx.accounts.vault;
        let creator = &ctx.accounts.creator;

        **vault.to_account_info().try_borrow_mut_lamports()? -= amount;
        **creator.to_account_info().try_borrow_mut_lamports()? += amount;

        Ok(())
    }

    pub fn close_job(ctx: Context<CloseJob>, _job_id: String) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow_job;
        require!(escrow.status == JobStatus::Active, EscrowError::JobNotActive);

        escrow.status = JobStatus::Completed;

        // Reclaim any remaining SOL from vault back to creator
        let vault = &ctx.accounts.vault;
        let creator = &ctx.accounts.creator;
        let remaining = vault.to_account_info().lamports();

        if remaining > 0 {
            **vault.to_account_info().try_borrow_mut_lamports()? -= remaining;
            **creator.to_account_info().try_borrow_mut_lamports()? += remaining;
        }

        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Account structs
// ---------------------------------------------------------------------------

#[derive(Accounts)]
#[instruction(job_id: String, worker_pubkeys: Vec<Pubkey>, per_worker_allocation: u64)]
pub struct CreateJob<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        init,
        payer = creator,
        space = EscrowJob::space(worker_pubkeys.len()),
        seeds = [b"escrow_job", job_id.as_bytes()],
        bump,
    )]
    pub escrow_job: Account<'info, EscrowJob>,

    /// CHECK: PDA used as a SOL vault, no data stored
    #[account(
        mut,
        seeds = [b"escrow_vault", job_id.as_bytes()],
        bump,
    )]
    pub vault: SystemAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(job_id: String)]
pub struct ReleasePayment<'info> {
    #[account(
        mut,
        seeds = [b"escrow_job", job_id.as_bytes()],
        bump = escrow_job.bump,
    )]
    pub escrow_job: Account<'info, EscrowJob>,

    /// CHECK: PDA vault holding SOL
    #[account(
        mut,
        seeds = [b"escrow_vault", job_id.as_bytes()],
        bump,
    )]
    pub vault: SystemAccount<'info>,

    #[account(mut)]
    pub worker: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(job_id: String)]
pub struct SlashPayment<'info> {
    #[account(
        mut,
        seeds = [b"escrow_job", job_id.as_bytes()],
        bump = escrow_job.bump,
        has_one = creator,
    )]
    pub escrow_job: Account<'info, EscrowJob>,

    /// CHECK: PDA vault holding SOL
    #[account(
        mut,
        seeds = [b"escrow_vault", job_id.as_bytes()],
        bump,
    )]
    pub vault: SystemAccount<'info>,

    #[account(mut)]
    pub creator: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(job_id: String)]
pub struct CloseJob<'info> {
    #[account(
        mut,
        seeds = [b"escrow_job", job_id.as_bytes()],
        bump = escrow_job.bump,
        has_one = creator,
    )]
    pub escrow_job: Account<'info, EscrowJob>,

    /// CHECK: PDA vault holding SOL
    #[account(
        mut,
        seeds = [b"escrow_vault", job_id.as_bytes()],
        bump,
    )]
    pub vault: SystemAccount<'info>,

    #[account(mut)]
    pub creator: Signer<'info>,

    pub system_program: Program<'info, System>,
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

#[account]
pub struct EscrowJob {
    pub creator: Pubkey,       // 32
    pub job_id: String,        // 4 + len
    pub total_budget: u64,     // 8
    pub released_amount: u64,  // 8
    pub status: JobStatus,     // 1
    pub workers: Vec<WorkerAllocation>, // 4 + n * WorkerAllocation::SIZE
    pub created_at: i64,       // 8
    pub bump: u8,              // 1
}

impl EscrowJob {
    pub fn space(num_workers: usize) -> usize {
        8  // anchor discriminator
        + 32 // creator
        + 4 + MAX_JOB_ID_LEN // job_id (String: 4-byte len prefix + max chars)
        + 8  // total_budget
        + 8  // released_amount
        + 1  // status
        + 4 + (num_workers * WorkerAllocation::SIZE) // workers vec
        + 8  // created_at
        + 1  // bump
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default)]
pub struct WorkerAllocation {
    pub worker: Pubkey,   // 32
    pub allocation: u64,  // 8
    pub released: bool,   // 1
}

impl WorkerAllocation {
    pub const SIZE: usize = 32 + 8 + 1;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, Default)]
pub enum JobStatus {
    #[default]
    Active,    // 0
    Completed, // 1
    Disputed,  // 2
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

#[error_code]
pub enum EscrowError {
    #[msg("Job ID exceeds maximum length of 32 bytes")]
    JobIdTooLong,
    #[msg("At least one worker is required")]
    NoWorkers,
    #[msg("Maximum 10 workers allowed")]
    TooManyWorkers,
    #[msg("Per-worker allocation must be greater than zero")]
    ZeroAllocation,
    #[msg("Arithmetic overflow")]
    Overflow,
    #[msg("Job is not in Active status")]
    JobNotActive,
    #[msg("Worker not found in job allocations")]
    WorkerNotFound,
    #[msg("Worker allocation already released")]
    AlreadyReleased,
    #[msg("Invalid worker index")]
    InvalidWorkerIndex,
}
