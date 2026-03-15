use anchor_lang::prelude::*;
use anchor_lang::system_program;

declare_id!("6KwGEfxmPQjYR7iyDrLQcvSk9xAyNPHBuWdUYEiWMGfR");

#[program]
pub mod solprobe_staking {
    use super::*;

    pub fn initialize_config(
        ctx: Context<InitializeConfig>,
        min_stake: u64,
        slash_percentage: u8,
        cooldown_seconds: i64,
    ) -> Result<()> {
        require!(
            slash_percentage <= 100,
            StakingError::InvalidSlashPercentage
        );

        let config = &mut ctx.accounts.stake_config;
        config.admin = ctx.accounts.admin.key();
        config.min_stake_lamports = min_stake;
        config.slash_percentage = slash_percentage;
        config.cooldown_seconds = cooldown_seconds;
        config.bump = ctx.bumps.stake_config;

        Ok(())
    }

    pub fn stake(ctx: Context<Stake>, amount: u64) -> Result<()> {
        let config = &ctx.accounts.stake_config;
        require!(amount >= config.min_stake_lamports, StakingError::InsufficientStake);

        let clock = Clock::get()?;

        // Transfer SOL from worker to vault
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.worker.to_account_info(),
                    to: ctx.accounts.stake_vault.to_account_info(),
                },
            ),
            amount,
        )?;

        let stake_account = &mut ctx.accounts.stake_account;
        stake_account.worker = ctx.accounts.worker.key();
        stake_account.staked_lamports = stake_account.staked_lamports.checked_add(amount).unwrap();
        stake_account.staked_at = clock.unix_timestamp;
        stake_account.locked_until = clock
            .unix_timestamp
            .checked_add(config.cooldown_seconds)
            .unwrap();
        stake_account.active = true;
        stake_account.bump = ctx.bumps.stake_account;

        Ok(())
    }

    pub fn slash(
        ctx: Context<Slash>,
        amount: u64,
        _reason_hash: [u8; 32],
        _diagnosis_id: String,
    ) -> Result<()> {
        require!(
            ctx.accounts.admin.key() == ctx.accounts.stake_config.admin,
            StakingError::NotAdmin
        );

        let stake_account = &mut ctx.accounts.stake_account;
        require!(stake_account.active, StakingError::StakeNotActive);

        let clock = Clock::get()?;
        let config = &ctx.accounts.stake_config;

        // Transfer lamports from vault to admin
        let worker_key = ctx.accounts.worker.key();
        let vault_seeds: &[&[u8]] = &[
            b"stake_vault",
            worker_key.as_ref(),
            &[ctx.bumps.stake_vault],
        ];

        let vault_info = ctx.accounts.stake_vault.to_account_info();
        let admin_info = ctx.accounts.admin.to_account_info();

        **vault_info.try_borrow_mut_lamports()? -= amount;
        **admin_info.try_borrow_mut_lamports()? += amount;

        stake_account.staked_lamports = stake_account.staked_lamports.saturating_sub(amount);
        stake_account.slash_count = stake_account.slash_count.checked_add(1).unwrap();
        stake_account.locked_until = clock
            .unix_timestamp
            .checked_add(config.cooldown_seconds)
            .unwrap();

        // Deactivate if fully slashed
        if stake_account.staked_lamports == 0 {
            stake_account.active = false;
        }

        Ok(())
    }

    pub fn unstake(ctx: Context<Unstake>) -> Result<()> {
        let stake_account = &mut ctx.accounts.stake_account;
        require!(stake_account.active, StakingError::StakeNotActive);

        let clock = Clock::get()?;
        require!(
            clock.unix_timestamp >= stake_account.locked_until,
            StakingError::CooldownNotExpired
        );

        let amount = stake_account.staked_lamports;

        // Transfer all lamports from vault back to worker
        let vault_info = ctx.accounts.stake_vault.to_account_info();
        let worker_info = ctx.accounts.worker.to_account_info();

        **vault_info.try_borrow_mut_lamports()? -= amount;
        **worker_info.try_borrow_mut_lamports()? += amount;

        stake_account.staked_lamports = 0;
        stake_account.active = false;

        Ok(())
    }

    pub fn update_config(
        ctx: Context<UpdateConfig>,
        min_stake: u64,
        slash_percentage: u8,
        cooldown_seconds: i64,
    ) -> Result<()> {
        require!(
            slash_percentage <= 100,
            StakingError::InvalidSlashPercentage
        );
        require!(
            ctx.accounts.admin.key() == ctx.accounts.stake_config.admin,
            StakingError::NotAdmin
        );

        let config = &mut ctx.accounts.stake_config;
        config.min_stake_lamports = min_stake;
        config.slash_percentage = slash_percentage;
        config.cooldown_seconds = cooldown_seconds;

        Ok(())
    }
}

// ── Accounts ────────────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(
        init,
        payer = admin,
        space = 8 + StakeConfig::INIT_SPACE,
        seeds = [b"stake_config"],
        bump,
    )]
    pub stake_config: Account<'info, StakeConfig>,

    #[account(mut)]
    pub admin: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Stake<'info> {
    #[account(
        init,
        payer = worker,
        space = 8 + StakeAccount::INIT_SPACE,
        seeds = [b"stake_account", worker.key().as_ref()],
        bump,
    )]
    pub stake_account: Account<'info, StakeAccount>,

    /// CHECK: PDA vault that holds staked SOL. Validated by seeds.
    #[account(
        mut,
        seeds = [b"stake_vault", worker.key().as_ref()],
        bump,
    )]
    pub stake_vault: SystemAccount<'info>,

    #[account(
        seeds = [b"stake_config"],
        bump = stake_config.bump,
    )]
    pub stake_config: Account<'info, StakeConfig>,

    #[account(mut)]
    pub worker: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Slash<'info> {
    #[account(
        mut,
        seeds = [b"stake_account", worker.key().as_ref()],
        bump = stake_account.bump,
    )]
    pub stake_account: Account<'info, StakeAccount>,

    /// CHECK: PDA vault that holds staked SOL. Validated by seeds.
    #[account(
        mut,
        seeds = [b"stake_vault", worker.key().as_ref()],
        bump,
    )]
    pub stake_vault: SystemAccount<'info>,

    #[account(
        seeds = [b"stake_config"],
        bump = stake_config.bump,
    )]
    pub stake_config: Account<'info, StakeConfig>,

    /// CHECK: Worker whose stake is being slashed. Not a signer.
    pub worker: AccountInfo<'info>,

    #[account(mut)]
    pub admin: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Unstake<'info> {
    #[account(
        mut,
        seeds = [b"stake_account", worker.key().as_ref()],
        bump = stake_account.bump,
    )]
    pub stake_account: Account<'info, StakeAccount>,

    /// CHECK: PDA vault that holds staked SOL. Validated by seeds.
    #[account(
        mut,
        seeds = [b"stake_vault", worker.key().as_ref()],
        bump,
    )]
    pub stake_vault: SystemAccount<'info>,

    #[account(mut)]
    pub worker: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    #[account(
        mut,
        seeds = [b"stake_config"],
        bump = stake_config.bump,
    )]
    pub stake_config: Account<'info, StakeConfig>,

    #[account(mut)]
    pub admin: Signer<'info>,
}

// ── State ───────────────────────────────────────────────────────────────────

#[account]
#[derive(InitSpace)]
pub struct StakeConfig {
    pub admin: Pubkey,
    pub min_stake_lamports: u64,
    pub slash_percentage: u8,
    pub cooldown_seconds: i64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct StakeAccount {
    pub worker: Pubkey,
    pub staked_lamports: u64,
    pub staked_at: i64,
    pub locked_until: i64,
    pub slash_count: u32,
    pub active: bool,
    pub bump: u8,
}

// ── Errors ──────────────────────────────────────────────────────────────────

#[error_code]
pub enum StakingError {
    #[msg("Stake amount is below the minimum required")]
    InsufficientStake,
    #[msg("Cooldown period has not expired")]
    CooldownNotExpired,
    #[msg("Only the admin can perform this action")]
    NotAdmin,
    #[msg("Stake is not active")]
    StakeNotActive,
    #[msg("Slash percentage must be between 0 and 100")]
    InvalidSlashPercentage,
}
